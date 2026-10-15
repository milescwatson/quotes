import test from 'node:test';
import assert from 'node:assert/strict';
import { readTestFile as readFile } from './schema.mjs';
import { PGlite } from '@electric-sql/pglite';
import { createIdentityService } from '../identity.mjs';
import { createTaxonomyService } from '../taxonomy.mjs';
const read = p => readFile(new URL(`../../database/${p}`,import.meta.url),'utf8');
const input = { productFamilyName:'F Series',currency:'USD',basePrice:'0.10',separators:[''],segments:[
  {id:null,placeholder:'F',name:null,defaultOptionIndex:null,options:[{id:null,code:'F',description:null,price:'0'}]},
  {id:null,placeholder:'XX',name:'Size',defaultOptionIndex:0,options:[{id:null,code:'01',description:'Small',price:'0.20'},{id:null,code:'02',description:'Large',price:'0.30'}]},
] };
test('quote creation, partial options, snapshots, authorization, atomic validation and concurrency',async t => {
  const db = new PGlite();
  const tx = async work => { await db.exec('BEGIN ISOLATION LEVEL REPEATABLE READ'); try { const value = await work(db); await db.exec('COMMIT'); return value } catch(e) { await db.exec('ROLLBACK'); throw e } };
  const quotes = createIdentityService(tx), catalog = createTaxonomyService(tx);
  const call = (fn,body={},quoteId,sub='member',orgId='10') => fn({identity:{issuer:'test',sub},orgId,quoteId,body});
  const reject = (fn,code) => assert.rejects(fn,e => e.code === code);
  try {
    for (const p of ['versions/0001/identity/schema.sql','versions/0001/quotes/schema.sql','versions/0002/taxonomy/schema.sql','versions/0003/principals/schema.sql']) await db.exec((await read(p)).replaceAll('INDEX ASYNC','INDEX').replaceAll('ALTER TABLE ASYNC','ALTER TABLE'));
    await db.exec(`INSERT INTO users(id,cognito_issuer,cognito_subject,email,normalized_email) VALUES(1,'test','admin','a@example.com','a@example.com'),(2,'test','member','m@example.com','m@example.com'),(3,'test','outsider','o@example.com','o@example.com');
      INSERT INTO organizations(id,name,status) VALUES(10,'Org','active'),(11,'Other','active');
      INSERT INTO organization_memberships(organization_id,user_id,role) VALUES(10,1,'administrator'),(10,2,'sales'),(11,3,'administrator');
      INSERT INTO principals(id,name,normalized_name,website_url,website_key,created_by_user_id) VALUES(1,'Acme','acme','https://acme.com','acme.com',1);
      INSERT INTO quotes(id,organization_id,customer_name,project_name,modified_by) VALUES(100,10,'Legacy','Project',1);`);
    await db.exec(await read('versions/0004/quotes/schema.sql'));
    await db.exec(await read('versions/0004/quotes/backfill.sql'));
    await db.exec((await read('versions/0004/quotes/enforce.sql')).replaceAll('ALTER TABLE ASYNC','ALTER TABLE'));
    assert.deepEqual((await call(quotes.readQuote,{},'100')).quote.lines,[]);
    const product = (await call(catalog.createTaxonomy,{principalId:'1',content:input},undefined,'admin')).body.taxonomy;
    const source = product.version.content;
    const line = { id:null,taxonomyId:product.id,versionId:product.version.id,selections:source.segments.map(s=>s.options[0].id),quantity:3 };
    const body = {customerName:'Customer',projectName:'Project',ownerId:'2',lines:[line,{...line,quantity:2}]};
    let q;
    await t.test('member creates repeated lines and exact cents with leading zero and blank separator',async()=>{
      q = (await call(quotes.createQuote,body)).quote;
      assert.equal(q.lines[0].partNumber,'F01'); assert.equal(q.lines[0].unitPrice,'0.30'); assert.equal(q.total,'1.50');
      assert.equal(q.lines[0].snapshot.principalName,'Acme'); assert.notEqual(q.lines[0].id,q.lines[1].id);
      assert.equal((await call(quotes.listQuotes)).totalItems,2);
    });
    const write = (value=q) => ({customerName:value.customerName,projectName:value.projectName,ownerId:value.ownerId,expectedToken:value.token,lines:value.lines.map(({id,taxonomyId,versionId,selections,quantity})=>({id,taxonomyId,versionId,selections:structuredClone(selections),quantity}))});
    await t.test('PDF exports saved snapshots with membership and concurrency checks', async () => {
      const request = { identity: { issuer: 'test', sub: 'member' }, orgId: '10', quoteId: q.id, query: { expectedToken: q.token } };
      const result = await quotes.readQuotePdf(request);
      assert.equal(result.pdf.subarray(0, 5).toString(), '%PDF-');
      await reject(() => quotes.readQuotePdf({ ...request, query: { expectedToken: 'stale' } }), 'QUOTE_CONFLICT');
      await reject(() => quotes.readQuotePdf({ ...request, query: { expectedToken: q.token, disposition: 'bad' } }), 'INVALID_INPUT');
      await reject(() => quotes.readQuotePdf({ ...request, identity: { issuer: 'test', sub: 'outsider' } }), 'NOT_FOUND');
      await db.exec('UPDATE organization_memberships SET removed_at=now() WHERE organization_id=10 AND user_id=2');
      await reject(() => quotes.readQuotePdf(request), 'NOT_FOUND');
      await db.exec('UPDATE organization_memberships SET removed_at=NULL WHERE organization_id=10 AND user_id=2');
      await db.exec('UPDATE users SET disabled_at=now() WHERE id=2');
      await reject(() => quotes.readQuotePdf(request), 'ACCOUNT_DISABLED');
      await db.exec('UPDATE users SET disabled_at=NULL WHERE id=2');
      await db.exec('UPDATE quotes SET archived_at=now() WHERE id='+q.id);
      assert.ok((await quotes.readQuotePdf(request)).pdf.length > 0);
      await db.exec('UPDATE quotes SET archived_at=NULL WHERE id='+q.id);
    });
    await t.test('no-op leaves metadata intact; empty selections and zero lines are savable',async()=>{
      assert.equal((await call(quotes.updateQuote,write(),q.id)).unchanged,true);
      const b=write(); b.lines[0].selections[1]=null;
      q=(await call(quotes.updateQuote,b,q.id)).quote;
      assert.equal(q.lines[0].partNumber,'FXX'); assert.equal(q.lines[0].complete,false); assert.equal(q.total,'0.90');
      const empty=(await call(quotes.createQuote,{...body,lines:[]})).quote;
      assert.equal(empty.total,'0.00'); assert.deepEqual(empty.lines,[]);
    });
    await t.test('saved options and prices remain editable after catalog change and archive',async()=>{
      const changed={...input,basePrice:'10.00',segments:source.segments.map(s=>({...s,defaultOptionIndex:null,options:s.options.map(o=>({...o,price:'5.00'}))}))};
      for(const s of changed.segments) delete s.defaultOptionId;
      await catalog.saveTaxonomyVersion({ identity: {issuer:'test',sub:'admin'},orgId:'10',taxonomyId:product.id,body:{principalId:'1',expectedVersionId:product.version.id,content:changed} });
    });
    await reject(()=>call(quotes.createQuote,body),'CONFIGURATION_CHANGED');
    const high = structuredClone(input); high.basePrice = '999999999999.99'; high.segments.forEach(s => s.options.forEach(o => o.price = '0.00'));
    const expensive = (await call(catalog.createTaxonomy,{principalId:'1',content:high},undefined,'admin')).body.taxonomy;
    await assert.rejects(()=>call(quotes.createQuote,{...body,lines:[{id:null,taxonomyId:expensive.id,versionId:expensive.version.id,selections:expensive.version.content.segments.map(s=>s.options[0].id),quantity:2}]}),e=>e.status===422);
    await db.query('UPDATE taxonomies SET archived_at=now(),archived_by_user_id=1 WHERE id=$1',[product.id]);
    const forbidden=write(); forbidden.lines[0].selections[1]=source.segments[1].options[1].id; await reject(()=>call(quotes.updateQuote,forbidden,q.id),'CONFIGURATION_CHANGED');
    const historical=write(); historical.lines[0].quantity=4;
    q=(await call(quotes.updateQuote,historical,q.id)).quote;
    assert.equal(q.lines[0].partNumber,'FXX'); assert.equal(q.lines[0].unitPrice,'0.10'); assert.equal(q.total,'1.00');
    await t.test('new archived/stale sources fail while existing snapshots remain readable',async()=>{
      await reject(()=>call(quotes.createQuote,body),'CONFIGURATION_CHANGED');
      assert.equal((await call(quotes.readQuote,{},q.id)).quote.lines[0].versionId,product.version.id);
    });
    await t.test('validation failures are atomic and reject forged options, line IDs, quantity and owner',async()=>{
      for(const mutate of [b=>b.lines[0].selections[0]='foreign',b=>b.lines[0].id='foreign',b=>b.lines[0].quantity=0,b=>b.lines[0].quantity=1.2,b=>b.ownerId='3',b=>b.lines.push({...b.lines[0]})]) {
        const b=write(); mutate(b); await assert.rejects(()=>call(quotes.updateQuote,b,q.id),e=>e.status===422);
        assert.equal((await call(quotes.readQuote,{},q.id)).quote.token,q.token);
      }
      await reject(()=>call(quotes.readQuote,{},q.id,'outsider'),'NOT_FOUND');
      await reject(()=>call(quotes.updateQuote,write(),q.id,'outsider','11'),'NOT_FOUND');
      await db.query('UPDATE taxonomies SET owner_organization_id=11,archived_at=NULL,archived_by_user_id=NULL WHERE id=$1',[product.id]);
      await assert.rejects(()=>call(quotes.createQuote,body),e=>e.status===422);
    });
    await t.test('list ownership changes invalidate full saves without overwriting input',async()=>{
      const stale=write(); await call(quotes.updateQuoteOwner,{ownerId:'1'},q.id);
      await reject(()=>call(quotes.updateQuote,stale,q.id),'QUOTE_CONFLICT');
      assert.equal((await call(quotes.readQuote,{},q.id)).quote.ownerId,'1');
    });
    await t.test('runtime grants support full saves and preserve delete restrictions',async()=>{
      await db.exec('CREATE ROLE quote_runtime; CREATE ROLE quote_operator;');
      for(const p of ['versions/0001/identity/permissions.sql','versions/0001/quotes/permissions.sql','versions/0002/taxonomy/permissions.sql','versions/0003/principals/permissions.sql','versions/0004/quotes/permissions.sql']) await db.exec((await read(p)).replaceAll(':"api_role"','quote_runtime').replaceAll(':"operator_role"','quote_operator'));
      await db.exec('SET ROLE quote_runtime');
      try { const empty=await call(quotes.createQuote,{...body,lines:[]}); assert.equal(empty.quote.ownerId,'2'); await assert.rejects(()=>db.exec('DELETE FROM quotes'),e=>e.code==='42501') } finally { await db.exec('RESET ROLE') }
    });
    await t.test('removed membership and disabled account lose quote read/write access',async()=>{
      await db.exec('UPDATE organization_memberships SET removed_at=now() WHERE user_id=2');
      await reject(()=>call(quotes.readQuote,{},q.id),'NOT_FOUND'); await reject(()=>call(quotes.createQuote,{...body,lines:[]}),'NOT_FOUND');
      await db.exec('UPDATE users SET disabled_at=now() WHERE id=2'); await reject(()=>call(quotes.readQuote,{},q.id),'ACCOUNT_DISABLED');
    });
  } finally { await db.close() }
});
