import { business, operationInput } from './context.mjs';
export function registerQuoteRoutes(app, service) {
  app.get('/organizations/:orgId/quotes', business, (request) =>
    service.listQuotes(operationInput(request)),
  );
  app.get('/organizations/:orgId/quote-owners', business, (request) =>
    service.listEligibleOwners(operationInput(request)),
  );
  app.patch('/organizations/:orgId/quotes/:quoteId', business, (request) =>
    service.updateQuoteOwner(operationInput(request)),
  );
}
