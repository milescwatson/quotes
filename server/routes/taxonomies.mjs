import { boundedBusiness, operationInput, respond } from './context.mjs';
export function registerTaxonomyRoutes(app, service) {
  app.get(
    '/organizations/:orgId/taxonomies',
    boundedBusiness,
    async (request, reply) =>
      respond(reply, await service.listTaxonomies(operationInput(request))),
  );
  app.post(
    '/organizations/:orgId/taxonomies',
    boundedBusiness,
    async (request, reply) =>
      respond(reply, await service.createTaxonomy(operationInput(request))),
  );
  app.get(
    '/organizations/:orgId/taxonomies/:taxonomyId',
    boundedBusiness,
    async (request, reply) =>
      respond(reply, await service.readTaxonomy(operationInput(request))),
  );
  app.post(
    '/organizations/:orgId/taxonomies/:taxonomyId/versions',
    boundedBusiness,
    async (request, reply) =>
      respond(
        reply,
        await service.saveTaxonomyVersion(operationInput(request)),
      ),
  );
  app.post(
    '/organizations/:orgId/taxonomies/:taxonomyId/preview',
    boundedBusiness,
    async (request, reply) =>
      respond(reply, await service.previewTaxonomy(operationInput(request))),
  );
  app.post(
    '/organizations/:orgId/taxonomies/:taxonomyId/archive',
    boundedBusiness,
    async (request, reply) =>
      respond(reply, await service.archiveTaxonomy(operationInput(request))),
  );
}
