// Local-only invocation of the actual deployment artifact; no database or userInfo calls.
import assert from 'node:assert/strict';
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
console.log(
  'Bundled Lambda health, trusted session, unauthorized business route, and unknown route passed.',
);
