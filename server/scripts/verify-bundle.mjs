// Local-only invocation of the actual deployment artifact; no database or userInfo calls.
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
process.env.COGNITO_ISSUER = 'urn:quotes:bundle-check';
process.env.COGNITO_CLIENT_ID = 'bundle-check-client';
process.env.ENVIRONMENT = 'local-bundle-check';
const { handler } = await import('../dist/index.mjs');
const event = (path, claims) => ({
  version: '2.0',
  routeKey: `GET ${path}`,
  rawPath: path,
  headers: {},
  requestContext: {
    requestId: 'bundle-check',
    http: { method: 'GET', path },
    ...(claims ? { authorizer: { jwt: { claims } } } : {}),
  },
});
const health = await handler(event('/health'), {});
assert.equal(health.statusCode, 200);
assert.equal(health.headers['cache-control'], 'no-store');
assert.deepEqual(JSON.parse(health.body), {
  status: 'ok',
  service: 'quotes-api',
  environment: 'local-bundle-check',
});
const session = await handler(
  event('/session', {
    iss: process.env.COGNITO_ISSUER,
    client_id: process.env.COGNITO_CLIENT_ID,
    sub: 'bundle-subject',
    token_use: 'access',
    exp: Date.now() / 1000 + 60,
    scope: 'quotes-api/access',
  }),
  {},
);
assert.equal(session.statusCode, 200);
assert.deepEqual(JSON.parse(session.body), { subject: 'bundle-subject' });
assert.equal((await handler(event('/me'), {})).statusCode, 401);
assert.equal((await handler(event('/unknown'), {})).statusCode, 404);
// Exercise the renderer from the actual deployment bundle in isolation. The
// temporary export exposes an internal function only in this verification copy.
const directory = await mkdtemp(join(tmpdir(), 'quotes-bundle-'));
try {
  const source = await readFile(new URL('../dist/index.mjs', import.meta.url), 'utf8');
  await writeFile(join(directory, 'index.mjs'), `${source}\nexport { renderQuotePdf as verifyRenderQuotePdf };\n`);
  await cp(new URL('../dist/assets', import.meta.url), join(directory, 'assets'), { recursive: true });
  const { verifyRenderQuotePdf } = await import(pathToFileURL(join(directory, 'index.mjs')).href);
  const pdf = await verifyRenderQuotePdf({ id: '1', customer: 'Café', project: 'Bundle check', organization: { name: 'Company', contact: [] }, draft: true, total: '0.00', lines: [] });
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.match(pdf.toString('latin1'), /\/FontFile2/);
} finally { await rm(directory, { recursive: true, force: true }); }
console.log(
  'Bundled Lambda health, trusted session, unauthorized business route, unknown route, and PDF rendering with packaged fonts passed.',
);
