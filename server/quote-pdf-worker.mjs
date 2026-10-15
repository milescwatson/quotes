import { detail } from './quotes.mjs';
import { identifier, one } from './shared.mjs';
import { prepareQuotePdf } from './quote-pdf-data.mjs';
import { renderQuotePdf } from './quote-pdf-layout.mjs';
import { createLogoStorage } from './organization-logo.mjs';
import { createQuotePdfStorage, quotePdfToken } from './quote-pdf-storage.mjs';

export function createQuotePdfWorker(withTransaction, { storage = createQuotePdfStorage(), logoStorage = createLogoStorage(), render = renderQuotePdf } = {}) {
  return async event => {
    const batchItemFailures = [];
    for (const [index, record] of event.Records.entries()) {
      try {
        const { organizationId, quoteId } = JSON.parse(record.body);
        identifier(organizationId); identifier(quoteId);
        const data = await withTransaction(async db => {
          const org = await one(db, 'SELECT * FROM public.organizations WHERE id=$1', [organizationId]);
          if (!org) return null;
          const exists = await one(db, 'SELECT id FROM public.quotes WHERE id=$1 AND organization_id=$2', [quoteId, organizationId]);
          if (!exists) return null;
          return { quote: await detail(db, organizationId, quoteId), org };
        });
        if (!data) continue;
        const { quote, org } = data;
        const existing = await storage.head(organizationId, quoteId);
        if (existing?.Metadata?.['quote-token'] === quotePdfToken(quote.token)) continue;
        const model = prepareQuotePdf(quote, org);
        if (org.logo_id) model.organization.logo = await logoStorage.get(organizationId, org.logo_id);
        await storage.put(organizationId, quoteId, quote.token, await render(model));
      } catch (error) {
        console.error(JSON.stringify({ errorCode: 'QUOTE_PDF_GENERATION_FAILED', messageId: record.messageId, cause: error.name }));
        // Preserve FIFO ordering if a caller ever supplies more than one record.
        batchItemFailures.push(...event.Records.slice(index).map(item => ({ itemIdentifier: item.messageId })));
        break;
      }
    }
    return { batchItemFailures };
  };
}
