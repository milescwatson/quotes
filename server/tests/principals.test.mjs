import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import YAML from 'yaml';
import { createPrincipalService, principalInput } from '../principals.mjs';
import { createTaxonomyService } from '../taxonomy.mjs';
import { createHandler, principalRoutes } from './helpers.mjs';
const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const content = () => ({
  productFamilyName: 'F',
  currency: 'USD',
  basePrice: '0.00',
  segments: [
    {
      id: null,
      placeholder: 'F',
      name: null,
      defaultOptionIndex: null,
      options: [{ id: null, code: '01', description: null, price: '0.10' }],
    },
  ],
});
const input = (c) => ({
  productFamilyName: c.productFamilyName,
  currency: c.currency,
  basePrice: c.basePrice,
  segments: c.segments.map((s) => ({
    id: s.id,
    placeholder: s.placeholder,
    name: s.name,
    defaultOptionIndex:
      s.defaultOptionId === null
        ? null
        : s.options.findIndex((o) => o.id === s.defaultOptionId),
    options: s.options,
  })),
});
const rejects = (fn, code) => assert.rejects(fn, (e) => e.code === code);

test('principal name and root domain normalization prevents URL-variant duplicates', () => {
  const normalize = (websiteUrl) =>
    principalInput({ name: '  A  Company  ', websiteUrl });
  for (const url of [
    'example.com',
    'https://www.example.com/about?q=1',
    'http://shop.example.com:8080/',
    'https://EXAMPLE.COM./',
  ])
    assert.equal(normalize(url).websiteKey, 'example.com');
  assert.equal(
    normalize('https://sales.example.co.uk/path').websiteKey,
    'example.co.uk',
  );
  assert.equal(normalize('https://bücher.de').websiteKey, 'xn--bcher-kva.de');
  assert.equal(normalize('https://a.github.io').websiteKey, 'github.io');
  assert.equal(normalize('example.com').normalizedName, 'a company');
  for (const url of [
    '',
    'localhost',
    '127.0.0.1',
    'https://com',
    'ftp://example.com',
    'https://user:secret@example.com',
    'https://bad host.com',
    'https://example.com\\@evil.com',
  ])
    assert.throws(() => normalize(url));
  assert.throws(() =>
    principalInput({ name: '\n', websiteUrl: 'example.com' }),
  );
});

test('principal schema, global directory, roles, uniqueness, assignment history and filtered isolation', async (t) => {
  const db = new PGlite();
  const tx = async (work) => {
    await db.exec('BEGIN');
    try {
      const r = await work(db);
      await db.exec('COMMIT');
      return r;
    } catch (e) {
      await db.exec('ROLLBACK');
      throw e;
    }
  };
  const principals = createPrincipalService(tx),
    taxonomy = createTaxonomyService(tx);
  const call = (operation, ids, body = {}, sub = 'admin', query = {}) =>
    operation({ ...ids, body, query, identity: { issuer: 'test', sub } });
  const list = (org = '10', sub = 'admin', query = {}) =>
    call(principals.listPrincipals, { orgId: org }, {}, sub, query);
  let first, second, saved;
  try {
    for (const file of [
      '0001/identity/schema.sql',
      '0002/taxonomy/schema.sql',
      '0003/principals/schema.sql',
      '0003/principals/enforce.sql',
    ])
      await db.exec(
        (await read(`../../database/versions/${file}`))
          .replaceAll('INDEX ASYNC', 'INDEX')
          .replaceAll('ALTER TABLE ASYNC', 'ALTER TABLE'),
      );
    await db.exec(
      "INSERT INTO users(id,cognito_issuer,cognito_subject,email,normalized_email) VALUES(1,'test','admin','a@b.com','a@b.com'),(2,'test','editor','e@b.com','e@b.com'),(3,'test','member','m@b.com','m@b.com'); INSERT INTO organizations(id,name,status) VALUES(10,'One','active'),(11,'Two','active'); INSERT INTO organization_memberships(organization_id,user_id,role) VALUES(10,1,'admin'),(11,1,'admin'),(10,2,'editor'),(10,3,'member')",
    );
    await t.test(
      'only admins create; directory shared with active members',
      async () => {
        for (const sub of ['member', 'editor'])
          await rejects(
            () =>
              call(
                principals.createPrincipal,
                { orgId: '10' },
                { name: 'Acme', websiteUrl: 'acme.com' },
                sub,
              ),
            'FORBIDDEN',
          );
        first = (
          await call(
            principals.createPrincipal,
            { orgId: '10' },
            {
              name: 'Acme',
              websiteUrl: 'acme.com',
            },
          )
        ).body.principal;
        second = (
          await call(
            principals.createPrincipal,
            { orgId: '11' },
            {
              name: 'Other',
              websiteUrl: 'other.co.uk',
            },
          )
        ).body.principal;
        assert.deepEqual(
          (await list('10', 'member')).body.items,
          (await list('11')).body.items,
        );
        await rejects(() => list('11', 'member'), 'NOT_FOUND');
        await rejects(
          () => list('10', 'admin', { page: '0' }),
          'INVALID_INPUT',
        );
      },
    );
    await t.test(
      'each uniqueness constraint rejects duplicates and returns field-specific errors',
      async () => {
        await rejects(
          () =>
            call(
              principals.createPrincipal,
              { orgId: '11' },
              {
                name: ' ACME ',
                websiteUrl: 'different.com',
              },
            ),
          'PRINCIPAL_NAME_EXISTS',
        );
        await assert.rejects(
          () =>
            call(
              principals.createPrincipal,
              { orgId: '11' },
              {
                name: 'Different',
                websiteUrl: 'https://shop.acme.com/about',
              },
            ),
          (e) =>
            e.code === 'PRINCIPAL_WEBSITE_EXISTS' &&
            e.fieldErrors[0].path === '/websiteUrl',
        );
        assert.equal((await list()).body.totalItems, 2);
        const insert = () =>
          db.query(
            "INSERT INTO principals(name,normalized_name,website_url,website_key,created_by_user_id) VALUES('Race','race','https://race.com','race.com',1)",
          );
        const attempts = await Promise.allSettled([insert(), insert()]);
        assert.equal(
          attempts.filter((r) => r.status === 'fulfilled').length,
          1,
        );
        assert.equal(
          attempts.find((r) => r.status === 'rejected').reason.code,
          '23505',
        );
      },
    );
    await t.test(
      'principal required on creates and foreign-key constraints protect relationships',
      async () => {
        await rejects(
          () =>
            call(
              taxonomy.createTaxonomy,
              { orgId: '10' },
              {
                content: content(),
              },
            ),
          'INVALID_INPUT',
        );
        await rejects(
          () =>
            call(
              taxonomy.createTaxonomy,
              { orgId: '10' },
              {
                principalId: '999',
                content: content(),
              },
            ),
          'INVALID_INPUT',
        );
        saved = (
          await call(
            taxonomy.createTaxonomy,
            { orgId: '10' },
            {
              principalId: first.id,
              content: content(),
            },
          )
        ).body.taxonomy;
        await rejects(
          () =>
            db.query('UPDATE taxonomies SET principal_id=999 WHERE id=$1', [
              saved.id,
            ]),
          '23503',
        );
        await rejects(
          () =>
            db.query('UPDATE taxonomies SET principal_id=NULL WHERE id=$1', [
              saved.id,
            ]),
          '23514',
        );
        await assert.rejects(
          () => db.query('DELETE FROM principals WHERE id=$1', [first.id]),
          (e) => ['23503', '23001'].includes(e.code),
        );
      },
    );
    await t.test(
      'principal-only changes version atomically; unchanged save is no-op and old assignment retained',
      async () => {
        const old = saved;
        saved = (
          await call(
            taxonomy.saveTaxonomyVersion,
            { orgId: '10', taxonomyId: saved.id },
            {
              expectedVersionId: saved.currentVersionId,
              principalId: second.id,
              content: input(saved.version.content),
            },
            'editor',
          )
        ).body.taxonomy;
        assert.equal(saved.version.versionNumber, 2);
        assert.equal(saved.principalId, second.id);
        assert.equal(saved.version.principalId, second.id);
        assert.equal(
          String(
            (
              await db.query(
                'SELECT principal_id FROM taxonomy_versions WHERE id=$1',
                [old.currentVersionId],
              )
            ).rows[0].principal_id,
          ),
          first.id,
        );
        const noOp = await call(
          taxonomy.saveTaxonomyVersion,
          { orgId: '10', taxonomyId: saved.id },
          {
            expectedVersionId: saved.currentVersionId,
            principalId: second.id,
            content: input(saved.version.content),
          },
        );
        assert.equal(noOp.body.unchanged, true);
        await rejects(
          () =>
            call(
              taxonomy.saveTaxonomyVersion,
              { orgId: '10', taxonomyId: saved.id },
              {
                expectedVersionId: old.currentVersionId,
                principalId: first.id,
                content: input(saved.version.content),
              },
            ),
          'VERSION_CONFLICT',
        );
      },
    );
    await t.test(
      'principal filter counts and rows remain within owner organization',
      async () => {
        await call(
          taxonomy.createTaxonomy,
          { orgId: '11' },
          {
            principalId: second.id,
            content: content(),
          },
        );
        assert.equal(
          (
            await call(taxonomy.listTaxonomies, { orgId: '10' }, {}, 'member', {
              principalId: first.id,
            })
          ).body.totalItems,
          0,
        );
        const found = (
          await call(taxonomy.listTaxonomies, { orgId: '10' }, {}, 'member', {
            principalId: second.id,
            pageSize: '1',
          })
        ).body;
        assert.equal(found.totalItems, 1);
        assert.equal(found.items[0].id, saved.id);
        assert.equal(found.items[0].principalName, 'Other');
        assert.equal(
          (
            await call(taxonomy.listTaxonomies, { orgId: '10' }, {}, 'member', {
              principalId: second.id,
              page: '2',
              pageSize: '1',
            })
          ).body.items.length,
          0,
        );
        await rejects(
          () =>
            call(taxonomy.listTaxonomies, { orgId: '10' }, {}, 'member', {
              principalId: 'bad',
            }),
          'INVALID_INPUT',
        );
      },
    );
    await t.test(
      'principal grants prohibit edits and history remains immutable',
      async () => {
        await db.exec(
          'CREATE ROLE principal_api; CREATE ROLE principal_operator;',
        );
        for (const file of [
          '0001/identity/permissions.sql',
          '0002/taxonomy/permissions.sql',
          '0003/principals/permissions.sql',
        ])
          await db.exec(
            (await read(`../../database/versions/${file}`))
              .replaceAll(':"api_role"', 'principal_api')
              .replaceAll(':"operator_role"', 'principal_operator'),
          );
        await db.exec('SET ROLE principal_api');
        try {
          await call(
            principals.createPrincipal,
            { orgId: '10' },
            {
              name: 'New',
              websiteUrl: 'new.com',
            },
          );
          await call(
            taxonomy.saveTaxonomyVersion,
            { orgId: '10', taxonomyId: saved.id },
            {
              expectedVersionId: saved.currentVersionId,
              principalId: first.id,
              content: input(saved.version.content),
            },
          );
          for (const sql of [
            'UPDATE principals SET name=name',
            'DELETE FROM principals',
            'UPDATE taxonomy_versions SET principal_id=principal_id',
          ])
            await rejects(() => db.exec(sql), '42501');
        } finally {
          await db.exec('RESET ROLE');
        }
      },
    );
  } finally {
    await db.close();
  }
});

test('additive migration preserves pre-principal history and requires principal on new snapshots', async () => {
  const db = new PGlite();
  try {
    for (const file of ['0001/identity/schema.sql', '0002/taxonomy/schema.sql'])
      await db.exec(
        (await read(`../../database/versions/${file}`))
          .replaceAll('INDEX ASYNC', 'INDEX')
          .replaceAll('ALTER TABLE ASYNC', 'ALTER TABLE'),
      );
    await db.exec(
      "INSERT INTO users(id,cognito_issuer,cognito_subject,email,normalized_email) VALUES(1,'i','s','a@b.com','a@b.com'); INSERT INTO organizations(id,name,status) VALUES(1,'Org','active'); BEGIN; INSERT INTO taxonomies(id,owner_organization_id,current_version_id,created_by_user_id) VALUES(1,1,1,1); INSERT INTO taxonomy_versions(id,taxonomy_id,version_number,content,created_by_user_id) VALUES(1,1,1,'{\"schemaVersion\":1,\"segments\":[]}',1); COMMIT;",
    );
    const before = (
      await db.query('SELECT content FROM taxonomy_versions WHERE id=1')
    ).rows[0].content;
    await db.exec(
      (await read('../../database/versions/0003/principals/schema.sql'))
        .replaceAll('INDEX ASYNC', 'INDEX')
        .replaceAll('ALTER TABLE ASYNC', 'ALTER TABLE'),
    );
    assert.deepEqual(
      (await db.query('SELECT content FROM taxonomy_versions WHERE id=1'))
        .rows[0].content,
      before,
    );
    assert.equal(
      (await db.query('SELECT principal_id FROM taxonomy_versions WHERE id=1'))
        .rows[0].principal_id,
      null,
    );
    await rejects(
      () =>
        db.exec(
          'INSERT INTO taxonomy_versions(id,taxonomy_id,version_number,content,created_by_user_id) VALUES(2,1,2,\'{"schemaVersion":1,"segments":[]}\',1)',
        ),
      '23514',
    );
    await rejects(
      async () =>
        db.exec(
          (
            await read('../../database/versions/0003/principals/enforce.sql')
          ).replaceAll('ALTER TABLE ASYNC', 'ALTER TABLE'),
        ),
      '23514',
    );
  } finally {
    await db.close();
  }
});

test('principal routes use authentication, service dispatch, status and structured errors', async () => {
  const api = YAML.parse(await read('../../AWS/openapi.yaml'));
  for (const key of principalRoutes) {
    const [method, path] = key.split(' ');
    assert.deepEqual(api.paths[path][method.toLowerCase()].security, [
      { CognitoJwt: ['quotes-api/access'] },
    ]);
  }
  const env = {
    COGNITO_ISSUER: 'issuer',
    COGNITO_CLIENT_ID: 'client',
    COGNITO_DOMAIN: 'https://auth.example.com',
  };
  let called = 0;
  const handler = createHandler({
    env,
    services: {
      principals: {
        createPrincipal: async () => {
          called++;
          return { statusCode: 201, body: { principal: { id: '1' } } };
        },
      },
    },
    fetchUser: async () => ({
      ok: true,
      json: async () => ({
        sub: 'admin',
        email: 'a@b.com',
        email_verified: true,
      }),
    }),
  });
  const event = {
    routeKey: principalRoutes[1],
    rawPath: '/organizations/10/principals',
    body: '{}',
    headers: { authorization: 'Bearer test' },
    requestContext: {
      http: { method: 'POST' },
      authorizer: {
        jwt: {
          claims: {
            iss: 'issuer',
            sub: 'admin',
            client_id: 'client',
            token_use: 'access',
            exp: Date.now() / 1000 + 1000,
            scope: 'quotes-api/access',
          },
        },
      },
    },
  };
  assert.equal((await handler(event)).statusCode, 201);
  assert.equal(called, 1);
  delete event.requestContext.authorizer;
  assert.equal((await handler(event)).statusCode, 401);
});
