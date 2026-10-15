import test from 'node:test';
import assert from 'node:assert/strict';
import { readTestFile as readFile } from './schema.mjs';
import { PGlite } from '@electric-sql/pglite';
import { createIdentityService } from '../identity.mjs';
import { createPrincipalService } from '../principals.mjs';
import { createTaxonomyService } from '../taxonomy.mjs';

test('page reads validate access without writes; mutations retain authorization guards', async (t) => {
  const db = new PGlite();
  let readOnly = false;
  let queries = [];
  const transaction = async (work) => {
    await db.exec(readOnly ? 'BEGIN READ ONLY' : 'BEGIN');
    try {
      const result = await work({ query: (sql, args) => {
        queries.push(sql);
        return db.query(sql, args);
      } });
      await db.exec('COMMIT');
      return result;
    } catch (error) {
      await db.exec('ROLLBACK');
      throw error;
    }
  };
  const identity = createIdentityService(transaction);
  const principals = createPrincipalService(transaction);
  const taxonomies = createTaxonomyService(transaction);
  const request = { orgId: '10', identity: { issuer: 'test', sub: 'admin' } };
  const content = {
    productFamilyName: 'Product', currency: 'USD', basePrice: '0.00',
    segments: [{ id: null, name: null, placeholder: 'X', defaultOptionIndex: null,
      options: [{ id: null, code: 'A', description: null, price: '0.00' }] }],
  };
  const revisions = async () => (await db.query(`SELECT
    (SELECT auth_revision FROM users WHERE id=1) AS user_revision,
    (SELECT auth_revision FROM organizations WHERE id=10) AS org_revision`)).rows[0];
  try {
    for (const file of ['0001/identity/schema.sql', '0001/quotes/schema.sql', '0002/taxonomy/schema.sql',
      '0003/principals/schema.sql', '0003/principals/enforce.sql']) {
      const sql = await readFile(new URL(`../../database/versions/${file}`, import.meta.url), 'utf8');
      await db.exec(sql.replaceAll('INDEX ASYNC', 'INDEX').replaceAll('ALTER TABLE ASYNC', 'ALTER TABLE'));
    }
    await db.exec(await readFile(new URL('../../database/versions/0008/quotes/schema.sql', import.meta.url), 'utf8'));
    await db.exec(`INSERT INTO users(id,cognito_issuer,cognito_subject,email,normalized_email)
      VALUES(1,'test','admin','admin@example.com','admin@example.com');
      INSERT INTO organizations(id,name,status) VALUES(10,'Workspace','active');
      INSERT INTO organization_memberships(organization_id,user_id,role) VALUES(10,1,'administrator');`);
    await principals.createPrincipal({ ...request, body: { name: 'Acme', websiteUrl: 'acme.com' } });
    const { body: { taxonomy } } = await taxonomies.createTaxonomy({ ...request, body: { principalId: '1', content } });
    const reads = [
      ['profile', () => identity.readProfile(request), false],
      ['organizations', () => identity.listProfileOrganizations(request), false],
      ['organization details', () => identity.readOrganization(request), true],
      ['quotes', () => identity.listQuotes(request), true],
      ['quote owners', () => identity.listEligibleOwners(request), true],
      ['members', () => identity.listMembers(request), true],
      ['principals', () => principals.listPrincipals(request), true],
      ['configurations', () => taxonomies.listTaxonomies(request), true],
      ['configuration details', () => taxonomies.readTaxonomy({ ...request, taxonomyId: taxonomy.id }), true],
      ['configuration preview', () => taxonomies.previewTaxonomy({ ...request, taxonomyId: taxonomy.id,
        body: { versionId: taxonomy.currentVersionId, selections: [] } }), true],
    ];
    readOnly = true;
    for (const [label, read, organizationScoped] of reads) {
      await t.test(`${label} succeeds in a read-only transaction and reads authorization once`, async () => {
        const before = await revisions();
        queries = [];
        await read();
        assert.deepEqual(await revisions(), before);
        assert.equal(queries.filter(sql => sql.startsWith('SELECT * FROM public.users WHERE cognito_issuer')).length, 1);
        assert.equal(queries.filter(sql => sql.startsWith('SELECT * FROM public.organizations WHERE id')).length, organizationScoped ? 1 : 0);
        assert.equal(queries.filter(sql => sql.includes('SELECT * FROM public.organization_memberships WHERE')).length, organizationScoped ? 1 : 0);
        assert.ok(queries.every(sql => !/\b(UPDATE|INSERT|DELETE)\b/i.test(sql)));
      });
    }
    await t.test('disabled accounts are rejected on every read', async () => {
      await db.exec('UPDATE users SET disabled_at=now() WHERE id=1');
      for (const [, read] of reads) await assert.rejects(read, { code: 'ACCOUNT_DISABLED', status: 403 });
      await db.exec('UPDATE users SET disabled_at=NULL WHERE id=1');
    });
    for (const [label, revoke, restore] of [
      ['removed membership', 'UPDATE organization_memberships SET removed_at=now()', 'UPDATE organization_memberships SET removed_at=NULL'],
      ['archived organization', "UPDATE organizations SET status='archived',archived_at=now()", "UPDATE organizations SET status='active',archived_at=NULL"],
    ]) {
      await t.test(`${label} denies every organization read`, async () => {
        await db.exec(revoke);
        for (const [, read, organizationScoped] of reads) {
          if (organizationScoped) await assert.rejects(read, { code: 'NOT_FOUND', status: 404 });
        }
        await db.exec(restore);
      });
    }
    await t.test('Sales users can view Team', async () => {
      await db.exec("UPDATE organization_memberships SET role='sales'");
      await identity.listMembers(request);
      await principals.listPrincipals(request);
      await taxonomies.listTaxonomies(request);
      await db.exec("UPDATE organization_memberships SET role='administrator'");
    });
    await t.test('principal and configuration creation still increment both guards', async () => {
      readOnly = false;
      for (const write of [
        () => principals.createPrincipal({ ...request, body: { name: 'Beacon', websiteUrl: 'beacon.com' } }),
        () => taxonomies.createTaxonomy({ ...request, body: { principalId: '1', content } }),
      ]) {
        const before = await revisions();
        await write();
        const after = await revisions();
        assert.equal(BigInt(after.user_revision), BigInt(before.user_revision) + 1n);
        assert.equal(BigInt(after.org_revision), BigInt(before.org_revision) + 1n);
      }
    });
  } finally {
    await db.close();
  }
});
