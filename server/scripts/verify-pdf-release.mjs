// Read-only cloud checks; writes release evidence locally. No live test records.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import YAML from 'yaml';

const aws = args => JSON.parse(execFileSync('aws', [...args, '--profile', 'quotes-development', '--region', 'us-west-2', '--output', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
assert.equal(aws(['sts', 'get-caller-identity']).Account, '415221799122');
const contract = YAML.parse(await readFile(new URL('../../AWS/openapi.yaml', import.meta.url), 'utf8'));
const expected = Object.entries(contract.paths).flatMap(([path, methods]) => Object.keys(methods).map(method => `${method.toUpperCase()} ${path}`)).sort();
const routes = aws(['apigatewayv2', 'get-routes', '--api-id', 'um0ix9fu4i']).Items;
assert.deepEqual(routes.map(route => route.RouteKey).sort(), expected);
for (const route of routes) assert.equal(route.AuthorizationType, route.RouteKey === 'GET /health' ? 'NONE' : 'JWT');
const config = aws(['lambda', 'get-function-configuration', '--function-name', 'quotes-development-api', '--qualifier', 'development']);
assert.equal(config.State, 'Active'); assert.equal(config.LastUpdateStatus, 'Successful');
const zip = await readFile(new URL('../../AWS/environments/development/.terraform/quotes-api.zip', import.meta.url));
assert.equal(config.CodeSha256, createHash('sha256').update(zip).digest('base64'));
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const result = { environment: 'development', sourceCommit, verifiedAt: new Date().toISOString(),
  api: { lambdaVersion: config.Version, codeSha256: config.CodeSha256, routeCount: routes.length, pdfAuthorization: 'JWT', checks: [] } };
const origin = 'https://development.d8i1ve5prnr7w.amplifyapp.com';
const base = 'https://um0ix9fu4i.execute-api.us-west-2.amazonaws.com';
for (const [path, status] of [['/health', 200], ['/organizations/1/quotes/1/pdf?expectedToken=test', 401], ['/organizations/1/quotes/1', 401]]) {
  const response = await fetch(base + path, { signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, status);
  result.api.checks.push({ path, status, requestId: response.headers.get('apigw-requestid') });
}
for (const allowed of [origin, 'http://localhost:3000']) {
  const response = await fetch(`${base}/organizations/1/quotes/1/pdf?expectedToken=test`, { method: 'OPTIONS', headers: {
    origin: allowed, 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization',
  }, signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), allowed);
  assert.ok(response.headers.get('access-control-allow-methods').split(',').includes('GET'));
  assert.ok(response.headers.get('access-control-allow-headers').toLowerCase().includes('authorization'));
  result.api.checks.push({ method: 'OPTIONS', status: 204, origin: allowed });
}
if (process.argv[2]) {
  assert.match(process.argv[2], /^\d+$/);
  const job = aws(['amplify', 'get-job', '--app-id', 'd8i1ve5prnr7w', '--branch-name', 'development', '--job-id', process.argv[2]]).job;
  assert.equal(job.summary.status, 'SUCCEED'); assert.equal(job.summary.commitId, sourceCommit);
  result.frontend = { jobId: process.argv[2], commitId: job.summary.commitId, status: job.summary.status,
    steps: job.steps.map(step => ({ name: step.stepName, status: step.status })), checks: [] };
  const queue = [], visited = new Set();
  for (const path of ['/', '/login']) {
    const response = await fetch(origin + path, { signal: AbortSignal.timeout(15000) });
    assert.equal(response.status, 200);
    result.frontend.checks.push({ path, status: response.status });
    const html = await response.text();
    for (const match of html.matchAll(/(?:src|href)="([^"\s]+\.js)"/g)) if (match[1].includes('/_nuxt/')) queue.push(new URL(match[1], origin).href);
  }
  while (queue.length && visited.size < 200 && !result.frontend.pdfAsset) {
    const batch = queue.splice(0, 6).filter(url => !visited.has(url)); batch.forEach(url => visited.add(url));
    const sources = await Promise.all(batch.map(async url => {
      const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
      assert.equal(response.status, 200); return [url, await response.text()];
    }));
    for (const [url, source] of sources) {
      if (source.includes('Preparing PDF') && source.includes('Preview PDF')) result.frontend.pdfAsset = {
        path: new URL(url).pathname, sha256: createHash('sha256').update(source).digest('hex'),
      };
      for (const match of source.matchAll(/["']((?:\.\/|\/_nuxt\/)[^"'\s]+\.js)["']/g)) {
        const next = new URL(match[1], url).href;
        if (next.startsWith(origin + '/_nuxt/') && !visited.has(next)) queue.push(next);
      }
    }
  }
  assert.ok(result.frontend.pdfAsset, 'Hosted frontend must contain the PDF actions');
}
await writeFile(new URL('../../AWS/deployments/2026-10-15-pdf-verification.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
