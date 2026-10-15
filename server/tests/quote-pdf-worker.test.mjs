import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuotePdfWorker } from '../quote-pdf-worker.mjs';
import { quotePdfToken } from '../quote-pdf-storage.mjs';
const quote = { id: '20', organization_id: '10', customer_name: 'Latest customer', project_name: 'Project', modified_when: '2026-10-01T00:00:00Z', token: 'latest', modified_by: '1', lines: [], author_name: 'Miles Watson' };
const event = { Records: [{ messageId: 'message', body: JSON.stringify({ organizationId: '10', quoteId: '20' }) }] };
function setup() {
  let stored = null, renders = 0;
  const writes = [], logoReads = [];
  const db = { query: async sql => ({ rows: sql.includes('public.organizations') ? [{ id: '10', name: 'Org', logo_id: 'logo' }] : [quote] }) };
  const storage = { head: async () => stored, put: async (...args) => { writes.push(args); stored = { Metadata: { 'quote-token': quotePdfToken(args[2]) } }; } };
  const worker = createQuotePdfWorker(work => work(db), { storage, logoStorage: { get: async (...args) => { logoReads.push(args); return Buffer.from('logo'); } }, render: async model => { renders++; assert.equal(model.customer, 'Latest customer'); assert.equal(model.quoteBy, 'MW'); assert.equal(model.organization.logo.toString(), 'logo'); return Buffer.from('%PDF-'); } });
  return { worker, writes, logoReads, storage, renders: () => renders };
}
test('worker reads current state, loads logo, writes stable-key PDF, and skips duplicates', async () => {
  const context = setup();
  assert.deepEqual(await context.worker(event), { batchItemFailures: [] });
  assert.deepEqual(context.writes[0].slice(0, 3), ['10', '20', 'latest']);
  assert.deepEqual(context.logoReads, [['10', 'logo']]);
  await context.worker(event);
  assert.equal(context.renders(), 1);
});
test('worker reports failed message for retry and succeeds on a later attempt', async () => {
  const context = setup();
  const put = context.storage.put;
  context.storage.put = async () => { throw Error('temporary'); };
  assert.deepEqual(await context.worker(event), { batchItemFailures: [{ itemIdentifier: 'message' }] });
  context.storage.put = put;
  assert.deepEqual(await context.worker(event), { batchItemFailures: [] });
});
test('FIFO failure leaves later records unprocessed; deleted quotes are acknowledged', async () => {
  const context = setup();
  const malformed = { messageId: 'bad', body: '{}' };
  assert.deepEqual(await context.worker({ Records: [malformed, ...event.Records] }), { batchItemFailures: [{ itemIdentifier: 'bad' }, { itemIdentifier: 'message' }] });
  assert.equal(context.renders(), 0);
  const worker = createQuotePdfWorker(work => work({ query: async () => ({ rows: [] }) }));
  assert.deepEqual(await worker(event), { batchItemFailures: [] });
});
