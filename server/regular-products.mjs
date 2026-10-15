import { identifier, one, rows, readUser, readOrganization, guardUser, guardOrganization, authorize, configurationAccessPredicate, fail } from './shared.mjs';
import { object, invalid, cents, dollars } from './taxonomy-content.mjs';
export function productFields(body, prefix = '') {
  const clean = (v,max,path,empty=false) => {
    if (typeof v !== 'string' || /[\p{Cc}\p{Cs}]/u.test(v) || v.trim().length > max || (!empty && !v.trim())) invalid(prefix + path,`Enter ${empty ? '0' : '1'}–${max} characters without control characters.`);
    return v.trim();
  };
  const partNumber = clean(body.partNumber,120,'/partNumber');
  const description = clean(body.description,500,'/description',true);
  if (typeof body.listPrice !== 'string' || !/^(0|[1-9][0-9]{0,11})(\.[0-9]{1,2})?$/.test(body.listPrice)) invalid(prefix + '/listPrice','Enter a nonnegative list price with at most two decimal places.');
  return {partNumber,description,listPrice:dollars(cents(body.listPrice))};
}
export const regularResource = p => ({id:String(p.id),partNumber:p.part_number,description:p.description,listPrice:p.list_price,parentTaxonomyId:p.parent_taxonomy_id == null ? null : String(p.parent_taxonomy_id),token:String(p.token)});
export function createRegularProductService(withTransaction) {
  async function run(input,write,work) {
    identifier(input.orgId);
    try { return await withTransaction(async db => {
      let user = await readUser(db,input.identity);
      if (write) user = await guardUser(db,user.id,input.identity);
      const org = await (write ? guardOrganization : readOrganization)(db,input.orgId);
      await authorize(db,user,org,write);
      return work(db,org);
    }); } catch (e) {
      if (e.code === '23505') invalid('/partNumber','This part number already exists in this organization.','PRODUCT_DUPLICATE',409);
      if (e.code === '40001') fail(409,'PRODUCT_CONFLICT','This product changed. Reload before saving.');
      throw e;
    }
  }
  return {
    list: input => run(input,false,async (db,org) => ({items:(await rows(db,'SELECT *,modified_when::text AS token FROM public.regular_products WHERE organization_id=$1 ORDER BY part_number,id',[org.id])).map(regularResource)})),
    save: input => run(input,true,async (db,org) => {
      object(input.body,['partNumber','description','listPrice','parentTaxonomyId',...(input.productId ? ['expectedToken'] : [])]);
      const p = productFields(input.body), parent = input.body.parentTaxonomyId;
      const previous = input.productId ? await one(db,'SELECT * FROM public.regular_products WHERE id=$1 AND organization_id=$2',[identifier(input.productId),org.id]) : null;
      if (input.productId && !previous) fail(404,'NOT_FOUND','Product not found.');
      if (input.productId && (typeof input.body.expectedToken !== 'string' || input.body.expectedToken.length > 100)) invalid('/expectedToken','Provide the saved concurrency token.');
      if (parent !== null) { try { identifier(parent); } catch { invalid('/parentTaxonomyId','Choose an accessible active configured product.'); } }
      if (parent !== null && (!previous || String(previous.parent_taxonomy_id) !== parent)) {
        await db.query('UPDATE public.taxonomies t SET auth_revision=COALESCE(auth_revision,0)+1 WHERE t.id=$1 AND '+configurationAccessPredicate,[parent,org.id]);
        const source = await one(db,`SELECT t.id,t.owner_organization_id FROM public.taxonomies t WHERE t.id=$1 AND t.archived_at IS NULL AND ${configurationAccessPredicate}`,[parent,org.id]);
        if (!source) invalid('/parentTaxonomyId','Choose an accessible active configured product.');
        if (String(source.owner_organization_id) !== String(org.id)) await guardOrganization(db,source.owner_organization_id);
      }
      let row;
      if (input.productId) {
        identifier(input.productId);
        row = await one(db,`UPDATE public.regular_products SET part_number=$1,description=$2,list_price=$3,parent_taxonomy_id=$4,modified_when=now() WHERE id=$5 AND organization_id=$6 AND modified_when::text=$7 RETURNING *,modified_when::text AS token`,[p.partNumber,p.description,p.listPrice,parent,input.productId,org.id,input.body.expectedToken]);
        if (!row) fail(409,'PRODUCT_CONFLICT','This product changed. Reload before saving.');
      } else row = await one(db,`INSERT INTO public.regular_products(organization_id,part_number,description,list_price,parent_taxonomy_id) VALUES($1,$2,$3,$4,$5) RETURNING *,modified_when::text AS token`,[org.id,p.partNumber,p.description,p.listPrice,parent]);
      return {product:regularResource(row)};
    }),
  };
}
