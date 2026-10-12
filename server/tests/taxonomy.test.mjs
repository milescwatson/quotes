import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import YAML from 'yaml';
import { createTaxonomyService } from '../taxonomy.mjs';
import {
  normalizeContent,
  checkedSnapshot,
  configure,
  MAX_BYTES,
} from '../taxonomy-content.mjs';
import { transactions } from '../database.mjs';
import { createHandler, taxonomyRoutes } from './helpers.mjs';
const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const issuer = 'https://test.example.com';
const content = () => ({
  productFamilyName: 'F Series',
  currency: 'USD',
  basePrice: '100.00',
  segments: [
    {
      id: null,
      placeholder: 'F',
      name: null,
      defaultOptionIndex: null,
      options: [{ id: null, code: 'F', description: null, price: '0.00' }],
    },
    {
      id: null,
      placeholder: 'XX',
      name: 'Size',
      defaultOptionIndex: 0,
      options: [
        { id: null, code: '01', description: null, price: '20.00' },
        { id: null, code: '02', description: 'Large', price: '30.00' },
      ],
    },
  ],
});
const editable = (c) => ({
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
    options: structuredClone(s.options),
  })),
});
const rejects = (fn, code) => assert.rejects(fn, (e) => e.code === code);

test('normalization, ordering, nested IDs, valid-only saves and exact prices', () => {
  const saved = normalizeContent(content());
  assert.deepEqual(checkedSnapshot(saved), saved);
  assert.deepEqual(normalizeContent(editable(saved), saved), saved);
  assert.equal(configure(saved, []).partNumber, 'F-01');
  assert.equal(configure(saved, []).unitPrice, '120.00');
  const reorder = editable(saved);
  reorder.segments.reverse();
  assert.equal(
    configure(normalizeContent(reorder, saved), []).partNumber,
    '01-F',
  );
  for (const mutate of [
    (c) => (c.segments = []),
    (c) => (c.segments[0].options = []),
    (c) => (c.currency = 'EUR'),
    (c) => (c.segments[1].defaultOptionIndex = 2),
    (c) => (c.segments[1].options[1].code = '01'),
    (c) => (c.segments[1].placeholder = 'f'),
    (c) => (c.segments[1].options[0].code = 'A-B'),
    (c) => (c.basePrice = 100),
    (c) => (c.basePrice = '1e2'),
    (c) => (c.basePrice = '-1'),
    (c) => (c.basePrice = '0.001'),
    (c) => (c.basePrice = '999999999999.99'),
    (c) => (c.segments[0].id = 'foreign'),
    (c) => delete c.segments[0].name,
    (c) => (c.segments[0].name = 'a\u0000'),
  ]) {
    const c = content();
    mutate(c);
    assert.throws(() => normalizeContent(c));
  }
  const borrowed = editable(saved);
  borrowed.segments[0].options[0].id = saved.segments[1].options[0].id;
  assert.throws(() => normalizeContent(borrowed, saved));
  const add = editable(saved);
  add.segments[1].options.push({
    id: null,
    code: '03',
    description: '',
    price: '0.1',
  });
  add.segments[1].defaultOptionIndex = 2;
  const next = normalizeContent(add, saved);
  assert.equal(
    next.segments[1].defaultOptionId,
    next.segments[1].options[2].id,
  );
  assert.equal(next.segments[1].options[2].price, '0.10');
  const noDefault = structuredClone(saved);
  noDefault.segments[1].defaultOptionId = null;
  assert.throws(
    () => configure(noDefault, []),
    (e) => e.code === 'SELECTION_REQUIRED',
  );
  assert.throws(() =>
    configure(saved, [
      {
        segmentId: saved.segments[0].id,
        optionId: saved.segments[1].options[0].id,
      },
    ]),
  );
  assert.throws(() => checkedSnapshot({ ...saved, schemaVersion: 2 }));
  const corrupt = structuredClone(saved);
  corrupt.segments[1].defaultOptionId = 'missing';
  assert.throws(() => checkedSnapshot(corrupt));
  const c = content();
  c.basePrice = '0.10';
  c.segments[1].options[0].price = '0.20';
  assert.equal(configure(normalizeContent(c), []).unitPrice, '0.30');
  const big = content();
  big.segments = Array.from({ length: 4 }, (_, i) => ({
    id: null,
    placeholder: `S${i}`,
    name: null,
    defaultOptionIndex: null,
    options: Array.from({ length: 500 }, (_, j) => ({
      id: null,
      code: `C${j}`,
      description: null,
      price: '0',
    })),
  }));
  assert.equal(
    normalizeContent(big).segments.flatMap((s) => s.options).length,
    2000,
  );
  big.segments.forEach((s) =>
    s.options.forEach((o) => (o.description = 'x'.repeat(400))),
  );
  assert.throws(
    () => normalizeContent(big),
    (e) => e.status === 413,
  );
});

test('schema, service, organization access, rollback and runtime grants', async (t) => {
  const db = new PGlite();
  const q = (sql, args = []) => db.query(sql, args);
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
  const service = createTaxonomyService(tx);
  const create = (args) =>
    service.createTaxonomy({
      ...args,
      body: { principalId: '1', ...args.body },
    });
  const save = (args) =>
    service.saveTaxonomyVersion({
      ...args,
      body: { principalId: '1', ...args.body },
    });
  const call = (
    operation,
    taxonomyId,
    body = {},
    sub = 'admin',
    orgId = '10',
    query = {},
  ) => operation({ orgId, taxonomyId, body, query, identity: { issuer, sub } });
  let saved;
  try {
    await db.exec(
      (
        await read('../../database/versions/0001/identity/schema.sql')
      ).replaceAll('INDEX ASYNC', 'INDEX'),
    );
    await db.exec(
      (await read('../../database/versions/0002/taxonomy/schema.sql'))
        .replaceAll('INDEX ASYNC', 'INDEX')
        .replaceAll('ALTER TABLE ASYNC', 'ALTER TABLE'),
    );
    await q(
      `INSERT INTO users(id,cognito_issuer,cognito_subject,email,normalized_email) VALUES (1,$1,'admin','a@example.com','a@example.com'),(2,$1,'editor','e@example.com','e@example.com'),(3,$1,'member','m@example.com','m@example.com'),(4,$1,'stranger','s@example.com','s@example.com')`,
      [issuer],
    );
    await db.exec(
      `INSERT INTO organizations(id,name,status) VALUES (10,'First','active'),(11,'Other','active'),(12,'Pending','pending'); INSERT INTO organization_memberships(organization_id,user_id,role) VALUES (10,1,'admin'),(10,2,'editor'),(10,3,'member'),(11,4,'admin'),(12,1,'admin');`,
    );
    await db.exec(
      (await read('../../database/versions/0003/principals/schema.sql'))
        .replaceAll('INDEX ASYNC', 'INDEX')
        .replaceAll('ALTER TABLE ASYNC', 'ALTER TABLE'),
    );
    await db.exec(
      (
        await read('../../database/versions/0003/principals/enforce.sql')
      ).replaceAll('ALTER TABLE ASYNC', 'ALTER TABLE'),
    );
    await db.exec(
      "INSERT INTO principals(id,name,normalized_name,website_url,website_key,created_by_user_id) VALUES(1,'Example','example','https://example.com','example.com',1)",
    );
    await t.test(
      'invalid creation rolls back; valid creation and preview',
      async () => {
        await rejects(
          () =>
            call(create, undefined, {
              content: { ...content(), segments: [] },
            }),
          'TAXONOMY_LIMIT_EXCEEDED',
        );
        assert.equal(
          Number((await q('SELECT count(*) FROM taxonomies')).rows[0].count),
          0,
        );
        const r = await call(create, undefined, {
          content: content(),
          changeSummary: 'Initial',
        });
        assert.equal(r.statusCode, 201);
        saved = r.body.taxonomy;
        assert.equal(saved.version.versionNumber, 1);
        const p = await call(
          service.previewTaxonomy,
          saved.id,
          { versionId: saved.currentVersionId, selections: [] },
          'member',
        );
        assert.equal(p.body.configuration.unitPrice, '120.00');
      },
    );
    await t.test(
      'no-op does not increment; stale save cannot overwrite; history persists',
      async () => {
        const c = editable(saved.version.content);
        c.productFamilyName = ' F Series ';
        c.basePrice = '100';
        c.segments[0].name = '';
        const noOp = await call(save, saved.id, {
          expectedVersionId: saved.currentVersionId,
          content: c,
          changeSummary: 'Summary only',
        });
        assert.equal(noOp.statusCode, 200);
        assert.equal(noOp.body.unchanged, true);
        const old = saved;
        c.basePrice = '110';
        saved = (
          await call(
            save,
            saved.id,
            { expectedVersionId: saved.currentVersionId, content: c },
            'editor',
          )
        ).body.taxonomy;
        assert.equal(saved.version.versionNumber, 2);
        assert.equal(saved.version.modifiedBy.id, '2');
        await rejects(
          () =>
            call(save, saved.id, {
              expectedVersionId: old.currentVersionId,
              content: editable(saved.version.content),
            }),
          'VERSION_CONFLICT',
        );
        assert.equal(
          Number(
            (await q('SELECT count(*) FROM taxonomy_versions')).rows[0].count,
          ),
          2,
        );
        assert.equal(
          (
            await q('SELECT content FROM taxonomy_versions WHERE id=$1', [
              old.currentVersionId,
            ])
          ).rows[0].content.basePrice,
          '100.00',
        );
      },
    );
    await t.test(
      'roles, ownership, strict inputs, pagination and access revocation',
      async () => {
        for (const sub of ['admin', 'editor', 'member'])
          assert.equal(
            (await call(service.readTaxonomy, saved.id, {}, sub)).statusCode,
            200,
          );
        await rejects(
          () => call(create, undefined, { content: content() }, 'member'),
          'FORBIDDEN',
        );
        await rejects(
          () => call(service.readTaxonomy, saved.id, {}, 'stranger'),
          'NOT_FOUND',
        );
        await rejects(
          () => call(service.readTaxonomy, saved.id, {}, 'stranger', '11'),
          'NOT_FOUND',
        );
        await rejects(
          () => call(service.listTaxonomies, undefined, {}, 'admin', '12'),
          'NOT_FOUND',
        );
        await rejects(
          () =>
            call(create, undefined, { content: content(), mutationId: 'no' }),
          'INVALID_INPUT',
        );
        await rejects(
          () =>
            call(service.listTaxonomies, undefined, {}, 'admin', '10', {
              status: 'all',
            }),
          'INVALID_INPUT',
        );
        await rejects(
          () =>
            call(service.listTaxonomies, undefined, {}, 'admin', '10', {
              page: '9007199254740991',
            }),
          'INVALID_INPUT',
        );
        assert.equal(
          (
            await call(service.listTaxonomies, undefined, {}, 'admin', '10', {
              pageSize: '1',
            })
          ).body.totalItems,
          1,
        );
        assert.equal(
          (
            await call(service.listTaxonomies, undefined, {}, 'admin', '10', {
              page: '2',
            })
          ).body.items.length,
          0,
        );
        assert.equal(
          (await call(service.listTaxonomies, undefined, {}, 'stranger', '11'))
            .body.totalPages,
          0,
        );
        await db.exec(
          'UPDATE organization_memberships SET removed_at=now() WHERE user_id=3',
        );
        await rejects(
          () => call(service.readTaxonomy, saved.id, {}, 'member'),
          'NOT_FOUND',
        );
        await db.exec(
          'UPDATE organization_memberships SET removed_at=NULL WHERE user_id=3; UPDATE users SET disabled_at=now() WHERE id=3',
        );
        await rejects(
          () => call(service.readTaxonomy, saved.id, {}, 'member'),
          'ACCOUNT_DISABLED',
        );
        await db.exec('UPDATE users SET disabled_at=NULL WHERE id=3');
      },
    );
    await t.test(
      'failed pointer update rolls back inserted version',
      async () => {
        const failing = createTaxonomyService((work) =>
          tx((client) =>
            work({
              query: async (sql, args) =>
                sql.includes('SET current_version_id=$1')
                  ? { rows: [] }
                  : client.query(sql, args),
            }),
          ),
        );
        const c = editable(saved.version.content);
        c.basePrice = '111';
        await rejects(
          () =>
            failing.saveTaxonomyVersion({
              orgId: '10',
              taxonomyId: saved.id,
              body: {
                principalId: '1',
                expectedVersionId: saved.currentVersionId,
                content: c,
              },
              identity: { issuer, sub: 'admin' },
            }),
          'CONCURRENT_CHANGE',
        );
        assert.equal(
          Number(
            (await q('SELECT count(*) FROM taxonomy_versions')).rows[0].count,
          ),
          2,
        );
        assert.equal(
          (await call(service.readTaxonomy, saved.id)).body.taxonomy
            .currentVersionId,
          saved.currentVersionId,
        );
      },
    );
    await t.test(
      'runtime can create/save but cannot rewrite history or ownership',
      async () => {
        await db.exec(
          'CREATE ROLE taxonomy_api; CREATE ROLE taxonomy_operator;',
        );
        const grants = (s) =>
          s
            .replaceAll(':"api_role"', 'taxonomy_api')
            .replaceAll(':"operator_role"', 'taxonomy_operator');
        await db.exec(
          grants(
            await read('../../database/versions/0001/identity/permissions.sql'),
          ),
        );
        await db.exec(
          grants(
            await read('../../database/versions/0002/taxonomy/permissions.sql'),
          ),
        );
        await db.exec(
          grants(
            await read(
              '../../database/versions/0003/principals/permissions.sql',
            ),
          ),
        );
        await db.exec('SET ROLE taxonomy_api');
        try {
          assert.equal(
            (await call(create, undefined, { content: content() })).statusCode,
            201,
          );
          const c = editable(saved.version.content);
          c.basePrice = '112';
          saved = (
            await call(save, saved.id, {
              expectedVersionId: saved.currentVersionId,
              content: c,
            })
          ).body.taxonomy;
          for (const sql of [
            'UPDATE taxonomy_versions SET content=content',
            'DELETE FROM taxonomy_versions',
            'TRUNCATE taxonomy_versions',
            'UPDATE taxonomies SET owner_organization_id=11',
          ])
            await rejects(() => q(sql), '42501');
        } finally {
          await db.exec('RESET ROLE');
        }
      },
    );
    await t.test(
      'archive preserves snapshots, excludes listing and blocks saves/preview',
      async () => {
        await rejects(
          () =>
            call(
              service.archiveTaxonomy,
              saved.id,
              { expectedVersionId: saved.currentVersionId },
              'editor',
            ),
          'FORBIDDEN',
        );
        const before = Number(
          (await q('SELECT count(*) FROM taxonomy_versions')).rows[0].count,
        );
        const r = await call(service.archiveTaxonomy, saved.id, {
          expectedVersionId: saved.currentVersionId,
        });
        assert.deepEqual(
          await call(service.archiveTaxonomy, saved.id, {
            expectedVersionId: saved.currentVersionId,
          }),
          r,
        );
        assert.equal(
          (await call(service.readTaxonomy, saved.id)).body.taxonomy.permissions
            .canPreview,
          false,
        );
        assert.equal(
          (await call(service.listTaxonomies)).body.items.some(
            (t) => t.id === saved.id,
          ),
          false,
        );
        await rejects(
          () =>
            call(service.previewTaxonomy, saved.id, {
              versionId: saved.currentVersionId,
              selections: [],
            }),
          'TAXONOMY_ARCHIVED',
        );
        await rejects(
          () =>
            call(save, saved.id, {
              expectedVersionId: saved.currentVersionId,
              content: editable(saved.version.content),
            }),
          'TAXONOMY_ARCHIVED',
        );
        assert.equal(
          Number(
            (await q('SELECT count(*) FROM taxonomy_versions')).rows[0].count,
          ),
          before,
        );
      },
    );
  } finally {
    await db.close();
  }
});

test('single attempt includes commit failures and conflict mapping', async () => {
  for (const conflict of [
    { code: '40001' },
    { code: '23505', constraint: 'taxonomy_version_number_unique' },
  ]) {
    let calls = 0,
      releases = 0,
      rollbacks = 0,
      sleeps = 0;
    const tx = transactions(
      {
        connect: async () => ({
          query: async (sql) => {
            if (sql === 'COMMIT') throw conflict;
            if (sql === 'ROLLBACK') rollbacks++;
          },
          release: () => releases++,
        }),
      },
      { attempts: 1, sleep: async () => sleeps++ },
    );
    await assert.rejects(
      () =>
        tx(async () => {
          calls++;
        }),
      (e) => e === conflict,
    );
    assert.deepEqual([calls, releases, rollbacks, sleeps], [1, 1, 1, 0]);
    const service = createTaxonomyService(async () => {
      throw conflict;
    });
    await rejects(
      () =>
        service.listTaxonomies({
          orgId: '10',
          identity: { issuer, sub: 'admin' },
        }),
      'CONCURRENT_CHANGE',
    );
  }
});

test('six authenticated Gateway routes, statuses and bounded HTTP bodies', async () => {
  const api = YAML.parse(await read('../../AWS/openapi.yaml'));
  const env = {
    COGNITO_ISSUER: issuer,
    COGNITO_CLIENT_ID: 'client',
    COGNITO_DOMAIN: 'https://auth.example.com',
  };
  let calls = 0;
  const handler = createHandler({
    env,
    services: {
      taxonomy: {
        createTaxonomy: async () => {
          calls++;
          return { statusCode: 201, body: { ok: true } };
        },
      },
    },
    fetchUser: async () => ({
      ok: true,
      json: async () => ({
        sub: 'admin',
        email: 'a@example.com',
        email_verified: true,
      }),
    }),
  });
  const e = {
    routeKey: 'POST /organizations/{orgId}/taxonomies',
    rawPath: '/organizations/10/taxonomies',
    headers: { authorization: 'Bearer test' },
    body: JSON.stringify({ content: content() }),
    requestContext: {
      requestId: 'tax-test',
      http: { method: 'POST' },
      authorizer: {
        jwt: {
          claims: {
            iss: issuer,
            sub: 'admin',
            client_id: 'client',
            token_use: 'access',
            exp: Date.now() / 1000 + 600,
            scope: 'quotes-api/access',
          },
        },
      },
    },
  };
  assert.equal((await handler(e)).statusCode, 201);
  const invalid = structuredClone(e);
  delete invalid.requestContext.authorizer;
  assert.equal((await handler(invalid)).statusCode, 401);
  assert.equal(calls, 1);
  assert.equal((await handler({ ...e, body: '{' })).statusCode, 422);
  assert.equal(
    (await handler({ ...e, body: 'x'.repeat(MAX_BYTES + 1) })).statusCode,
    413,
  );
  assert.equal(
    (
      await handler({
        ...e,
        body: Buffer.from('x'.repeat(MAX_BYTES + 1)).toString('base64'),
        isBase64Encoded: true,
      })
    ).statusCode,
    413,
  );
  for (const key of taxonomyRoutes) {
    const [method, path] = key.split(' ');
    const route = api.paths[path][method.toLowerCase()];
    assert.deepEqual(route.security, [{ CognitoJwt: ['quotes-api/access'] }]);
    assert.equal(
      route['x-amazon-apigateway-integration'].uri,
      '${lambda_invoke_arn}',
    );
  }
  assert.equal(
    Object.entries(api.paths).flatMap(([p, ops]) =>
      p.includes('/taxonomies') ? Object.keys(ops) : [],
    ).length,
    6,
  );
});

test('client-side timeout discards the connection instead of pooling an in-flight transaction', async () => {
  const queries = [];
  let discarded;
  const run = transactions(
    {
      connect: async () => ({
        query: async (sql) => {
          queries.push(sql);
        },
        release: (value) => {
          discarded = value;
        },
      }),
    },
    { attempts: 1 },
  );
  await assert.rejects(() =>
    run(async () => {
      throw new Error('Query read timeout');
    }),
  );
  assert.equal(discarded, true);
  assert.deepEqual(queries, ['BEGIN ISOLATION LEVEL REPEATABLE READ']);
});
