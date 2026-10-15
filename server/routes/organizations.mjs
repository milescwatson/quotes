import { LOGO_REQUEST_LIMIT } from '../organization-logo.mjs';
import { business, operationInput } from './context.mjs';
export function registerOrganizationRoutes(app, service) {
  app.get('/organizations/:orgId/logo', business, async (request, reply) => {
    const image = await service.readOrganizationLogo(operationInput(request));
    return reply.type('image/png').header('x-content-type-options', 'nosniff').send(image);
  });
  app.put('/organizations/:orgId/logo', { bodyLimit: LOGO_REQUEST_LIMIT, config: { authentication: 'identity', logoBody: true } }, request => service.updateOrganizationLogo(operationInput(request)));
  app.delete('/organizations/:orgId/logo', business, request => service.removeOrganizationLogo(operationInput(request)));
  app.get('/organizations/:orgId/domains', business, request => service.listOrganizationDomains(operationInput(request)));
  app.put('/organizations/:orgId/domains', business, request => service.updateOrganizationDomains(operationInput(request)));
  app.get('/organizations/:orgId', business, (request) =>
    service.readOrganization(operationInput(request)),
  );
  app.patch('/organizations/:orgId', business, (request) =>
    service.updateOrganization(operationInput(request)),
  );
  app.get('/organizations/:orgId/members', business, (request) =>
    service.listMembers(operationInput(request)),
  );
  app.post('/organizations/:orgId/members', business, (request) =>
    service.addMember(operationInput(request)),
  );
  app.patch(
    '/organizations/:orgId/members/:membershipId',
    business,
    (request) => service.updateMember(operationInput(request)),
  );
  app.delete(
    '/organizations/:orgId/members/:membershipId',
    business,
    (request) => service.removeMember(operationInput(request)),
  );
}
