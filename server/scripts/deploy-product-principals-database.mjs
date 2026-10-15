// Development-only 0007 migration. API remains paused until coordinated release.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {aws,target,developmentDatabase} from './development-database.mjs';
const root=new URL('../../',import.meta.url),path=new URL('database/deployments/development-0007.json',root),{db}=developmentDatabase();
const q=async(sql,args=[]) => (await db.query(sql,args)).rows;
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const originals=async()=>({products:await q('SELECT id,organization_id,part_number,description,list_price,parent_taxonomy_id,modified_when::text AS token FROM regular_products ORDER BY id'),quotes:await q('SELECT to_jsonb(q) AS document FROM quotes q ORDER BY id')});
let journal;
try {journal=JSON.parse(await readFile(path,'utf8'))} catch(e) {if(e.code!=='ENOENT') throw e;journal={target,startedAt:new Date().toISOString(),events:[]}}
assert.deepEqual(journal.target,target);
const persist=()=>writeFile(path,JSON.stringify(journal,null,2)+'\n');
try {
 await db.connect();
 if(!journal.apiPause) {
  assert.equal((await q("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='regular_products' AND column_name='principal_id'")).length,0,'Inspect unexpected partially applied migration.');
  assert.equal((await q("SELECT convalidated FROM pg_constraint WHERE conname='quotes_multiple_valid'"))[0]?.convalidated,true,'Verified 0006 required.');
  const config=JSON.parse(aws(['lambda','get-function-configuration','--function-name','quotes-development-api']));const concurrency=JSON.parse(aws(['lambda','get-function-concurrency','--function-name','quotes-development-api']) || '{}');
  journal.apiPause={previousConcurrency:concurrency.ReservedConcurrentExecutions??null,startedAt:new Date().toISOString()};await persist();
  aws(['lambda','put-function-concurrency','--function-name','quotes-development-api','--reserved-concurrent-executions','0']);await new Promise(resolve=>setTimeout(resolve,(config.Timeout+2)*1000));
 }
 assert.equal(JSON.parse(aws(['lambda','get-function-concurrency','--function-name','quotes-development-api']) || '{}').ReservedConcurrentExecutions,0,'API must remain paused.');
 if(!journal.before) {const data=await originals();journal.before={productCount:data.products.length,quoteCount:data.quotes.length,originalFieldsSha256:hash(data)};await persist()}
 const sql=(await readFile(new URL('database/versions/0007/products/schema.sql',root),'utf8')).replace(/--[^\n]*/g,'');
 for(const [i,statement] of sql.split(';').map(s=>s.trim()).filter(Boolean).entries()) {
  const key=`schema:${i+1}`,sha256=hash(statement),prior=journal.events.find(e=>e.key===key);
  if(prior) {assert.equal(prior.sha256,sha256);assert.equal(prior.status,'completed','Inspect an unresolved statement before resuming.');continue}
  const event={key,sql:statement,sha256,status:'started',startedAt:new Date().toISOString()};journal.events.push(event);await persist();
  const result=await db.query(statement),job=result.rows[0]?.job_id??result.rows[0]?.job_uuid;
  if(job) {
   event.jobId=job;await persist();
   for(let n=0;n<120;n++) {const [state]=await q('SELECT job_id,status,details FROM sys.jobs WHERE job_id=$1',[job]);event.job=state;if(state?.status==='completed') break;if(state?.status==='failed'||n===119) throw Error(`Validation job ${job}: ${state?.status}`);await new Promise(resolve=>setTimeout(resolve,1000))}
  }
  event.status='completed';event.completedAt=new Date().toISOString();await persist();console.log(JSON.stringify({key,status:event.status,job:event.job}));
 }
 assert.equal(hash(await originals()),journal.before.originalFieldsSha256,'Existing product fields or quote data changed.');
 const constraint=(await q("SELECT conname,convalidated FROM pg_constraint WHERE conname='regular_products_principal_fk'"))[0];assert.equal(constraint.convalidated,true);
 const grants=(await q("SELECT has_column_privilege('quotes_api','regular_products','principal_id','SELECT') AS read,has_column_privilege('quotes_api','regular_products','principal_id','UPDATE') AS update,has_column_privilege('quotes_api','regular_products','principal_id','INSERT') AS insert"))[0];assert.ok(Object.values(grants).every(v=>v===true));
 assert.equal(Number((await q('SELECT count(*) AS n FROM regular_products WHERE principal_id IS NOT NULL'))[0].n),0);
 journal.status='migration_verified_api_paused';journal.verification={constraint,grants,originalFieldsSha256:journal.before.originalFieldsSha256};journal.verifiedAt=new Date().toISOString();await persist();console.log(JSON.stringify({status:journal.status,...journal.verification}));
} catch(e) {journal.status='failed';journal.error={code:e.code,message:e.message};await persist();throw e} finally {await db.end()}
