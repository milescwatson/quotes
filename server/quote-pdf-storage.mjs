import { createHash, randomUUID } from 'node:crypto';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { S3Client, HeadObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export const quotePdfToken = token => createHash('sha256').update(token).digest('hex');
export const quotePdfKey = (organizationId, quoteId) => `organizations/${organizationId}/quotes/${quoteId}.pdf`;
export function createQuotePdfQueue(config = process.env, client = new SQSClient({ maxAttempts: 3 }), log = entry => console.error(JSON.stringify(entry))) {
  return async ({ organizationId, quoteId }) => {
    if (!config.QUOTE_PDF_QUEUE_URL) return;
    try {
      await client.send(new SendMessageCommand({ QueueUrl: config.QUOTE_PDF_QUEUE_URL,
        MessageBody: JSON.stringify({ organizationId, quoteId }),
        MessageGroupId: `${organizationId}:${quoteId}`, MessageDeduplicationId: randomUUID() }));
    } catch (error) { log({ errorCode: 'QUOTE_PDF_ENQUEUE_FAILED', organizationId, quoteId, cause: error.name }); }
  };
}
export function createQuotePdfStorage(config = process.env, client = new S3Client({}), sign = getSignedUrl) {
  const location = (orgId, quoteId) => ({ Bucket: config.QUOTE_PDF_BUCKET, Key: quotePdfKey(orgId, quoteId) });
  return {
    async head(orgId, quoteId) {
      if (!config.QUOTE_PDF_BUCKET) return null;
      try { return await client.send(new HeadObjectCommand(location(orgId, quoteId))); }
      catch (error) { if (error.$metadata?.httpStatusCode === 404 || ['NotFound', 'NoSuchKey'].includes(error.name)) return null; throw error; }
    },
    async url(orgId, quoteId, token, disposition) {
      try {
        const object = await this.head(orgId, quoteId);
        if (!object?.VersionId || object.VersionId === 'null' || object.Metadata?.['quote-token'] !== quotePdfToken(token)) return null;
        return await sign(client, new GetObjectCommand({ ...location(orgId, quoteId), VersionId: object.VersionId,
          ResponseContentType: 'application/pdf', ResponseCacheControl: 'no-store',
          ResponseContentDisposition: `${disposition}; filename="quote-${quoteId}.pdf"` }), { expiresIn: 60 });
      } catch { return null; }
    },
    put(orgId, quoteId, token, pdf) {
      if (!config.QUOTE_PDF_BUCKET) throw Error('Quote PDF storage is not configured');
      return client.send(new PutObjectCommand({ ...location(orgId, quoteId), Body: pdf, ContentType: 'application/pdf',
        CacheControl: 'no-store', Metadata: { 'quote-token': quotePdfToken(token) } }));
    },
  };
}
