import { boundedBusiness, operationInput, respond } from './context.mjs';
export function registerPrincipalRoutes(app, service) {
  app.get(
    '/organizations/:orgId/principals',
    boundedBusiness,
    async (request, reply) =>
      respond(reply, await service.listPrincipals(operationInput(request))),
  );
  app.post(
    '/organizations/:orgId/principals',
    boundedBusiness,
    async (request, reply) =>
      respond(reply, await service.createPrincipal(operationInput(request))),
  );
}
