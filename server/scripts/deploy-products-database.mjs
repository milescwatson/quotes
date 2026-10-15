// Development-only checkpointed 0006 installer; stays paused through coordinated release.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { aws, target, developmentDatabase } from './development-database.mjs';
const mode = process.argv[2];
assert.ok(['inventory','apply','verify'].includes(mode), 'Use inventory, apply, or verify.');
const root = new URL('../../',import.meta.url), journalPath = new URL('database/deployments/development-0006.json',root);
const { db } = developmentDatabase();
const q = async (sql,args=[]) => (await db.query(sql,args)).rows;
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const originals = () => q('SELECT id,organization_id,customer_id,owner_user_id,customer_name,project_name,lines,modified_by,modified_when::text AS modified_when FROM public.quotes ORDER BY id');
let journal;
try { journal=JSON.parse(await readFile(journalPath,'utf8')) } catch (e) { if(e.code!=='ENOENT') throw e; journal={target,startedAt:new Date().toISOString(),events:[]} }
assert.deepEqual(journal.target,target);
const persist = () => writeFile(journalPath,JSON.stringify(journal,null,2)+'\n');
async function inventory() {
  const tables=await q("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name");
  const columns=await q("SELECT column_name,column_default,data_type,numeric_precision,numeric_scale FROM information_schema.columns WHERE table_schema='public' AND table_name='quotes' AND column_name IN ('lines','multiple') ORDER BY column_name");
  const roles=await q('SELECT role,count(*) AS n FROM organization_memberships GROUP BY role');
  const before=await originals();
  return {tables:tables.map(t=>t.table_name),columns,roles,quoteCount:before.length,originalFieldsSha256:digest(before)};
}
async function run(key,sql) {
  const sha256=digest(sql),prior=journal.events.find(e=>e.key===key);
  if(prior) { assert.equal(prior.sha256,sha256); assert.equal(prior.status,'completed','Inspect an unresolved statement before resuming.'); return }
  const event={key,sql,sha256,status:'started',startedAt:new Date().toISOString()};journal.events.push(event);await persist();
  try {
    const result=await db.query(sql);event.rowsAffected=result.rowCount;
    const job=result.rows[0]?.job_id ?? result.rows[0]?.job_uuid;
    if(job) {
      event.jobId=job;await persist();
      for(let attempt=0;attempt<120;attempt++) {
        const [state]=await q('SELECT job_id,status,details FROM sys.jobs WHERE job_id=$1',[job]);event.job=state;
        if(state?.status==='completed') break;
        if(state?.status==='failed' || attempt===119) throw Error(`Validation job ${job}: ${state?.status}`);
        await new Promise(resolve=>setTimeout(resolve,1000));
      }
    }
    event.status='completed';event.completedAt=new Date().toISOString();await persist();console.log(JSON.stringify({key,status:event.status,rowsAffected:event.rowsAffected,job:event.job}));
  } catch(e) {event.status='failed';event.error={code:e.code,message:e.message};await persist();throw e}
}
async function file(name) {
  const text=(await readFile(new URL(`database/versions/0006/products/${name}.sql`,root),'utf8')).replace(/--[^\n]*/g,'').replaceAll(':"api_role"','"quotes_api"');
  for(const [i,statement] of text.split(';').map(s=>s.trim()).filter(Boolean).entries()) await run(`${name}:${i+1}`,statement);
}
async function verify() {
  const after=await originals();assert.equal(digest(after),journal.before.originalFieldsSha256,'Original quote data changed.');assert.equal(after.length,journal.before.quoteCount);
  const constraints=await q("SELECT conname,convalidated FROM pg_constraint WHERE conrelid='public.regular_products'::regclass OR conname='quotes_multiple_valid' ORDER BY conname");
  assert.ok(constraints.some(c=>c.conname==='regular_product_number_unique'));assert.ok(constraints.some(c=>c.conname==='quotes_multiple_valid'));assert.ok(constraints.every(c=>c.convalidated));
  const counts=(await q('SELECT count(*) AS total,count(*) FILTER (WHERE multiple IS NULL) AS null_multiples,count(*) FILTER (WHERE multiple<>1) AS nondefault_multiples FROM public.quotes'))[0];assert.equal(Number(counts.null_multiples),0);assert.equal(Number(counts.nondefault_multiples),0);
  const grants=(await q("SELECT has_table_privilege('quotes_api','regular_products','SELECT') AS read,has_table_privilege('quotes_api','regular_products','INSERT') AS insert,has_table_privilege('quotes_api','regular_products','UPDATE') AS update,has_table_privilege('quotes_api','regular_products','DELETE') AS delete,has_column_privilege('quotes_api','quotes','multiple','UPDATE') AS multiple,has_sequence_privilege('quotes_api','regular_products_id_seq','USAGE') AS sequence_usage"))[0];
  for(const key of ['read','insert','update','multiple','sequence_usage']) assert.equal(grants[key],true);assert.equal(grants.delete,false);
  journal.verification={constraints,counts,grants,originalFieldsSha256:digest(after)};journal.status='migration_verified_api_paused';journal.verifiedAt=new Date().toISOString();await persist();console.log(JSON.stringify({status:journal.status,...journal.verification}));
}
try {
  await db.connect();
  if(mode==='inventory') {console.log(JSON.stringify(await inventory(),null,2));}
  else {
    if(!journal.before) {
      const before=await inventory();assert.ok(before.tables.includes('organization_domains') && before.tables.includes('taxonomy_organization_access'));assert.ok(before.roles.every(r=>['administrator','sales'].includes(r.role)));
      assert.equal(before.tables.includes('regular_products'),false);assert.equal(before.columns.some(c=>c.column_name==='multiple'),false);journal.before=before;await persist();
    }
    if(mode==='apply') {
      if(!journal.apiPause) {
        const config=JSON.parse(aws(['lambda','get-function-configuration','--function-name','quotes-development-api']));const concurrency=JSON.parse(aws(['lambda','get-function-concurrency','--function-name','quotes-development-api']) || '{}');
        journal.apiPause={previousConcurrency:concurrency.ReservedConcurrentExecutions ?? null,startedAt:new Date().toISOString(),previousVersion:config.Version};await persist();
        aws(['lambda','put-function-concurrency','--function-name','quotes-development-api','--reserved-concurrent-executions','0']);await new Promise(resolve=>setTimeout(resolve,(config.Timeout+2)*1000));
      }
      assert.equal(JSON.parse(aws(['lambda','get-function-concurrency','--function-name','quotes-development-api'])).ReservedConcurrentExecutions,0,'API must remain paused.');
      await file('schema');
      const backfill=(await readFile(new URL('database/versions/0006/products/backfill.sql',root),'utf8')).replace(/--[^\n]*/g,'').trim().replace(/;$/,'');let batch=1;
      while(Number((await q('SELECT count(*) AS n FROM quotes WHERE multiple IS NULL'))[0].n)>0) {while(journal.events.some(e=>e.key===`backfill:${batch}`)) batch++;await run(`backfill:${batch++}`,backfill)}
      await file('enforce');await file('permissions');
    }
    await verify();
  }
} catch(e) {if(mode!=='inventory') {journal.status='failed';journal.error={code:e.code,message:e.message};await persist()} throw e} finally {await db.end()}
