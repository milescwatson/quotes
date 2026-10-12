import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createIdentityService, HttpError } from '../identity.mjs';
import { createHandler } from './helpers.mjs';
import { transactions } from '../database.mjs';
const issuer = 'https://cognito-idp.us-west-2.amazonaws.com/test-pool';
const identity = {
  issuer,
  sub: randomUUID(),
  email: 'admin@example.com',
  name: 'Alex',
};
const other = {
  issuer,
  sub: randomUUID(),
  email: 'member@example.com',
  name: 'Jamie',
};
const stranger = { issuer, sub: randomUUID(), email: 'outside@example.com' };
const db = new PGlite({ parsers: { 20: (value) => value } });
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
const service = createIdentityService(async (work) => {
  await db.exec('BEGIN');
  try {
    const result = await work(db);
    await db.exec('COMMIT');
    return result;
  } catch (e) {
    await db.exec('ROLLBACK');
    throw e;
  }
});
const call = (operation, ids = {}, body = {}, who = identity, query = {}) =>
  operation({ ...ids, body, identity: who, query, requestId: randomUUID() });
const rejects = (op, status, code) =>
  assert.rejects(
    op,
    (e) =>
      e instanceof HttpError &&
      e.status === status &&
      (!code || e.code === code),
  );
let admin, member, org, org2;
test('identity service transactions and authorization', async (t) => {
  try {
    await db.exec(
      (
        await readFile(
          new URL(
            '../../database/versions/0001/identity/schema.sql',
            import.meta.url,
          ),
          'utf8',
        )
      ).replaceAll('INDEX ASYNC', 'INDEX'),
    );
    await t.test(
      'bootstrap is idempotent and creates no membership',
      async () => {
        admin = (await call(service.bootstrapProfile, {})).user;
        assert.equal(
          (await call(service.bootstrapProfile, {})).user.id,
          admin.id,
        );
        assert.equal(
          (
            await q(
              "SELECT * FROM identity_audit_events WHERE action='user.created'",
            )
          ).length,
          1,
        );
        assert.equal(
          (await call(service.listProfileOrganizations, {})).items.length,
          0,
        );
        member = (await call(service.bootstrapProfile, {}, {}, other)).user;
        await call(service.bootstrapProfile, {}, {}, stranger);
        const organizations = await q(
          "INSERT INTO organizations(name,status) VALUES('Northstar','active'),('Studio','active') RETURNING id",
        );
        org = String(organizations[0].id);
        org2 = String(organizations[1].id);
        await q(
          "INSERT INTO organization_memberships(organization_id,user_id,role) VALUES($1,$2,'admin'),($1,$3,'member'),($4,$2,'member')",
          [org, admin.id, member.id, org2],
        );
      },
    );
    await t.test(
      'bigint IDs preserve precision and reject invalid inputs',
      async () => {
        await q(
          'ALTER TABLE organizations ALTER COLUMN id RESTART WITH 9007199254740993',
        );
        const [large] = await q(
          "INSERT INTO organizations(name,status) VALUES('Large ID','active') RETURNING id::text AS id",
        );
        assert.equal(large.id, '9007199254740993');
        await q(
          "INSERT INTO organization_memberships(organization_id,user_id,role) VALUES($1,$2,'member')",
          [large.id, admin.id],
        );
        assert.equal(
          (await call(service.readOrganization, { orgId: large.id }))
            .organization.id,
          large.id,
        );
        for (const id of [
          '0',
          '-1',
          '01',
          '1.5',
          '9223372036854775808',
          randomUUID(),
        ]) {
          await rejects(
            () => call(service.readOrganization, { orgId: id }),
            422,
            'INVALID_INPUT',
          );
        }
        await q(
          "UPDATE organizations SET status='archived',archived_at=now() WHERE id=$1",
          [large.id],
        );
      },
    );
    await t.test('role and organization boundaries are enforced', async () => {
      assert.equal(
        (await call(service.readOrganization, { orgId: org })).organization
          .role,
        'admin',
      );
      await rejects(
        () => call(service.listMembers, { orgId: org }, {}, stranger),
        404,
      );
      await rejects(
        () => call(service.listMembers, { orgId: org }, {}, other),
        403,
      );
      await rejects(
        () =>
          call(
            service.updateOrganization,
            { orgId: org2 },
            { name: 'Changed' },
          ),
        403,
      );
      assert.equal(
        (await call(service.listProfileOrganizations, {})).items.length,
        2,
      );
    });
    await t.test(
      'cursor pagination advances and rejects invalid cursors',
      async () => {
        const first = await call(
          service.listProfileOrganizations,
          {},
          {},
          identity,
          {
            limit: '1',
          },
        );
        assert.equal(first.items.length, 1);
        assert.ok(first.nextCursor);
        const second = await call(
          service.listProfileOrganizations,
          {},
          {},
          identity,
          {
            limit: '1',
            cursor: first.nextCursor,
          },
        );
        assert.equal(second.items.length, 1);
        assert.notEqual(first.items[0].id, second.items[0].id);
        assert.equal(second.nextCursor, null);
        await rejects(
          () =>
            call(service.listProfileOrganizations, {}, {}, identity, {
              cursor: 'invalid',
            }),
          422,
        );
      },
    );
    await t.test(
      'last administrator cannot be removed or demoted',
      async () => {
        const a = (await call(service.listMembers, { orgId: org })).items.find(
          (m) => m.userId === admin.id,
        );
        await rejects(
          () => call(service.removeMember, { orgId: org, membershipId: a.id }),
          409,
          'LAST_ADMIN',
        );
        await rejects(
          () =>
            call(
              service.updateMember,
              { orgId: org, membershipId: a.id },
              {
                role: 'member',
              },
            ),
          409,
          'LAST_ADMIN',
        );
      },
    );
    await t.test('profile validation rejects field injection', async () => {
      await rejects(
        () =>
          call(
            service.updateProfile,
            {},
            { displayName: 'Alex', disabled_at: null },
          ),
        422,
      );
      assert.equal(
        (await call(service.updateProfile, {}, { displayName: ' Updated ' }))
          .user.displayName,
        'Updated',
      );
    });
    await t.test(
      'admin adds an account with immediate access and one audit event',
      async () => {
        const body = { email: ' Outside@Example.com ', role: 'editor' };
        const added = (await call(service.addMember, { orgId: org }, body))
          .member;
        assert.equal(added.email, stranger.email);
        assert.equal(
          (await call(service.listProfileOrganizations, {}, {}, stranger))
            .items[0].id,
          org,
        );
        assert.equal(
          (await call(service.readOrganization, { orgId: org }, {}, stranger))
            .organization.role,
          'editor',
        );
        await rejects(
          () =>
            call(
              service.addMember,
              { orgId: org },
              {
                ...body,
                role: 'admin',
              },
            ),
          409,
          'ALREADY_MEMBER',
        );
        assert.equal(
          (await call(service.readOrganization, { orgId: org }, {}, stranger))
            .organization.role,
          'editor',
        );
        assert.equal(
          (
            await q(
              "SELECT * FROM identity_audit_events WHERE action='membership.added' AND entity_id=$1",
              [added.id],
            )
          ).length,
          1,
        );
        await call(service.removeMember, {
          orgId: org,
          membershipId: added.id,
        });
        assert.equal(
          (await call(service.listProfileOrganizations, {}, {}, stranger)).items
            .length,
          0,
        );
        await rejects(
          () => call(service.readOrganization, { orgId: org }, {}, stranger),
          404,
        );
        const restored = (
          await call(
            service.addMember,
            { orgId: org },
            {
              ...body,
              role: 'member',
            },
          )
        ).member;
        assert.equal(restored.id, added.id);
        assert.equal(
          (await call(service.readOrganization, { orgId: org }, {}, stranger))
            .organization.role,
          'member',
        );
      },
    );
    await t.test(
      'adding members enforces authorization and valid active accounts',
      async () => {
        const body = { email: stranger.email, role: 'member' };
        await rejects(
          () => call(service.addMember, { orgId: org }, body, other),
          403,
        );
        await rejects(
          () => call(service.addMember, { orgId: org2 }, body, stranger),
          404,
        );
        await rejects(
          () =>
            call(
              service.addMember,
              { orgId: org },
              {
                ...body,
                role: 'owner',
              },
            ),
          422,
        );
        await rejects(
          () =>
            call(
              service.addMember,
              { orgId: org },
              {
                ...body,
                email: 'bad',
              },
            ),
          422,
        );
        await rejects(
          () =>
            call(
              service.addMember,
              { orgId: org },
              {
                ...body,
                userId: admin.id,
              },
            ),
          422,
        );
        await rejects(
          () =>
            call(
              service.addMember,
              { orgId: org },
              {
                ...body,
                email: 'unknown@example.com',
              },
            ),
          422,
          'ACCOUNT_UNAVAILABLE',
        );
        const duplicate = { ...stranger, sub: randomUUID() };
        const duplicateUser = (
          await call(service.bootstrapProfile, {}, {}, duplicate)
        ).user;
        await rejects(
          () => call(service.addMember, { orgId: org }, body),
          422,
          'ACCOUNT_UNAVAILABLE',
        );
        await q('UPDATE users SET disabled_at=now() WHERE id=$1', [
          duplicateUser.id,
        ]);
      },
    );
    await t.test(
      'disable and archive revoke access without deleting records',
      async () => {
        await q('UPDATE users SET disabled_at=now() WHERE id=$1', [member.id]);
        await rejects(
          () =>
            call(
              service.addMember,
              { orgId: org },
              {
                email: other.email,
                role: 'member',
              },
            ),
          422,
          'ACCOUNT_UNAVAILABLE',
        );
        await rejects(
          () => call(service.readProfile, {}, {}, other),
          403,
          'ACCOUNT_DISABLED',
        );
        await rejects(
          () => call(service.bootstrapProfile, {}, {}, other),
          403,
          'ACCOUNT_DISABLED',
        );
        await q(
          "UPDATE organizations SET status='archived',archived_at=now() WHERE id=$1",
          [org2],
        );
        await rejects(
          () => call(service.readOrganization, { orgId: org2 }),
          404,
        );
        assert.equal(
          (await call(service.listProfileOrganizations, {})).items.length,
          1,
        );
      },
    );
  } finally {
    await db.close();
  }
});
test('handler validates gateway claims and trusted verified email', async () => {
  const env = {
    COGNITO_ISSUER: issuer,
    COGNITO_CLIENT_ID: 'client',
    COGNITO_DOMAIN: 'https://example.auth.us-west-2.amazoncognito.com',
  };
  const event = {
    routeKey: 'GET /me',
    rawPath: '/me',
    headers: { authorization: 'Bearer test' },
    requestContext: {
      requestId: 'test-request',
      http: { method: 'GET' },
      authorizer: {
        jwt: {
          claims: {
            iss: issuer,
            client_id: 'client',
            sub: 'subject',
            token_use: 'access',
            exp: Math.floor(Date.now() / 1000) + 600,
            scope: 'quotes-api/access',
          },
        },
      },
    },
  };
  let calls = 0;
  const handler = createHandler({
    env,
    services: {
      identity: {
        readProfile: async ({ identity }) => {
          assert.equal(identity.sub, 'subject');
          calls++;
          return { user: { id: '1' } };
        },
      },
    },
    fetchUser: async () => ({
      ok: true,
      json: async () => ({
        sub: 'subject',
        email: 'verified@example.com',
        email_verified: true,
      }),
    }),
  });
  assert.equal((await handler(event)).statusCode, 200);
  assert.equal(calls, 1);
  for (const patch of [
    { iss: 'wrong' },
    { client_id: 'wrong' },
    { token_use: 'id' },
    { exp: 0 },
    { scope: '' },
  ]) {
    const bad = structuredClone(event);
    Object.assign(bad.requestContext.authorizer.jwt.claims, patch);
    assert.equal((await handler(bad)).statusCode, 401);
  }
  const unverified = createHandler({
    env,
    services: {
      identity: {
        readProfile: async () =>
          assert.fail('unverified identity reached service'),
      },
    },
    fetchUser: async () => ({
      ok: true,
      json: async () => ({
        sub: 'subject',
        email: 'verified@example.com',
        email_verified: false,
      }),
    }),
  });
  assert.equal((await unverified(event)).statusCode, 403);
  assert.equal(
    (
      await handler({
        ...event,
        routeKey: 'POST /unknown',
        rawPath: '/unknown',
      })
    ).statusCode,
    404,
  );
  for (const path of ['/v1/me', '/v1/session']) {
    assert.equal(
      (await handler({ ...event, routeKey: `GET ${path}`, rawPath: path }))
        .statusCode,
      404,
    );
  }
  assert.equal(calls, 1);
  const session = await handler({
    ...event,
    routeKey: 'GET /session',
    rawPath: '/session',
  });
  assert.equal(session.statusCode, 200);
  assert.deepEqual(JSON.parse(session.body), { subject: 'subject' });
});
test('serialization failure retries entire transaction', async () => {
  let calls = 0,
    releases = 0;
  const pool = {
    connect: async () => ({
      query: async () => ({ rows: [] }),
      release: () => releases++,
    }),
  };
  assert.equal(
    await transactions(pool, { sleep: async () => {} })(async () => {
      if (++calls === 1)
        throw Object.assign(new Error('conflict'), { code: '40001' });
      return 'ok';
    }),
    'ok',
  );
  assert.equal(calls, 2);
  assert.equal(releases, 2);
});
