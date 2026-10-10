// Run with Node and @electric-sql/pglite available, or set PGLITE_MODULE to its
// absolute dist/index.js path. Uses an isolated in-memory PostgreSQL database.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { PGlite } = await import(process.env.PGLITE_MODULE ?? '@electric-sql/pglite');
const db = new PGlite();
let checks = 0;
const id = n => String(n);
const owner = id(1), subscriber = id(2), user = id(3);
const taxonomy = id(10), v1 = id(11), v2 = id(12), segment = id(20), option = id(30);
const version = (v, number, extra = '') => `INSERT INTO public.taxonomy_versions
  (id, taxonomy_id, version_number, product_family_name, created_by_user_id ${extra})
  VALUES (${v}, ${taxonomy}, ${number}, 'F Series', ${user}`;
const insertVersion = (v, number) => version(v, number) + ');';
const insertSegment = (v, s = segment, position = 0, placeholder = 'XX', defaultId = 'NULL') =>
  `INSERT INTO public.taxonomy_version_segments
   (version_id, segment_id, position, placeholder, default_option_id)
   VALUES (${v}, ${s}, ${position}, '${placeholder}', ${defaultId});`;
const insertOption = (v, s = segment, o = option, position = 0, code = '01', price = '20.00') =>
  `INSERT INTO public.taxonomy_version_options
   (version_id, segment_id, option_id, position, code, price)
   VALUES (${v}, ${s}, ${o}, ${position}, '${code}', ${price});`;
async function rejects(label, sql, code) {
  try {
    await assert.rejects(db.exec(sql), error => error.code === code, label);
    checks++;
  } finally {
    await db.exec('ROLLBACK;');
  }
}
try {
  // Shared identity fixtures exist only in this disposable test database.
  await db.exec(`CREATE TABLE public.organizations(id bigint PRIMARY KEY);
    CREATE TABLE public.users(id bigint PRIMARY KEY);
    INSERT INTO public.organizations VALUES (${owner}), (${subscriber});
    INSERT INTO public.users VALUES (${user});`);
  await db.exec(await readFile(new URL('../versions/0001/taxonomy/schema.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../functions/taxonomy.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../versions/0001/taxonomy/triggers.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../functions/taxonomy.sql', import.meta.url), 'utf8'));
  checks++;
  // Exercise database allocation and the circular version reference without fixed IDs.
  await db.exec('BEGIN');
  const generatedVersion = (await db.query("SELECT nextval(pg_get_serial_sequence('public.taxonomy_versions', 'id')) AS id")).rows[0].id;
  const generatedTaxonomy = (await db.query(`INSERT INTO taxonomies(owner_organization_id,current_version_id,created_by_user_id)
    VALUES (${owner},$1,${user}) RETURNING id`, [generatedVersion])).rows[0].id;
  await db.query(`INSERT INTO taxonomy_versions(id,taxonomy_id,version_number,product_family_name,created_by_user_id)
    VALUES ($1,$2,1,'Generated IDs',${user})`, [generatedVersion, generatedTaxonomy]);
  const generatedSegment = (await db.query(`INSERT INTO taxonomy_version_segments(version_id,position,placeholder)
    VALUES ($1,0,'XX') RETURNING segment_id`, [generatedVersion])).rows[0].segment_id;
  const generatedOption = (await db.query(`INSERT INTO taxonomy_version_options(version_id,segment_id,position,code,price)
    VALUES ($1,$2,0,'01',0) RETURNING option_id`, [generatedVersion, generatedSegment])).rows[0].option_id;
  assert.ok(BigInt(generatedTaxonomy) > 0n && BigInt(generatedSegment) > 0n && BigInt(generatedOption) > 0n);
  await db.exec('ROLLBACK');
  checks++;
  await db.exec(`BEGIN;
    INSERT INTO public.taxonomies(id, owner_organization_id, current_version_id, created_by_user_id)
    VALUES (${taxonomy}, ${owner}, ${v1}, ${user});
    ${insertVersion(v1, 1)}
    ${insertSegment(v1, segment, 0, 'XX', option)}
    ${insertOption(v1)}
    COMMIT;`);
  assert.equal((await db.query(`SELECT code FROM public.taxonomy_version_options`)).rows[0].code, '01');
  checks++;
  for (const table of ['taxonomy_versions', 'taxonomy_version_segments', 'taxonomy_version_options']) {
    await rejects(`${table} deletion`, `DELETE FROM public.${table};`, '23514');
    await rejects(`${table} truncation`, `TRUNCATE public.${table} CASCADE;`, '23514');
  }
  await rejects('option mutation', `UPDATE public.taxonomy_version_options SET price = 30;`, '23514');
  await rejects('late option insertion', insertOption(v1, segment, id(31), 1, '02'), '23514');
  await rejects('late segment insertion', insertSegment(v1, id(21), 1, 'YY'), '23514');
  await rejects('ownership transfer', `UPDATE public.taxonomies SET owner_organization_id = ${subscriber};`, '23514');
  await rejects('version gap', `BEGIN; ${insertVersion(v2, 3)} COMMIT;`, '23514');
  await rejects('unadvanced current pointer', `BEGIN; ${insertVersion(v2, 2)} COMMIT;`, '23514');
  const beginV2 = `BEGIN; ${insertVersion(v2, 2)}
    UPDATE public.taxonomies SET current_version_id = ${v2} WHERE id = ${taxonomy};`;
  await rejects('case-insensitive code uniqueness', `${beginV2}
    ${insertSegment(v2)} ${insertOption(v2, segment, option, 0, 'AA')}
    ${insertOption(v2, segment, id(31), 1, 'aa')} COMMIT;`, '23505');
  await rejects('case-insensitive placeholder uniqueness', `${beginV2}
    ${insertSegment(v2)} ${insertSegment(v2, id(21), 1, 'xx')} COMMIT;`, '23505');
  await rejects('cross-segment default', `${beginV2}
    ${insertSegment(v2, segment, 0, 'XX', option)}
    ${insertSegment(v2, id(21), 1, 'YY')}
    ${insertOption(v2, id(21))} COMMIT;`, '23503');
  await rejects('cross-version default', `${beginV2}
    ${insertSegment(v2, segment, 0, 'XX', option)} COMMIT;`, '23503');
  for (const price of ['1.001', '-1', '1000000000000', "'NaN'", "'Infinity'"]) {
    await rejects(`invalid price ${price}`, `${beginV2}
      ${insertSegment(v2)} ${insertOption(v2, segment, option, 0, '01', price)} COMMIT;`, '23514');
  }
  for (const code of ['', 'A-B', 'A B']) {
    await rejects(`invalid code ${JSON.stringify(code)}`, `${beginV2}
      ${insertSegment(v2)} ${insertOption(v2, segment, option, 0, code)} COMMIT;`, '23514');
  }
  const subscription = `INSERT INTO public.taxonomy_subscriptions
    (taxonomy_id, subscriber_organization_id, granted_by_user_id)
    VALUES (${taxonomy}, ${subscriber}, ${user});`;
  await db.exec(subscription);
  await rejects('duplicate active subscription', subscription, '23505');
  await rejects('owner subscription', `INSERT INTO public.taxonomy_subscriptions
    (taxonomy_id, subscriber_organization_id, granted_by_user_id)
    VALUES (${taxonomy}, ${owner}, ${user});`, '23514');
  await rejects('revocation without actor', `UPDATE public.taxonomy_subscriptions SET revoked_at = now();`, '23514');
  await db.exec(`UPDATE public.taxonomy_subscriptions SET revoked_at = now(), revoked_by_user_id = ${user};`);
  await rejects('reactivate revoked grant', `UPDATE public.taxonomy_subscriptions
    SET revoked_at = NULL, revoked_by_user_id = NULL;`, '23514');
  await db.exec(subscription);
  checks++;
  // New version may retain stable IDs, reuse codes in different segments,
  // and omit options from a segment while preserving all historical values.
  await db.exec(`${beginV2} ${insertSegment(v2)}
    ${insertSegment(v2, id(21), 1, 'YY')}
    ${insertSegment(v2, id(22), 2, 'ZZ')}
    ${insertOption(v2, segment, option, 0, '01', '25.00')}
    ${insertOption(v2, id(21), id(31), 0, '01', '2.50')}
    COMMIT;`);
  assert.equal((await db.query(`SELECT price::text AS price FROM public.taxonomy_version_options
    WHERE version_id = ${v1}`)).rows[0].price, '20.00');
  assert.equal((await db.query(`SELECT sum(price)::text AS total FROM public.taxonomy_version_options
    WHERE version_id = ${v2}`)).rows[0].total, '27.50');
  checks += 2;
  await rejects('current pointer rollback', `BEGIN;
    UPDATE public.taxonomies SET current_version_id = ${v1}; COMMIT;`, '23514');
  await db.exec(`UPDATE public.taxonomies SET archived_at = now();`);
  await rejects('edit archived taxonomy', `BEGIN; ${insertVersion(id(13), 3)} COMMIT;`, '23514');
  console.log(`PASS: ${checks} PostgreSQL schema checks`);
} finally {
  await db.close();
}
