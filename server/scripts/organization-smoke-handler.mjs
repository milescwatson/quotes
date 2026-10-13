// Temporary IAM-role Lambda only. Every fixture/write is rolled back in one transaction.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { getPool } from '../database.mjs';
import { createIdentityService } from '../identity.mjs';
import { createTaxonomyService } from '../taxonomy.mjs';
import { createPrincipalService } from '../principals.mjs';
export async function verifyOrganizationDatabase(db) {
  const runId=randomUUID(), issuer=`https://validation.invalid/${runId}`, checks=[];
  const q=async(sql,args=[]) => (await db.query(sql,args)).rows;
  const tx=work=>work(db), identity=createIdentityService(tx), taxonomies=createTaxonomyService(tx), principals=createPrincipalService(tx);
  const actor={issuer,sub:'super',email:'mc.watson415@gmail.com'}, sales={issuer,sub:'sales',email:'sales@gmail.com'};
  const input=(who,orgId,body={})=>({identity:who,orgId,body,requestId:runId});
  try {
    assert.equal((await q('SELECT current_user'))[0].current_user,'quotes_api');checks.push('IAM-authenticated restricted runtime connection');
    await q('BEGIN ISOLATION LEVEL REPEATABLE READ');
    const superUser=(await q('INSERT INTO users(cognito_issuer,cognito_subject,email,normalized_email) VALUES($1,$2,$3,$3) RETURNING id',[issuer,actor.sub,actor.email]))[0];
    const salesUser=(await identity.bootstrapProfile({...input(sales),body:{}})).user;
    const owner=(await q("INSERT INTO organizations(name,status) VALUES($1,'active') RETURNING id",[`Validation owner ${runId}`]))[0].id;
    const recipient=(await q("INSERT INTO organizations(name,status) VALUES($1,'active') RETURNING id",[`Validation recipient ${runId}`]))[0].id;
    await q("INSERT INTO organization_memberships(organization_id,user_id,role) VALUES($1,$2,'sales'),($3,$2,'sales')",[owner,salesUser.id,recipient]);
    await assert.rejects(()=>identity.updateOrganization({...input(sales,owner,{name:'Forbidden'})}),{code:'FORBIDDEN'});
    await identity.updateOrganization(input(actor,owner,{address:'100 Main St',email:'company@example.com',websiteUrl:'https://example.com',phone:'555-0100'}));
    assert.equal((await identity.listMembers(input(sales,owner))).items.length,1);checks.push('Sales Team reads and Administrator-only company writes');
    const domain=`validation-${runId}.example.com`;
    await identity.updateOrganizationDomains(input(actor,owner,{domains:[domain]}));
    const work={issuer,sub:'work',email:`work@${domain}`};const enrolled=(await identity.bootstrapProfile(input(work))).user;
    assert.equal((await identity.listProfileOrganizations(input(work))).items[0].id,String(owner));
    await q('UPDATE organization_memberships SET removed_at=now() WHERE user_id=$1',[enrolled.id]);
    await identity.bootstrapProfile(input(work));assert.equal((await identity.listProfileOrganizations(input(work))).items[0].role,'sales');checks.push('Exact-domain enrollment and Sales restoration');
    const p=(await principals.createPrincipal(input(actor,owner,{name:`Verification ${runId}`,websiteUrl:`https://validation-${runId}.com`}))).body.principal;
    const product=(await taxonomies.createTaxonomy(input(sales,owner,{principalId:p.id,content:{productFamilyName:'Validation product',currency:'USD',basePrice:'10.00',segments:[{id:null,placeholder:'X',name:null,defaultOptionIndex:null,options:[{id:null,code:'01',description:null,price:'2.00'}]}]}}))).body.taxonomy;
    const shareInput={...input(actor,owner),taxonomyId:product.id};
    const sharing=(await taxonomies.readTaxonomySharing(shareInput)).body;
    await taxonomies.updateTaxonomySharing({...shareInput,body:{organizationIds:[String(recipient)],expectedRevision:sharing.revision}});
    const recipientInput={...input(sales,recipient),taxonomyId:product.id};
    assert.equal((await taxonomies.readTaxonomy(recipientInput)).body.taxonomy.permissions.canEdit,false);
    await assert.rejects(()=>taxonomies.archiveTaxonomy({...recipientInput,body:{expectedVersionId:product.currentVersionId}}),{code:'NOT_FOUND'});
    const quote=(await identity.createQuote(input(sales,recipient,{customerName:'Customer',projectName:'Project',ownerId:null,lines:[{id:null,taxonomyId:product.id,versionId:product.currentVersionId,selections:[product.version.content.segments[0].options[0].id],quantity:2}]}))).quote;
    assert.equal(quote.total,'24.00');checks.push('Owned editing, shared read-only access and shared quote pricing');
    const latest=(await taxonomies.readTaxonomySharing(shareInput)).body;
    await taxonomies.updateTaxonomySharing({...shareInput,body:{organizationIds:[],expectedRevision:latest.revision}});
    const lines=quote.lines.map(({id,taxonomyId,versionId,selections})=>({id,taxonomyId,versionId,selections,quantity:3}));
    assert.equal((await identity.updateQuote({...input(sales,recipient,{customerName:'Customer',projectName:'Project',ownerId:null,expectedToken:quote.token,lines}),quoteId:quote.id})).quote.total,'36.00');
    await assert.rejects(()=>identity.createQuote(input(sales,recipient,{customerName:'Customer',projectName:'Project',ownerId:null,lines:lines.map(l=>({...l,id:null}))})),{code:'INVALID_INPUT'});checks.push('Revocation blocks new use and retains snapshots');
    assert.equal((await identity.readProfile(input(actor))).user.isSuperAdministrator,true);
    assert.equal((await identity.readProfile(input(sales))).user.isSuperAdministrator,false);checks.push('Exact email allowlist determines global privileges');
    await q('ROLLBACK');return {status:'passed',runId,checks,fixturesRolledBack:true};
  } catch(e) {await db.query('ROLLBACK').catch(()=>{});return {status:'failed',runId,checks,error:{code:e.code,message:e.message},fixturesRolledBack:true}}
}
export async function handler() {
  const db=await getPool().connect();
  try { return await verifyOrganizationDatabase(db) } finally { db.release() }
}

