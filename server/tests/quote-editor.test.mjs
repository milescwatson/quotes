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
  let inTransaction = false;
  const enqueued = [];
  const tx = async work => { await db.exec('BEGIN ISOLATION LEVEL REPEATABLE READ'); inTransaction = true; try { const value = await work(db); await db.exec('COMMIT'); inTransaction = false; return value } catch(e) { await db.exec('ROLLBACK'); inTransaction = false; throw e } };
  const enqueueQuotePdf = async message => { assert.equal(inTransaction, false, 'enqueue must follow commit'); enqueued.push(message); };
  const quotes = createIdentityService(tx, { enqueueQuotePdf }), catalog = createTaxonomyService(tx);
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
    await t.test('queue follows committed changes, skips no-ops and failures, and covers owner/archive/restore', async () => {
      const created = (await call(quotes.createQuote, { ...body, lines: [] })).quote;
      assert.deepEqual(enqueued.at(-1), { organizationId: '10', quoteId: created.id });
      const initial = enqueued.length;
      const write = { customerName: created.customerName, projectName: created.projectName, ownerId: created.ownerId, lines: [], expectedToken: created.token };
      assert.equal((await call(quotes.updateQuote, write, created.id)).unchanged, true);
      assert.equal(enqueued.length, initial);
      await reject(() => call(quotes.updateQuote, { ...write, expectedToken: 'stale', projectName: 'Other' }, created.id), 'QUOTE_CONFLICT');
      assert.equal(enqueued.length, initial);
      await call(quotes.updateQuote, { ...write, projectName: 'Other' }, created.id);
      assert.equal(enqueued.length, initial + 1);
      await call(quotes.updateQuoteOwner, { ownerId: '2' }, created.id);
      assert.equal(enqueued.length, initial + 1);
      await call(quotes.updateQuoteOwner, { ownerId: '1' }, created.id);
      assert.equal(enqueued.length, initial + 2);
      await call(quotes.archiveQuote, {}, created.id, 'admin');
      await call(quotes.restoreQuote, {}, created.id, 'admin');
      assert.equal(enqueued.length, initial + 4);
      await db.query('DELETE FROM quotes WHERE id=$1', [created.id]);
      // A transaction that cannot commit must not publish its proposed quote.
      const broken = createIdentityService(async work => { await db.exec('BEGIN'); try { await work(db); throw Error('commit failed'); } finally { await db.exec('ROLLBACK'); } }, { enqueueQuotePdf });
      await assert.rejects(() => call(broken.createQuote, { ...body, lines: [] }), /commit failed/);
      assert.equal(enqueued.length, initial + 4);
    });
    await t.test('PDF URL checks server age, five-minute boundary, token and authorization', async () => {
      const created = (await call(quotes.createQuote, { ...body, lines: [] })).quote;
      await db.query("UPDATE quotes SET modified_when='2026-10-01T00:00:00Z' WHERE id=$1", [created.id]);
      const current = (await call(quotes.readQuote, {}, created.id)).quote;
      let age = 299999;
      const urls = [];
      const service = createIdentityService(tx, { enqueueQuotePdf, now: () => Date.parse(current.modifiedWhen) + age, pdfStorage: { url: async (...args) => { urls.push(args); return 'https://pdf.example/signed'; } } });
      const request = { identity: { issuer: 'test', sub: 'member' }, orgId: '10', quoteId: created.id, query: { expectedToken: current.token, disposition: 'attachment' } };
      assert.deepEqual(await service.readQuotePdfUrl(request), { url: null });
      assert.equal(urls.length, 0);
      age = 300000;
      assert.deepEqual(await service.readQuotePdfUrl(request), { url: 'https://pdf.example/signed' });
      assert.deepEqual(urls[0], ['10', created.id, current.token, 'attachment']);
      age = 300001;
      assert.ok((await service.readQuotePdfUrl(request)).url);
      await reject(() => service.readQuotePdfUrl({ ...request, query: { expectedToken: 'stale' } }), 'QUOTE_CONFLICT');
      await reject(() => service.readQuotePdfUrl({ ...request, query: { ...request.query, disposition: 'bad' } }), 'INVALID_INPUT');
      await reject(() => service.readQuotePdfUrl({ ...request, identity: { issuer: 'test', sub: 'outsider' } }), 'NOT_FOUND');
      await db.exec('UPDATE organization_memberships SET removed_at=now() WHERE organization_id=10 AND user_id=2');
      await reject(() => service.readQuotePdfUrl(request), 'NOT_FOUND');
      await db.exec('UPDATE organization_memberships SET removed_at=NULL WHERE organization_id=10 AND user_id=2');
      await db.query('DELETE FROM quotes WHERE id=$1', [created.id]);
    });
    await t.test('location persists and author survives edits and ownership changes', async () => {
      await db.exec("UPDATE users SET display_name='Miles Watson' WHERE id=2; UPDATE users SET display_name='Other Editor' WHERE id=1");
      const created = (await call(quotes.createQuote, { ...body, lines: [], location: '  Seattle, WA  ' })).quote;
      assert.equal(created.location, 'Seattle, WA');
      assert.equal(created.authorName, 'Miles Watson');
      const update = { customerName: created.customerName, projectName: created.projectName, ownerId: '1', lines: [], location: 'Portland, OR', expectedToken: created.token };
      const edited = (await call(quotes.updateQuote, update, created.id, 'admin')).quote;
      assert.equal(edited.location, 'Portland, OR');
      assert.equal(edited.authorName, 'Miles Watson');
      assert.equal(edited.modifiedByName, 'Other Editor');
      const { location: omitted, ...withoutLocation } = { ...update, expectedToken: edited.token };
      assert.equal((await call(quotes.updateQuote, withoutLocation, created.id, 'admin')).quote.location, 'Portland, OR');
      const cleared = (await call(quotes.updateQuote, { ...withoutLocation, location: '' }, created.id, 'admin')).quote;
      assert.equal(cleared.location, '');
      for (const location of [null, 42, 'x'.repeat(121), 'bad\nlocation']) {
        await assert.rejects(() => call(quotes.createQuote, { ...body, lines: [], location }), e => e.status === 422);
      }
      const legacy = (await call(quotes.readQuote, {}, '100')).quote;
      assert.equal(legacy.location, '');
      assert.equal(legacy.authorName, null);
      await db.query('DELETE FROM quotes WHERE id=$1', [created.id]);
    });
    await t.test('member creates repeated lines and exact cents with leading zero and blank separator',async()=>{
      q = (await call(quotes.createQuote,body)).quote;
      assert.equal(q.lines[0].partNumber,'F01'); assert.equal(q.lines[0].unitPrice,'0.30'); assert.equal(q.total,'1.50');
      assert.equal(q.lines[0].snapshot.principalName,'Acme'); assert.notEqual(q.lines[0].id,q.lines[1].id);
      assert.equal((await call(quotes.listQuotes)).totalItems,2);
    });
    const write = (value=q) => ({customerName:value.customerName,projectName:value.projectName,ownerId:value.ownerId,expectedToken:value.token,lines:value.lines.map(({id,taxonomyId,versionId,selections,quantity})=>({id,taxonomyId,versionId,selections:structuredClone(selections),quantity}))});
    await t.test('line products are immutable and visibility persists without changing snapshots', async () => {
      for (const fields of [{ taxonomyId: '999' }, { versionId: '999' }, { kind: 'regular', regularProductId: '999' }]) {
        const b = write();
        b.lines[0] = fields.kind ? { id: q.lines[0].id, quantity: 1, ...fields } : { ...b.lines[0], ...fields };
        await assert.rejects(() => call(quotes.updateQuote, b, q.id), e => e.status === 422);
      }
      const snapshot = structuredClone(q.lines[0].snapshot);
      const b = write(); b.lines[0].descriptionVisible = false;
      q = (await call(quotes.updateQuote, b, q.id)).quote;
      assert.equal(q.lines[0].descriptionVisible, false);
      q = (await call(quotes.updateQuote, write(), q.id)).quote;
      assert.equal(q.lines[0].descriptionVisible, false);
      assert.deepEqual(q.lines[0].snapshot, snapshot);
      const shown = write(); shown.lines[0].descriptionVisible = true;
      q = (await call(quotes.updateQuote, shown, q.id)).quote;
      assert.equal(q.lines[0].descriptionVisible, true);
      const invalid = write(); invalid.lines[0].descriptionVisible = 'false';
      await assert.rejects(() => call(quotes.updateQuote, invalid, q.id), e => e.status === 422);
    });
    await t.test('formatted descriptions are quote-specific, preserved when omitted, and cleared explicitly', async () => {
      const snapshot = structuredClone(q.lines[0].snapshot);
      const runs = [{ text: 'Edited ', bold: true }, { text: 'description\nSecond line', italic: true, underline: true }];
      const b = write(); b.lines[0].descriptionContent = runs; b.lines[0].descriptionVisible = false;
      q = (await call(quotes.updateQuote, b, q.id)).quote;
      assert.deepEqual(q.lines[0].descriptionContent, runs);
      assert.deepEqual(q.lines[0].snapshot, snapshot);
      q = (await call(quotes.updateQuote, write(), q.id)).quote;
      assert.deepEqual(q.lines[0].descriptionContent, runs);
      const shown = write(); shown.lines[0].descriptionVisible = true;
      q = (await call(quotes.updateQuote, shown, q.id)).quote;
      assert.deepEqual(q.lines[0].descriptionContent, runs);
      for (const descriptionContent of [null, 'html', [{ text: 'x', html: '<b>x</b>' }], [{ text: 'x', bold: 'true' }], [{ text: 'x'.repeat(5001) }], [{ text: 'bad\u0000text' }], [{ text: '' }]]) {
        const invalid = write(); invalid.lines[0].descriptionContent = descriptionContent;
        await assert.rejects(() => call(quotes.updateQuote, invalid, q.id), e => e.status === 422);
      }
      const clear = write(); clear.lines[0].descriptionContent = [];
      q = (await call(quotes.updateQuote, clear, q.id)).quote;
      assert.deepEqual(q.lines[0].descriptionContent, []);
    });
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
      try { const empty=await call(quotes.createQuote,{...body,lines:[],location:'Job site'}); assert.equal(empty.quote.ownerId,'2'); assert.equal(empty.quote.location,'Job site'); await assert.rejects(()=>db.exec('UPDATE quotes SET created_by_user_id=1'),e=>e.code==='42501'); await assert.rejects(()=>db.exec('DELETE FROM quotes'),e=>e.code==='42501') } finally { await db.exec('RESET ROLE') }
    });
    await t.test('removed membership and disabled account lose quote read/write access',async()=>{
      await db.exec('UPDATE organization_memberships SET removed_at=now() WHERE user_id=2');
      await reject(()=>call(quotes.readQuote,{},q.id),'NOT_FOUND'); await reject(()=>call(quotes.createQuote,{...body,lines:[]}),'NOT_FOUND');
      await db.exec('UPDATE users SET disabled_at=now() WHERE id=2'); await reject(()=>call(quotes.readQuote,{},q.id),'ACCOUNT_DISABLED');
    });
  } finally { await db.close() }
});
