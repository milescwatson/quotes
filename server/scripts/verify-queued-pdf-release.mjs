// Read-only infrastructure, API authorization, and hosted-client release verification.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { aws, target } from './development-database.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
const implementation = execFileSync('git', ['log','-1','--format=%H','--','app/app/components/QuoteEditor.vue'], { cwd: root, encoding: 'utf8' }).trim();
assert.equal(JSON.parse(aws(['sts','get-caller-identity'])).Account, target.account);
const contract = YAML.parse(await readFile(root + '/AWS/openapi.yaml','utf8'));
const routes = JSON.parse(aws(['apigatewayv2','get-routes','--api-id','um0ix9fu4i'])).Items;
const expected = Object.entries(contract.paths).flatMap(([path,methods]) => Object.keys(methods).map(method => `${method.toUpperCase()} ${path}`)).sort();
assert.deepEqual(routes.map(route => route.RouteKey).sort(), expected);
for (const route of routes) assert.equal(route.AuthorizationType, route.RouteKey === 'GET /health' ? 'NONE' : 'JWT');
const api = JSON.parse(aws(['lambda','get-function-configuration','--function-name','quotes-development-api','--qualifier','development']));
const worker = JSON.parse(aws(['lambda','get-function-configuration','--function-name','quotes-development-quote-pdf-worker']));
const archive = await readFile(root + '/AWS/environments/development/.terraform/quotes-api.zip');
const hash = createHash('sha256').update(archive).digest('base64');
for (const config of [api,worker]) {
  assert.equal(config.State,'Active'); assert.equal(config.LastUpdateStatus,'Successful');
  assert.equal(config.CodeSha256, hash); assert.deepEqual(config.Architectures,['arm64']);
}
assert.equal(worker.Environment.Variables.DSQL_USER,'quotes_pdf_worker');
assert.equal(worker.Timeout,60);
const bucket = api.Environment.Variables.QUOTE_PDF_BUCKET;
assert.equal(bucket,worker.Environment.Variables.QUOTE_PDF_BUCKET);
assert.equal(JSON.parse(aws(['s3api','get-bucket-versioning','--bucket',bucket])).Status,'Enabled');
assert.ok(Object.values(JSON.parse(aws(['s3api','get-public-access-block','--bucket',bucket])).PublicAccessBlockConfiguration).every(value => value === true));
assert.equal(JSON.parse(aws(['s3api','get-bucket-ownership-controls','--bucket',bucket])).OwnershipControls.Rules[0].ObjectOwnership,'BucketOwnerEnforced');
assert.equal(JSON.parse(aws(['s3api','get-bucket-encryption','--bucket',bucket])).ServerSideEncryptionConfiguration.Rules[0].ApplyServerSideEncryptionByDefault.SSEAlgorithm,'AES256');
const policy = JSON.parse(JSON.parse(aws(['s3api','get-bucket-policy','--bucket',bucket])).Policy);
assert.ok(policy.Statement.some(s => s.Effect === 'Deny' && s.Condition?.Bool?.['aws:SecureTransport'] === 'false'));
const queueUrl = api.Environment.Variables.QUOTE_PDF_QUEUE_URL;
const queue = JSON.parse(aws(['sqs','get-queue-attributes','--queue-url',queueUrl,'--attribute-names','All'])).Attributes;
assert.equal(queue.FifoQueue,'true'); assert.equal(queue.VisibilityTimeout,'360');
const redrive = JSON.parse(queue.RedrivePolicy); assert.equal(Number(redrive.maxReceiveCount),3);
const mapping = JSON.parse(aws(['lambda','list-event-source-mappings','--function-name',worker.FunctionName])).EventSourceMappings.find(m => m.EventSourceArn === queue.QueueArn);
assert.equal(mapping.State,'Enabled'); assert.equal(mapping.BatchSize,1); assert.deepEqual(mapping.FunctionResponseTypes,['ReportBatchItemFailures']);
const origin = 'https://development.d8i1ve5prnr7w.amplifyapp.com';
const base = 'https://um0ix9fu4i.execute-api.us-west-2.amazonaws.com';
const checks=[];
for (const [path,status] of [['/health',200],['/organizations/1/quotes/1/pdf-url?expectedToken=test',401],['/organizations/1/quotes/1/pdf?expectedToken=test',401]]) {
  const response=await fetch(base+path,{signal:AbortSignal.timeout(15000)}); assert.equal(response.status,status); checks.push({path,status});
}
const preflight=await fetch(base+'/organizations/1/quotes/1/pdf-url',{method:'OPTIONS',headers:{origin,'access-control-request-method':'GET','access-control-request-headers':'authorization'},signal:AbortSignal.timeout(15000)});
assert.equal(preflight.status,204); assert.equal(preflight.headers.get('access-control-allow-origin'),origin);
checks.push({method:'OPTIONS',status:204});
const result={environment:'development',verifiedAt:new Date().toISOString(),sourceCommit:implementation,api:{version:api.Version,codeSha256:hash,routeCount:routes.length,checks},worker:{functionName:worker.FunctionName,role:worker.Role,databaseUser:worker.Environment.Variables.DSQL_USER,architecture:'arm64',timeout:60,eventSourceState:mapping.State},storage:{bucket,versioning:'Enabled',private:true,encryption:'AES256',tlsOnly:true},queue:{url:queueUrl,fifo:true,visibilityTimeout:360,maxReceiveCount:3,deadLetterArn:redrive.deadLetterTargetArn}};
if(process.argv[2]) {
  const job=JSON.parse(aws(['amplify','get-job','--app-id','d8i1ve5prnr7w','--branch-name','development','--job-id',process.argv[2]])).job;
  assert.equal(job.summary.status,'SUCCEED'); assert.equal(job.summary.commitId,implementation);
  result.frontend={jobId:process.argv[2],commitId:job.summary.commitId,status:job.summary.status};
  const queue=[],visited=new Set();
  for(const path of ['/','/login']) { const response=await fetch(origin+path,{signal:AbortSignal.timeout(15000)}); assert.equal(response.status,200); if(path==='/login') for(const match of (await response.text()).matchAll(/(?:src|href)="([^"\s]+\.js)"/g)) if(match[1].includes('/_nuxt/')) queue.push(new URL(match[1],origin).href); }
  while(queue.length && visited.size<200 && !result.frontend.quoteAsset) {
    const batch=queue.splice(0,6).filter(url=>!visited.has(url)); batch.forEach(url=>visited.add(url));
    for(const [url,source] of await Promise.all(batch.map(async url=>{const response=await fetch(url,{signal:AbortSignal.timeout(15000)});assert.equal(response.status,200);return [url,await response.text()]}))) {
      if(source.includes('/pdf-url?') && source.includes('Job Location')) result.frontend.quoteAsset={path:new URL(url).pathname,sha256:createHash('sha256').update(source).digest('hex')};
      for(const match of source.matchAll(/["']((?:\.\/|\/_nuxt\/)[^"'\s]+\.js)["']/g)) {const next=new URL(match[1],url).href;if(next.startsWith(origin+'/_nuxt/')&&!visited.has(next))queue.push(next)}
    }
  }
  assert.ok(result.frontend.quoteAsset,'Hosted client must include signed-URL quote exports and location controls');
}
await writeFile(root+'/AWS/deployments/2026-10-15-queued-pdf-verification.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
