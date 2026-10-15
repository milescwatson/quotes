// Verify the actual ARM64 release, SQS event source, read-only worker role, and
// signed S3 downloads using an existing quote. No quote/user records are changed.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { aws, target } from './development-database.mjs';
assert.equal(JSON.parse(aws(['sts', 'get-caller-identity'])).Account, target.account);
const config = JSON.parse(aws(['lambda', 'get-function-configuration', '--function-name', 'quotes-development-api', '--qualifier', 'development']));
const archive = fileURLToPath(new URL('../../AWS/environments/development/.terraform/quotes-api.zip', import.meta.url));
assert.equal(config.CodeSha256, createHash('sha256').update(await readFile(archive)).digest('base64'));
const directory = await mkdtemp(join(tmpdir(), 'quotes-queued-pdf-runtime-'));
const name = 'quotes-development-queued-pdf-smoke';
let created = false;
try {
  const code = join(directory, 'code');
  execFileSync('unzip', ['-q', archive, '-d', code]);
  const source = await readFile(join(code, 'index.mjs'), 'utf8');
  await writeFile(join(code, 'index.mjs'), source + `
export async function queuedPdfRuntimeSmoke() {
  const check = (condition, message) => { if (!condition) throw Error(message); };
  try {
    const saved = (await getPool().query(
      "SELECT q.id,q.organization_id,q.modified_when::text AS token,q.modified_when,u.cognito_issuer,u.cognito_subject FROM public.quotes q JOIN public.organizations o ON o.id=q.organization_id JOIN public.organization_memberships m ON m.organization_id=o.id JOIN public.users u ON u.id=m.user_id WHERE o.status='active' AND m.removed_at IS NULL AND u.disabled_at IS NULL ORDER BY q.modified_when DESC,q.id DESC,u.id LIMIT 1"
    )).rows[0];
    check(saved, 'An existing quote with an active member is required');
    const organizationId = String(saved.organization_id), quoteId = String(saved.id);
    const storage = createQuotePdfStorage();
    await createQuotePdfQueue()({ organizationId, quoteId });
    let object;
    for (let attempt = 0; attempt < 45; attempt++) {
      object = await storage.head(organizationId, quoteId);
      if (object?.Metadata?.['quote-token'] === quotePdfToken(saved.token)) break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    check(object?.Metadata?.['quote-token'] === quotePdfToken(saved.token), 'SQS worker did not generate the current PDF');
    check(object.VersionId && object.VersionId !== 'null', 'PDF bucket must be versioned');
    const input = { orgId: organizationId, quoteId, identity: { issuer: saved.cognito_issuer, sub: saved.cognito_subject }, query: { expectedToken: saved.token } };
    const service = age => createIdentityService(work => transactions(getPool())(work), { now: () => new Date(saved.modified_when).getTime() + age });
    check((await service(299999).readQuotePdfUrl(input)).url === null, 'Recent quotes must use blobs');
    const blobs = await service(299999).readQuotePdf(input);
    check(blobs.pdf.subarray(0,5).toString() === '%PDF-', 'Blob fallback must render a PDF on ARM64');
    const downloads = [];
    for (const disposition of ['inline', 'attachment']) {
      const result = await service(300000).readQuotePdfUrl({ ...input, query: { ...input.query, disposition } });
      check(result.url, 'Five-minute-old quotes must return a signed URL');
      const url = new URL(result.url);
      check(url.searchParams.get('X-Amz-Expires') === '60', 'Signed URL must expire in 60 seconds');
      check(url.searchParams.get('versionId') === object.VersionId, 'Signed URL must pin the inspected version');
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
      check(response.status === 200, 'Signed S3 download must succeed');
      check(response.headers.get('content-disposition') === disposition + '; filename="quote-' + quoteId + '.pdf"', 'S3 must honor disposition');
      const pdf = Buffer.from(await response.arrayBuffer());
      check(pdf.subarray(0,5).toString() === '%PDF-', 'Stored bytes must be a PDF');
      check(pdf.toString('latin1').includes('/FontFile2'), 'Stored PDF must embed packaged fonts');
      downloads.push({ disposition, status: response.status, bytes: pdf.length });
    }
    let conflict = false;
    try { await service(300000).readQuotePdfUrl({ ...input, query: { expectedToken: 'stale' } }); }
    catch (error) { conflict = error.code === 'QUOTE_CONFLICT'; }
    check(conflict, 'Stale quote tokens must be rejected');
    const anonymous = await fetch('https://' + process.env.QUOTE_PDF_BUCKET + '.s3.' + process.env.AWS_REGION + '.amazonaws.com/organizations/' + organizationId + '/quotes/' + quoteId + '.pdf', { signal: AbortSignal.timeout(10000) });
    check(anonymous.status === 403, 'Unsigned PDF access must be denied');
    return { status: 'passed', architecture: process.arch, runtime: process.version, checks: ['SQS-to-Lambda-generation','read-only-worker-database-role','versioned-S3-PDF','embedded-fonts','recent-blob-fallback','five-minute-signed-URL-boundary','60-second-TTL','pinned-object-version','inline-and-attachment-dispositions','stale-token-conflict','anonymous-S3-denied'], downloads, databaseWrites: false, artifact: 'PDF retained for the existing quote' };
  } finally { await getPool().end(); }
}
`);
  const zip = join(directory, 'smoke.zip');
  execFileSync('zip', ['-qr', zip, '.'], { cwd: code });
  const input = join(directory, 'function.json');
  await writeFile(input, JSON.stringify({ FunctionName: name, Runtime: 'nodejs22.x', Role: config.Role, Handler: 'index.queuedPdfRuntimeSmoke', Timeout: 90, MemorySize: 512, Architectures: ['arm64'], Environment: config.Environment }));
  aws(['lambda', 'create-function', '--cli-input-json', `file://${input}`, '--zip-file', `fileb://${zip}`]); created = true;
  aws(['lambda', 'wait', 'function-active-v2', '--function-name', name]);
  const output = join(directory, 'response.json');
  const invocation = JSON.parse(aws(['lambda', 'invoke', '--function-name', name, '--cli-read-timeout', '120', output]));
  const response = JSON.parse(await readFile(output, 'utf8'));
  assert.ok(!invocation.FunctionError, JSON.stringify(response));
  assert.equal(response.status, 'passed');
  const result = { environment: 'development', verifiedAt: new Date().toISOString(), apiVersion: config.Version, codeSha256: config.CodeSha256, ...response };
  await writeFile(new URL('../../AWS/deployments/2026-10-15-queued-pdf-runtime-verification.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally {
  if (created) aws(['lambda', 'delete-function', '--function-name', name]);
  await rm(directory, { recursive: true, force: true });
}
