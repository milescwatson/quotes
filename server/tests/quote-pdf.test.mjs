import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareQuotePdf } from '../quote-pdf-data.mjs';
import { renderQuotePdf } from '../quote-pdf-layout.mjs';
import { createApp } from '../app.mjs';
import { createLambdaHandler } from '../lambda.mjs';

export const sampleQuote = {
  id: '123', customerName: 'Acme Café', projectName: 'Office', multiple: 0.5, total: '0.05',
  lines: [{ partNumber: 'F-A', quantity: 3, complete: true, unitPrice: '0.03', lineTotal: '0.09',
    selections: ['a'], snapshot: { content: { productFamilyName: 'F Series', productDescription: 'Configured product', segments: [
      { name: 'Size', placeholder: 'XX', options: [{ id: 'a', code: 'A', description: 'Small', price: '0.01' }] },
    ] } } }],
};
const model = () => prepareQuotePdf(sampleQuote, { name: 'Northstar Industries', address: '123 Main Street', email: 'sales@example.com' });
test('PDF data uses saved prices, line rounding, and per-unit additions after multiple', () => {
  const result = model();
  assert.equal(result.lines[0].extendedPrice, '0.05'); // Not rounded unit price * quantity (0.06).
  assert.equal(result.lines[0].options[0].addition, '0.01');
  assert.equal(result.total, '0.05');
  assert.equal(result.draft, false);
  assert.equal(result.lines[0].productName, 'F Series');
  const ordinary = structuredClone(sampleQuote);
  ordinary.lines[0].kind = 'freeform';
  assert.deepEqual(prepareQuotePdf(ordinary, {}).lines[0].options, []);
  assert.equal(prepareQuotePdf(ordinary, {}).lines[0].productName, '');
  assert.equal(prepareQuotePdf({ ...sampleQuote, lines: [] }, {}).draft, true);
});
test('repeated segment labels and codes display once while retaining the option price', () => {
  const quote = structuredClone(sampleQuote);
  quote.lines[0].snapshot.content.segments[0] = {
    name: null, placeholder: 'A-CG5000',
    options: [{ id: 'a', code: 'A-CG5000', description: null, price: '11930.00' }],
  };
  const result = prepareQuotePdf(quote, {});
  assert.deepEqual(result.lines[0].options, [{ description: 'A-CG5000', addition: '5965.00' }]);
  assert.equal(result.total, quote.total);
  assert.equal(model().lines[0].options[0].description, 'Size - A - Small');
});
test('renderer embeds fonts, uses Letter, and paginates 100 long product lines', async () => {
  const result = model();
  result.lines = Array.from({ length: 100 }, (_, i) => ({ ...result.lines[0], partNumber: `F-${i + 1}`, description: 'Long product description. '.repeat(20) }));
  const pdf = await renderQuotePdf(result);
  const raw = pdf.toString('latin1');
  assert.equal(raw.slice(0, 5), '%PDF-');
  assert.match(raw, /\/MediaBox \[0 0 612 792\]/);
  assert.match(raw, /\/FontFile2/);
  const pages = [...raw.matchAll(/\/Type \/Page\b/g)].length;
  assert.ok(pages > 10 && pages < 100, `Unexpected page count ${pages}`);
  assert.ok(pdf.length < 4 * 1024 * 1024);
});
test('Gateway v2 delivers actual PDF bytes and dispositions, retains authentication and no-store', async () => {
  const pdf = await renderQuotePdf(model());
  const config = { COGNITO_ISSUER: 'issuer', COGNITO_CLIENT_ID: 'client' };
  const app = createApp({ config, identityLookup: async () => ({ sub: 'member' }), services: {
    identity: { readQuotePdf: async input => ({ pdf, disposition: input.query.disposition, filename: 'quote-123.pdf' }) },
    taxonomy: {}, principals: {}, regularProducts: {},
  } });
  const handler = createLambdaHandler(app);
  const claims = { iss: 'issuer', client_id: 'client', sub: 'member', token_use: 'access', exp: Date.now() / 1000 + 60, scope: 'quotes-api/access' };
  for (const disposition of ['inline', 'attachment']) {
    const event = { version: '2.0', rawPath: '/organizations/10/quotes/123/pdf',
      queryStringParameters: { disposition, expectedToken: 'saved' }, headers: {},
      requestContext: { requestId: 'pdf-test', http: { method: 'GET', path: '/organizations/10/quotes/123/pdf' }, authorizer: { jwt: { claims } } } };
    const response = await handler(event, {});
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['content-type'], 'application/pdf');
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.headers['content-disposition'], `${disposition}; filename="quote-123.pdf"`);
    assert.equal(response.isBase64Encoded, true);
    assert.deepEqual(Buffer.from(response.body, 'base64'), pdf);
    delete event.requestContext.authorizer;
    assert.equal((await handler(event, {})).statusCode, 401);
  }
  await app.close();
});
