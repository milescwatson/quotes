import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { randomUUID, randomBytes } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { PGlite } from '@electric-sql/pglite';
import { readTestFile } from './schema.mjs';
import { createIdentityService } from '../identity.mjs';
import { normalizeLogo, createLogoStorage, LOGO_REQUEST_LIMIT } from '../organization-logo.mjs';
import { createApp } from '../app.mjs';
import { createLambdaHandler } from '../lambda.mjs';
import { HttpError } from '../shared.mjs';
import { createQuoteService } from '../quotes.mjs';
import { renderQuotePdf } from '../quote-pdf-layout.mjs';

const image = (width = 20, height = 10) => sharp({ create: { width, height, channels: 4, background: '#2463eb80' } });
test('normalization decodes, limits dimensions, preserves alpha, and rejects unsafe image inputs', async () => {
  const png = await normalizeLogo((await image(2000, 1000).png().toBuffer()).toString('base64'));
  const meta = await sharp(png).metadata();
  assert.equal(meta.width, 1024); assert.equal(meta.height, 512); assert.equal(meta.hasAlpha, true);
  const small = await normalizeLogo((await image().jpeg().toBuffer()).toString('base64'));
  assert.equal((await sharp(small).metadata()).width, 20);
  for (const value of ['', '!', null, Buffer.from('<svg/>').toString('base64'), (await image().webp().toBuffer()).toString('base64'), (await image(4001, 4000).png().toBuffer()).toString('base64')])
    await assert.rejects(() => normalizeLogo(value), { code: 'INVALID_LOGO' });
  // Assemble a valid two-frame APNG, including sequence numbers and CRCs.
  const frame = await image(1, 1).png().toBuffer();
  const chunks = [];
  for (let offset = 8; offset < frame.length;) {
    const size = frame.readUInt32BE(offset);
    chunks.push([frame.toString('ascii', offset + 4, offset + 8), frame.subarray(offset + 8, offset + 8 + size)]);
    offset += size + 12;
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]), size = Buffer.alloc(4), checksum = Buffer.alloc(4);
    size.writeUInt32BE(data.length); checksum.writeUInt32BE(crc32(body));
    return Buffer.concat([size, body, checksum]);
  };
  const control = Buffer.alloc(8); control.writeUInt32BE(2);
  const fc = sequence => { const value = Buffer.alloc(26); value.writeUInt32BE(sequence); value.writeUInt32BE(1, 4); value.writeUInt32BE(1, 8); value.writeUInt16BE(1, 20); value.writeUInt16BE(10, 22); return value; };
  const idat = Buffer.concat(chunks.filter(([type]) => type === 'IDAT').map(([, data]) => data));
  const sequence = Buffer.alloc(4); sequence.writeUInt32BE(2);
  const apng = Buffer.concat([frame.subarray(0, 8), chunk('IHDR', chunks.find(([type]) => type === 'IHDR')[1]), chunk('acTL', control), chunk('fcTL', fc(0)), chunk('IDAT', idat), chunk('fcTL', fc(1)), chunk('fdAT', Buffer.concat([sequence, idat])), chunk('IEND', Buffer.alloc(0))]);
  assert.equal((await sharp(apng).metadata()).format, 'png');
  await assert.rejects(() => normalizeLogo(apng.toString('base64')), { code: 'INVALID_LOGO' });
  const noise = await sharp(randomBytes(800 * 800 * 3), { raw: { width: 800, height: 800, channels: 3 } }).jpeg().toBuffer();
  assert.ok(noise.length < 2 * 1024 * 1024);
  await assert.rejects(() => normalizeLogo(noise.toString('base64')), { code: 'LOGO_TOO_LARGE' });
  await assert.rejects(() => normalizeLogo(Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64')), { code: 'LOGO_TOO_LARGE' });
});

test('organization logo access, replacement, rollback, cleanup, audit, and quote branding', async t => {
  const db = new PGlite({ parsers: { 20: value => value } });
  let failCommit = false;
  const tx = async work => { await db.exec('BEGIN'); try { const result = await work(db); if (failCommit) { failCommit = false; throw new HttpError(503, 'SERVICE_UNAVAILABLE', 'Commit failed'); } await db.exec('COMMIT'); return result; } catch (error) { await db.exec('ROLLBACK'); throw error; } };
  const objects = new Map(); let failPut = false, failGet = false, failDelete = false, revokeOnPut = false, failCommitOnPut = false, reads = 0;
  const storage = {
    async put(org, version, bytes) { if (failPut) throw new HttpError(503, 'LOGO_UNAVAILABLE', 'Unavailable'); objects.set(`${org}/${version}`, bytes); if (failCommitOnPut) failCommit = true; if (revokeOnPut) await db.exec("UPDATE organization_memberships SET role='sales' WHERE user_id=1"); },
    async get(org, version) { reads++; if (failGet || !objects.has(`${org}/${version}`)) throw new HttpError(503, 'LOGO_UNAVAILABLE', 'Unavailable'); return objects.get(`${org}/${version}`); },
    async remove(org, version) { if (failDelete) throw Error('Unavailable'); objects.delete(`${org}/${version}`); },
  };
  const service = createIdentityService(tx, { logoStorage: storage });
  const call = (fn, sub = 'admin', body = {}, orgId = '10') => fn({ orgId, identity: { issuer: 'test', sub, email: sub === 'super' ? 'mc.watson415@gmail.com' : `${sub}@example.com` }, body, requestId: randomUUID() });
  const body = { imageBase64: (await image().png().toBuffer()).toString('base64') };
  try {
    await db.exec((await readTestFile(new URL('../../database/versions/0001/identity/schema.sql', import.meta.url))).replaceAll('INDEX ASYNC', 'INDEX'));
    await db.exec(`INSERT INTO users(id,cognito_issuer,cognito_subject,email,normalized_email) VALUES (1,'test','admin','admin@example.com','admin@example.com'),(2,'test','sales','sales@example.com','sales@example.com'),(3,'test','outsider','outsider@example.com','outsider@example.com'),(4,'test','super','mc.watson415@gmail.com','mc.watson415@gmail.com');
      INSERT INTO organizations(id,name,status) VALUES (10,'Organization','active'),(11,'Other','active');
      INSERT INTO organization_memberships(organization_id,user_id,role) VALUES (10,1,'administrator'),(10,2,'sales'),(11,3,'administrator');`);
    await t.test('permissions and absent logo', async () => {
      await assert.rejects(() => call(service.readOrganizationLogo), { code: 'NOT_FOUND' });
      await assert.rejects(() => call(service.updateOrganizationLogo, 'sales', body), { code: 'FORBIDDEN' });
      await assert.rejects(() => call(service.updateOrganizationLogo, 'outsider', body), { code: 'NOT_FOUND' });
      await assert.rejects(() => call(service.removeOrganizationLogo, 'sales'), { code: 'FORBIDDEN' });
      assert.equal(objects.size, 0);
    });
    let version;
    await t.test('upload and sales read; cross-organization access denied', async () => {
      version = (await call(service.updateOrganizationLogo, 'admin', body)).organization.logoVersion;
      assert.ok(version);
      assert.deepEqual(await call(service.readOrganizationLogo, 'sales'), objects.get(`10/${version}`));
      await assert.rejects(() => call(service.readOrganizationLogo, 'outsider'), { code: 'NOT_FOUND' });
      assert.equal(reads, 1);
    });
    await t.test('failed upload retains the current logo; replacement cleans the old object', async () => {
      failPut = true;
      await assert.rejects(() => call(service.updateOrganizationLogo, 'admin', body), { code: 'LOGO_UNAVAILABLE' });
      assert.equal((await call(service.readOrganization)).organization.logoVersion, version);
      failPut = false;
      const next = (await call(service.updateOrganizationLogo, 'super', body)).organization.logoVersion;
      assert.notEqual(next, version); assert.equal(objects.has(`10/${version}`), false); version = next;
      assert.equal((await db.query("SELECT * FROM identity_audit_events WHERE action='organization.logo_uploaded'")).rows.length, 2);
    });
    await t.test('database failure rolls back the reference and its audit event', async () => {
      failCommitOnPut = true;
      await assert.rejects(() => call(service.updateOrganizationLogo, 'admin', body), { code: 'SERVICE_UNAVAILABLE' });
      failCommitOnPut = false;
      assert.equal((await call(service.readOrganization)).organization.logoVersion, version);
      assert.equal((await db.query("SELECT * FROM identity_audit_events WHERE action='organization.logo_uploaded'")).rows.length, 2);
    });
    await t.test('authorization revoked during upload prevents publishing the new image', async () => {
      revokeOnPut = true;
      await assert.rejects(() => call(service.updateOrganizationLogo, 'admin', body), { code: 'FORBIDDEN' });
      assert.equal((await call(service.readOrganization)).organization.logoVersion, version);
      revokeOnPut = false;
      await db.exec("UPDATE organization_memberships SET role='administrator' WHERE user_id=1");
    });
    await t.test('storage failures, disabled accounts, removal and failed cleanup', async () => {
      failGet = true;
      await assert.rejects(() => call(service.readOrganizationLogo), { code: 'LOGO_UNAVAILABLE' }); failGet = false;
      await db.exec('UPDATE users SET disabled_at=now() WHERE id=1');
      for (const fn of [service.readOrganizationLogo, service.updateOrganizationLogo, service.removeOrganizationLogo])
        await assert.rejects(() => call(fn, 'admin', body), { code: 'ACCOUNT_DISABLED' });
      await db.exec('UPDATE users SET disabled_at=NULL WHERE id=1');
      failDelete = true;
      assert.equal((await call(service.removeOrganizationLogo)).organization.logoVersion, null);
      assert.equal((await call(service.removeOrganizationLogo)).organization.logoVersion, null);
      await assert.rejects(() => call(service.readOrganizationLogo, 'sales'), { code: 'NOT_FOUND' });
    });
  } finally { await db.close(); }
});

test('S3 uses organization-scoped keys and maps unavailable storage to retryable errors', async () => {
  const commands = [];
  const storage = createLogoStorage({ ORGANIZATION_LOGO_BUCKET: 'private-logos' }, { async send(command) { commands.push(command); return { Body: { transformToByteArray: async () => [1, 2] } }; } });
  await storage.put('10', 'version', Buffer.from([1, 2]));
  assert.deepEqual(await storage.get('10', 'version'), Buffer.from([1, 2]));
  await storage.remove('10', 'version');
  for (const command of commands) { assert.equal(command.input.Bucket, 'private-logos'); assert.equal(command.input.Key, 'organizations/10/logos/version.png'); }
  const broken = createLogoStorage({ ORGANIZATION_LOGO_BUCKET: 'private-logos' }, { async send() { throw Error('secret upstream details'); } });
  await assert.rejects(() => broken.get('10', 'v'), { status: 503, code: 'LOGO_UNAVAILABLE' });
});

test('Lambda returns PNG bytes; upload body limit is independent of other routes', async () => {
  const png = await image().png().toBuffer();
  const config = { COGNITO_ISSUER: 'test', COGNITO_CLIENT_ID: 'client' };
  const app = createApp({ config, identityLookup: async () => ({}), logError: () => {}, services: { identity: { readOrganizationLogo: async () => png, updateOrganizationLogo: async () => ({ ok: true }) }, taxonomy: {}, principals: {}, regularProducts: {} } });
  const handler = createLambdaHandler(app);
  const event = (method, body) => ({ version: '2.0', rawPath: '/organizations/10/logo', headers: { 'content-type': 'application/json' }, body,
    requestContext: { http: { method, path: '/organizations/10/logo' }, authorizer: { jwt: { claims: { iss: 'test', client_id: 'client', sub: 'member', token_use: 'access', exp: Date.now() / 1000 + 60, scope: 'quotes-api/access' } } } } });
  const result = await handler(event('GET'), {});
  assert.equal(result.headers['content-type'], 'image/png'); assert.equal(result.headers['cache-control'], 'no-store');
  assert.equal(result.isBase64Encoded, true); assert.deepEqual(Buffer.from(result.body, 'base64'), png);
  assert.equal((await handler(event('PUT', JSON.stringify({ imageBase64: 'a'.repeat(600000) })), {})).statusCode, 200);
  assert.equal((await handler(event('PUT', JSON.stringify({ imageBase64: 'a'.repeat(LOGO_REQUEST_LIMIT) })), {})).statusCode, 413);
  await app.close();
});

test('PDF renderer embeds transparent, wide and tall logos without exceeding download bounds', async () => {
  for (const [width, height] of [[500, 50], [50, 500], [100, 100]]) {
    const logo = await image(width, height).png().toBuffer();
    const pdf = await renderQuotePdf({ id: '10', customer: 'Customer', project: 'Project', draft: true, total: '0.00', lines: [], organization: { name: 'Company name', contact: ['Address'], logo } });
    assert.match(pdf.toString('latin1'), /\/Subtype \/Image/); assert.ok(pdf.length < 4 * 1024 * 1024);
  }
});

test('quote PDF loads only the authorized current logo and propagates storage errors', async () => {
  const png = await image().png().toBuffer();
  let version = randomUUID(), allow = true, broken = false, reads = [];
  const db = { async query(sql) {
    if (sql.includes('FROM public.users')) return { rows: [{ id: '1' }] };
    if (sql.includes('FROM public.organizations')) return { rows: [{ id: '10', status: 'active', name: 'Company', logo_id: version }] };
    if (sql.includes('FROM public.organization_memberships')) return { rows: allow ? [{ role: 'sales' }] : [] };
    if (sql.includes('FROM public.quotes')) return { rows: [{ id: '1', organization_id: '10', customer_name: 'Customer', project_name: 'Project', lines: [], token: 'saved', modified_by: '1', modified_when: new Date() }] };
    throw Error(sql);
  } };
  const quotes = createQuoteService(work => work(db), { logoStorage: { async get(org, id) { reads.push([org, id]); if (broken) throw new HttpError(503, 'LOGO_UNAVAILABLE', 'Unavailable'); return png; } } });
  const input = { orgId: '10', quoteId: '1', query: { expectedToken: 'saved' }, identity: { issuer: 'test', sub: 'member' } };
  assert.match((await quotes.readQuotePdf(input)).pdf.toString('latin1'), /\/Subtype \/Image/);
  assert.deepEqual(reads, [['10', version]]);
  version = randomUUID(); await quotes.readQuotePdf(input); assert.equal(reads[1][1], version);
  broken = true; await assert.rejects(() => quotes.readQuotePdf(input), { code: 'LOGO_UNAVAILABLE' });
  allow = false;
  const count = reads.length;
  await assert.rejects(() => quotes.readQuotePdf(input), { code: 'NOT_FOUND' }); assert.equal(reads.length, count);
  allow = true; version = null;
  assert.doesNotMatch((await quotes.readQuotePdf(input)).pdf.toString('latin1'), /\/Subtype \/Image/);
});
