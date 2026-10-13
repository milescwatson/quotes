// Read-only Gateway/Lambda and real Cognito-session verification. Tokens are never logged.
import { readFile,writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import YAML from 'yaml';
import { aws,target } from './development-database.mjs';
const token=process.env.QUOTES_VERIFY_ACCESS_TOKEN;
assert.ok(token,'Set QUOTES_VERIFY_ACCESS_TOKEN to a verified development Cognito access token.');
assert.equal(JSON.parse(aws(['sts','get-caller-identity'])).Account,target.account);
const api=YAML.parse(await readFile(new URL('../../AWS/openapi.yaml',import.meta.url),'utf8'));
const expected=Object.entries(api.paths).flatMap(([path,methods])=>Object.keys(methods).map(method=>`${method.toUpperCase()} ${path}`)).sort();
const routes=JSON.parse(aws(['apigatewayv2','get-routes','--api-id','um0ix9fu4i'])).Items;assert.deepEqual(routes.map(r=>r.RouteKey).sort(),expected);
for(const r of routes) assert.equal(r.AuthorizationType,r.RouteKey==='GET /health'?'NONE':'JWT');
const config=JSON.parse(aws(['lambda','get-function-configuration','--function-name','quotes-development-api','--qualifier','development']));assert.equal(config.State,'Active');assert.equal(config.LastUpdateStatus,'Successful');
const checks=[];
async function get(path) {const response=await fetch(`https://um0ix9fu4i.execute-api.us-west-2.amazonaws.com${path}`,{headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(10000)});assert.equal(response.status,200,`GET ${path}`);checks.push({method:'GET',path,status:response.status});return response.json()}
const {user}=await get('/me');assert.equal(typeof user.isSuperAdministrator,'boolean');
let cursor=null;
do {
 const page=await get(`/me/organizations${cursor?`?cursor=${encodeURIComponent(cursor)}`:''}`);
 for(const org of page.items) {assert.ok(['sales','administrator'].includes(org.role));await get(`/organizations/${org.id}`);await get(`/organizations/${org.id}/members`);const configurations=await get(`/organizations/${org.id}/taxonomies`);for(const item of configurations.items.slice(0,1)) {const {taxonomy}=await get(`/organizations/${org.id}/taxonomies/${item.id}`);assert.equal(typeof taxonomy.permissions.canManageSharing,'boolean')};if(user.isSuperAdministrator) await get(`/organizations/${org.id}/domains`)}
 cursor=page.nextCursor;
} while(cursor);
const result={status:'passed',environment:'development',verifiedAt:new Date().toISOString(),lambda:{version:config.Version,codeSha256:config.CodeSha256},routeCount:routes.length,checks};
await writeFile(new URL('../../tasks/6000/development-verification.json',import.meta.url),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
