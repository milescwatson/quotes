import { createQuotePdfQueue, createQuotePdfStorage } from './quote-pdf-storage.mjs';
import { multiple, netAmount, flatSnapshot } from './quote-pricing.mjs';
import { productFields } from './regular-products.mjs';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { prepareQuotePdf } from './quote-pdf-data.mjs';
import { createLogoStorage } from './organization-logo.mjs';
import { renderQuotePdf } from './quote-pdf-layout.mjs';
import { fail, identifier, one, readUser, readOrganization, guardUser, guardOrganization, authorize, configurationAccessPredicate } from './shared.mjs';
import { object, invalid, checkedSnapshot, cents, dollars } from './taxonomy-content.mjs';

const conflict = () => fail(409, 'QUOTE_CONFLICT', 'This quote changed. Reload before saving; your changes have been retained.');
export async function detail(db, orgId, id) {
  const q = await one(db, `SELECT q.*, q.modified_when::text AS token,
    COALESCE(NULLIF(trim(u.display_name), ''), 'Unnamed team member') AS modifier_name,
    CASE WHEN o.id IS NOT NULL THEN COALESCE(NULLIF(trim(o.display_name), ''), 'Unnamed team member') END AS owner_name, a.display_name AS author_name
    FROM public.quotes q JOIN public.users u ON u.id=q.modified_by
    LEFT JOIN public.users a ON a.id=q.created_by_user_id
    LEFT JOIN public.users o ON o.id=q.owner_user_id WHERE q.organization_id=$1 AND q.id=$2`, [orgId,id]);
  if (!q) fail(404, 'NOT_FOUND', 'Quote not found.');
  const lines = q.lines.map(({ multiple: _removed, ...line }) => line);
  return { id: String(q.id), organizationId: String(q.organization_id), customerId: q.customer_id,
    customerName: q.customer_name, projectName: q.project_name, location: q.location ?? '', authorName: q.author_name?.trim() || null, title: `${q.customer_name} - ${q.project_name}`,
    ownerId: q.owner_user_id == null ? null : String(q.owner_user_id), ownerName: q.owner_name,
    modifiedBy: String(q.modified_by), modifiedByName: q.modifier_name, modifiedWhen: new Date(q.modified_when).toISOString(), archivedAt: q.archived_at ? new Date(q.archived_at).toISOString() : null,
    token: q.token, multiple: Number(q.multiple ?? 1), lines, currency: 'USD', listTotal: dollars(lines.reduce((sum,l) => sum + cents(l.lineTotal),0n)), total: dollars(lines.reduce((sum,l) => sum + cents(netAmount(l.lineTotal,Number(q.multiple ?? 1))),0n)) };
}
export function createQuoteService(withTransaction, { logoStorage = createLogoStorage(), enqueueQuotePdf = createQuotePdfQueue(), pdfStorage = createQuotePdfStorage(), now = Date.now } = {}) {
  async function transaction(input, write, work) {
    identifier(input.orgId);
    try {
      return await withTransaction(async db => {
        let user = await readUser(db,input.identity);
        if (write) {
          const ids = new Set([String(user.id)]);
          if (input.body.ownerId !== null) ids.add(identifier(input.body.ownerId));
          for (const id of [...ids].sort((a,b) => BigInt(a)<BigInt(b)?-1:1)) {
            if (id === String(user.id)) user = await guardUser(db,id,input.identity);
            else await db.query('UPDATE public.users SET auth_revision=auth_revision+1 WHERE id=$1',[id]);
          }
        }
        const org = await (write ? guardOrganization : readOrganization)(db,input.orgId);
        await authorize(db,user,org);
        return work(db,user,org);
      });
    } catch (e) { if (e.code === '40001') conflict(); throw e; }
  }
  async function save(input) {
    const { body, quoteId } = input;
    object(body,['customerName','projectName','ownerId','lines','multiple','location',...(quoteId ? ['expectedToken'] : [])],'',['customerName','projectName','ownerId','lines',...(quoteId ? ['expectedToken'] : [])]);
    const quoteMultiple = multiple(body.multiple);
    const text = (v,path) => { if (typeof v !== 'string' || !v.trim() || v.trim().length > 120 || /[\p{Cc}\p{Cs}]/u.test(v)) invalid(path,'Enter 1–120 characters without control characters.'); return v.trim(); };
    if (body.location !== undefined && (typeof body.location !== 'string' || body.location.trim().length > 120 || /[\p{Cc}\p{Cs}]/u.test(body.location))) invalid('/location','Enter at most 120 characters without control characters.');
    const customer = text(body.customerName,'/customerName'), project = text(body.projectName,'/projectName');
    if (!Array.isArray(body.lines) || body.lines.length > 100) invalid('/lines','Use at most 100 product lines.');
    if (quoteId) { identifier(quoteId); if (typeof body.expectedToken !== 'string' || body.expectedToken.length > 100) invalid('/expectedToken','Provide the saved concurrency token.'); }
    const result = await transaction(input,true,async (db,user,org) => {
      const old = quoteId ? await detail(db,org.id,quoteId) : null;
      const location = body.location === undefined ? old?.location ?? '' : body.location.trim();
      if (old?.archivedAt) fail(409, 'QUOTE_ARCHIVED', 'Restore this quote before editing it.');
      if (old && old.token !== body.expectedToken) conflict();
      if (body.ownerId !== null && !await one(db,`SELECT u.id FROM public.organization_memberships m JOIN public.users u ON u.id=m.user_id
        WHERE m.organization_id=$1 AND m.user_id=$2 AND m.removed_at IS NULL AND u.disabled_at IS NULL`,[org.id,body.ownerId])) invalid('/ownerId','Choose an active team member from this organization.');
      const used = new Set(); let total = 0n, netTotal = 0n;
      const lines = [];
      for (const [i,line] of body.lines.entries()) {
        const path = `/lines/${i}`;
        if (!line || typeof line !== 'object' || Array.isArray(line)) invalid(path,'Provide a product line.');
        const kind = line.kind ?? 'configured';
        if (!['configured','regular','freeform'].includes(kind)) invalid(`${path}/kind`,'Choose a supported product type.');
        const common = ['id','quantity','kind'];
        const fields = kind === 'configured' ? ['taxonomyId','versionId','selections'] : kind === 'regular' ? ['regularProductId'] : ['partNumber','description','listPrice'];
        object(line,[...common,...fields],path,['id','quantity',...fields]);
        if (kind === 'configured') { identifier(line.taxonomyId); identifier(line.versionId); }
        if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 1000000) invalid(`${path}/quantity`,'Use a whole quantity between 1 and 1,000,000.');
        const previous = old?.lines.find(l => l.id === line.id);
        if (line.id !== null && (!previous || used.has(line.id))) invalid(`${path}/id`,'Use a unique saved line identity or null.');
        used.add(line.id);
        if (kind !== 'configured') {
          let snapshot, partNumber, price, parentTaxonomyId = null;
          if (kind === 'regular') {
            identifier(line.regularProductId);
            if (previous?.kind === 'regular' && previous.regularProductId === line.regularProductId) {
              snapshot = previous.snapshot; partNumber = previous.partNumber; price = previous.unitPrice; parentTaxonomyId = previous.parentTaxonomyId;
            } else {
              const p = await one(db,'SELECT r.*,p.name AS principal_name FROM public.regular_products r LEFT JOIN public.principals p ON p.id=r.principal_id WHERE r.id=$1 AND r.organization_id=$2',[line.regularProductId,org.id]);
              if (!p) invalid(`${path}/regularProductId`,'Choose a regular product in this organization.');
              partNumber = p.part_number; price = p.list_price; parentTaxonomyId = p.parent_taxonomy_id == null ? null : String(p.parent_taxonomy_id);
              snapshot = flatSnapshot(partNumber,p.description,price,p.principal_id == null ? null : String(p.principal_id),p.principal_name);
            }
          } else {
            const p = productFields(line,path); partNumber = p.partNumber; price = p.listPrice;
            snapshot = flatSnapshot(partNumber,p.description,price,p.principal_id == null ? null : String(p.principal_id),p.principal_name);
          }
          const amount = cents(price) * BigInt(line.quantity);
          total += amount; netTotal += cents(netAmount(dollars(amount),quoteMultiple));
          if (total > 99999999999999n || netTotal > 99999999999999n) invalid('/lines','Quote total exceeds the supported USD limit.');
          lines.push({id:previous?.id ?? randomUUID(),kind,regularProductId:kind === 'regular' ? line.regularProductId : null,parentTaxonomyId,taxonomyId:null,versionId:null,snapshot,selections:[],quantity:line.quantity,partNumber,complete:true,unitPrice:price,lineTotal:dollars(amount)});
          continue;
        }

        if (previous && !previous.kind && previous.taxonomyId === line.taxonomyId && previous.versionId === line.versionId) {
          const segments = previous.snapshot.content.segments;
          if (!Array.isArray(line.selections) || line.selections.length !== segments.length) invalid(`${path}/selections`,'Provide a choice or null for each segment.');
          line.selections.forEach((choice,j)=>{ if (choice !== null && !segments[j].options.some(o=>o.id===choice)) invalid(`${path}/selections/${j}`,'Choose an option from the saved configuration.'); });
        }
        let snapshot;
        if (previous && !previous.kind && previous.taxonomyId === line.taxonomyId && previous.versionId === line.versionId && isDeepStrictEqual(previous.selections,line.selections)) snapshot = previous.snapshot;
        else {
          await db.query('UPDATE public.taxonomies t SET auth_revision=COALESCE(auth_revision,0)+1 WHERE t.id=$1 AND '+configurationAccessPredicate,[line.taxonomyId,org.id]);
          const source = await one(db,`SELECT t.owner_organization_id,t.current_version_id,t.archived_at,v.content,v.principal_id,p.name AS principal_name
            FROM public.taxonomies t JOIN public.taxonomy_versions v ON v.id=t.current_version_id AND v.taxonomy_id=t.id
            LEFT JOIN public.principals p ON p.id=v.principal_id WHERE t.id=$1 AND ${configurationAccessPredicate}`,[line.taxonomyId,org.id]);
          if (!source) invalid(`${path}/taxonomyId`,'Choose a configuration in this organization.');
          if (String(source.owner_organization_id) !== String(org.id)) await guardOrganization(db,source.owner_organization_id);
          if (source.archived_at || String(source.current_version_id) !== line.versionId) fail(409,'CONFIGURATION_CHANGED','The configuration changed or was archived. Select the current product again and review its options.');
          checkedSnapshot(source.content);
          snapshot = { content: source.content, principalId: source.principal_id == null ? null : String(source.principal_id), principalName: source.principal_name };
        }
        const content = snapshot.content;
        if (!Array.isArray(line.selections) || line.selections.length !== content.segments.length) invalid(`${path}/selections`,'Provide a choice or null for each segment.');
        let price = cents(content.basePrice);
        const codes = content.segments.map((s,j) => {
          const choice = line.selections[j];
          if (choice === null) return s.placeholder;
          const option = s.options.find(o => o.id === choice);
          if (!option) invalid(`${path}/selections/${j}`,'Choose an option from the saved configuration.');
          price += cents(option.price); return option.code;
        });
        const amount = price * BigInt(line.quantity); total += amount; netTotal += cents(netAmount(dollars(amount),quoteMultiple));
        if (total > 99999999999999n || netTotal > 99999999999999n) invalid('/lines','Quote total exceeds the supported USD limit.');
        const separators = content.separators ?? Array(content.segments.length-1).fill('-');
        lines.push({ id: previous?.id ?? randomUUID(), taxonomyId: line.taxonomyId, versionId: line.versionId, snapshot,
          selections: line.selections, quantity: line.quantity, partNumber: codes.map((code,j) => (j ? separators[j-1] : '')+code).join(''),
          complete: line.selections.every(s => s !== null), unitPrice: dollars(price), lineTotal: dollars(amount) });
      }
      if (Buffer.byteLength(JSON.stringify(lines),'utf8') > 512 * 1024) invalid('/lines','Quote snapshots exceed 512 KiB. Use fewer lines.', 'PAYLOAD_TOO_LARGE', 413);
      if (old && old.customerName === customer && old.projectName === project && old.location === location && old.ownerId === body.ownerId && old.multiple === quoteMultiple && isDeepStrictEqual(old.lines,lines)) return { quote: old, unchanged: true };
      let id = quoteId;
      if (old) {
        const updated = await one(db,`UPDATE public.quotes SET customer_name=$1, project_name=$2,owner_user_id=$3,lines=$4,modified_by=$5,modified_when=now(),multiple=$9,location=$10
          WHERE id=$6 AND organization_id=$7 AND modified_when::text=$8 RETURNING id`,[customer,project,body.ownerId,JSON.stringify(lines),user.id,id,org.id,body.expectedToken,quoteMultiple,location]);
        if (!updated) conflict();
      } else id = String((await one(db,`INSERT INTO public.quotes(organization_id,customer_name,project_name,owner_user_id,lines,modified_by,multiple,location,created_by_user_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$6) RETURNING id`,[org.id,customer,project,body.ownerId,JSON.stringify(lines),user.id,quoteMultiple,location])).id);
      return { quote: await detail(db,org.id,id), unchanged: false };
    });
    if (!result.unchanged) await enqueueQuotePdf({ organizationId: result.quote.organizationId, quoteId: result.quote.id });
    return result;
  }
  function pdfRequest(input) {
    identifier(input.quoteId);
    const disposition = input.query.disposition ?? 'inline';
    if (!['inline', 'attachment'].includes(disposition) || typeof input.query.expectedToken !== 'string' || !input.query.expectedToken || input.query.expectedToken.length > 100)
      fail(422, 'INVALID_INPUT', 'Provide a saved quote token and a valid PDF disposition.');
    return disposition;
  }
  async function savedPdfQuote(db, org, input) {
    const quote = await detail(db, org.id, input.quoteId);
    if (quote.token !== input.query.expectedToken) fail(409, 'QUOTE_CONFLICT', 'This quote changed. Reload the page before exporting a PDF.');
    return quote;
  }
  return {
    async readQuotePdfUrl(input) {
      const disposition = pdfRequest(input);
      const quote = await transaction(input, false, (db, _user, org) => savedPdfQuote(db, org, input));
      if (now() - Date.parse(quote.modifiedWhen) < 300000) return { url: null };
      return { url: await pdfStorage.url(input.orgId, input.quoteId, quote.token, disposition) };
    },
    async readQuotePdf(input) {
      const disposition = pdfRequest(input);
      const model = await transaction(input, false, async (db, _user, org) => {
        const quote = await savedPdfQuote(db, org, input);
        return { ...prepareQuotePdf(quote, org), logoVersion: org.logo_id ?? null };
      });
      if (model.logoVersion) model.organization.logo = await logoStorage.get(input.orgId, model.logoVersion);
      return { pdf: await renderQuotePdf(model), disposition, filename: `quote-${input.quoteId}.pdf` };
    },
    readQuote: input => { identifier(input.quoteId); return transaction(input,false,async (db,_user,org) => ({ quote: await detail(db,org.id,input.quoteId) })); },
    createQuote: save,
    updateQuote: save,
  };
}
