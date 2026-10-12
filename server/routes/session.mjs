export function registerSessionRoutes(app, config) {
  app.get('/health', () => ({
    status: 'ok',
    service: 'quotes-api',
    environment: config.ENVIRONMENT,
  }));
  app.get('/session', { config: { authentication: 'claims' } }, (request) => ({
    subject: request.claims.sub,
  }));
}
