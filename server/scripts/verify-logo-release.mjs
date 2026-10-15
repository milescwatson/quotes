// Read-only release and hosted-asset checks. No user tokens or records needed.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import YAML from 'yaml';
import { aws, target } from './development-database.mjs';
assert.equal(JSON.parse(aws(['sts', 'get-caller-identity'])).Account, target.account);
const contract = YAML.parse(await readFile(new URL('../../AWS/openapi.yaml', import.meta.url), 'utf8'));
const routes = JSON.parse(aws(['apigatewayv2', 'get-routes', '--api-id', 'um0ix9fu4i'])).Items;
const expected = Object.entries(contract.paths).flatMap(([path, methods]) => Object.keys(methods).map(method => `${method.toUpperCase()} ${path}`)).sort();
assert.deepEqual(routes.map(route => route.RouteKey).sort(), expected);
for (const route of routes) assert.equal(route.AuthorizationType, route.RouteKey === 'GET /health' ? 'NONE' : 'JWT');
const config = JSON.parse(aws(['lambda', 'get-function-configuration', '--function-name', 'quotes-development-api', '--qualifier', 'development']));
assert.equal(config.State, 'Active'); assert.equal(config.LastUpdateStatus, 'Successful');
const archive = await readFile(new URL('../../AWS/environments/development/.terraform/quotes-api.zip', import.meta.url));
assert.equal(config.CodeSha256, createHash('sha256').update(archive).digest('base64'));
const bucket = config.Environment.Variables.ORGANIZATION_LOGO_BUCKET;
const block = JSON.parse(aws(['s3api', 'get-public-access-block', '--bucket', bucket])).PublicAccessBlockConfiguration;
assert.ok(Object.values(block).every(value => value === true));
const ownership = JSON.parse(aws(['s3api', 'get-bucket-ownership-controls', '--bucket', bucket])).OwnershipControls;
assert.equal(ownership.Rules[0].ObjectOwnership, 'BucketOwnerEnforced');
const encryption = JSON.parse(aws(['s3api', 'get-bucket-encryption', '--bucket', bucket])).ServerSideEncryptionConfiguration;
assert.equal(encryption.Rules[0].ApplyServerSideEncryptionByDefault.SSEAlgorithm, 'AES256');
const policy = JSON.parse(JSON.parse(aws(['s3api', 'get-bucket-policy', '--bucket', bucket])).Policy);
assert.ok(policy.Statement.some(statement => statement.Effect === 'Deny' && statement.Condition?.Bool?.['aws:SecureTransport'] === 'false'));
const result = { environment: 'development', verifiedAt: new Date().toISOString(), api: { lambdaVersion: config.Version, codeSha256: config.CodeSha256, routeCount: routes.length, checks: [] }, storage: { bucket, block, ownership, encryption, tlsOnly: true } };
const base = 'https://um0ix9fu4i.execute-api.us-west-2.amazonaws.com';
for (const [method, path, status] of [['GET', '/health', 200], ...['GET', 'PUT', 'DELETE'].map(method => [method, '/organizations/1/logo', 401])]) {
  const response = await fetch(base + path, { method, signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, status);
  result.api.checks.push({ method, path, status });
}
const origin = 'https://development.d8i1ve5prnr7w.amplifyapp.com';
for (const method of ['GET', 'PUT', 'DELETE']) {
  const response = await fetch(base + '/organizations/1/logo', { method: 'OPTIONS', headers: { origin, 'access-control-request-method': method, 'access-control-request-headers': 'authorization,content-type' }, signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 204); assert.equal(response.headers.get('access-control-allow-origin'), origin);
  assert.ok(response.headers.get('access-control-allow-methods').split(',').includes(method));
  result.api.checks.push({ method: 'OPTIONS', requestedMethod: method, status: 204 });
}
if (process.argv[2]) {
  assert.match(process.argv[2], /^\d+$/);
  const job = JSON.parse(aws(['amplify', 'get-job', '--app-id', 'd8i1ve5prnr7w', '--branch-name', 'development', '--job-id', process.argv[2]])).job;
  assert.equal(job.summary.status, 'SUCCEED');
  const implementation = execFileSync('git', ['log', '-1', '--format=%H', '--', 'app/app/components/OrganizationLogo.vue'], { encoding: 'utf8' }).trim();
  assert.equal(job.summary.commitId, implementation);
  const queue = [], visited = new Set();
  result.frontend = { jobId: process.argv[2], commitId: job.summary.commitId, status: job.summary.status };
  const page = await fetch(origin + '/login', { signal: AbortSignal.timeout(15000) });
  assert.equal(page.status, 200);
  for (const match of (await page.text()).matchAll(/(?:src|href)="([^"\s]+\.js)"/g)) if (match[1].includes('/_nuxt/')) queue.push(new URL(match[1], origin).href);
  while (queue.length && visited.size < 200 && !result.frontend.logoAsset) {
    const batch = queue.splice(0, 6).filter(url => !visited.has(url)); batch.forEach(url => visited.add(url));
    const sources = await Promise.all(batch.map(async url => {
      const response = await fetch(url, { signal: AbortSignal.timeout(15000) }); assert.equal(response.status, 200);
      return [url, await response.text()];
    }));
    for (const [url, source] of sources) {
      if (source.includes('Logo uploaded.') && source.includes('Remove logo')) result.frontend.logoAsset = { path: new URL(url).pathname, sha256: createHash('sha256').update(source).digest('hex') };
      for (const match of source.matchAll(/["']((?:\.\/|\/_nuxt\/)[^"'\s]+\.js)["']/g)) {
        const next = new URL(match[1], url).href;
        if (next.startsWith(origin + '/_nuxt/') && !visited.has(next)) queue.push(next);
      }
    }
  }
  assert.ok(result.frontend.logoAsset, 'The hosted frontend must contain the logo settings controls.');
}
await writeFile(new URL('../../AWS/deployments/2026-10-15-logo-verification.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
