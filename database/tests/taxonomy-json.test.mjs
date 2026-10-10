import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { PGlite } = await import(process.env.PGLITE_MODULE ?? '@electric-sql/pglite');
const read = path => readFile(new URL(path, import.meta.url), 'utf8');
test('JSON taxonomy schema rejects invalid format, pointers, duplicate versions and historical writes', async () => {
 const db = new PGlite();
 const tx=async work=>{await db.exec('BEGIN');try{const r=await work();await db.exec('COMMIT');return r;}catch(e){await db.exec('ROLLBACK');throw e;}};
 try {
  await db.exec((await read('../versions/0001/identity/schema.sql')).replaceAll('INDEX ASYNC','INDEX'));
  const schema=await read('../versions/0002/taxonomy/schema.sql');
  await db.exec(schema.replaceAll('INDEX ASYNC','INDEX').replaceAll('ALTER TABLE ASYNC','ALTER TABLE'));
  await db.exec(`INSERT INTO users(id,cognito_issuer,cognito_subject,email,normalized_email) VALUES(1,'test','test','a@b.com','a@b.com'); INSERT INTO organizations(id,name,status) VALUES(1,'Test','active');`);
  const content={schemaVersion:1,productFamilyName:'Test',basePrice:'0.00',currency:'USD',segments:[{id:'segment',placeholder:'A',name:null,defaultOptionId:null,options:[{id:'option',code:'01',description:null,price:'0.10'}]}]};
  await tx(async()=>{
   await db.exec('INSERT INTO taxonomies(id,owner_organization_id,current_version_id,created_by_user_id) VALUES(1,1,1,1)');
   await db.query('INSERT INTO taxonomy_versions(id,taxonomy_id,version_number,content,created_by_user_id) VALUES(1,1,1,$1,1)',[JSON.stringify(content)]);
  });
  assert.deepEqual((await db.query('SELECT content FROM taxonomy_versions WHERE id=1')).rows[0].content,content);
  for(const bad of [{},{schemaVersion:2,segments:[]},{schemaVersion:1,segments:{}},[]])
   await assert.rejects(()=>db.query('INSERT INTO taxonomy_versions(taxonomy_id,version_number,content,created_by_user_id) VALUES(1,2,$1,1)',[JSON.stringify(bad)]),e=>e.code==='23514');
  await assert.rejects(()=>tx(()=>db.exec('UPDATE taxonomies SET current_version_id=999 WHERE id=1')),e=>e.code==='23503');
  await assert.rejects(()=>db.exec('UPDATE taxonomies SET archived_at=now() WHERE id=1'),e=>e.code==='23514');
  await assert.rejects(()=>db.query('INSERT INTO taxonomy_versions(taxonomy_id,version_number,content,created_by_user_id) VALUES(1,1,$1,1)',[JSON.stringify(content)]),e=>e.code==='23505');
  await db.exec('CREATE ROLE json_api; CREATE ROLE json_operator');
  await db.exec((await read('../versions/0002/taxonomy/permissions.sql')).replaceAll(':"api_role"','json_api').replaceAll(':"operator_role"','json_operator'));
  await db.exec('SET ROLE json_api');
  try{for(const sql of ['UPDATE taxonomy_versions SET content=content','DELETE FROM taxonomy_versions','TRUNCATE taxonomy_versions','UPDATE taxonomies SET owner_organization_id=1'])await assert.rejects(()=>db.exec(sql),e=>e.code==='42501');}
  finally{await db.exec('RESET ROLE');}
  await assert.rejects(()=>db.exec(schema.replaceAll('INDEX ASYNC','INDEX').replaceAll('ALTER TABLE ASYNC','ALTER TABLE')),e=>e.code==='42P07');
 } finally {await db.close();}
});
