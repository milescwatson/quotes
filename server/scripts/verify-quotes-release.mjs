// Read-only verification of the deployed development API/Gateway release.
import { execFileSync } from 'node:child_process';
import { readFile,writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import YAML from 'yaml';
const aws=args=>JSON.parse(execFileSync('aws',[...args,'--profile','quotes-development','--region','us-west-2','--output','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
assert.equal(aws(['sts','get-caller-identity']).Account,'415221799122');
const api=YAML.parse(await readFile(new URL('../../AWS/openapi.yaml',import.meta.url),'utf8'));
const expected=Object.entries(api.paths).flatMap(([path,methods])=>Object.keys(methods).map(method=>`${method.toUpperCase()} ${path}`)).sort();
const routes=aws(['apigatewayv2','get-routes','--api-id','um0ix9fu4i']).Items;
assert.deepEqual(routes.map(r=>r.RouteKey).sort(),expected);
for(const r of routes) assert.equal(r.AuthorizationType,r.RouteKey==='GET /health'?'NONE':'JWT');
const configuration=aws(['lambda','get-function-configuration','--function-name','quotes-development-api','--qualifier','development']);
assert.equal(configuration.State,'Active'); assert.equal(configuration.LastUpdateStatus,'Successful');
const result={environment:'development',verifiedAt:new Date().toISOString(),status:'backend_verified',lambda:{version:configuration.Version,codeSha256:configuration.CodeSha256,state:configuration.State,lastUpdateStatus:configuration.LastUpdateStatus},gateway:{routes:routes.map(r=>({route:r.RouteKey,authorization:r.AuthorizationType})).sort((a,b)=>a.route.localeCompare(b.route))},checks:[],databaseEvidence:'database/deployments/development-0004-validation.json',deploymentRecovery:{initialGatewayImport:'rejected YAML aliases; expanded contract then applied Gateway-only plan',failedRequestId:'63bdbcc3-4e2a-41d9-a4df-2e182407c937',initialPlan:{added:0,changed:3,destroyed:0},recoveryPlan:{added:0,changed:1,destroyed:0}}};
const base='https://um0ix9fu4i.execute-api.us-west-2.amazonaws.com',origin='https://development.d8i1ve5prnr7w.amplifyapp.com';
for(const [method,path,status] of [['GET','/health',200],['GET','/organizations/1/quotes/1',401],['POST','/organizations/1/quotes',401],['PUT','/organizations/1/quotes/1',401]]) {
  const response=await fetch(base+path,{method,signal:AbortSignal.timeout(10000),...(method==='GET'?{}:{headers:{'content-type':'application/json'},body:'{}'})});
  assert.equal(response.status,status); result.checks.push({method,path,status:response.status,requestId:response.headers.get('apigw-requestid') || response.headers.get('x-amzn-requestid')});
}
const preflight=await fetch(`${base}/organizations/1/quotes/1`,{method:'OPTIONS',headers:{origin,'access-control-request-method':'PUT','access-control-request-headers':'authorization,content-type'},signal:AbortSignal.timeout(10000)});
assert.equal(preflight.status,204); assert.equal(preflight.headers.get('access-control-allow-origin'),origin); assert.ok(preflight.headers.get('access-control-allow-methods').split(',').includes('PUT'));
result.checks.push({method:'OPTIONS',status:204,allowedOrigin:origin,allowMethods:preflight.headers.get('access-control-allow-methods')});
await writeFile(new URL('../../AWS/deployments/2026-10-12-quotes-verification.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({status:result.status,lambda:result.lambda,routeCount:routes.length,checks:result.checks},null,2));
