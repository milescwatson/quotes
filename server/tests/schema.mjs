import { readFile } from 'node:fs/promises';
const migration = async name => (await readFile(new URL(`../../database/versions/0005/organizations/${name}.sql`,import.meta.url),'utf8')).replaceAll('INDEX ASYNC','INDEX').replaceAll('ALTER TABLE ASYNC','ALTER TABLE');
// Service suites exercise the current schema; database suites retain baseline migration coverage.
export async function readTestFile(url, encoding = 'utf8') {
  let text = await readFile(url,encoding);
  if (url.pathname.endsWith('/0001/identity/schema.sql')) text += '\n'+await migration('identity')+'\n'+await migration('backfill')+'\n'+await migration('enforce');
  if (url.pathname.endsWith('/0002/taxonomy/schema.sql')) text += '\n'+await migration('sharing');
  if (url.pathname.endsWith('/0001/identity/permissions.sql')) text += `
    GRANT INSERT ON organizations TO :"api_role";
    GRANT USAGE ON SEQUENCE organizations_id_seq TO :"api_role";
    GRANT UPDATE(address,website_url,email,phone) ON organizations TO :"api_role";
    GRANT SELECT,INSERT,DELETE ON organization_domains TO :"api_role";
    GRANT SELECT,UPDATE ON platform_authorization_guard TO :"api_role";`;
  if (url.pathname.endsWith('/0002/taxonomy/permissions.sql')) text += `
    GRANT SELECT,INSERT,DELETE ON taxonomy_organization_access TO :"api_role";
    GRANT UPDATE(auth_revision,sharing_revision) ON taxonomies TO :"api_role";`;
  return text;
}
