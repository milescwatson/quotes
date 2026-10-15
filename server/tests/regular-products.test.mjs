import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readTestFile } from './schema.mjs';
import { createRegularProductService } from '../regular-products.mjs';
import { createQuoteService } from '../quotes.mjs';
import { createTaxonomyService } from '../taxonomy.mjs';
import { multiple, netAmount } from '../quote-pricing.mjs';

test('multiples compound with exact half-up rounding and bounded validation', () => {
  assert.equal(netAmount('0.01', 0.5, { multiple: 1 }), '0.01');
  assert.equal(netAmount('0.03', 0.5, { multiple: 0.5 }), '0.01');
  assert.equal(netAmount('100.00', 0.8, { multiple: 0.5 }), '40.00');
  assert.equal(netAmount('100.00', 0, { multiple: 1000 }), '0.00');
  for (const value of [-1, 1001, NaN, Infinity, 0.00001, '1', null]) assert.throws(() => multiple(value), e => e.status === 422);
});

test('regular catalog authorization, mixed snapshots, shared parents and restricted grants', async t => {
  const db = new PGlite(), tx = work => db.transaction(work);
  const products = createRegularProductService(tx), quotes = createQuoteService(tx), taxonomies = createTaxonomyService(tx);
  const call = (fn, body = {}, extra = {}) => fn({ identity: { issuer:'test',sub:'admin' },orgId:'10',body,...extra });
  const reject = (fn, code) => assert.rejects(fn, e => e.code === code);
  try {
    for (const file of ['0001/identity/schema.sql','0001/quotes/schema.sql','0002/taxonomy/schema.sql','0003/principals/schema.sql','0004/quotes/schema.sql','0004/quotes/backfill.sql','0004/quotes/enforce.sql']) await db.exec((await readTestFile(new URL(`../../database/versions/${file}`,import.meta.url))).replaceAll('INDEX ASYNC','INDEX').replaceAll('ALTER TABLE ASYNC','ALTER TABLE'));
    await db.exec(`INSERT INTO users(id,cognito_issuer,cognito_subject,email,normalized_email) VALUES(1,'test','admin','a@example.com','a@example.com'),(2,'test','sales','s@example.com','s@example.com'),(3,'test','outside','o@example.com','o@example.com');
      INSERT INTO organizations(id,name,status) VALUES(10,'Main','active'),(11,'Other','active');
      INSERT INTO organization_memberships(organization_id,user_id,role) VALUES(10,1,'administrator'),(10,2,'sales'),(11,3,'administrator');
      INSERT INTO principals(id,name,normalized_name,website_url,website_key,created_by_user_id) VALUES(1,'Maker','maker','https://maker.com','maker.com',1);`);
    const configured=(await call(taxonomies.createTaxonomy,{principalId:'1',content:{productFamilyName:'Configured',currency:'USD',basePrice:'10.00',segments:[{id:null,placeholder:'C',name:null,defaultOptionIndex:null,options:[{id:null,code:'C',description:null,price:'0.00'}]}]}})).body.taxonomy;
    const fields={partNumber:' 001-A ',description:'Standalone',listPrice:'12.50',principalId:'1',parentTaxonomyId:configured.id};
    let product=(await call(products.save,fields)).product;
    await t.test('validation, uniqueness, concurrency and organization roles',async()=>{
      assert.equal(product.partNumber,'001-A');assert.equal(product.principalId,'1');assert.equal(product.principalName,'Maker');
      assert.equal((await call(products.list,{}, {identity:{issuer:'test',sub:'sales'}})).items.length,1);
      await reject(()=>call(products.save,fields,{identity:{issuer:'test',sub:'sales'}}),'FORBIDDEN');
      await reject(()=>call(products.save,fields),'PRODUCT_DUPLICATE');
      await reject(()=>call(products.save,{...fields,partNumber:'New',parentTaxonomyId:'999'}),'INVALID_INPUT');
      await reject(()=>call(products.save,{...fields,expectedToken:'stale'},{productId:product.id}),'PRODUCT_CONFLICT');
      await reject(()=>call(products.save,{...fields,expectedToken:product.token},{productId:product.id,orgId:'11',identity:{issuer:'test',sub:'outside'}}),'NOT_FOUND');
      for(const change of [{partNumber:''},{listPrice:'-1'},{listPrice:'1.234'},{description:'\n'},{parentTaxonomyId:'undefined'},{parentTaxonomyId:'null'},{principalId:'999'},{principalId:'bad'}]) await reject(()=>call(products.save,{...fields,...change}),'INVALID_INPUT');
    });
    const body={customerName:'Acme',projectName:'Office',ownerId:null,multiple:0.8,lines:[
      {id:null,taxonomyId:configured.id,versionId:configured.version.id,selections:[configured.version.content.segments[0].options[0].id],quantity:2,multiple:0.5},
      {id:null,kind:'regular',regularProductId:product.id,quantity:3,multiple:0.5},
      {id:null,kind:'freeform',partNumber:' 000-X ',description:'Custom',listPrice:'0.03',quantity:1,multiple:0.5},
    ]};
    let quote;
    const write=()=>({...body,expectedToken:quote.token,lines:body.lines.map((l,i)=>({...l,id:quote.lines[i].id}))});
    await t.test('mixed lines, exact totals, no-op save and historical catalog pricing',async()=>{
      quote=(await call(quotes.createQuote,body,{identity:{issuer:'test',sub:'sales'}})).quote;
      assert.equal(quote.lines[1].snapshot.principalId,'1');assert.equal(quote.lines[1].snapshot.principalName,'Maker');
      assert.equal(quote.listTotal,'57.53');assert.equal(quote.total,'23.01');assert.equal(quote.lines[2].partNumber,'000-X');
      assert.equal((await call(quotes.updateQuote,write(),{quoteId:quote.id})).unchanged,true);
      product=(await call(products.save,{...fields,principalId:null,listPrice:'99.00',expectedToken:product.token},{productId:product.id})).product;
      const b=write();b.lines[1].quantity=4;quote=(await call(quotes.updateQuote,b,{quoteId:quote.id})).quote;
      assert.equal(quote.lines[1].snapshot.principalName,'Maker');assert.equal(quote.lines[1].unitPrice,'12.50');assert.equal(quote.total,'28.01');
      assert.equal((await call(quotes.createQuote,{...body,lines:[body.lines[1]]})).quote.lines[0].unitPrice,'99.00');
    });
    await t.test('omitted principal keeps assignments and explicit null clears them', async () => {
      let p=(await call(products.save,{...fields,partNumber:'Principal test',parentTaxonomyId:null})).product;
      const legacy={...fields,partNumber:p.partNumber,parentTaxonomyId:null,expectedToken:p.token};delete legacy.principalId;
      p=(await call(products.save,legacy,{productId:p.id})).product;assert.equal(p.principalId,'1');
      p=(await call(products.save,{...legacy,principalId:null,expectedToken:p.token},{productId:p.id})).product;assert.equal(p.principalId,null);
    });
    await t.test('parent archive retention and sharing access',async()=>{
      await db.query('UPDATE taxonomies SET archived_at=now(),archived_by_user_id=1 WHERE id=$1',[configured.id]);
      product=(await call(products.save,{...fields,listPrice:product.listPrice,expectedToken:product.token},{productId:product.id})).product;
      await reject(()=>call(products.save,{...fields,partNumber:'New'}),'INVALID_INPUT');
      await db.query('UPDATE taxonomies SET archived_at=NULL,archived_by_user_id=NULL,owner_organization_id=11 WHERE id=$1',[configured.id]);
      await reject(()=>call(products.save,{...fields,partNumber:'New'}),'INVALID_INPUT');
      await db.query('INSERT INTO taxonomy_organization_access(taxonomy_id,organization_id) VALUES($1,10)',[configured.id]);
      assert.equal((await call(products.save,{...fields,partNumber:'Shared'})).product.parentTaxonomyId,configured.id);
    });
    await t.test('atomic validation, zero factors, overflow and legacy defaults',async()=>{
      for(const mutate of [b=>b.multiple=-1,b=>b.lines[0].multiple=1.00001,b=>b.lines[0].multipleMode='override',b=>b.lines[1].regularProductId='999',b=>{b.lines[2].listPrice='999999999999.99';b.lines[2].quantity=2},b=>b.lines[2].listPrice='oops']) {
        const b=structuredClone(body);mutate(b);await reject(()=>call(quotes.createQuote,b),'INVALID_INPUT');
      }
      assert.equal((await call(quotes.createQuote,{...body,multiple:0})).quote.total,'0.00');
      const old={customerName:'Old',projectName:'Legacy',ownerId:null,lines:[]};const legacy=(await call(quotes.createQuote,old)).quote;
      assert.equal(legacy.multiple,1);assert.equal((await call(quotes.updateQuote,{...old,expectedToken:legacy.token},{quoteId:legacy.id})).unchanged,true);
    });
    await t.test('runtime writes and denied catalog deletion',async()=>{
      await db.exec('CREATE ROLE product_api;CREATE ROLE product_operator;');
      for(const file of ['0001/identity/permissions.sql','0001/quotes/permissions.sql','0002/taxonomy/permissions.sql','0003/principals/permissions.sql','0004/quotes/permissions.sql']) await db.exec((await readTestFile(new URL(`../../database/versions/${file}`,import.meta.url))).replaceAll(':"api_role"','product_api').replaceAll(':"operator_role"','product_operator'));
      await db.exec('SET ROLE product_api');
      try { const p=(await call(products.save,{...fields,partNumber:'Runtime',parentTaxonomyId:null})).product;assert.ok((await call(quotes.createQuote,{...body,lines:[{id:null,kind:'regular',regularProductId:p.id,quantity:1}]})).quote.id);await assert.rejects(()=>db.exec('DELETE FROM regular_products'),e=>e.code==='42501'); } finally {await db.exec('RESET ROLE')}
    });
  } finally {await db.close()}
});
