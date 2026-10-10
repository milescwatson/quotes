// Local relational validation, not a DSQL emulator or authentication service.
// The only DDL translation is INDEX ASYNC -> INDEX; see ../../design/identity/validation.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
const { PGlite } = await import(process.env.PGLITE_MODULE ?? '@electric-sql/pglite');
const issuer = 'https://cognito-idp.us-west-2.amazonaws.com/test-pool';
const principal = 'arn:aws:iam::123456789012:role/test-operator';
const schema = await readFile(new URL('../versions/0001/identity/schema.sql', import.meta.url), 'utf8');
const permissions = await readFile(new URL('../versions/0001/identity/permissions.sql', import.meta.url), 'utf8');
const db = new PGlite();
const query = async (sql, args = []) => (await db.query(sql, args)).rows;
async function insert(table, values) {
  const entries = Object.entries(values);
  return (await query(`INSERT INTO public.${table} (${entries.map(([k]) => k).join(',')})
    VALUES (${entries.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, entries.map(([, v]) => v)))[0];
}
const user = (changes = {}) => insert('users', {
  cognito_issuer: issuer, cognito_subject: randomUUID(),
  email: 'Person@example.com', normalized_email: 'person@example.com', ...changes,
});
const org = (changes = {}) => insert('organizations', { name: 'Test organization', ...changes });
const membership = (organization, person, role = 'member') => insert('organization_memberships', {
  organization_id: organization.id, user_id: person.id, role,
});
const audit = (changes = {}) => insert('identity_audit_events', {
  actor_type: 'operator', actor_principal: principal,
  action: 'organization.created', entity_type: 'organization', entity_id: '1',
  request_id: randomUUID(), ...changes,
});
async function rejects(operation, code) {
  await assert.rejects(operation, error => (Array.isArray(code) ? code : [code]).includes(error.code));
}
// Explicit documented access predicate, not a replacement for JWT/role checks.
const accessible = (u, o) => query(`SELECT m.role FROM public.organization_memberships m
  JOIN public.users u ON u.id = m.user_id
  JOIN public.organizations o ON o.id = m.organization_id
  WHERE u.id = $1 AND o.id = $2 AND u.disabled_at IS NULL
    AND m.removed_at IS NULL AND o.status = 'active'`, [u.id, o.id]);

test('identity schema: local PostgreSQL constraints and transaction shapes', async t => {
  try {
    await t.test('DSQL DDL is explicit, ordered, and free of procedural enforcement', async () => {
      const sql = schema.replace(/--[^\n]*/g, '');
      assert.equal((sql.match(/CREATE TABLE /g) ?? []).length, 4);
      assert.equal((sql.match(/CREATE (?:UNIQUE )?INDEX ASYNC /g) ?? []).length, 4);
      assert.doesNotMatch(sql, /\b(BEGIN|COMMIT|TRIGGER|PLPGSQL|DOMAIN)\b/i);
      for (const statement of sql.split(';').map(s => s.trim()).filter(Boolean)) {
        await db.exec(statement.replace(/\bINDEX ASYNC\b/g, 'INDEX'));
      }
    });
    await t.test('Cognito identity is unique while equal emails do not merge users', async () => {
      const a = await user();
      await rejects(() => user({ cognito_subject: a.cognito_subject }), '23505');
      const b = await user();
      assert.notEqual(a.id, b.id);
      const c = await user({ cognito_subject: a.cognito_subject, cognito_issuer: `${issuer}-other` });
      assert.notEqual(a.id, c.id);
      assert.equal((await query('SELECT * FROM organization_memberships WHERE user_id = $1', [a.id])).length, 0);
      await rejects(() => user({ normalized_email: 'PERSON@example.com' }), '23514');
      await rejects(() => user({ display_name: '  ' }), '23514');
    });
    await t.test('organization lifecycle and duplicate names', async () => {
      const a = await org();
      const b = await org();
      assert.equal(a.status, 'pending');
      assert.notEqual(a.id, b.id);
      await rejects(() => org({ status: 'archived' }), '23514');
      await rejects(() => org({ status: 'unknown' }), '23514');
      const archivedAt = new Date('2026-01-02T00:00:00Z');
      await org({ status: 'archived', created_at: archivedAt, archived_at: archivedAt });
    });
    await t.test('one user can have independent roles, with unique organization membership', async () => {
      const u = await user(), a = await org({ status: 'active' }), b = await org({ status: 'active' });
      await membership(a, u, 'admin');
      await membership(b, u, 'editor');
      assert.equal((await accessible(u, a))[0].role, 'admin');
      assert.equal((await accessible(u, b))[0].role, 'editor');
      await rejects(() => membership(a, u), '23505');
      await rejects(() => membership(awaitableMissingOrg, u), '23503');
      await rejects(() => membership(a, { id: '9223372036854775807' }), '23503');
      await rejects(() => membership(awaitableMissingOrg, u, 'superadmin'), '23514');
    });
    await t.test('access predicate excludes strangers, removed members, disabled users, and archives', async () => {
      const u = await user(), a = await org({ status: 'active' });
      assert.equal((await accessible(u, a)).length, 0);
      const m = await membership(a, u);
      assert.equal((await accessible(u, a)).length, 1);
      await query('UPDATE organization_memberships SET removed_at = now() WHERE id = $1', [m.id]);
      assert.equal((await accessible(u, a)).length, 0);
      await query('UPDATE organization_memberships SET removed_at = NULL WHERE id = $1', [m.id]);
      await query('UPDATE users SET disabled_at = now() WHERE id = $1', [u.id]);
      assert.equal((await accessible(u, a)).length, 0);
      await query('UPDATE users SET disabled_at = NULL WHERE id = $1', [u.id]);
      await query("UPDATE organizations SET status = 'archived', archived_at = now() WHERE id = $1", [a.id]);
      assert.equal((await accessible(u, a)).length, 0);
      assert.equal((await query('SELECT id FROM organization_memberships WHERE id = $1', [m.id])).length, 1);
    });
    await t.test('membership and audit changes roll back together', async () => {
      const a = await org(), u = await user();
      await db.exec('BEGIN');
      const m = await membership(a, u);
      await audit({ organization_id: a.id, entity_type: 'membership', entity_id: m.id });
      await db.exec('ROLLBACK');
      assert.equal((await query('SELECT * FROM organization_memberships WHERE id=$1', [m.id])).length, 0);
      assert.equal((await query('SELECT * FROM identity_audit_events WHERE entity_id=$1', [m.id])).length, 0);
    });
    await t.test('foreign keys protect identity and history from cascading deletion', async () => {
      const a = await org(), u = await user();
      await membership(a, u);
      await rejects(() => query('DELETE FROM users WHERE id = $1', [u.id]), ['23001', '23503']);
      await rejects(() => query('DELETE FROM organizations WHERE id = $1', [a.id]), ['23001', '23503']);
    });
    await t.test('runtime grants preserve audit records', async () => {
      await db.exec('CREATE ROLE identity_test_api; CREATE ROLE identity_test_operator;');
      await db.exec(permissions.replaceAll(':"api_role"', 'identity_test_api')
        .replaceAll(':"operator_role"', 'identity_test_operator'));
      const a = await org(), u = await user();
      for (const role of ['identity_test_api', 'identity_test_operator']) {
        await db.exec(`SET ROLE ${role}`);
        try {
          await rejects(() => query('UPDATE identity_audit_events SET action = action'), '42501');
          await rejects(() => query('DELETE FROM identity_audit_events'), '42501');
          await rejects(() => db.exec('TRUNCATE identity_audit_events'), '42501');
        } finally { await db.exec('RESET ROLE'); }
      }
      await db.exec('SET ROLE identity_test_api');
      try {
        await rejects(() => org(), '42501');
        await rejects(() => query('UPDATE users SET disabled_at = now() WHERE id = $1', [u.id]), '42501');
        await rejects(() => query('DELETE FROM organization_memberships'), '42501');
        await query(`INSERT INTO identity_audit_events(actor_type, actor_user_id, action, entity_type, entity_id, request_id)
          VALUES ('user', $1, 'profile.updated', 'user', $1, $2)`, [u.id, randomUUID()]);
      } finally { await db.exec('RESET ROLE'); }
    });
    await t.test('existing taxonomy DDL references real users and organizations', async () => {
      await db.exec(await readFile(new URL('../versions/0001/taxonomy/schema.sql', import.meta.url), 'utf8'));
      await db.exec(await readFile(new URL('../functions/taxonomy.sql', import.meta.url), 'utf8'));
      await db.exec(await readFile(new URL('../versions/0001/taxonomy/triggers.sql', import.meta.url), 'utf8'));
      await db.exec(await readFile(new URL('../functions/taxonomy.sql', import.meta.url), 'utf8'));
      const a = await org({ status: 'active' }), u = await user();
      const taxonomyId = 100, versionId = 100;
      await db.exec('BEGIN');
      await query('INSERT INTO taxonomies(id, owner_organization_id, current_version_id, created_by_user_id) VALUES ($1,$2,$3,$4)',
        [taxonomyId, a.id, versionId, u.id]);
      await query(`INSERT INTO taxonomy_versions(id, taxonomy_id, version_number, product_family_name, created_by_user_id)
        VALUES ($1,$2,1,'Test family',$3)`, [versionId, taxonomyId, u.id]);
      await db.exec('COMMIT');
      assert.equal((await query('SELECT current_version_id FROM taxonomies WHERE id = $1', [taxonomyId]))[0].current_version_id, versionId);
      await rejects(() => query('DELETE FROM users WHERE id = $1', [u.id]), '23503');
    });
  } finally { await db.close(); }
});

const awaitableMissingOrg = { id: '9223372036854775807' };
