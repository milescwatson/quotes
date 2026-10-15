import { netAmount } from './quote-pricing.mjs';

// All amounts remain decimal strings. Option additions are per unit; they are
// explanatory and never summed back into the already quantity-extended total.
export function prepareQuotePdf(quote, organization) {
  const multiple = quote.multiple ?? 1;
  return {
    id: quote.id, customer: quote.customerName, project: quote.projectName,
    organization: {
      name: organization.name,
      contact: [organization.address, organization.email, organization.phone, organization.website_url].filter(Boolean),
    },
    draft: !quote.lines.length || quote.lines.some(line => !line.complete),
    total: quote.total,
    lines: quote.lines.map(line => {
      const content = line.snapshot.content;
      return {
        partNumber: line.partNumber, quantity: line.quantity,
        description: content.productDescription || '',
        extendedPrice: netAmount(line.lineTotal, multiple),
        options: line.kind === 'regular' || line.kind === 'freeform' ? [] : content.segments.flatMap((segment, index) => {
          const option = segment.options.find(item => item.id === line.selections[index]);
          return option ? [{
            description: [segment.name || segment.placeholder, option.code, option.description].filter(Boolean).join(' - '),
            addition: netAmount(option.price, multiple),
          }] : [];
        }),
      };
    }),
  };
}
