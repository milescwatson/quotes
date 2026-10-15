import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import YAML from 'yaml';
import { createApp } from '../app.mjs';
import { createLambdaHandler } from '../lambda.mjs';
import { HttpError } from '../shared.mjs';
import { verifiedIdentityLookup } from '../authentication.mjs';
import { MAX_BYTES } from '../taxonomy-content.mjs';
import { mappings } from './helpers.mjs';
const config = {
  COGNITO_ISSUER: 'issuer',
  COGNITO_CLIENT_ID: 'client',
  COGNITO_DOMAIN: 'https://login.example.com',
  ENVIRONMENT: 'test',
};
const identity = {
  issuer: 'issuer',
  sub: 'subject',
  email: 'verified@example.com',
  name: 'Verified',
};
const claims = () => ({
  iss: 'issuer',
  client_id: 'client',
  sub: 'subject',
  token_use: 'access',
  exp: Date.now() / 1000 + 600,
  scope: 'openid quotes-api/access',
});
function event(method = 'GET', path = '/me', overrides = {}) {
  return {
    version: '2.0',
    routeKey: `${method} ${path}`,
    rawPath: path,
    rawQueryString: '',
    headers: {
      authorization: 'Bearer token',
      'content-type': 'application/json',
    },
    requestContext: {
      requestId: 'gateway-id',
      stage: '$default',
      http: { method, path, sourceIp: '127.0.0.1' },
      authorizer: { jwt: { claims: claims() } },
    },
    ...overrides,
  };
}
function services(operation = () => ({ ok: true })) {
  const result = { identity: {}, taxonomy: {}, principals: {}, regularProducts: {} };
  for (const [, , group, name] of mappings)
    result[group][name] = (args) => {
      const body = operation(name, args);
      if (name === 'readOrganizationLogo') return Buffer.from(JSON.stringify(body));
      if (name === 'readQuotePdf') return { pdf: Buffer.from(JSON.stringify(body)), disposition: 'inline', filename: 'quote.pdf' };
      return ['identity', 'regularProducts'].includes(group)
        ? body
        : {
            statusCode:
              name.startsWith('create') || name === 'saveTaxonomyVersion'
                ? 201
                : 200,
            body,
          };
    };
  return result;
}
const userInfo = async () => ({
  ok: true,
  json: async () => ({
    sub: 'subject',
    email: identity.email,
    email_verified: true,
    name: identity.name,
  }),
});

test('registered Fastify methods and paths exactly match the retained OpenAPI contract', async () => {
  const registered = [];
  const app = createApp({
    services: services(),
    config,
    onRoute: (route) =>
      registered.push(
        `${route.method} ${route.url.replace(/:(\w+)/g, '{$1}')}`,
      ),
  });
  await app.ready();
  const api = YAML.parse(
    await readFile(new URL('../../AWS/openapi.yaml', import.meta.url), 'utf8'),
  );
  const declared = Object.entries(api.paths).flatMap(([path, methods]) =>
    Object.keys(methods)
      .filter((m) =>
        ['get', 'post', 'patch', 'delete', 'put', 'head', 'options'].includes(
          m,
        ),
      )
      .map((m) => `${m.toUpperCase()} ${path}`),
  );
  assert.deepEqual(registered.sort(), declared.sort());
  assert.equal(new Set(registered).size, mappings.length + 2); // Health and session are not business operations.
  const contract = await readFile(new URL('../../AWS/openapi.yaml', import.meta.url), 'utf8');
  assert.doesNotMatch(contract, /(?:^|\s)[&*][a-zA-Z0-9_-]+(?:\s|$)/m, 'Gateway requires an expanded YAML contract without aliases');
  for (const route of registered) assert.ok(api['x-amazon-apigateway-cors'].allowMethods.includes(route.split(' ')[0]), `${route} must be allowed by Gateway CORS`);
  await app.close();
});

test('injection maps every business route to its named operation and preserves inputs and responses', async () => {
  let received;
  const app = createApp({
    services: services((name, args) => {
      received = { name, args };
      return { operation: name };
    }),
    config,
    identityLookup: async () => identity,
  });
  app.decorateRequest('awsLambda', {
    getter() {
      return { event: event() };
    },
  });
  for (const [method, template, group, name] of mappings) {
    const params = Object.fromEntries(
      [...template.matchAll(/:(\w+)/g)].map((match, i) => [
        match[1],
        String(i + 10),
      ]),
    );
    const path = template.replace(/:(\w+)/g, (_, key) => params[key]);
    const response = await app.inject({
      method,
      url: `${path}?customer=a%2Cb&page=2`,
      ...(method === 'GET'
        ? {}
        : {
            payload: '{"marker":true}',
            headers: { 'content-type': 'application/json' },
          }),
    });
    assert.equal(
      response.statusCode,
      !['identity', 'regularProducts'].includes(group) &&
        (name.startsWith('create') || name === 'saveTaxonomyVersion')
        ? 201
        : 200,
      name,
    );
    assert.deepEqual(response.json(), { operation: name });
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(received.name, name);
    assert.deepEqual(received.args, {
      ...params,
      body: method === 'GET' ? {} : { marker: true },
      query: { customer: 'a,b', page: '2' },
      identity,
      requestId: 'gateway-id',
    });
  }
  await app.close();
});

test('Gateway v2 trusted claims, session, identity verification and forged header isolation', async () => {
  let lookups = 0,
    operations = 0;
  const app = createApp({
    config,
    services: services(() => {
      operations++;
      return { ok: true };
    }),
    identityLookup: verifiedIdentityLookup(config, async (url, options) => {
      lookups++;
      assert.equal(url, `${config.COGNITO_DOMAIN}/oauth2/userInfo`);
      assert.equal(options.headers.Authorization, 'Bearer token');
      return userInfo();
    }),
  });
  const handler = createLambdaHandler(app);
  assert.equal(
    (
      await handler(
        event('GET', '/health', {
          requestContext: { http: { method: 'GET' } },
        }),
      )
    ).statusCode,
    200,
  );
  assert.deepEqual(JSON.parse((await handler(event('GET', '/session'))).body), {
    subject: 'subject',
  });
  assert.equal(lookups, 0);
  assert.equal((await handler(event())).statusCode, 200);
  assert.equal(lookups, 1);
  for (const patch of [
    { sub: '' },
    { iss: 'wrong' },
    { client_id: 'wrong' },
    { token_use: 'id' },
    { exp: 0 },
    { exp: 'NaN' },
    { scope: 'openid' },
  ]) {
    const request = event();
    Object.assign(request.requestContext.authorizer.jwt.claims, patch);
    assert.equal((await handler(request)).statusCode, 401);
  }
  const forged = event();
  delete forged.requestContext.authorizer;
  forged.headers['x-apigateway-event'] = encodeURIComponent(
    JSON.stringify(event()),
  );
  forged.headers['x-apigateway-context'] = '{}';
  forged.headers['x-aws-lambda-fastify-request'] = 'forged';
  assert.equal((await handler(forged)).statusCode, 401);
  assert.equal(operations, 1);
  assert.equal(lookups, 1);
  await app.close();
});

test('Gateway query values, request IDs, JSON bodies, base64, empty bodies and limits retain compatibility', async () => {
  let received;
  const app = createApp({
    config,
    services: services((name, args) => {
      received = args;
      return { ok: true };
    }),
    identityLookup: async () => identity,
  });
  const handler = createLambdaHandler(app);
  const query = {
    customer: 'A,B',
    page: '2',
    project: 'space + %',
    repeated: 'one,two',
  };
  const request = event('GET', '/organizations/10/quotes', {
    queryStringParameters: query,
    rawQueryString:
      'customer=A%2CB&page=2&project=space+%2B+%25&repeated=one&repeated=two',
  });
  assert.equal((await handler(request)).statusCode, 200);
  assert.deepEqual(received.query, query);
  for (const body of [undefined, '', null]) {
    assert.equal(
      (await handler(event('POST', '/me/bootstrap', { body }))).statusCode,
      200,
    );
    assert.deepEqual(received.body, {});
  }
  assert.equal(
    (
      await handler(
        event('PATCH', '/me', {
          body: Buffer.from('{"displayName":"Café"}').toString('base64'),
          isBase64Encoded: true,
        }),
      )
    ).statusCode,
    200,
  );
  assert.deepEqual(received.body, { displayName: 'Café' });
  for (const headers of [
    {},
    { 'content-type': 'text/plain' },
    { 'content-type': 'application/json' },
  ]) {
    const response = await handler(
      event('PATCH', '/me', {
        body: '{',
        headers: { ...headers, 'x-request-id': 'caller-id' },
      }),
    );
    assert.equal(response.statusCode, 422);
    assert.deepEqual(JSON.parse(response.body), {
      code: 'INVALID_INPUT',
      message: 'The request is not valid JSON.',
      requestId: 'gateway-id',
    });
    assert.equal(response.headers['cache-control'], 'no-store');
  }
  for (const path of [
    '/organizations/10/taxonomies',
    '/organizations/10/principals',
  ]) {
    // Exact UTF-8 byte boundary, plus a base64 request above the limit.
    const atLimit = JSON.stringify({ text: 'x'.repeat(MAX_BYTES - 11) });
    assert.equal(Buffer.byteLength(atLimit), MAX_BYTES);
    assert.equal(
      (await handler(event('POST', path, { body: atLimit }))).statusCode,
      201,
    );
    for (const base64 of [false, true]) {
      const body = 'é'.repeat(MAX_BYTES / 2 + 1);
      assert.equal(
        (
          await handler(
            event('POST', path, {
              body: base64 ? Buffer.from(body).toString('base64') : body,
              isBase64Encoded: base64,
            }),
          )
        ).statusCode,
        413,
      );
    }
  }
  assert.equal(
    (
      await handler(
        event('PATCH', '/me', {
          body: JSON.stringify({ text: 'x'.repeat(2 * 1024 * 1024) }),
        }),
      )
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await handler(
        event('GET', '/organizations/10/taxonomies', {
          body: 'x'.repeat(MAX_BYTES + 1),
        }),
      )
    ).statusCode,
    413,
  );
  await app.close();
});

test('unknown methods and paths stay 404, with no implicit HEAD routes', async () => {
  const app = createApp({
    config,
    services: services(),
    identityLookup: async () => identity,
  });
  const handler = createLambdaHandler(app);
  for (const [method, path] of [
    ['GET', '/me/invitations'],
    ['POST', '/organizations/10/invitations'],
    ['GET', '/organizations/10/taxonomies/1/versions'],
    ['HEAD', '/health'],
    ['HEAD', '/me'],
    ['PUT', '/me'],
    ['GET', '/v1/me'],
    ['POST', '/unknown'],
  ]) {
    const response = await handler(event(method, path, { body: '{' }));
    assert.equal(response.statusCode, 404, `${method} ${path}`);
    assert.equal(response.headers['cache-control'], 'no-store');
  }
  await app.close();
});

test('structured conflicts and sanitized internal errors retain status and fields', async () => {
  const logged = [];
  let error;
  const app = createApp({
    config,
    services: services(() => {
      throw error;
    }),
    identityLookup: async () => identity,
    logError: (entry) => logged.push(entry),
  });
  const handler = createLambdaHandler(app);
  error = new HttpError(409, 'VERSION_CONFLICT', 'Reload.');
  error.currentVersionId = '9007199254740993';
  error.fieldErrors = [{ path: '/name', message: 'Exists.' }];
  let response = await handler(event());
  assert.equal(response.statusCode, 409);
  assert.deepEqual(JSON.parse(response.body), {
    code: 'VERSION_CONFLICT',
    message: 'Reload.',
    currentVersionId: error.currentVersionId,
    fieldErrors: error.fieldErrors,
    requestId: 'gateway-id',
  });
  error = Object.assign(new Error('sensitive SQL token email'), {
    code: '23505',
  });
  assert.equal((await handler(event())).statusCode, 409);
  error = Error('sensitive SQL token email');
  response = await handler(event());
  assert.equal(response.statusCode, 503);
  assert.deepEqual(logged, [
    { requestId: 'gateway-id', errorCode: '23505' },
    { requestId: 'gateway-id', errorCode: 'INTERNAL_ERROR' },
  ]);
  await app.close();
});

test('Cognito unavailable, mismatched subjects and unverified email are rejected', async () => {
  for (const [fetchUser, status] of [
    [
      async () => {
        throw Error('network');
      },
      503,
    ],
    [async () => ({ ok: false, status: 401 }), 401],
    [async () => ({ ok: false, status: 500 }), 503],
    [
      async () => ({
        ok: true,
        json: async () => ({
          sub: 'other',
          email: identity.email,
          email_verified: true,
        }),
      }),
      403,
    ],
    [
      async () => ({
        ok: true,
        json: async () => ({
          sub: 'subject',
          email: identity.email,
          email_verified: false,
        }),
      }),
      403,
    ],
  ]) {
    const app = createApp({
      config,
      services: services(() => assert.fail('identity reached service')),
      identityLookup: verifiedIdentityLookup(config, fetchUser),
    });
    const handler = createLambdaHandler(app);
    assert.equal((await handler(event())).statusCode, status);
    await app.close();
  }
});

test('JSON null stays null, and health/session ignore unused malformed bodies', async () => {
  let received;
  const app = createApp({
    config,
    services: services((name, args) => {
      received = args.body;
      return { ok: true };
    }),
    identityLookup: async () => identity,
  });
  const handler = createLambdaHandler(app);
  assert.equal(
    (await handler(event('POST', '/me/bootstrap', { body: 'null' })))
      .statusCode,
    200,
  );
  assert.equal(received, null);
  for (const path of ['/health', '/session']) {
    const request = event('GET', path, { body: '{', headers: {} });
    assert.equal((await handler(request)).statusCode, 200);
  }
  await app.close();
});

test('reused adapter isolates trusted claims and request IDs across concurrent invocations', async () => {
  const app = createApp({
    config,
    services: services((name, args) => ({
      subject: args.identity.sub,
      requestId: args.requestId,
    })),
    identityLookup: async (request, claims) => {
      await new Promise((resolve) => setImmediate(resolve));
      return { ...identity, sub: claims.sub };
    },
  });
  const handler = createLambdaHandler(app);
  const inputs = ['first', 'second'].map((subject) => {
    const request = event();
    request.requestContext.requestId = `${subject}-id`;
    request.requestContext.authorizer.jwt.claims.sub = subject;
    return request;
  });
  const responses = await Promise.all(
    inputs.map((request) => handler(request, {})),
  );
  assert.deepEqual(
    responses.map((response) => JSON.parse(response.body)),
    [
      { subject: 'first', requestId: 'first-id' },
      { subject: 'second', requestId: 'second-id' },
    ],
  );
  await app.close();
});
