import test from 'node:test';
import assert from 'node:assert/strict';
import { SQSClient } from '@aws-sdk/client-sqs';
import { createQuotePdfStorage, createQuotePdfQueue, quotePdfToken } from '../quote-pdf-storage.mjs';

test('stored PDF signs the inspected version for 60 seconds and honors disposition', async () => {
  for (const disposition of ['inline', 'attachment']) {
    const calls = [];
    const client = { send: async command => { calls.push(command); return { VersionId: 'v1', Metadata: { 'quote-token': quotePdfToken('saved') } }; } };
    const storage = createQuotePdfStorage({ QUOTE_PDF_BUCKET: 'pdfs' }, client, async (actual, command, options) => {
      assert.equal(actual, client);
      assert.deepEqual(options, { expiresIn: 60 });
      assert.deepEqual(command.input, { Bucket: 'pdfs', Key: 'organizations/10/quotes/20.pdf', VersionId: 'v1', ResponseContentType: 'application/pdf', ResponseCacheControl: 'no-store', ResponseContentDisposition: `${disposition}; filename="quote-20.pdf"` });
      return 'https://pdf.example/signed';
    });
    assert.equal(await storage.url('10', '20', 'saved', disposition), 'https://pdf.example/signed');
    assert.equal(calls[0].constructor.name, 'HeadObjectCommand');
  }
});
test('missing, outdated, unversioned, inaccessible objects and signing errors use blob fallback', async () => {
  for (const value of [null, {}, { VersionId: 'null' }, { VersionId: 'v1', Metadata: { 'quote-token': 'old' } }, new Error('storage'), { VersionId: 'v1', Metadata: { 'quote-token': quotePdfToken('saved') } }]) {
    const storage = createQuotePdfStorage({ QUOTE_PDF_BUCKET: 'pdfs' }, { send: async () => { if (value instanceof Error) throw value; return value; } }, async () => { throw Error('sign'); });
    assert.equal(await storage.url('10', '20', 'saved', 'inline'), null);
  }
  assert.equal(await createQuotePdfStorage({}).url('10', '20', 'saved', 'inline'), null);
});
test('upload writes PDF token metadata at the stable key', async () => {
  let command;
  const storage = createQuotePdfStorage({ QUOTE_PDF_BUCKET: 'pdfs' }, { send: async c => { command = c; } });
  await storage.put('10', '20', 'saved', Buffer.from('%PDF-'));
  assert.equal(command.constructor.name, 'PutObjectCommand');
  assert.equal(command.input.Key, 'organizations/10/quotes/20.pdf');
  assert.equal(command.input.Metadata['quote-token'], quotePdfToken('saved'));
});
test('FIFO sends group each quote and use unique deduplication IDs; errors are swallowed', async () => {
  const commands = [], errors = [];
  const queue = createQuotePdfQueue({ QUOTE_PDF_QUEUE_URL: 'queue' }, { send: async c => { commands.push(c); if (commands.length === 3) throw Error('unavailable'); } }, e => errors.push(e));
  for (let i = 0; i < 3; i++) await queue({ organizationId: '10', quoteId: '20' });
  assert.equal(commands[0].input.MessageGroupId, '10:20');
  assert.deepEqual(JSON.parse(commands[0].input.MessageBody), { organizationId: '10', quoteId: '20' });
  assert.notEqual(commands[0].input.MessageDeduplicationId, commands[1].input.MessageDeduplicationId);
  assert.equal(errors[0].errorCode, 'QUOTE_PDF_ENQUEUE_FAILED');
});
test('SDK retries queue transport failure three times in total', async () => {
  let attempts = 0;
  const client = new SQSClient({ region: 'us-west-2', maxAttempts: 3, retryMode: 'standard', credentials: { accessKeyId: 'test', secretAccessKey: 'test' }, requestHandler: {
    handle: async () => { attempts++; const error = new Error('temporary'); error.name = 'TimeoutError'; throw error; },
  } });
  const errors = [];
  await createQuotePdfQueue({ QUOTE_PDF_QUEUE_URL: 'https://sqs.us-west-2.amazonaws.com/123/test.fifo' }, client, error => errors.push(error))({ organizationId: '10', quoteId: '20' });
  assert.equal(attempts, 3);
  assert.equal(errors.length, 1);
  client.destroy();
});
