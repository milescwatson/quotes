// Fixed development target; journals each statement and restores API concurrency.
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import pg from 'pg';
const target = { environment:'development',account:'415221799122',region:'us-west-2',cluster:'3zuetvjhixkp3qeuzxxosvlssq',profile:'quotes-development' };
const root = new URL('../../',import.meta.url), journalPath = new URL('database/deployments/development-0004.json',root);
const aws = args => execFileSync('aws',[...args,'--profile',target.profile,'--region',target.region],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
assert.equal(JSON.parse(aws(['sts','get-caller-identity'])).Account,target.account);
assert.equal(JSON.parse(aws(['dsql','get-cluster','--identifier',target.cluster])).status,'ACTIVE');
const host = `${target.cluster}.dsql.${target.region}.on.aws`;
const db = new pg.Client({host,user:'admin',database:'postgres',password:aws(['dsql','generate-db-connect-admin-auth-token','--hostname',host]),ssl:{rejectUnauthorized:true},connectionTimeoutMillis:5000,query_timeout:15000});
let journal;
try { journal = JSON.parse(await readFile(journalPath,'utf8')) } catch(e) { if(e.code !== 'ENOENT') throw e; journal = {target,startedAt:new Date().toISOString(),events:[]} }
assert.deepEqual(journal.target,target);
const persist = () => writeFile(journalPath,JSON.stringify(journal,null,2)+'\n');
const q = async(sql,args=[]) => (await db.query(sql,args)).rows;
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function originalRows() { return q('SELECT id,organization_id,customer_id,owner_user_id,customer_name,project_name,modified_by,modified_when::text AS modified_when FROM public.quotes ORDER BY id') }
async function run(key,sql) {
  const sha256 = createHash('sha256').update(sql).digest('hex'), prior = journal.events.find(e=>e.key === key);
  if(prior) { assert.equal(prior.sha256,sha256); assert.equal(prior.status,'completed','Inspect an unresolved statement before resuming'); return }
  const event = {key,sql,sha256,status:'started',startedAt:new Date().toISOString()}; journal.events.push(event); await persist();
  try {
    const result = await db.query(sql); event.rowsAffected = result.rowCount; event.result = result.rows; await persist();
    const job = result.rows[0]?.job_id ?? result.rows[0]?.job_uuid;
    if(job) {
      for(let i=0;i<120;i++) {
        const [state] = await q('SELECT job_id,status,details FROM sys.jobs WHERE job_id=$1',[job]);
        event.job = state;
        if(state?.status === 'completed') break;
        if(state?.status === 'failed' || i === 119) throw Error(`Validation job ${job}: ${state?.status}`);
        await new Promise(r=>setTimeout(r,1000));
      }
    }
    event.status='completed'; event.completedAt=new Date().toISOString(); await persist();
    console.log(JSON.stringify({key,status:event.status,rowsAffected:event.rowsAffected,job:event.job}));
  } catch(e) { event.status='failed'; event.error={code:e.code,message:e.message}; await persist(); throw e }
}
async function file(path) {
  const statements=(await readFile(new URL(path,root),'utf8')).replace(/--[^\n]*/g,'').replaceAll(':"api_role"','"quotes_api"').split(';').map(s=>s.trim()).filter(Boolean);
  for(const [i,sql] of statements.entries()) await run(`${path}:${i+1}`,sql);
}
let paused=false,previousConcurrency;
try {
  await db.connect();
  const config=JSON.parse(aws(['lambda','get-function-configuration','--function-name','quotes-development-api']));
  previousConcurrency=JSON.parse(aws(['lambda','get-function-concurrency','--function-name','quotes-development-api']) || '{}').ReservedConcurrentExecutions;
  journal.apiPause={previousConcurrency:previousConcurrency ?? -1,startedAt:new Date().toISOString()}; await persist();
  aws(['lambda','put-function-concurrency','--function-name','quotes-development-api','--reserved-concurrent-executions','0']); paused=true;
  console.log('Development API paused; draining in-flight requests.');
  await new Promise(r=>setTimeout(r,(config.Timeout+2)*1000));
  const originals=await originalRows();
  if(!journal.before) {
    const tables=await q("SELECT table_name FROM information_schema.tables WHERE table_schema='public'");
    assert.equal(tables.length,8,'Expected 0003 baseline');
    assert.equal((await q("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='quotes' AND column_name='lines'")).length,0,'Unexpected existing column; inspect before applying');
    journal.before={quoteCount:originals.length,originalFieldsSha256:digest(originals)}; await persist();
  }
  await file('database/versions/0004/quotes/schema.sql');
  const backfill=(await readFile(new URL('database/versions/0004/quotes/backfill.sql',root),'utf8')).replace(/--[^\n]*/g,'').trim().replace(/;$/,'');
  let batch=1;
  while(Number((await q('SELECT count(*) AS n FROM public.quotes WHERE lines IS NULL'))[0].n)>0) {
    while(journal.events.some(e=>e.key===`backfill:${batch}`)) batch++;
    await run(`backfill:${batch++}`,backfill);
  }
  await file('database/versions/0004/quotes/enforce.sql');
  await file('database/versions/0004/quotes/permissions.sql');
  const after=await originalRows();
  assert.equal(digest(after),journal.before.originalFieldsSha256,'Existing quote metadata changed during migration');
  const constraint=(await q("SELECT convalidated FROM pg_constraint WHERE conname='quotes_lines_valid'"))[0]; assert.equal(constraint.convalidated,true);
  const counts=(await q("SELECT count(*) AS total,count(*) FILTER (WHERE lines IS NULL) AS null_lines FROM public.quotes"))[0]; assert.equal(Number(counts.null_lines),0);
  const grants=(await q("SELECT has_table_privilege('quotes_api','quotes','INSERT') AS insert,has_column_privilege('quotes_api','quotes','lines','UPDATE') AS update_lines,has_column_privilege('quotes_api','quotes','customer_name','UPDATE') AS update_customer,has_table_privilege('quotes_api','quotes','DELETE') AS delete,has_sequence_privilege('quotes_api','quotes_id_seq','USAGE') AS sequence_usage"))[0];
  assert.equal(grants.insert,true); assert.equal(grants.update_lines,true); assert.equal(grants.update_customer,true); assert.equal(grants.delete,false); assert.equal(grants.sequence_usage,true);
  journal.verification={counts,constraint,grants,originalFieldsSha256:digest(after)}; journal.status='applied'; journal.appliedAt=new Date().toISOString(); await persist();
  console.log(JSON.stringify({status:'migration_verified',...journal.verification}));
} catch(e) { journal.status='failed'; journal.error={code:e.code,message:e.message}; await persist(); console.error(JSON.stringify(journal.error)); process.exitCode=1 }
finally {
  if(paused) {
    try {
      if(previousConcurrency === undefined) aws(['lambda','delete-function-concurrency','--function-name','quotes-development-api']);
      else aws(['lambda','put-function-concurrency','--function-name','quotes-development-api','--reserved-concurrent-executions',String(previousConcurrency)]);
      journal.apiPause.restoredAt=new Date().toISOString(); await persist(); console.log('Development API concurrency restored.');
    } catch(e) { journal.restoreError=e.message; await persist(); process.exitCode=1; console.error('API concurrency restoration failed; inspect development Lambda.') }
  }
  await db.end();
}
