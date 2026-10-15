import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { createIdentityService } from '../identity.mjs';
import { createTaxonomyService } from '../taxonomy.mjs';
import { createPrincipalService } from '../principals.mjs';
import { createHandler } from './helpers.mjs';
import { verifyOrganizationDatabase } from '../scripts/organization-smoke-handler.mjs';
import { isSuperAdministratorEmail } from '../super-administrators.mjs';
import { readUser, guardUser } from '../shared.mjs';
import { workDomain, normalizeDomain } from '../organization-domains.mjs';
const read = async p => (await readFile(new URL(`../../database/versions/${p}`,import.meta.url),'utf8')).replaceAll('INDEX ASYNC','INDEX').replaceAll('ALTER TABLE ASYNC','ALTER TABLE');
const product = { productFamilyName:'Shared product',currency:'USD',basePrice:'10.00',segments:[{id:null,placeholder:'X',name:null,defaultOptionIndex:null,options:[{id:null,code:'01',description:null,price:'2.00'},{id:null,code:'02',description:null,price:'4.00'}]}] };
test('domain normalization preserves exact subdomains and excludes personal providers',()=>{
  for (const domain of ['gmail.com','yahoo.co.uk','hotmail.com','icloud.com','proton.me']) assert.equal(workDomain(`user@${domain}`),null);
  assert.equal(workDomain('user@DIVISION.Example.com'),'division.example.com');
  assert.equal(normalizeDomain('xn--bcher-kva.de'),'xn--bcher-kva.de');
  for(const domain of ['localhost','bad_domain.com','example.com.','a@example.com','https://example.com','127.0.0.1']) assert.throws(()=>normalizeDomain(domain),{code:'INVALID_INPUT'});
});
test('0005 migration, enrollment, role boundaries, sharing and email-based global privileges', async t => {
  const db = new PGlite({parsers:{20:v=>v}});
  const q = async (sql,args=[]) => (await db.query(sql,args)).rows;
  // Serialize this in-process PGlite connection; production retries OCC conflicts in database.mjs.
  let queue=Promise.resolve();
  const tx = work => { const result=queue.then(async()=>{await db.exec('BEGIN');try {const value=await work(db);await db.exec('COMMIT');return value} catch(e){await db.exec('ROLLBACK');throw e}});queue=result.catch(()=>{});return result };
  const identity=createIdentityService(tx), taxonomy=createTaxonomyService(tx), principals=createPrincipalService(tx);
  const people={};
  const call = (method,who='admin',body={},args={})=>method({identity:{issuer:'test',sub:who,email:people[who]?.email || `${who}@gmail.com`},body,requestId:randomUUID(),...args});
  const denied = (fn,code='FORBIDDEN')=>assert.rejects(fn,{code});
  let owner,recipient,other,config;
  try {
    for(const file of ['0001/identity/schema.sql','0001/quotes/schema.sql','0002/taxonomy/schema.sql','0003/principals/schema.sql','0003/principals/enforce.sql','0004/quotes/schema.sql','0004/quotes/backfill.sql','0004/quotes/enforce.sql','0006/products/schema.sql','0006/products/backfill.sql','0006/products/enforce.sql']) await db.exec(await read(file));
    for(const sub of ['admin','sales','super','outside','candidate']) people[sub]=(await q('INSERT INTO users(cognito_issuer,cognito_subject,email,normalized_email,display_name) VALUES($1,$2,$3,$3,$2) RETURNING *',['test',sub,sub==='super'?'mc.watson415@gmail.com':`${sub}@gmail.com`]))[0];
    [owner,recipient,other]=await q("INSERT INTO organizations(name,status) VALUES('Owner','active'),('Recipient','active'),('Other','active') RETURNING *");
    await q("INSERT INTO organization_memberships(organization_id,user_id,role) VALUES($1,$2,'admin'),($1,$3,'editor'),($4,$5,'member'),($6,$7,'admin')",[owner.id,people.admin.id,people.sales.id,recipient.id,people.outside.id,other.id,people.candidate.id]);
    await t.test('migration maps roles, defaults Sales, preserves membership identity and validates constraints',async()=>{
      const before=await q('SELECT id,organization_id,user_id,joined_at FROM organization_memberships ORDER BY id');
      for(const file of ['identity','backfill','enforce','sharing']) await db.exec(await read(`0005/organizations/${file}.sql`));
      assert.deepEqual(await q('SELECT id,organization_id,user_id,joined_at FROM organization_memberships ORDER BY id'),before);
      assert.deepEqual((await q('SELECT role FROM organization_memberships ORDER BY id')).map(r=>r.role),['administrator','sales','sales','administrator']);
      await assert.rejects(()=>q("INSERT INTO organization_memberships(organization_id,user_id,role) VALUES($1,$2,'super')",[owner.id,people.super.id]),e=>e.code==='23514');
      const row=(await q('INSERT INTO organization_memberships(organization_id,user_id) VALUES($1,$2) RETURNING role',[recipient.id,people.candidate.id]))[0];assert.equal(row.role,'sales');
    });
    await t.test('Sales reads Team and adds existing accounts as Sales but cannot escalate or manage teammates',async()=>{
      assert.equal((await call(identity.listMembers,'sales',{}, {orgId:owner.id})).items.length,2);
      await denied(()=>call(identity.addMember,'sales',{email:people.candidate.email,role:'administrator'},{orgId:owner.id}));
      const added=(await call(identity.addMember,'sales',{email:people.candidate.email},{orgId:owner.id})).member;
      assert.equal(added.role,'sales');
      await denied(()=>call(identity.updateMember,'sales',{role:'administrator'},{orgId:owner.id,membershipId:added.id}));
      await denied(()=>call(identity.removeMember,'sales',{}, {orgId:owner.id,membershipId:added.id}));
      await call(identity.updateMember,'admin',{displayName:'New Name'},{orgId:owner.id,membershipId:added.id});
      assert.equal((await call(identity.readProfile,'candidate')).user.displayName,'New Name');
      const admin=(await call(identity.listMembers,'admin',{}, {orgId:owner.id})).items.find(m=>m.userId===people.admin.id);
      await denied(()=>call(identity.updateMember,'admin',{role:'sales'},{orgId:owner.id,membershipId:admin.id}),'LAST_ADMIN');
      await denied(()=>call(identity.addMember,'sales',{email:'unknown@gmail.com'},{orgId:owner.id}),'ACCOUNT_UNAVAILABLE');
    });
    await t.test('company details validate, clear to null and remain Administrator-only',async()=>{
      await denied(()=>call(identity.updateOrganization,'sales',{name:'Bad'},{orgId:owner.id}));
      const body={address:'100 Main St\nSuite 2',websiteUrl:'https://example.com',email:' CONTACT@EXAMPLE.COM ',phone:'+1 (555) 123-4567 ext 2'};
      const result=(await call(identity.updateOrganization,'admin',body,{orgId:owner.id})).organization;
      assert.equal(result.email,'contact@example.com');assert.equal(result.websiteUrl,'https://example.com/');assert.equal(result.address,body.address);
      await denied(()=>call(identity.updateOrganization,'admin',{websiteUrl:'javascript:alert(1)'},{orgId:owner.id}),'INVALID_INPUT');
      await denied(()=>call(identity.updateOrganization,'admin',{email:'bad'},{orgId:owner.id}),'INVALID_INPUT');
      await denied(()=>call(identity.updateOrganization,'admin',{address:'invalid\u0000address'},{orgId:owner.id}),'INVALID_INPUT');
      assert.equal((await call(identity.updateOrganization,'admin',{phone:''},{orgId:owner.id})).organization.phone,null);
    });
    await t.test('verified work enrollment upserts exact domains, preserves roles and restores removals as Sales',async()=>{
      await call(identity.updateOrganizationDomains,'super',{domains:['Example.com']},{orgId:owner.id});
      await denied(()=>call(identity.updateOrganizationDomains,'admin',{domains:['other.com']},{orgId:owner.id}));
      await denied(()=>call(identity.updateOrganizationDomains,'super',{domains:['example.com']},{orgId:recipient.id}),'DOMAIN_ASSIGNED');
      await denied(()=>call(identity.updateOrganizationDomains,'super',{domains:['gmail.com']},{orgId:owner.id}),'INVALID_INPUT');
      const bootstrap=(sub,email)=>identity.bootstrapProfile({identity:{issuer:'test',sub,email},body:{},requestId:randomUUID()});
      const work=(await bootstrap('work','one@EXAMPLE.com')).user;
      assert.deepEqual((await identity.listProfileOrganizations({identity:{issuer:'test',sub:'work'},query:{}})).items.map(o=>o.id),[owner.id]);
      const m=(await q('SELECT * FROM organization_memberships WHERE user_id=$1',[work.id]))[0];
      await q("UPDATE organization_memberships SET role='administrator' WHERE id=$1",[m.id]);
      await bootstrap('work','one@example.com');assert.equal((await q('SELECT role FROM organization_memberships WHERE id=$1',[m.id]))[0].role,'administrator');
      await q('UPDATE organization_memberships SET removed_at=now() WHERE id=$1',[m.id]);
      await bootstrap('work','one@example.com');assert.equal((await q('SELECT role FROM organization_memberships WHERE id=$1',[m.id]))[0].role,'sales');
      await Promise.all([bootstrap('a','a@new-company.com'),bootstrap('b','b@new-company.com')]);
      assert.equal((await q("SELECT * FROM organization_domains WHERE domain='new-company.com'")).length,1);
      const newOrg=(await q("SELECT organization_id FROM organization_domains WHERE domain='new-company.com'"))[0].organization_id;
      assert.equal((await q('SELECT * FROM organization_memberships WHERE organization_id=$1',[newOrg])).length,2);
      await bootstrap('division','a@division.example.com');assert.equal((await q("SELECT * FROM organization_domains WHERE domain='division.example.com'")).length,1);
      await bootstrap('personal','a@yahoo.co.uk');const personal=(await q("SELECT id FROM users WHERE cognito_subject='personal'"))[0];assert.equal((await q('SELECT * FROM organization_memberships WHERE user_id=$1',[personal.id])).length,0);
      await bootstrap('a','a@another-company.com');assert.equal((await q("SELECT * FROM organization_memberships WHERE user_id=(SELECT id FROM users WHERE cognito_subject='a')")).length,2);
      await q("UPDATE organizations SET status='archived',archived_at=now() WHERE id=$1",[newOrg]);
      await bootstrap('c','c@new-company.com');assert.equal((await q('SELECT * FROM organization_memberships WHERE organization_id=$1',[newOrg])).length,2);
      assert.equal((await q('SELECT status FROM organizations WHERE id=$1',[newOrg]))[0].status,'archived');
    });
    await t.test('Super Administrator bypasses membership but must edit shared content in its owner',async()=>{
      const principal=(await call(principals.createPrincipal,'admin',{name:'Acme',websiteUrl:'https://acme.com'},{orgId:owner.id})).body.principal;
      config=(await call(taxonomy.createTaxonomy,'sales',{principalId:principal.id,content:product},{orgId:owner.id})).body.taxonomy;
      assert.equal(config.permissions.canArchive,true);
      await denied(()=>call(taxonomy.readTaxonomy,'outside',{}, {orgId:recipient.id,taxonomyId:config.id}),'NOT_FOUND');
      const shareArgs={orgId:owner.id,taxonomyId:config.id};
      const state=(await call(taxonomy.readTaxonomySharing,'super',{},shareArgs)).body;
      await denied(()=>call(taxonomy.updateTaxonomySharing,'admin',{organizationIds:[recipient.id],expectedRevision:state.revision},shareArgs));
      await call(taxonomy.updateTaxonomySharing,'super',{organizationIds:[recipient.id,other.id],expectedRevision:state.revision},shareArgs);
      await denied(()=>call(taxonomy.updateTaxonomySharing,'super',{organizationIds:[],expectedRevision:state.revision},shareArgs),'SHARING_CONFLICT');
      const shared=(await call(taxonomy.readTaxonomy,'outside',{}, {orgId:recipient.id,taxonomyId:config.id})).body.taxonomy;
      assert.equal(shared.permissions.canEdit,false);assert.equal(shared.permissions.canArchive,false);
      assert.equal((await call(taxonomy.listTaxonomies,'outside',{}, {orgId:recipient.id})).body.totalItems,1);
      await denied(()=>call(taxonomy.archiveTaxonomy,'super',{expectedVersionId:config.currentVersionId},{orgId:recipient.id,taxonomyId:config.id}),'NOT_FOUND');
      await denied(()=>call(taxonomy.saveTaxonomyVersion,'outside',{principalId:principal.id,content:product,expectedVersionId:config.currentVersionId},{orgId:recipient.id,taxonomyId:config.id}),'NOT_FOUND');
      assert.equal((await call(identity.listOrganizationDomains,'super',{}, {orgId:recipient.id})).domains.length,0);
    });
    await t.test('shared quote sources require active access; revocation preserves snapshots and quantity edits',async()=>{
      const args={orgId:recipient.id};
      const sharingBeforeQuote=(await call(taxonomy.readTaxonomySharing,'super',{}, {orgId:owner.id,taxonomyId:config.id})).body;
      let quote=(await call(identity.createQuote,'outside',{customerName:'Customer',projectName:'Project',ownerId:null,lines:[{id:null,taxonomyId:config.id,versionId:config.currentVersionId,selections:[config.version.content.segments[0].options[0].id],quantity:2}]},args)).quote;
      assert.equal(quote.total,'24.00');
      assert.equal((await call(taxonomy.readTaxonomySharing,'super',{}, {orgId:owner.id,taxonomyId:config.id})).body.revision,sharingBeforeQuote.revision);
      const shareArgs={orgId:owner.id,taxonomyId:config.id};
      const state=(await call(taxonomy.readTaxonomySharing,'super',{},shareArgs)).body;
      await call(taxonomy.updateTaxonomySharing,'super',{organizationIds:[],expectedRevision:state.revision},shareArgs);
      const body={customerName:quote.customerName,projectName:quote.projectName,ownerId:null,expectedToken:quote.token,lines:quote.lines.map(({id,taxonomyId,versionId,selections})=>({id,taxonomyId,versionId,selections,quantity:3}))};
      quote=(await call(identity.updateQuote,'outside',body,{...args,quoteId:quote.id})).quote;assert.equal(quote.total,'36.00');
      await denied(()=>call(identity.createQuote,'outside',{...body,lines:body.lines.map(l=>({...l,id:null}))},args),'INVALID_INPUT');
      body.expectedToken=quote.token;body.lines[0].selections=[config.version.content.segments[0].options[1].id];
      await denied(()=>call(identity.updateQuote,'outside',body,{...args,quoteId:quote.id}),'INVALID_INPUT');
      assert.equal((await call(identity.readQuote,'outside',{}, {...args,quoteId:quote.id})).quote.total,'36.00');
      await call(taxonomy.archiveTaxonomy,'sales',{expectedVersionId:config.currentVersionId},{orgId:owner.id,taxonomyId:config.id});
      assert.equal((await call(taxonomy.listTaxonomies,'sales',{}, {orgId:owner.id})).body.totalItems,0);
    });
    await t.test('only allowlisted email addresses have global access; disabled users remain blocked',async()=>{
      assert.equal((await call(identity.readProfile,'super')).user.isSuperAdministrator,true);
      assert.equal((await call(identity.readProfile,'admin')).user.isSuperAdministrator,false);
      const all=(await call(identity.listProfileOrganizations,'super')).items;assert.ok(all.some(o=>o.id===recipient.id));
      const added=(await call(identity.addMember,'admin',{email:people.super.email},{orgId:owner.id})).member;assert.equal(added.isSuperAdministrator,true);
      await q('UPDATE users SET disabled_at=now() WHERE id=$1',[people.super.id]);
      await denied(()=>call(identity.readOrganization,'super',{}, {orgId:recipient.id}),'ACCOUNT_DISABLED');
      await q('UPDATE users SET disabled_at=NULL WHERE id=$1',[people.super.id]);
      assert.ok((await q("SELECT * FROM identity_audit_events WHERE action='taxonomy.sharing_updated'")).length>=2);
    });
    await t.test('authenticated Gateway requests enforce role restrictions with real services',async()=>{
      const handler=createHandler({env:{COGNITO_ISSUER:'test',COGNITO_CLIENT_ID:'client',COGNITO_DOMAIN:'https://login.example.com'},services:{identity,taxonomy,principals},fetchUser:async()=>({ok:true,json:async()=>({sub:'sales',email:people.sales.email,email_verified:true})})});
      const request=async(method,path,body)=>handler({version:'2.0',routeKey:`${method} ${path}`,rawPath:path,headers:{authorization:'Bearer token','content-type':'application/json'},requestContext:{requestId:randomUUID(),http:{method,path},authorizer:{jwt:{claims:{iss:'test',client_id:'client',sub:'sales',token_use:'access',exp:Date.now()/1000+600,scope:'quotes-api/access'}}}},...(body?{body:JSON.stringify(body)}:{})},{});
      assert.equal((await request('GET',`/organizations/${owner.id}/members`)).statusCode,200);
      assert.equal((await request('PATCH',`/organizations/${owner.id}`,{name:'Forbidden'})).statusCode,403);
      assert.equal((await request('PUT',`/users/${people.sales.id}/super-administrator`,{isSuperAdministrator:true})).statusCode,404);
    });
    await t.test('runtime grants support enrollment, sharing and details without hard deletes or audit edits',async()=>{
      await db.exec('CREATE ROLE organizations_api; CREATE ROLE organizations_operator;');
      for(const p of ['0001/identity/permissions.sql','0001/quotes/permissions.sql','0002/taxonomy/permissions.sql','0003/principals/permissions.sql','0004/quotes/permissions.sql','0005/organizations/permissions.sql','0006/products/permissions.sql']) await db.exec((await read(p)).replaceAll(':"api_role"','organizations_api').replaceAll(':"operator_role"','organizations_operator'));
      await db.exec('SET ROLE organizations_api');
      try {
        const profile=await identity.bootstrapProfile({identity:{issuer:'test',sub:'runtime',email:'new@runtime-company.com'},body:{},requestId:randomUUID()});assert.ok(profile.user.id);
        await call(identity.updateOrganization,'admin',{phone:'555-1234'},{orgId:owner.id});
        const share=(await call(taxonomy.readTaxonomySharing,'super',{}, {orgId:owner.id,taxonomyId:config.id})).body;assert.ok(share.revision);
        await assert.rejects(()=>q('DELETE FROM organizations'),e=>e.code==='42501');
        await assert.rejects(()=>q("UPDATE identity_audit_events SET action='forged'"),e=>e.code==='42501');
        await assert.rejects(()=>q('DELETE FROM taxonomy_versions'),e=>e.code==='42501');
      } finally {await db.exec('RESET ROLE')}
    });
    await t.test('the deployment smoke handler executes under restricted runtime grants and rolls back all fixtures',async()=>{
      await db.exec('CREATE ROLE quotes_api; GRANT organizations_api TO quotes_api; SET ROLE quotes_api;');
      try {
        const before=(await q('SELECT count(*) AS n FROM users'))[0].n;
        const result=await verifyOrganizationDatabase(db);
        assert.equal(result.status,'passed',JSON.stringify(result));assert.equal(result.fixturesRolledBack,true);
        assert.equal((await q('SELECT count(*) AS n FROM users'))[0].n,before);
      } finally {await db.exec('RESET ROLE')}
    });
  } finally { await db.close() }
});

test('Super Administrator allowlist uses exact normalized verified emails and ignores stored flags',async()=>{
  for (const email of ['mc.watson415@gmail.com','miles@baysideio.com','miles@milescwatson.com']) {
    assert.equal(isSuperAdministratorEmail(email),true);
    assert.equal(isSuperAdministratorEmail(` ${email.toUpperCase()} `),true);
  }
  for (const email of ['mcwatson415@gmail.com','mc.watson415+admin@gmail.com','miles@baysideio.com.evil.com','someone@baysideio.com',null]) assert.equal(isSuperAdministratorEmail(email),false);
  const row={id:'1',email:'mc.watson415@gmail.com',is_super_administrator:true};
  const db={query:async()=>({rows:[row]})};
  assert.equal((await readUser(db,{issuer:'test',sub:'one',email:'ordinary@gmail.com'})).isSuperAdministrator,false);
  assert.equal((await guardUser(db,'1',{email:'ordinary@gmail.com'})).isSuperAdministrator,false);
  row.email='ordinary@gmail.com';row.is_super_administrator=false;
  assert.equal((await readUser(db,{issuer:'test',sub:'one',email:'MILES@BAYSIDEIO.COM'})).isSuperAdministrator,true);
});
