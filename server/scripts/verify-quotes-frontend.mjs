// Read-only development Amplify/page/asset verification after a successful build.
import { execFileSync } from 'node:child_process';
import { readFile,writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const jobId=process.argv[2]; assert.match(jobId ?? '',/^\d+$/);
const job=JSON.parse(execFileSync('aws',['amplify','get-job','--app-id','d8i1ve5prnr7w','--branch-name','development','--job-id',jobId,'--profile','quotes-development','--region','us-west-2','--output','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']})).job;
assert.equal(job.summary.status,'SUCCEED');
const origin='https://development.d8i1ve5prnr7w.amplifyapp.com';
const checks=[],queue=[],visited=new Set();
for(const path of ['/','/login','/organizations/6b86b273ff34/quotes/new']) {
  const response=await fetch(origin+path,{signal:AbortSignal.timeout(15000)}),html=await response.text();
  assert.equal(response.status,200); assert.ok(html.includes('/_nuxt/')); checks.push({path,status:response.status,finalUrl:response.url});
  for(const match of html.matchAll(/(?:src|href)="([^"\s]+\.js)"/g)) if(match[1].includes('/_nuxt/')) queue.push(new URL(match[1],origin).href);
}
let feature;
while(queue.length && visited.size < 100) {
  const batch=queue.splice(0,6).filter(url=>!visited.has(url)); batch.forEach(url=>visited.add(url));
  const texts=await Promise.all(batch.map(async url=>{const response=await fetch(url,{signal:AbortSignal.timeout(15000)}); assert.equal(response.status,200); return [url,await response.text()] }));
  for(const [url,text] of texts) {
    if(text.includes('Saved configuration version') && text.includes('Estimated quote total')) feature={path:new URL(url).pathname,sha256:createHash('sha256').update(text).digest('hex')};
    for(const match of text.matchAll(/["']((?:\.\/|\/_nuxt\/)[^"'\s]+\.js)["']/g)) {const next=new URL(match[1],url).href; if(next.startsWith(origin+'/_nuxt/') && !visited.has(next)) queue.push(next)}
  }
  if(feature) break;
}
assert.ok(feature,'The released client must contain the new Quotes editor');
const path=new URL('../../AWS/deployments/2026-10-12-quotes-verification.json',import.meta.url),result=JSON.parse(await readFile(path,'utf8'));
result.frontend={jobId,commitId:job.summary.commitId,status:job.summary.status,startTime:job.summary.startTime,endTime:job.summary.endTime,steps:job.steps.map(s=>({name:s.stepName,status:s.status})),checks,featureAsset:feature,verifiedAt:new Date().toISOString()}; result.status='passed';
await writeFile(path,JSON.stringify(result,null,2)+'\n'); console.log(JSON.stringify(result.frontend,null,2));
