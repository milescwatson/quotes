// Fixed development target. Temporary Lambda runs with the API IAM/database role.
import { execFileSync } from 'node:child_process';
import { readFile,writeFile,mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { aws,target } from './development-database.mjs';
assert.equal(JSON.parse(aws(['sts','get-caller-identity'])).Account,target.account);
const name=`quotes-development-organization-check-${randomUUID().slice(0,8)}`,dir=await mkdtemp(join(tmpdir(),'organization-check-'));
const result={environment:'development',startedAt:new Date().toISOString()};let created=false;
try {
  await build({entryPoints:[new URL('./organization-smoke-handler.mjs',import.meta.url).pathname],outfile:join(dir,'index.mjs'),bundle:true,platform:'node',target:'node22',format:'esm',banner:{js:"import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);"},external:['pg-native']});
  execFileSync('zip',['-q','function.zip','index.mjs'],{cwd:dir,stdio:'pipe'});
  aws(['lambda','create-function','--function-name',name,'--runtime','nodejs22.x','--role',`arn:aws:iam::${target.account}:role/quotes-development-api`,'--handler','index.handler','--timeout','90','--memory-size','512','--zip-file',`fileb://${join(dir,'function.zip')}`,'--environment',JSON.stringify({Variables:{DSQL_ENDPOINT:`${target.cluster}.dsql.${target.region}.on.aws`,DSQL_USER:'quotes_api'}})]);created=true;
  aws(['lambda','wait','function-active-v2','--function-name',name]);
  result.invocation=JSON.parse(aws(['lambda','invoke','--function-name',name,join(dir,'response.json')]));
  result.smoke=JSON.parse(await readFile(join(dir,'response.json'),'utf8'));assert.equal(result.smoke.status,'passed',JSON.stringify(result.smoke));result.status='passed';
} catch(e) {result.status='failed';result.error=e.message;process.exitCode=1}
finally {
  if(created) try {aws(['lambda','delete-function','--function-name',name]);result.temporaryFunctionDeleted=true} catch(e) {result.cleanupError=e.message;process.exitCode=1}
  await rm(dir,{recursive:true,force:true});result.completedAt=new Date().toISOString();await writeFile(new URL('../../database/deployments/development-0005-validation.json',import.meta.url),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}
