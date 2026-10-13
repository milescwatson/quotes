import Fastify from 'fastify';
import { HttpError } from './shared.mjs';
import { MAX_BYTES } from './taxonomy-content.mjs';
import { validateClaims, verifiedIdentityLookup } from './authentication.mjs';
import { registerSessionRoutes } from './routes/session.mjs';
import { registerProfileRoutes } from './routes/profile.mjs';
import { registerOrganizationRoutes } from './routes/organizations.mjs';
import { registerQuoteRoutes } from './routes/quotes.mjs';
import { registerTaxonomyRoutes } from './routes/taxonomies.mjs';
import { registerPrincipalRoutes } from './routes/principals.mjs';

export function createApp({
  services,
  config = process.env,
  identityLookup = verifiedIdentityLookup(config),
  onRoute = () => {},
  logError = (entry) => console.error(JSON.stringify(entry)),
} = {}) {
  // Gateway already bounds Lambda payloads. Taxonomy/principal and quote writes
  // have the existing 512 KiB application limit; other routes have no new limit.
  const app = Fastify({
    logger: false,
    exposeHeadRoutes: false,
    bodyLimit: Number.MAX_SAFE_INTEGER,
    requestIdHeader: false,
  });
  app.addHook('onRoute', onRoute);
  app.decorateRequest('identity', null);
  app.decorateRequest('claims', null);
  app.addHook('onRequest', async (request, reply) => {
    request.id =
      request.awsLambda?.event?.requestContext?.requestId || 'unknown';
    reply.header('cache-control', 'no-store').type('application/json');
    if (!request.routeOptions.url)
      throw new HttpError(404, 'NOT_FOUND', 'Route not found.');
    const authentication = request.routeOptions.config.authentication;
    if (!authentication) return;
    request.claims = validateClaims(
      request.awsLambda?.event?.requestContext?.authorizer?.jwt?.claims,
      config,
    );
    if (authentication === 'identity')
      request.identity = await identityLookup(request, request.claims);
  });
  // The previous handler parsed JSON independently of Content-Type, accepted an
  // empty body as {}, and returned 422 for malformed JSON. Keep those semantics.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser(
    '*',
    { parseAs: 'string' },
    (request, body, done) => {
      if (
        request.routeOptions.config.boundedBody &&
        Buffer.byteLength(body, 'utf8') > MAX_BYTES
      )
        return done(
          new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Request exceeds 512 KiB.'),
        );
      try {
        done(null, body ? JSON.parse(body) : {});
      } catch {
        done(
          new HttpError(422, 'INVALID_INPUT', 'The request is not valid JSON.'),
        );
      }
    },
  );
  // Fastify does not parse GET/HEAD payloads; Gateway event bodies still need the
  // same checks for those methods and for empty requests with no content type.
  app.addHook('preValidation', async (request) => {
    const event = request.awsLambda?.event;
    if (
      !event ||
      request.body !== undefined ||
      request.routeOptions.config.authentication !== 'identity'
    )
      return;
    const body = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64').toString('utf8')
      : event.body || '';
    if (
      request.routeOptions.config.boundedBody &&
      Buffer.byteLength(body, 'utf8') > MAX_BYTES
    )
      throw new HttpError(
        413,
        'PAYLOAD_TOO_LARGE',
        'Request exceeds 512 KiB.',
      );
    try {
      request.body = body ? JSON.parse(body) : {};
    } catch {
      throw new HttpError(
        422,
        'INVALID_INPUT',
        'The request is not valid JSON.',
      );
    }
  });
  app.setNotFoundHandler(() => {
    throw new HttpError(404, 'NOT_FOUND', 'Route not found.');
  });
  app.setErrorHandler((error, request, reply) => {
    if (!(error instanceof HttpError))
      logError({
        requestId: request.id,
        errorCode: error.code || 'INTERNAL_ERROR',
      });
    const status =
      error instanceof HttpError
        ? error.status
        : error.code === '23505'
          ? 409
          : 503;
    const body =
      error instanceof HttpError
        ? {
            code: error.code,
            message: error.message,
            ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
            ...(error.currentVersionId
              ? { currentVersionId: error.currentVersionId }
              : {}),
          }
        : error.code === '23505'
          ? {
              code: 'CONFLICT',
              message:
                'This change conflicts with an existing record. Refresh and try again.',
            }
          : {
              code: 'SERVICE_UNAVAILABLE',
              message:
                'The service is temporarily unavailable. Please try again.',
            };
    reply.code(status).send({ ...body, requestId: request.id });
  });
  registerSessionRoutes(app, config);
  registerProfileRoutes(app, services.identity);
  registerOrganizationRoutes(app, services.identity);
  registerQuoteRoutes(app, services.identity);
  registerTaxonomyRoutes(app, services.taxonomy);
  registerPrincipalRoutes(app, services.principals);
  return app;
}
