// Invoked only by the temporary deployment-verification Lambda; no HTTP route.
import assert from 'node:assert/strict';
import { getPool } from '../database.mjs';
import { createPrincipalService } from '../principals.mjs';
import { createTaxonomyService } from '../taxonomy.mjs';
export async function handler(event) {
 const db=await getPool().connect();const checks=[];const q=async(sql,args=[]) => (await db.query(sql,args)).rows;
 const check=name=>checks.push(name);
 const editable=c=>({productFamilyName:c.productFamilyName,currency:c.currency,basePrice:c.basePrice,segments:c.segments.map(s=>({id:s.id,placeholder:s.placeholder,name:s.name,defaultOptionIndex:s.defaultOptionId===null?null:s.options.findIndex(o=>o.id===s.defaultOptionId),options:s.options}))});
 try{
  assert.equal((await q('SELECT current_user'))[0].current_user,'quotes_api');check('IAM-authenticated quotes_api connection');
  await q('BEGIN ISOLATION LEVEL REPEATABLE READ');
  await q("INSERT INTO users(cognito_issuer,cognito_subject,email,normalized_email) VALUES ($1,'rollback-only','rollback@example.invalid','rollback@example.invalid')",[event.identity.issuer]);check('Runtime identity insert with generated ID');
  const principalService=createPrincipalService(async work=>work(db));
  const unique=crypto.randomUUID();
  const principal=(await principalService({method:'POST',path:`/organizations/${event.orgId}/principals`,body:{name:`Smoke ${unique}`,websiteUrl:`https://smoke-${unique}.com`},identity:event.identity})).body.principal;
  check('Shared principal created with root-domain uniqueness');
  const service=createTaxonomyService(async work=>work(db));
  const call=(method,suffix='',body={})=>service({method,path:`/organizations/${event.orgId}/taxonomies${suffix}`,body:method==='POST'&&(!suffix||suffix.endsWith('/versions'))?{principalId:principal.id,...body}:body,identity:event.identity});
  const content={productFamilyName:'Smoke',currency:'USD',basePrice:'0.10',segments:[{id:null,placeholder:'X',name:null,defaultOptionIndex:null,options:[{id:null,code:'01',description:null,price:'0.20'}]}]};
  let t=(await call('POST','',{content})).body.taxonomy;
  assert.equal(t.version.versionNumber,1);check('Create with generated IDs and deferred current-version foreign key');
  assert.equal((await call('GET')).body.items.some(item=>item.id===t.id),true);assert.equal((await call('GET',`/${t.id}`)).body.taxonomy.id,t.id);check('Catalog and detail');
  assert.equal((await call('POST',`/${t.id}/preview`,{versionId:t.currentVersionId,selections:[]})).body.configuration.unitPrice,'0.30');check('Exact-price configuration preview');
  assert.equal((await call('POST',`/${t.id}/versions`,{expectedVersionId:t.currentVersionId,content:editable(t.version.content)})).body.unchanged,true);check('No-op save retains version');
  const second=(await principalService({method:'POST',path:`/organizations/${event.orgId}/principals`,body:{name:`Other ${unique}`,websiteUrl:`https://other-${unique}.com`},identity:event.identity})).body.principal;
  const originalVersion=t.currentVersionId;
  t=(await call('POST',`/${t.id}/versions`,{principalId:second.id,expectedVersionId:t.currentVersionId,content:editable(t.version.content)})).body.taxonomy;
  assert.equal(t.principalId,second.id);assert.equal(t.version.versionNumber,2);
  assert.equal((await q('SELECT principal_id FROM taxonomy_versions WHERE id=$1',[originalVersion]))[0].principal_id,principal.id);
  const filtered=await service({method:'GET',path:`/organizations/${event.orgId}/taxonomies`,query:{principalId:second.id},identity:event.identity});
  assert.equal(filtered.body.items.length,1);assert.equal(filtered.body.items[0].id,t.id);check('Principal-only save preserves historical assignment and principal filter');
  const old=t.currentVersionId;const changed=editable(t.version.content);changed.basePrice='1.00';
  t=(await call('POST',`/${t.id}/versions`,{expectedVersionId:old,content:changed})).body.taxonomy;
  assert.equal(t.version.versionNumber,3);check('Changed save increments version');
  await assert.rejects(()=>call('POST',`/${t.id}/versions`,{expectedVersionId:old,content:changed}),e=>e.code==='VERSION_CONFLICT');check('Stale save rejected');
  const c=editable(t.version.content);c.segments=Array.from({length:4},(_,i)=>({id:null,placeholder:`S${i}`,name:null,defaultOptionIndex:null,options:Array.from({length:500},(_,j)=>({id:null,code:`C${j}`,description:'x'.repeat(110),price:'0.00'}))}));
  const large=(await call('POST','',{content:c})).body.taxonomy;const largeDocumentBytes=Buffer.byteLength(JSON.stringify(large.version.content));check('2000-option JSON document stored and read');
  await call('POST',`/${t.id}/archive`,{expectedVersionId:t.currentVersionId});
  await assert.rejects(()=>call('POST',`/${t.id}/preview`,{versionId:t.currentVersionId,selections:[]}),e=>e.code==='TAXONOMY_ARCHIVED');check('Archive blocks preview');
  await q('SET CONSTRAINTS ALL IMMEDIATE');check('All deferred constraints validated');
  await q('ROLLBACK');check('Smoke taxonomy fixture rolled back');
  for(const [name,websiteUrl,code] of [[` Smoke ${unique} `,`https://different-${unique}.com`,'PRINCIPAL_NAME_EXISTS'],[`Different ${unique}`,`http://shop.smoke-${unique}.com/path`,'PRINCIPAL_WEBSITE_EXISTS']]){
   await q('BEGIN');
   await principalService({method:'POST',path:`/organizations/${event.orgId}/principals`,body:{name:`Smoke ${unique}`,websiteUrl:`https://smoke-${unique}.com`},identity:event.identity});
   await assert.rejects(()=>principalService({method:'POST',path:`/organizations/${event.orgId}/principals`,body:{name,websiteUrl},identity:event.identity}),e=>e.code===code);
   await q('ROLLBACK');
  }
  check('Independent name and root-domain duplicates rejected and rolled back');
  for(const sql of ['UPDATE principals SET name=name WHERE false','DELETE FROM principals WHERE false','UPDATE taxonomy_versions SET change_summary=change_summary WHERE false','DELETE FROM taxonomy_versions WHERE false','UPDATE taxonomies SET owner_organization_id=owner_organization_id WHERE false','DELETE FROM users WHERE false'])await assert.rejects(()=>q(sql),e=>e.code==='42501');
  check('Runtime forbidden historical/ownership/deletion writes rejected');
  return {status:'passed',checks,largeDocumentBytes};
 }catch(e){await db.query('ROLLBACK').catch(()=>{});return {status:'failed',checks,error:{code:e.code,message:e.message}};}finally{db.release();}
}
