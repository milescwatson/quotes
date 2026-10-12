import { business, operationInput } from './context.mjs';
export function registerProfileRoutes(app, service) {
  app.post('/me/bootstrap', business, (request) =>
    service.bootstrapProfile(operationInput(request)),
  );
  app.get('/me', business, (request) =>
    service.readProfile(operationInput(request)),
  );
  app.patch('/me', business, (request) =>
    service.updateProfile(operationInput(request)),
  );
  app.get('/me/organizations', business, (request) =>
    service.listProfileOrganizations(operationInput(request)),
  );
}
