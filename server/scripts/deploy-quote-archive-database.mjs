// Development-only 0008 migration. API traffic remains paused for coordinated release.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { aws, target, developmentDatabase } from './development-database.mjs';

const root = new URL('../../', import.meta.url);
const journalPath = new URL('database/deployments/development-0008.json', root);
const { db } = developmentDatabase();
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const originals = () => q(`SELECT id, organization_id, customer_id, owner_user_id, customer_name,
  project_name, lines, modified_by, modified_when::text AS modified_when, multiple
  FROM public.quotes ORDER BY id`);
let journal;
try {
  journal = JSON.parse(await readFile(journalPath, 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  journal = { target, startedAt: new Date().toISOString(), events: [] };
}
assert.deepEqual(journal.target, target);
const persist = () => writeFile(journalPath, JSON.stringify(journal, null, 2) + '\n');

async function run(key, sql) {
  const sha256 = createHash('sha256').update(sql).digest('hex');
  const prior = journal.events.find(event => event.key === key);
  if (prior) {
    assert.equal(prior.sha256, sha256);
    assert.equal(prior.status, 'completed', 'Inspect an unresolved statement before resuming.');
    return;
  }
  const event = { key, sql, sha256, status: 'started', startedAt: new Date().toISOString() };
  journal.events.push(event);
  await persist();
  try {
    const result = await db.query(sql);
    event.rowsAffected = result.rowCount;
    event.result = result.rows;
    event.status = 'completed';
    event.completedAt = new Date().toISOString();
    await persist();
    console.log(JSON.stringify({ key, status: event.status, rowsAffected: event.rowsAffected }));
  } catch (error) {
    event.status = 'failed';
    event.error = { code: error.code, message: error.message };
    await persist();
    throw error;
  }
}

async function applyFile(name) {
  const sql = (await readFile(new URL(`database/versions/0008/quotes/${name}.sql`, root), 'utf8'))
    .replace(/--[^\n]*/g, '')
    .replaceAll(':"api_role"', '"quotes_api"');
  for (const [index, statement] of sql.split(';').map(value => value.trim()).filter(Boolean).entries())
    await run(`${name}:${index + 1}`, statement);
}

try {
  await db.connect();
  if (!journal.apiPause) {
    const config = JSON.parse(aws(['lambda', 'get-function-configuration', '--function-name', 'quotes-development-api']));
    const concurrency = JSON.parse(aws(['lambda', 'get-function-concurrency', '--function-name', 'quotes-development-api']) || '{}');
    journal.apiPause = { previousConcurrency: concurrency.ReservedConcurrentExecutions ?? -1, startedAt: new Date().toISOString() };
    await persist();
    aws(['lambda', 'put-function-concurrency', '--function-name', 'quotes-development-api', '--reserved-concurrent-executions', '0']);
    await new Promise(resolve => setTimeout(resolve, (config.Timeout + 2) * 1000));
  }
  assert.equal(JSON.parse(aws(['lambda', 'get-function-concurrency', '--function-name', 'quotes-development-api'])).ReservedConcurrentExecutions, 0, 'API must remain paused.');
  const existingColumn = await q("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='quotes' AND column_name='archived_at'");
  if (!journal.before) {
    assert.equal(existingColumn.length, 0, 'Inspect unexpected archived_at column before applying this migration.');
    const before = await originals();
    journal.before = { quoteCount: before.length, quoteFieldsSha256: digest(before) };
    await persist();
  }
  await applyFile('schema');
  await applyFile('permissions');
  const after = await originals();
  assert.equal(after.length, journal.before.quoteCount);
  assert.equal(digest(after), journal.before.quoteFieldsSha256, 'Existing quote data changed during migration.');
  const column = (await q("SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='quotes' AND column_name='archived_at'"))[0];
  assert.equal(column?.data_type, 'timestamp with time zone');
  const grant = (await q("SELECT has_column_privilege('quotes_api','quotes','archived_at','UPDATE') AS update"))[0];
  assert.equal(grant.update, true);
  const archived = Number((await q('SELECT count(*) AS total FROM public.quotes WHERE archived_at IS NOT NULL'))[0].total);
  assert.equal(archived, 0, 'Existing quotes must remain active.');
  journal.status = 'migration_verified_api_paused';
  journal.verification = { quoteCount: after.length, quoteFieldsSha256: digest(after), column, grant, archivedQuotes: archived };
  journal.verifiedAt = new Date().toISOString();
  await persist();
  console.log(JSON.stringify({ status: journal.status, ...journal.verification }));
} catch (error) {
  journal.status = 'failed';
  journal.error = { code: error.code, message: error.message };
  await persist();
  throw error;
} finally {
  await db.end();
}
