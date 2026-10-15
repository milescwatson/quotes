// Run the deployment bundle on Lambda against real S3 and the restricted DSQL
// role. Database fixtures roll back; all uploaded objects and the temporary
// Lambda are deleted. Synthetic identity lookup is confined to this smoke copy.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { aws, target } from './development-database.mjs';
assert.equal(JSON.parse(aws(['sts', 'get-caller-identity'])).Account, target.account);
const config = JSON.parse(aws(['lambda', 'get-function-configuration', '--function-name', 'quotes-development-api', '--qualifier', 'development']));
assert.ok(config.Environment.Variables.ORGANIZATION_LOGO_BUCKET);
const archive = fileURLToPath(new URL('../../AWS/environments/development/.terraform/quotes-api.zip', import.meta.url));
assert.equal(config.CodeSha256, createHash('sha256').update(await readFile(archive)).digest('base64'));
const directory = await mkdtemp(join(tmpdir(), 'quotes-logo-runtime-'));
const name = 'quotes-development-logo-smoke';
let created = false;
try {
  const code = join(directory, 'code');
  execFileSync('unzip', ['-q', archive, '-d', code]);
  const source = await readFile(join(code, 'index.mjs'), 'utf8');
  await writeFile(join(code, 'index.mjs'), source + `
export async function logoRuntimeSmoke() {
  const assert = (condition, message) => { if (!condition) throw Error(message); };
  const client = await getPool().connect();
  const storage = createLogoStorage();
  const versions = new Set(); let orgId, app;
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    const subject = 'logo-smoke-' + Date.now();
    const user = (await client.query("INSERT INTO public.users(cognito_issuer,cognito_subject,email,normalized_email) VALUES($1,$2,'logo-smoke@gmail.com','logo-smoke@gmail.com') RETURNING id", [process.env.COGNITO_ISSUER, subject])).rows[0];
    const org = (await client.query("INSERT INTO public.organizations(name,status) VALUES('Logo deployment verification','active') RETURNING id")).rows[0];
    orgId = String(org.id);
    await client.query("INSERT INTO public.organization_memberships(organization_id,user_id,role) VALUES($1,$2,'administrator')", [orgId, user.id]);
    const identity = { issuer: process.env.COGNITO_ISSUER, sub: subject, email: 'logo-smoke@gmail.com' };
    const service = createIdentityService(work => work(client), { logoStorage: storage });
    app = createApp({ services: { identity: service, taxonomy: {}, principals: {}, regularProducts: {} }, identityLookup: async () => identity });
    const proxy = createLambdaHandler(app);
    const call = async (method, suffix, body, status = 200) => {
      const path = '/organizations/' + orgId + suffix;
      const response = await proxy({ version: '2.0', rawPath: path.split('?')[0], queryStringParameters: Object.fromEntries(new URLSearchParams(path.split('?')[1] || '')),
        headers: { 'content-type': 'application/json', authorization: 'Bearer smoke-copy-only' }, ...(body ? { body: JSON.stringify(body) } : {}),
        requestContext: { requestId: 'logo-runtime-smoke', http: { method, path: path.split('?')[0] }, authorizer: { jwt: { claims: { iss: identity.issuer, client_id: process.env.COGNITO_CLIENT_ID, sub: identity.sub, token_use: 'access', exp: Date.now()/1000 + 300, scope: 'quotes-api/access' } } } } }, {});
      assert(response.statusCode === status, method + ' ' + suffix + ': ' + response.statusCode + ' ' + response.body?.slice(0,200));
      return response;
    };
    const bytes = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWNQSX79H4QZYAwAUcQJxZw+vakAAAAASUVORK5CYII=';
    await call('GET', '/logo', null, 404);
    const first = JSON.parse((await call('PUT', '/logo', { imageBase64: bytes })).body).organization.logoVersion;
    versions.add(first); assert(first, 'Upload must set a logo identifier');
    const downloaded = await call('GET', '/logo');
    assert(downloaded.isBase64Encoded && downloaded.headers['content-type'] === 'image/png', 'PNG must survive Lambda binary encoding');
    assert(Buffer.from(downloaded.body, 'base64').subarray(1,4).toString() === 'PNG', 'Expected PNG bytes');
    const anonymous = await fetch('https://' + process.env.ORGANIZATION_LOGO_BUCKET + '.s3.' + process.env.AWS_REGION + '.amazonaws.com/organizations/' + orgId + '/logos/' + first + '.png');
    assert(anonymous.status === 403, 'Stored logo must reject anonymous access');
    const quote = (await service.createQuote({ orgId, identity, body: { customerName: 'Smoke customer', projectName: 'Smoke project', ownerId: null, lines: [] } })).quote;
    const pdf = await call('GET', '/quotes/' + quote.id + '/pdf?expectedToken=' + encodeURIComponent(quote.token));
    assert(Buffer.from(pdf.body, 'base64').toString('latin1').includes('/Subtype /Image'), 'PDF must embed the current logo');
    const second = JSON.parse((await call('PUT', '/logo', { imageBase64: bytes })).body).organization.logoVersion;
    versions.add(second); assert(first !== second, 'Replacement must use a fresh object');
    await client.query("UPDATE public.organization_memberships SET role='sales' WHERE organization_id=$1 AND user_id=$2", [orgId,user.id]);
    await call('GET', '/logo');
    await call('PUT', '/logo', { imageBase64: bytes }, 403);
    await call('DELETE', '/logo', null, 403);
    await client.query("UPDATE public.organization_memberships SET role='administrator' WHERE organization_id=$1 AND user_id=$2", [orgId,user.id]);
    assert(JSON.parse((await call('DELETE', '/logo')).body).organization.logoVersion === null, 'Removal must clear reference');
    await call('DELETE', '/logo'); await call('GET', '/logo', null, 404);
    return { status: 'passed', runtime: process.version, architecture: process.arch, checks: ['native-normalization','restricted-database-role','S3-upload-read-replace-remove','anonymous-S3-read-denied','Lambda-PNG-binary-response','PDF-embedded-logo','Sales-read-and-write-boundaries','idempotent-removal'], fixtures: 'rolled-back' };
  } finally {
    try { await client.query('ROLLBACK'); }
    finally { client.release(); }
    for (const version of versions) await storage.remove(orgId, version);
    if (app) await app.close();
    await getPool().end();
  }
}
`);
  const zip = join(directory, 'smoke.zip');
  execFileSync('zip', ['-qr', zip, '.'], { cwd: code });
  const input = join(directory, 'function.json');
  await writeFile(input, JSON.stringify({ FunctionName: name, Runtime: 'nodejs22.x', Role: config.Role, Handler: 'index.logoRuntimeSmoke', Timeout: 60, MemorySize: 512, Architectures: ['arm64'], Environment: config.Environment }));
  aws(['lambda', 'create-function', '--cli-input-json', `file://${input}`, '--zip-file', `fileb://${zip}`]); created = true;
  aws(['lambda', 'wait', 'function-active-v2', '--function-name', name]);
  const output = join(directory, 'response.json');
  const invocation = JSON.parse(aws(['lambda', 'invoke', '--function-name', name, output]));
  const response = JSON.parse(await readFile(output, 'utf8'));
  assert.ok(!invocation.FunctionError, JSON.stringify(response));
  assert.equal(response.status, 'passed');
  const result = { environment: 'development', verifiedAt: new Date().toISOString(), deployedLambdaVersion: config.Version, codeSha256: config.CodeSha256, ...response };
  await writeFile(new URL('../../AWS/deployments/2026-10-15-logo-runtime-verification.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally {
  if (created) aws(['lambda', 'delete-function', '--function-name', name]);
  await rm(directory, { recursive: true, force: true });
}
