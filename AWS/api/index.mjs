import { getPool, transactions } from './database.mjs';
import { createIdentityService, HttpError } from './identity.mjs';
import { createTaxonomyService } from './taxonomy.mjs';
import { MAX_BYTES } from './taxonomy-content.mjs';
export const taxonomyRoutes = [
  'GET /organizations/{orgId}/taxonomies',
  'POST /organizations/{orgId}/taxonomies',
  'GET /organizations/{orgId}/taxonomies/{taxonomyId}',
  'POST /organizations/{orgId}/taxonomies/{taxonomyId}/versions',
  'POST /organizations/{orgId}/taxonomies/{taxonomyId}/preview',
  'POST /organizations/{orgId}/taxonomies/{taxonomyId}/archive',
];
const routes = new Set([
  ...taxonomyRoutes,
  'POST /me/bootstrap',
  'GET /me',
  'PATCH /me',
  'GET /me/organizations',
  'GET /organizations/{orgId}',
  'GET /organizations/{orgId}/quotes',
  'GET /organizations/{orgId}/quote-owners',
  'PATCH /organizations/{orgId}/quotes/{quoteId}',
  'PATCH /organizations/{orgId}',
  'GET /organizations/{orgId}/members',
  'POST /organizations/{orgId}/members',
  'PATCH /organizations/{orgId}/members/{membershipId}',
  'DELETE /organizations/{orgId}/members/{membershipId}',
]);
export function createHandler({
  service,
  taxonomyService,
  fetchUser = fetch,
  env = process.env,
} = {}) {
  return async (event) => {
    const requestId = event.requestContext?.requestId || 'unknown';
    const headers = {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    };
    const reply = (statusCode, body) => ({
      statusCode,
      headers,
      body: JSON.stringify(body),
    });
    if (event.routeKey === 'GET /health')
      return reply(200, {
        status: 'ok',
        service: 'quotes-api',
        environment: env.ENVIRONMENT,
      });
    if (!routes.has(event.routeKey) && event.routeKey !== 'GET /session')
      return reply(404, {
        code: 'NOT_FOUND',
        message: 'Route not found.',
        requestId,
      });
    try {
      const claims = event.requestContext?.authorizer?.jwt?.claims;
      if (
        !claims ||
        typeof claims.sub !== 'string' ||
        !claims.sub ||
        claims.iss !== env.COGNITO_ISSUER ||
        claims.client_id !== env.COGNITO_CLIENT_ID ||
        claims.token_use !== 'access' ||
        Number(claims.exp) <= Date.now() / 1000 ||
        !Number.isFinite(Number(claims.exp)) ||
        !String(claims.scope).split(' ').includes('quotes-api/access')
      ) {
        throw new HttpError(401, 'UNAUTHORIZED', 'Please sign in to continue.');
      }
      if (event.routeKey === 'GET /session')
        return reply(200, { subject: claims.sub });
      const token =
        event.headers?.authorization || event.headers?.Authorization;
      if (!/^Bearer [^ ]+$/.test(token || ''))
        throw new HttpError(401, 'UNAUTHORIZED', 'Please sign in to continue.');
      if (!env.COGNITO_DOMAIN)
        throw new HttpError(
          503,
          'CONFIGURATION',
          'Sign-in is not configured yet.',
        );
      let response;
      try {
        response = await fetchUser(`${env.COGNITO_DOMAIN}/oauth2/userInfo`, {
          headers: { Authorization: token },
          signal: AbortSignal.timeout(4000),
        });
      } catch {
        throw new HttpError(
          503,
          'IDENTITY_UNAVAILABLE',
          'We could not verify your account. Please try again.',
        );
      }
      if (!response.ok)
        throw new HttpError(
          response.status === 401 ? 401 : 503,
          'IDENTITY_UNAVAILABLE',
          'We could not verify your account. Please sign in again.',
        );
      const attributes = await response.json();
      if (
        attributes.sub !== claims.sub ||
        !attributes.email ||
        ![true, 'true'].includes(attributes.email_verified)
      )
        throw new HttpError(
          403,
          'EMAIL_UNVERIFIED',
          'Verify your email address before continuing.',
        );
      const isTaxonomy = taxonomyRoutes.includes(event.routeKey);
      const decodedBody = event.isBase64Encoded
        ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '');
      if (isTaxonomy && Buffer.byteLength(decodedBody, 'utf8') > MAX_BYTES)
        throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Taxonomy exceeds 512 KiB.');
      let body = {};
      try {
        if (event.body)
          body = JSON.parse(decodedBody);
      } catch {
        throw new HttpError(
          422,
          'INVALID_INPUT',
          'The request is not valid JSON.',
        );
      }
      const execute = isTaxonomy
        ? (taxonomyService || createTaxonomyService(transactions(getPool(), { attempts: 1 })))
        : (service || createIdentityService(transactions(getPool())));
      const result = await execute({
        method: event.requestContext.http.method,
        path: event.rawPath,
        body,
        query: event.queryStringParameters || {},
        identity: {
          issuer: claims.iss,
          sub: claims.sub,
          email: attributes.email,
          name: attributes.name,
        },
        requestId,
      });
      return isTaxonomy ? reply(result.statusCode, result.body) : reply(200, result);
    } catch (error) {
      if (error instanceof HttpError)
        return reply(error.status, {
          code: error.code,
          message: error.message,
          requestId,
          ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
          ...(error.currentVersionId ? { currentVersionId: error.currentVersionId } : {}),
        });
      // Do not log SQL, tokens, profile attributes, or provider response bodies.
      console.error(
        JSON.stringify({
          requestId,
          errorCode: error.code || 'INTERNAL_ERROR',
        }),
      );
      if (error.code === '23505')
        return reply(409, {
          code: 'CONFLICT',
          message:
            'This change conflicts with an existing record. Refresh and try again.',
          requestId,
        });
      return reply(503, {
        code: 'SERVICE_UNAVAILABLE',
        message: 'The service is temporarily unavailable. Please try again.',
        requestId,
      });
    }
  };
}
export const handler = createHandler();
