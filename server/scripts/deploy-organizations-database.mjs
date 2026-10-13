// Fixed development target. Remains paused until the matching API is released.
import { readFile,writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { aws,target,developmentDatabase } from './development-database.mjs';
import { normalizeDomain,personalDomains } from '../organization-domains.mjs';
const root=new URL('../../',import.meta.url), journalPath=new URL('database/deployments/development-0005.json',root);
const {db}=developmentDatabase();
let journal;
try {journal=JSON.parse(await readFile(journalPath,'utf8'))} catch(e) {if(e.code!=='ENOENT') throw e;journal={target,events:[],startedAt:new Date().toISOString()}}
assert.deepEqual(journal.target,target);
const persist=()=>writeFile(journalPath,JSON.stringify(journal,null,2)+'\n');
const q=async(sql,args=[]) => (await db.query(sql,args)).rows;
const mapPath=process.argv[2];
const domainMap=mapPath?JSON.parse(await readFile(mapPath,'utf8')):{};
assert.ok(domainMap && typeof domainMap==='object' && !Array.isArray(domainMap));
for(const [domain,id] of Object.entries(domainMap)) {assert.equal(normalizeDomain(domain),domain);assert.equal(personalDomains.has(domain),false);assert.match(id,/^[1-9][0-9]{0,18}$/)}
async function run(key,sql,args=[]) {
  const sha256=createHash('sha256').update(JSON.stringify([sql,args])).digest('hex'),prior=journal.events.find(e=>e.key===key);
  if(prior) {assert.equal(prior.sha256,sha256);assert.equal(prior.status,'completed','Inspect any unresolved statement before resuming.');return}
  const event={key,sha256,status:'started',startedAt:new Date().toISOString()};journal.events.push(event);await persist();
  try {
    const result=await db.query(sql,args);event.rowsAffected=result.rowCount;
    const job=result.rows[0]?.job_id ?? result.rows[0]?.job_uuid;
    if(job) {
      event.jobId=job;await persist();
      for(let i=0;i<120;i++) {
        const [state]=await q('SELECT job_id,status,details FROM sys.jobs WHERE job_id=$1',[job]);event.job=state;
        if(state?.status==='completed') break;
        if(state?.status==='failed' || i===119) throw Error(`Migration job ${job}: ${state?.status}`);
        await new Promise(resolve=>setTimeout(resolve,1000));
      }
    }
    event.status='completed';event.completedAt=new Date().toISOString();await persist();console.log(JSON.stringify({key,status:event.status}));
  } catch(e) {event.status='failed';event.error={code:e.code,message:e.message};await persist();throw e}
}
async function file(name) {
 const sql=(await readFile(new URL(`database/versions/0005/organizations/${name}.sql`,root),'utf8')).replace(/--[^\n]*/g,'').replaceAll(':"api_role"','"quotes_api"').replaceAll(':"operator_role"','"quotes_operator"');
 for(const [i,statement] of sql.split(';').map(s=>s.trim()).filter(Boolean).entries()) await run(`${name}:${i+1}`,statement);
}
try {
 await db.connect();
 if(!journal.apiPause) {
   const config=JSON.parse(aws(['lambda','get-function-configuration','--function-name','quotes-development-api']));
   const current=JSON.parse(aws(['lambda','get-function-concurrency','--function-name','quotes-development-api']) || '{}');
   journal.apiPause={previousConcurrency:current.ReservedConcurrentExecutions ?? null,startedAt:new Date().toISOString()};await persist();
   aws(['lambda','put-function-concurrency','--function-name','quotes-development-api','--reserved-concurrent-executions','0']);
   await new Promise(resolve=>setTimeout(resolve,(config.Timeout+2)*1000));
 } else assert.equal(JSON.parse(aws(['lambda','get-function-concurrency','--function-name','quotes-development-api'])).ReservedConcurrentExecutions,0,'Pause the API before resuming migration.');
 await file('identity');
 const backfills=(await readFile(new URL('database/versions/0005/organizations/backfill.sql',root),'utf8')).split(';').map(s=>s.trim()).filter(Boolean);
 for(const [i,sql] of backfills.entries()) {
   const remaining="SELECT count(*) AS n FROM organization_memberships WHERE role IN ('admin','editor','member')";
   let batch=1;
   while(Number((await q(remaining))[0].n)>0) {while(journal.events.some(e=>e.key===`backfill:${i}:${batch}`)) batch++;await run(`backfill:${i}:${batch++}`,sql)}
 }
 await file('enforce');await file('sharing');await file('permissions');
 for(const [domain,id] of Object.entries(domainMap)) {
   assert.equal((await q("SELECT id FROM organizations WHERE id=$1 AND status='active'",[id])).length,1);
   await run(`domain:${domain}`,'INSERT INTO organization_domains(domain,organization_id) VALUES($1,$2)',[domain,id]);
 }
 const constraints=await q("SELECT conname,convalidated FROM pg_constraint WHERE conname IN ('organization_memberships_role_check','identity_audit_events_entity_type_check')");
 assert.equal(constraints.length,2);assert.ok(constraints.every(c=>c.convalidated));
 const roles=await q('SELECT role,count(*) AS n FROM organization_memberships GROUP BY role');assert.ok(roles.every(r=>['sales','administrator'].includes(r.role)));
 journal.status='migration_verified_api_paused';journal.verification={constraints,roles,domains:Object.keys(domainMap)};await persist();
 console.log('Migration verified. API stays paused: release the matching Lambda/Gateway/UI, verify the version and routes, then restore the concurrency recorded in the journal.');
} catch(e) {journal.status='failed_api_paused';journal.error={code:e.code,message:e.message};await persist();throw e} finally {await db.end()}
