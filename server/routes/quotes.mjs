import { business, boundedBusiness, operationInput } from './context.mjs';
export function registerQuoteRoutes(app, service) {
  app.get('/organizations/:orgId/quotes/:quoteId/pdf', business, async (request, reply) => {
    const result = await service.readQuotePdf(operationInput(request));
    return reply.type('application/pdf')
      .header('content-disposition', `${result.disposition}; filename="${result.filename}"`)
      .header('x-content-type-options', 'nosniff')
      .send(result.pdf);
  });
  app.get('/organizations/:orgId/quotes/:quoteId', business, request => service.readQuote(operationInput(request)));
  app.post('/organizations/:orgId/quotes', boundedBusiness, request => service.createQuote(operationInput(request)));
  app.put('/organizations/:orgId/quotes/:quoteId', boundedBusiness, request => service.updateQuote(operationInput(request)));
  app.post('/organizations/:orgId/quotes/:quoteId/archive', business, request => service.archiveQuote(operationInput(request)));
  app.post('/organizations/:orgId/quotes/:quoteId/restore', business, request => service.restoreQuote(operationInput(request)));
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
