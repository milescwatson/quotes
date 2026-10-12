import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import YAML from 'yaml';
import { createIdentityService, HttpError } from '../identity.mjs';
import { createHandler } from './helpers.mjs';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const schema = await read('../../database/versions/0001/quotes/schema.sql');
const grants = await read(
  '../../database/versions/0001/quotes/permissions.sql',
);
const issuer = 'https://test.example.com';

test('quotes schema, list service, and organization access', async (t) => {
  const db = new PGlite();
  const q = async (sql, args = []) => (await db.query(sql, args)).rows;
  const service = createIdentityService(async (work) => {
    await db.exec('BEGIN ISOLATION LEVEL REPEATABLE READ');
    try {
      const result = await work(db);
      await db.exec('COMMIT');
      return result;
    } catch (error) {
      await db.exec('ROLLBACK');
      throw error;
    }
  });
  const call = (org = '10', query = {}, sub = 'admin') =>
    service.listQuotes({
      orgId: org,
      query,
      identity: { issuer, sub },
      requestId: 'quotes-test',
    });
  const denied = (operation, status) =>
    assert.rejects(
      operation,
      (error) => error instanceof HttpError && error.status === status,
    );
  const constraint = (operation, codes) =>
    assert.rejects(operation, (error) => codes.includes(error.code));
  const insert = (changes = {}) => {
    const fields = {
      organization_id: '10',
      customer_name: 'Acme',
      project_name: 'Office Renovation',
      modified_by: '1',
      ...changes,
    };
    return q(
      `INSERT INTO quotes(${Object.keys(fields).join(',')}) VALUES(${Object.keys(
        fields,
      )
        .map((_, i) => `$${i + 1}`)
        .join(',')}) RETURNING *`,
      Object.values(fields),
    );
  };
  try {
    await db.exec(
      (
        await read('../../database/versions/0001/identity/schema.sql')
      ).replaceAll('INDEX ASYNC', 'INDEX'),
    );
    await db.exec(schema.replaceAll('INDEX ASYNC', 'INDEX'));
    await q(
      `INSERT INTO users(id,cognito_issuer,cognito_subject,email,normalized_email,display_name)
      VALUES(1,$1,'admin','admin@example.com','admin@example.com','Alex'),
      (2,$1,'editor','editor@example.com','editor@example.com','Editor'),
      (3,$1,'member','member@example.com','member@example.com',NULL),
      (4,$1,'stranger','stranger@example.com','stranger@example.com',NULL)`,
      [issuer],
    );
    await db.exec(`INSERT INTO organizations(id,name,status) VALUES(10,'Northstar','active'),(11,'Forma','active'),(12,'Empty','active');
      INSERT INTO organization_memberships(organization_id,user_id,role) VALUES(10,1,'admin'),(10,2,'editor'),(10,3,'member'),(11,1,'member'),(12,1,'member');`);

    await t.test(
      'numeric IDs, constraints, title inputs, and foreign keys',
      async () => {
        const [row] = await insert();
        assert.equal(row.customer_id, null);
        assert.ok(row.modified_when);
        assert.ok(row.id);
        assert.equal((await insert({ customer_id: 123 }))[0].customer_id, 123);
        for (const field of ['customer_name', 'project_name']) {
          for (const value of ['', ' ', ' padded ', 'x'.repeat(121)])
            await constraint(() => insert({ [field]: value }), ['23514']);
          await constraint(() => insert({ [field]: null }), ['23502']);
        }
        for (const value of ['uuid-value', '1.5', '2147483648'])
          await constraint(
            () => insert({ customer_id: value }),
            ['22P02', '22003'],
          );
        for (const field of ['organization_id', 'modified_by']) {
          await constraint(() => insert({ [field]: null }), ['23502']);
          await constraint(() => insert({ [field]: '999999' }), ['23503']);
        }
        await constraint(() => insert({ modified_when: null }), ['23502']);
        await constraint(
          () => q('DELETE FROM users WHERE id=1'),
          ['23001', '23503'],
        );
        await constraint(
          () => q('DELETE FROM organizations WHERE id=10'),
          ['23001', '23503'],
        );
        await db.exec('DELETE FROM quotes');
      },
    );

    await t.test(
      'scoped pages, derived titles, UTC dates, numeric customers, and precise bigint IDs',
      async () => {
        await insert({
          id: '9007199254740993',
          modified_when: '2026-10-10T12:00:00Z',
        });
        await insert({
          id: '9007199254740994',
          customer_id: 123,
          modified_by: '3',
          modified_when: '2026-10-10T12:00:00Z',
        });
        await insert({
          id: '9007199254740995',
          project_name: 'Earlier',
          modified_when: '2026-10-09T12:00:00Z',
        });
        await insert({
          organization_id: '11',
          customer_name: 'Other organization',
          modified_when: '2026-10-11T12:00:00Z',
        });
        const first = await call('10', { pageSize: '2' });
        assert.deepEqual(
          [first.page, first.pageSize, first.totalItems, first.totalPages],
          [1, 2, 3, 2],
        );
        assert.deepEqual(
          first.items.map((item) => item.id),
          ['9007199254740994', '9007199254740993'],
        );
        assert.deepEqual(first.items[0], {
          id: '9007199254740994',
          organizationId: '10',
          customerId: 123,
          ownerId: null,
          ownerName: null,
          customerName: 'Acme',
          projectName: 'Office Renovation',
          title: 'Acme - Office Renovation',
          modifiedBy: '3',
          modifiedByName: 'member@example.com',
          modifiedWhen: '2026-10-10T12:00:00.000Z',
        });
        assert.equal(first.items[1].customerId, null);
        const second = await call('10', { page: '2', pageSize: '2' });
        assert.deepEqual(
          second.items.map((item) => item.id),
          ['9007199254740995'],
        );
        assert.equal(second.totalItems, 3);
        assert.equal((await call()).pageSize, 50);
        assert.equal((await call('11')).totalItems, 1);
        const empty = await call('12');
        assert.deepEqual(empty, {
          items: [],
          page: 1,
          pageSize: 50,
          totalItems: 0,
          totalPages: 0,
        });
        assert.deepEqual(await call('10', { page: '9' }), {
          items: [],
          page: 9,
          pageSize: 50,
          totalItems: 3,
          totalPages: 1,
        });
      },
    );

    await t.test('validates page numbers and page sizes', async () => {
      for (const page of [
        '0',
        '-1',
        '1.1',
        '',
        'abc',
        'Infinity',
        '1e2',
        '9007199254740992',
        '9007199254740991',
      ])
        await denied(() => call('10', { page }), 422);
      for (const pageSize of ['0', '-1', '101', '1.5', '', 'NaN'])
        await denied(() => call('10', { pageSize }), 422);
      assert.equal((await call('10', { pageSize: '100' })).pageSize, 100);
    });

    await t.test(
      'filters combine across rows and totals with literal case-insensitive matching',
      async () => {
        assert.equal(
          (
            await call('10', {
              customer: 'ACME',
              project: 'office',
              pageSize: '1',
            })
          ).totalItems,
          2,
        );
        assert.equal((await call('10', { project: 'earlier' })).totalItems, 1);
        assert.equal((await call('10', { customer: '%' })).totalItems, 0);
        assert.equal(
          (await call('10', { customer: "' OR 1=1 --" })).totalItems,
          0,
        );
        assert.equal(
          (await call('10', { ownerId: 'unassigned' })).totalItems,
          3,
        );
        await denied(() => call('10', { ownerId: 'bad' }), 422);
        await denied(() => call('10', { customer: 'a'.repeat(121) }), 422);
      },
    );

    await t.test(
      'members can assign only active same-organization owners and attribution follows the actor',
      async () => {
        const update = (
          body,
          sub = 'member',
          orgId = '10',
          quoteId = '9007199254740993',
        ) =>
          service.updateQuoteOwner({
            orgId: orgId,
            quoteId: quoteId,
            body,
            identity: { issuer, sub },
            requestId: 'owner-test',
          });
        const owners = (sub) =>
          service.listEligibleOwners({
            orgId: '10',
            identity: { issuer, sub },
          });
        assert.equal((await owners('member')).items.length, 3);
        await denied(() => owners('stranger'), 404);
        await update({ ownerId: '2' });
        const owned = await call('10', {
          ownerId: '2',
          customer: 'acme',
          project: 'office',
        });
        assert.equal(owned.totalItems, 1);
        assert.equal(owned.items[0].ownerName, 'Editor');
        assert.equal(owned.items[0].modifiedBy, '3');
        assert.equal(owned.items[0].modifiedByName, 'member@example.com');
        await denied(() => update({ ownerId: '4' }), 422);
        await denied(() => update({ ownerId: '99999' }), 422);
        await denied(() => update({ ownerId: '2' }, 'stranger'), 404);
        await denied(() => update({ ownerId: '1' }, 'admin', '11'), 404);
        await denied(() => update({ ownerId: '2', modifiedBy: '1' }), 422);
        await denied(() => update({}), 422);
        await db.exec('UPDATE users SET disabled_at=now() WHERE id=2');
        await denied(() => update({ ownerId: '2' }), 422);
        assert.equal((await owners('admin')).items.length, 2);
        assert.equal(
          (await call('10', { ownerId: '2' })).items[0].ownerName,
          'Editor',
        );
        await db.exec('UPDATE users SET disabled_at=NULL WHERE id=2');
        await db.exec(
          'UPDATE organization_memberships SET removed_at=now() WHERE user_id=2',
        );
        await denied(() => update({ ownerId: '2' }), 422);
        await db.exec(
          'UPDATE organization_memberships SET removed_at=NULL WHERE user_id=2',
        );
        await update({ ownerId: null }, 'editor');
        assert.equal(
          (await call('10', { ownerId: 'unassigned' })).totalItems,
          3,
        );
        // Restore the ordering expected by the historical-attribution checks below.
        await q(
          "UPDATE quotes SET modified_when='2026-10-10T12:00:00Z',modified_by=1 WHERE id=9007199254740993",
        );
      },
    );

    await t.test(
      'all member roles can list; outsiders cannot access rows or counts',
      async () => {
        for (const sub of ['admin', 'editor', 'member'])
          assert.equal((await call('10', {}, sub)).totalItems, 3);
        await denied(() => call('10', {}, 'stranger'), 404);
        await denied(() => call('11', {}, 'member'), 404);
        await denied(() => call('99999'), 404);
        await denied(() => call('invalid'), 422);
      },
    );

    await t.test(
      'removal, disabled viewers, and archives revoke access while retaining attribution',
      async () => {
        await db.exec(
          'UPDATE organization_memberships SET removed_at=now() WHERE organization_id=10 AND user_id=3',
        );
        await denied(() => call('10', { page: '2' }, 'member'), 404);
        assert.equal(
          (await call()).items[0].modifiedByName,
          'member@example.com',
        );
        await db.exec('UPDATE users SET disabled_at=now() WHERE id=3');
        await denied(() => call('10', {}, 'member'), 403);
        assert.equal((await call()).items[0].modifiedBy, '3');
        await db.exec(
          "UPDATE organizations SET status='archived',archived_at=now() WHERE id=11",
        );
        await denied(() => call('11'), 404);
        await db.exec("UPDATE organizations SET status='pending' WHERE id=12");
        await denied(() => call('12'), 404);
      },
    );

    await t.test(
      'runtime role can update ownership but not other quote fields; operator can seed',
      async () => {
        await db.exec(
          'CREATE ROLE quotes_test_api; CREATE ROLE quotes_test_operator;',
        );
        const substitute = (text) =>
          text
            .replaceAll(':"api_role"', 'quotes_test_api')
            .replaceAll(':"operator_role"', 'quotes_test_operator');
        await db.exec(
          substitute(
            await read('../../database/versions/0001/identity/permissions.sql'),
          ),
        );
        await db.exec(substitute(grants));
        await db.exec('SET ROLE quotes_test_api');
        try {
          assert.equal((await call()).totalItems, 3);
          await service.updateQuoteOwner({
            orgId: '10',
            quoteId: '9007199254740993',
            body: { ownerId: '2' },
            identity: { issuer, sub: 'admin' },
          });
          assert.equal((await call('10', { ownerId: '2' })).totalItems, 1);
          await constraint(() => insert(), ['42501']);
          await constraint(
            () => q('UPDATE quotes SET project_name=$1', ['Changed']),
            ['42501'],
          );
          await constraint(() => q('DELETE FROM quotes'), ['42501']);
        } finally {
          await db.exec('RESET ROLE');
        }
        await db.exec('SET ROLE quotes_test_operator');
        try {
          assert.ok((await insert())[0].id);
          const before = Number(
            (await q('SELECT count(*) AS total FROM quotes'))[0].total,
          );
          const seed = await read('../../database/seeds/quotes.sql');
          await db.exec(
            seed
              .replaceAll(":'org_id'", "'10'")
              .replaceAll(":'actor_id'", "'1'"),
          );
          assert.equal(
            Number((await q('SELECT count(*) AS total FROM quotes'))[0].total),
            before + 55,
          );
          await db.exec(
            seed
              .replaceAll(":'org_id'", "'10'")
              .replaceAll(":'actor_id'", "'3'"),
          );
          assert.equal(
            Number((await q('SELECT count(*) AS total FROM quotes'))[0].total),
            before + 55,
          );
        } finally {
          await db.exec('RESET ROLE');
        }
      },
    );
  } finally {
    await db.close();
  }
});

test('quotes Gateway route reaches authenticated service with page query and no-store response', async () => {
  const api = YAML.parse(await read('../../AWS/openapi.yaml'));
  const route = api.paths['/organizations/{orgId}/quotes'].get;
  assert.equal(route.operationId, 'listQuotes');
  assert.deepEqual(route.security, [{ CognitoJwt: ['quotes-api/access'] }]);
  assert.equal(
    route['x-amazon-apigateway-integration'].uri,
    '${lambda_invoke_arn}',
  );
  assert.deepEqual(
    route.parameters.map((p) => p.name),
    ['orgId', 'page', 'pageSize', 'customer', 'project', 'ownerId'],
  );
  const env = {
    COGNITO_ISSUER: issuer,
    COGNITO_CLIENT_ID: 'client',
    COGNITO_DOMAIN: 'https://auth.example.com',
  };
  let received;
  const handler = createHandler({
    env,
    services: {
      identity: {
        listQuotes: async (request) => {
          received = request;
          return {
            items: [],
            page: 2,
            pageSize: 50,
            totalItems: 0,
            totalPages: 0,
          };
        },
      },
    },
    fetchUser: async () => ({
      ok: true,
      json: async () => ({
        sub: 'admin',
        email: 'admin@example.com',
        email_verified: true,
      }),
    }),
  });
  const event = {
    routeKey: 'GET /organizations/{orgId}/quotes',
    rawPath: '/organizations/10/quotes',
    queryStringParameters: { page: '2', pageSize: '50' },
    headers: { authorization: 'Bearer test' },
    requestContext: {
      requestId: 'test',
      http: { method: 'GET' },
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
  const response = await handler(event);
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(received.orgId, '10');
  assert.deepEqual(received.query, { page: '2', pageSize: '50' });
  const unauthenticated = structuredClone(event);
  delete unauthenticated.requestContext.authorizer;
  assert.equal((await handler(unauthenticated)).statusCode, 401);
});

test('owner migration preserves existing quotes and adds a validated reference', async () => {
  const db = new PGlite();
  try {
    await db.exec(
      (
        await read('../../database/versions/0001/identity/schema.sql')
      ).replaceAll('INDEX ASYNC', 'INDEX'),
    );
    await db.exec(
      schema
        .replace(/    owner_user_id.*\n/, '')
        .replaceAll('INDEX ASYNC', 'INDEX'),
    );
    await db.exec(`INSERT INTO users(id,cognito_issuer,cognito_subject,email,normalized_email) VALUES(1,'test','test','test@example.com','test@example.com');
      INSERT INTO organizations(id,name,status) VALUES(1,'Test','active');
      INSERT INTO quotes(organization_id,customer_name,project_name,modified_by) VALUES(1,'Customer','Project',1);`);
    await db.exec(
      (await read('../../database/legacy/quotes/2001-owner.sql')).replace(
        'ALTER TABLE ASYNC',
        'ALTER TABLE',
      ),
    );
    const row = (await db.query('SELECT * FROM quotes')).rows[0];
    assert.equal(row.owner_user_id, null);
    assert.equal(row.customer_name, 'Customer');
    await assert.rejects(
      () => db.exec('UPDATE quotes SET owner_user_id=999'),
      (error) => error.code === '23503',
    );
  } finally {
    await db.close();
  }
});
