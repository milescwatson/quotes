// Fixed development target. Dedicated fixtures and temporary IAM-role Lambda are removed.
import { execFileSync } from 'node:child_process';
import { readFile,writeFile,mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import pg from 'pg';
const aws=args=>execFileSync('aws',[...args,'--profile','quotes-development','--region','us-west-2'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
assert.equal(JSON.parse(aws(['sts','get-caller-identity'])).Account,'415221799122');
const host='3zuetvjhixkp3qeuzxxosvlssq.dsql.us-west-2.on.aws';
const db=new pg.Client({host,user:'admin',database:'postgres',password:aws(['dsql','generate-db-connect-admin-auth-token','--hostname',host]),ssl:{rejectUnauthorized:true},connectionTimeoutMillis:5000,query_timeout:15000});
const q=async(sql,args=[]) => (await db.query(sql,args)).rows;
const runId=randomUUID(), name=`quotes-development-quote-check-${runId.slice(0,8)}`, dir=await mkdtemp(join(tmpdir(),'quotes-check-'));
const result={environment:'development',startedAt:new Date().toISOString(),runId};
let created=false,adminId,memberId,orgId,otherOrgId;
try {
  await db.connect();
  await q('BEGIN');
  for(const [sub,email] of [['admin',`quote-admin-${runId}@example.invalid`],['member',`quote-member-${runId}@example.invalid`]]) {
    const id=(await q('INSERT INTO users(cognito_issuer,cognito_subject,email,normalized_email) VALUES($1,$2,$3,$3) RETURNING id',[`https://deployment.invalid/${runId}`,sub,email]))[0].id;
    if(sub==='admin') adminId=id; else memberId=id;
  }
  orgId=(await q("INSERT INTO organizations(name,status) VALUES($1,'active') RETURNING id",[`Quote verification ${runId}`]))[0].id;
  otherOrgId=(await q("INSERT INTO organizations(name,status) VALUES($1,'active') RETURNING id",[`Quote isolation ${runId}`]))[0].id;
  await q("INSERT INTO organization_memberships(organization_id,user_id,role) VALUES($1,$2,'admin'),($1,$3,'member'),($4,$2,'admin')",[orgId,adminId,memberId,otherOrgId]);
  await q('COMMIT'); result.fixture={adminId,memberId,orgId,otherOrgId};
  await build({entryPoints:[new URL('./quote-smoke-handler.mjs',import.meta.url).pathname],outfile:join(dir,'index.mjs'),bundle:true,platform:'node',target:'node22',format:'esm',banner:{js:"import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);"},external:['pg-native']});
  execFileSync('zip',['-q','function.zip','index.mjs'],{cwd:dir,stdio:'pipe'});
  result.functionArn=JSON.parse(aws(['lambda','create-function','--function-name',name,'--runtime','nodejs22.x','--role','arn:aws:iam::415221799122:role/quotes-development-api','--handler','index.handler','--timeout','90','--memory-size','512','--zip-file',`fileb://${join(dir,'function.zip')}`,'--environment',JSON.stringify({Variables:{DSQL_ENDPOINT:host,DSQL_USER:'quotes_api'}})])).FunctionArn;
  created=true; aws(['lambda','wait','function-active-v2','--function-name',name]);
  await writeFile(join(dir,'payload.json'),JSON.stringify({runId,orgId:String(orgId),otherOrgId:String(otherOrgId),adminId:String(adminId),memberId:String(memberId),identity:{issuer:`https://deployment.invalid/${runId}`,sub:'admin'},memberIdentity:{issuer:`https://deployment.invalid/${runId}`,sub:'member'}}));
  result.invocation=JSON.parse(aws(['lambda','invoke','--function-name',name,'--payload',`fileb://${join(dir,'payload.json')}`,join(dir,'response.json')]));
  result.smoke=JSON.parse(await readFile(join(dir,'response.json'),'utf8')); assert.equal(result.smoke.status,'passed',JSON.stringify(result.smoke));
  result.status='passed';
} catch(e) { await db.query('ROLLBACK').catch(()=>{}); result.status='failed'; result.error={code:e.code,message:e.message}; process.exitCode=1 }
finally {
  if(created) try { aws(['lambda','delete-function','--function-name',name]); result.temporaryFunctionDeleted=true } catch(e) { result.functionCleanupError=e.message; process.exitCode=1 }
  try {
    await q('BEGIN');
    if(orgId) {
      await q('DELETE FROM identity_audit_events WHERE organization_id=$1 OR organization_id=$2',[orgId,otherOrgId]);
      await q('DELETE FROM quotes WHERE organization_id=$1',[orgId]);
      await q('DELETE FROM taxonomy_versions WHERE taxonomy_id IN (SELECT id FROM taxonomies WHERE owner_organization_id=$1)',[orgId]);
      await q('DELETE FROM taxonomies WHERE owner_organization_id=$1',[orgId]);
      await q('DELETE FROM principals WHERE created_by_user_id=$1',[adminId]);
      await q('DELETE FROM organization_memberships WHERE organization_id=$1 OR organization_id=$2',[orgId,otherOrgId]);
      await q('DELETE FROM organizations WHERE id=$1 OR id=$2',[orgId,otherOrgId]);
    }
    if(adminId) await q('DELETE FROM users WHERE id=$1 OR id=$2',[adminId,memberId]);
    await q('COMMIT');
    assert.equal(Number((await q('SELECT count(*) AS n FROM users WHERE cognito_issuer=$1',[`https://deployment.invalid/${runId}`]))[0].n),0);
    result.fixtureDeleted=true;
  } catch(e) { await db.query('ROLLBACK').catch(()=>{}); result.cleanupError={code:e.code,message:e.message}; process.exitCode=1 }
  await db.end(); await rm(dir,{recursive:true,force:true}); result.completedAt=new Date().toISOString();
  await writeFile(new URL('../../database/deployments/development-0004-validation.json',import.meta.url),JSON.stringify(result,null,2)+'\n'); console.log(JSON.stringify(result,null,2));
}
