// Dedicated development verification Lambda. Uses the real restricted runtime role.
import assert from 'node:assert/strict';
import { getPool, transactions } from '../database.mjs';
import { createIdentityService } from '../identity.mjs';
import { createTaxonomyService } from '../taxonomy.mjs';
import { createPrincipalService } from '../principals.mjs';
export async function handler(event) {
  const pool=getPool(), tx=transactions(pool,{attempts:1}), quotes=createIdentityService(tx), catalog=createTaxonomyService(tx), principals=createPrincipalService(tx);
  const checks=[], context={orgId:event.orgId,identity:event.identity};
  const principal=(await principals.createPrincipal({...context,body:{name:`Quote smoke ${event.runId}`,websiteUrl:`https://quote-smoke-${event.runId}.com`}})).body.principal;
  const content={productFamilyName:'Quote smoke product',currency:'USD',basePrice:'0.10',separators:[''],segments:[
    {id:null,placeholder:'F',name:null,defaultOptionIndex:null,options:[{id:null,code:'F',description:'Fixed',price:'0.00'}]},
    {id:null,placeholder:'XX',name:'Size',defaultOptionIndex:0,options:[{id:null,code:'01',description:'Small',price:'0.20'},{id:null,code:'02',description:'Large',price:'0.30'}]},
  ]};
  const product=(await catalog.createTaxonomy({...context,body:{principalId:principal.id,content}})).body.taxonomy;
  const line={id:null,taxonomyId:product.id,versionId:product.version.id,selections:product.version.content.segments.map(s=>s.options[0].id),quantity:3};
  const member={...context,identity:event.memberIdentity};
  let quote=(await quotes.createQuote({...member,body:{customerName:'Quote deployment smoke',projectName:event.runId,ownerId:event.memberId,lines:[line,{...line,quantity:2}]}})).quote;
  assert.equal(quote.total,'1.50'); assert.equal(quote.lines[0].partNumber,'F01'); assert.equal(quote.lines[0].unitPrice,'0.30'); checks.push('Member creation, repeated lines, exact cents, leading zeroes and blank separator');
  assert.deepEqual((await quotes.readQuote({...member,quoteId:quote.id})).quote,quote); checks.push('Persisted quote detail and snapshot read');
  const body=()=>({customerName:quote.customerName,projectName:quote.projectName,ownerId:quote.ownerId,expectedToken:quote.token,lines:quote.lines.map(({id,taxonomyId,versionId,selections,quantity})=>({id,taxonomyId,versionId,selections,quantity}))});
  assert.equal((await quotes.updateQuote({...member,quoteId:quote.id,body:body()})).unchanged,true); checks.push('No-op preserves modification token');
  let update=body(); update.lines[0].selections[1]=null;
  quote=(await quotes.updateQuote({...member,quoteId:quote.id,body:update})).quote; assert.equal(quote.total,'0.90'); assert.equal(quote.lines[0].complete,false); checks.push('Blank selections persist with partial estimates');
  const stale=body(); await quotes.updateQuoteOwner({...context,quoteId:quote.id,body:{ownerId:event.adminId}});
  await assert.rejects(()=>quotes.updateQuote({...member,quoteId:quote.id,body:stale}),e=>e.code==='QUOTE_CONFLICT'); checks.push('List owner changes invalidate full-save token');
  quote=(await quotes.readQuote({...member,quoteId:quote.id})).quote;
  const changed={...content,basePrice:'10.00',segments:product.version.content.segments.map(s=>({id:s.id,placeholder:s.placeholder,name:s.name,defaultOptionIndex:null,options:s.options.map(o=>({...o,price:'5.00'}))}))};
  const newer=(await catalog.saveTaxonomyVersion({...context,taxonomyId:product.id,body:{principalId:principal.id,expectedVersionId:product.version.id,content:changed}})).body.taxonomy;
  await assert.rejects(()=>quotes.createQuote({...member,body:{customerName:'Stale',projectName:'Preview',ownerId:null,lines:[line]}}),e=>e.code==='CONFIGURATION_CHANGED'); checks.push('Stale catalog previews rejected');
  await catalog.archiveTaxonomy({...context,taxonomyId:product.id,body:{expectedVersionId:newer.currentVersionId}});
  update=body(); update.lines[0].selections[1]=product.version.content.segments[1].options[1].id; update.lines[0].quantity=4;
  quote=(await quotes.updateQuote({...member,quoteId:quote.id,body:update})).quote;
  assert.equal(quote.lines[0].unitPrice,'0.40'); assert.equal(quote.total,'2.20'); checks.push('Historical version choices and prices survive changes and archive');
  update=body(); update.lines[0].selections[0]='foreign';
  await assert.rejects(()=>quotes.updateQuote({...member,quoteId:quote.id,body:update}),e=>e.status===422); assert.equal((await quotes.readQuote({...member,quoteId:quote.id})).quote.token,quote.token); checks.push('Invalid selections roll back atomically');
  const empty=(await quotes.createQuote({...member,body:{customerName:'Empty',projectName:'Quote',ownerId:null,lines:[]}})).quote; assert.equal(empty.total,'0.00'); checks.push('Empty quote persistence');
  await assert.rejects(()=>quotes.readQuote({...member,orgId:event.otherOrgId,quoteId:quote.id}),e=>e.status===404); checks.push('Organization isolation');
  const client=await pool.connect();
  try { await client.query('BEGIN'); await assert.rejects(()=>client.query('DELETE FROM public.quotes WHERE id=$1',[quote.id]),e=>e.code==='42501'); } finally { await client.query('ROLLBACK'); client.release() }
  checks.push('Runtime quote deletion denied');
  return {status:'passed',checks,quoteId:quote.id,emptyQuoteId:empty.id,productId:product.id,principalId:principal.id};
}
