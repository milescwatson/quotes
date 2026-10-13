import { fail, identifier, fields, one, rows, readUser, readOrganization, guardUser, guardOrganization, authorize, requireSuperAdministrator, guardPlatform, auditEvent } from './shared.mjs';
import { normalizeDomain, personalDomains } from './organization-domains.mjs';
export function createOrganizationAdminService(withTransaction) {
  async function transact(input, write, work) {
    try {
      return await withTransaction(async db => {
        let user = await readUser(db,input.identity);
        requireSuperAdministrator(user);
        if (write) {
          await guardPlatform(db);
          user = await guardUser(db,user.id,input.identity);
          requireSuperAdministrator(user);
        }
        return work(db,user);
      });
    } catch (e) {
      if (e.code === '23505' || e.code === '40001') fail(409,'CONCURRENT_CHANGE','A domain or permission changed. Refresh and try again.');
      throw e;
    }
  }
  return {
    async listOrganizationDomains(input) {
      return transact(input,false,async (db,user) => {
        const org = await readOrganization(db,identifier(input.orgId));
        await authorize(db,user,org,true);
        return { domains: (await rows(db,'SELECT domain FROM public.organization_domains WHERE organization_id=$1 ORDER BY domain',[org.id])).map(r=>r.domain) };
      });
    },
    async updateOrganizationDomains(input) {
      fields(input.body,['domains']);
      if (!Array.isArray(input.body.domains) || input.body.domains.length > 100) fail(422,'INVALID_INPUT','Use at most 100 email domains.');
      const domains = [...new Set(input.body.domains.map(normalizeDomain))].sort();
      if (domains.some(d=>personalDomains.has(d))) fail(422,'INVALID_INPUT','Personal email providers cannot be assigned to an organization.');
      return transact(input,true,async (db,user) => {
        const org = await guardOrganization(db,identifier(input.orgId));
        await authorize(db,user,org,true);
        const before = (await rows(db,'SELECT domain FROM public.organization_domains WHERE organization_id=$1 ORDER BY domain',[org.id])).map(r=>r.domain);
        for (const domain of domains) {
          const existing = await one(db,'SELECT organization_id FROM public.organization_domains WHERE domain=$1',[domain]);
          if (existing && String(existing.organization_id) !== String(org.id)) fail(409,'DOMAIN_ASSIGNED','This domain is already assigned to another organization. Remove that assignment first.');
        }
        await db.query('DELETE FROM public.organization_domains WHERE organization_id=$1',[org.id]);
        for (const domain of domains) await db.query('INSERT INTO public.organization_domains(domain,organization_id) VALUES($1,$2)',[domain,org.id]);
        await auditEvent(db,user,org.id,'organization.domains_updated','organization',org.id,input.requestId,{before,after:domains});
        return { domains };
      });
    },
  };
}
