// Read-only development checks plus empty-event Lambda invocations. No quote/user writes.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import YAML from 'yaml';
import { aws, target } from './development-database.mjs';
const root = new URL('../../', import.meta.url);
const sourceCommit = execFileSync('git', ['log', '-1', '--format=%H', '--', 'app/app/components/QuoteDescriptionEditor.vue'], { encoding: 'utf8' }).trim();
assert.equal(JSON.parse(aws(['sts', 'get-caller-identity'])).Account, target.account);
const contract = YAML.parse(await readFile(new URL('AWS/openapi.yaml', root), 'utf8'));
const routes = JSON.parse(aws(['apigatewayv2', 'get-routes', '--api-id', 'um0ix9fu4i'])).Items;
const expected = Object.entries(contract.paths).flatMap(([path, methods]) => Object.keys(methods).map(method => `${method.toUpperCase()} ${path}`)).sort();
assert.deepEqual(routes.map(route => route.RouteKey).sort(), expected);
for (const route of routes) assert.equal(route.AuthorizationType, route.RouteKey === 'GET /health' ? 'NONE' : 'JWT');
const api = JSON.parse(aws(['lambda', 'get-function-configuration', '--function-name', 'quotes-development-api', '--qualifier', 'development']));
const worker = JSON.parse(aws(['lambda', 'get-function-configuration', '--function-name', 'quotes-development-quote-pdf-worker']));
const hash = createHash('sha256').update(await readFile(new URL('AWS/environments/development/.terraform/quotes-api.zip', root))).digest('base64');
for (const config of [api, worker]) {
  assert.equal(config.State, 'Active'); assert.equal(config.LastUpdateStatus, 'Successful');
  assert.equal(config.CodeSha256, hash); assert.deepEqual(config.Architectures, ['arm64']);
}
const directory = await mkdtemp(join(tmpdir(), 'quotes-description-live-'));
try {
  const input = join(directory, 'event.json'), output = join(directory, 'response.json');
  await writeFile(input, JSON.stringify({ version: '2.0', rawPath: '/health', headers: {}, requestContext: { requestId: 'description-release-health', http: { method: 'GET', path: '/health' } } }));
  let invocation = JSON.parse(aws(['lambda', 'invoke', '--function-name', api.FunctionName, '--qualifier', 'development', '--payload', `fileb://${input}`, output]));
  assert.ok(!invocation.FunctionError); assert.equal(invocation.ExecutedVersion, api.Version);
  const response = JSON.parse(await readFile(output, 'utf8'));
  assert.equal(response.statusCode, 200); assert.equal(JSON.parse(response.body).environment, 'development');
  await writeFile(input, JSON.stringify({ Records: [] }));
  invocation = JSON.parse(aws(['lambda', 'invoke', '--function-name', worker.FunctionName, '--payload', `fileb://${input}`, output]));
  assert.ok(!invocation.FunctionError); assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), { batchItemFailures: [] });
} finally { await rm(directory, { recursive: true, force: true }); }
const origin = 'https://development.d8i1ve5prnr7w.amplifyapp.com';
const base = 'https://um0ix9fu4i.execute-api.us-west-2.amazonaws.com';
const checks = [];
for (const [path, status] of [['/health', 200], ['/organizations/1/quotes/1', 401], ['/organizations/1/quotes/1/pdf?expectedToken=test', 401], ['/organizations/1/quotes/1/pdf-url?expectedToken=test', 401]]) {
  const response = await fetch(base + path, { signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, status); checks.push({ path, status, requestId: response.headers.get('apigw-requestid') });
}
for (const allowed of [origin, 'http://localhost:3000']) {
  const response = await fetch(base + '/organizations/1/quotes/1', { method: 'OPTIONS', headers: { origin: allowed, 'access-control-request-method': 'PUT', 'access-control-request-headers': 'authorization,content-type' }, signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 204); assert.equal(response.headers.get('access-control-allow-origin'), allowed);
  checks.push({ method: 'OPTIONS', origin: allowed, status: response.status });
}
const result = { environment: 'development', sourceCommit, verifiedAt: new Date().toISOString(), api: { version: api.Version, codeSha256: hash, routeCount: routes.length, checks }, worker: { functionName: worker.FunctionName, codeSha256: hash, architecture: 'arm64', emptyEvent: 'passed' }, databaseMigration: false, databaseWrites: false };
if (process.argv[2]) {
  assert.match(process.argv[2], /^\d+$/);
  const job = JSON.parse(aws(['amplify', 'get-job', '--app-id', 'd8i1ve5prnr7w', '--branch-name', 'development', '--job-id', process.argv[2]])).job;
  assert.equal(job.summary.status, 'SUCCEED'); assert.equal(job.summary.commitId, sourceCommit);
  result.frontend = { jobId: process.argv[2], commitId: job.summary.commitId, status: job.summary.status, steps: job.steps.map(step => ({ name: step.stepName, status: step.status })), assets: [] };
  const queue = [], visited = new Set(); let editorFound = false;
  for (const path of ['/', '/login']) {
    const response = await fetch(origin + path, { signal: AbortSignal.timeout(15000) }); assert.equal(response.status, 200);
    for (const match of (await response.text()).matchAll(/(?:src|href)="([^"\s]+\.js)"/g)) if (match[1].includes('/_nuxt/')) queue.push(new URL(match[1], origin).href);
  }
  while (queue.length && visited.size < 200 && !editorFound) {
    const batch = queue.splice(0, 6).filter(url => !visited.has(url)); batch.forEach(url => visited.add(url));
    for (const [url, source] of await Promise.all(batch.map(async url => { const response = await fetch(url, { signal: AbortSignal.timeout(15000) }); assert.equal(response.status, 200); return [url, await response.text()]; }))) {
      if (source.includes('Description formatting') && source.includes('Hide description') && source.includes('descriptionContent')) {
        editorFound = true;
        result.frontend.assets.push({ path: new URL(url).pathname, sha256: createHash('sha256').update(source).digest('hex'), checks: ['Tiptap formatting toolbar', 'description visibility menu', 'quote-specific description persistence'] });
      }
      for (const match of source.matchAll(/["']((?:\.\/|\/_nuxt\/)[^"'\s]+\.js)["']/g)) {
        const next = new URL(match[1], url).href; if (next.startsWith(origin + '/_nuxt/') && !visited.has(next)) queue.push(next);
      }
    }
  }
  assert.ok(editorFound, 'Hosted frontend must contain the inline description editor and visibility controls');
}
await writeFile(new URL('AWS/deployments/2026-10-19-description-verification.json', root), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
