import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('0006 preserves legacy quotes and enforces catalog uniqueness and price/multiple ranges', async () => {
  const db=new PGlite();
  const apply=async path=>db.exec((await readFile(new URL(`../versions/${path}`,import.meta.url),'utf8')).replaceAll('INDEX ASYNC','INDEX').replaceAll('ALTER TABLE ASYNC','ALTER TABLE'));
  try {
    for(const p of ['0001/identity/schema.sql','0001/quotes/schema.sql','0002/taxonomy/schema.sql']) await apply(p);
    await db.exec(`INSERT INTO users(id,cognito_issuer,cognito_subject,email,normalized_email) VALUES(1,'test','admin','a@example.com','a@example.com');
      INSERT INTO organizations(id,name,status) VALUES(10,'Main','active'),(11,'Other','active');
      INSERT INTO quotes(id,organization_id,customer_name,project_name,modified_by) VALUES(1,10,'Old','Legacy',1);`);
    const before=(await db.query('SELECT * FROM quotes')).rows[0];
    for (const file of ['schema','backfill','enforce']) await apply(`0006/products/${file}.sql`);
    const {multiple,...after}=(await db.query('SELECT * FROM quotes')).rows[0];
    assert.equal(multiple,'1.0000');assert.deepEqual(after,before);
    const insert='INSERT INTO regular_products(organization_id,part_number,list_price) VALUES($1,$2,$3)';
    await db.query(insert,[10,'0001','12.50']);await db.query(insert,[11,'0001','12.50']);
    await assert.rejects(()=>db.query(insert,[10,'0001','12.50']),e=>e.code==='23505');
    for(const [part,price] of [['','1'],[' space ','1'],['X','-0.01']]) await assert.rejects(()=>db.query(insert,[10,part,price]),e=>e.code==='23514');
    await assert.rejects(()=>db.query('UPDATE quotes SET multiple=-1'),e=>e.code==='23514');
    await assert.rejects(()=>db.query('UPDATE quotes SET multiple=1001'),e=>e.code==='23514');
    await assert.rejects(()=>db.query('UPDATE quotes SET multiple=NULL'),e=>e.code==='23514');
    await db.query('UPDATE quotes SET multiple=0');await db.query('UPDATE quotes SET multiple=1000');
  } finally {await db.close()}
});
