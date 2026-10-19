import { lineDescription } from './quote-description.mjs';
import { netAmount } from './quote-pricing.mjs';

// All amounts remain decimal strings. Option additions are per unit; they are
// explanatory and never summed back into the already quantity-extended total.
export function prepareQuotePdf(quote, organization) {
  const multiple = quote.multiple ?? 1;
  const names = quote.authorName?.trim().split(/\s+/u).filter(Boolean) ?? [];
  const initials = (names.length > 1 ? [names[0], names.at(-1)] : names)
    .map(name => Array.from(name)[0].toLocaleUpperCase('en-US')).join('');
  return {
    id: quote.id, customer: quote.customerName, project: quote.projectName, location: quote.location || '', quoteBy: initials || '-',
    organization: {
      name: organization.name,
      address: organization.address || '',
      contact: [organization.email, organization.phone, organization.website_url].filter(Boolean),
    },
    draft: !quote.lines.length || quote.lines.some(line => !line.complete),
    total: quote.total,
    lines: quote.lines.map(line => {
      const content = line.snapshot.content;
      return {
        productName: line.kind !== 'regular' && line.kind !== 'freeform' && content.productFamilyName !== line.partNumber
          ? content.productFamilyName || '' : '',
        partNumber: line.partNumber, quantity: line.quantity,
        description: lineDescription(line).map(run => run.text).join(''),
        ...(line.descriptionContent === undefined ? {} : { descriptionContent: lineDescription(line) }),
        extendedPrice: netAmount(line.lineTotal, multiple),
        options: line.kind === 'regular' || line.kind === 'freeform' ? [] : content.segments.flatMap((segment, index) => {
          const option = segment.options.find(item => item.id === line.selections[index]);
          return option ? [{
            description: [...new Set([segment.name || segment.placeholder, option.code, option.description]
              .map(value => value?.trim()).filter(Boolean))].join(' - '),
            addition: netAmount(option.price, multiple),
          }] : [];
        }),
      };
    }),
  };
}
