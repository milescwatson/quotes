import { HttpError, fail, identifier, rows, one, guardUser, guardOrganization, authorize } from './shared.mjs';
import { bounded, object, invalid, normalizeContent, checkedSnapshot, sameContent, summary, configure } from './taxonomy-content.mjs';
const iso = date => date == null ? null : new Date(date).toISOString();
const actor = version => ({ id: String(version.created_by_user_id), name: version.modifier_name });
const reply = (body, statusCode = 200) => ({ statusCode, body });
const missing = () => fail(404, 'NOT_FOUND', 'Taxonomy not found.');
function expected(value, current) {
  identifier(value);
  if (value !== String(current)) {
    const error = new HttpError(409, 'VERSION_CONFLICT', 'The taxonomy changed. Reload before saving or configuring.');
    error.currentVersionId = String(current);
    throw error;
  }
}
function pagination(query) {
  object(query, ['page', 'pageSize'], '', []);
  const number = (v, fallback, max) => {
    if (v === undefined) return fallback;
    if (typeof v !== 'string' || !/^[1-9][0-9]*$/.test(v) || !Number.isSafeInteger(Number(v)) || Number(v) > max)
      invalid('', 'Use positive page numbers and page sizes of at most 100.');
    return Number(v);
  };
  const page = number(query.page, 1, Number.MAX_SAFE_INTEGER), pageSize = number(query.pageSize, 50, 100);
  const offset = (page - 1) * pageSize;
  if (!Number.isSafeInteger(offset)) invalid('', 'Page is too large.');
  return { page, pageSize, offset };
}
async function version(db, id) {
  const v = await one(db, `SELECT v.*, COALESCE(u.display_name,u.email) AS modifier_name
    FROM public.taxonomy_versions v JOIN public.users u ON u.id=v.created_by_user_id WHERE v.id=$1`, [id]);
  if (!v) throw new Error('Missing current taxonomy version');
  checkedSnapshot(v.content);
  return v;
}
function resource(t, v, role) {
  return { id: String(t.id), ownerOrganizationId: String(t.owner_organization_id), createdAt: iso(t.created_at),
    archivedAt: iso(t.archived_at), currentVersionId: String(t.current_version_id),
    permissions: { canEdit: !t.archived_at && ['admin', 'editor'].includes(role),
      canArchive: !t.archived_at && role === 'admin', canPreview: !t.archived_at },
    version: { id: String(v.id), versionNumber: v.version_number, createdAt: iso(v.created_at),
      modifiedBy: actor(v), changeSummary: v.change_summary, content: v.content } };
}
async function insertVersion(db, taxonomyId, userId, number, content, changeSummary, id = null) {
  if (id !== null) return one(db, `INSERT INTO public.taxonomy_versions(id,taxonomy_id,version_number,content,created_by_user_id,change_summary)
    VALUES($1,$2,$3,$4,$5,$6) RETURNING *`, [id, taxonomyId, number, JSON.stringify(content), userId, changeSummary]);
  return one(db, `INSERT INTO public.taxonomy_versions(taxonomy_id,version_number,content,created_by_user_id,change_summary)
    VALUES($1,$2,$3,$4,$5) RETURNING *`, [taxonomyId, number, JSON.stringify(content), userId, changeSummary]);
}
export function createTaxonomyService(withTransaction) {
  return async ({ method, path, body = {}, query = {}, identity }) => {
    // Bound decoded requests for direct service callers as well as the HTTP boundary.
    bounded(body);
    const match = /^\/organizations\/([^/]+)\/taxonomies(?:\/([^/]+)(?:\/(versions|preview|archive))?)?$/.exec(path);
    if (!match) missing();
    const [, orgId, taxonomyId, action] = match;
    identifier(orgId);
    if (taxonomyId) identifier(taxonomyId);
    const allowed = !taxonomyId ? ['GET', 'POST'] : action ? ['POST'] : ['GET'];
    if (!allowed.includes(method)) missing();
    const paging = method === 'GET' && !taxonomyId ? pagination(query) : (object(query, []), null);
    if (method === 'GET') object(body, []);
    else if (!taxonomyId) object(body, ['content', 'changeSummary'], '', ['content']);
    else if (action === 'versions') object(body, ['expectedVersionId', 'content', 'changeSummary'], '', ['expectedVersionId', 'content']);
    else if (action === 'archive') object(body, ['expectedVersionId']);
    else object(body, ['versionId', 'selections']);
    try {
      return await withTransaction(async db => {
        const account = await one(db, 'SELECT id FROM public.users WHERE cognito_issuer=$1 AND cognito_subject=$2', [identity.issuer, identity.sub]);
        if (!account) fail(401, 'BOOTSTRAP_REQUIRED', 'Please sign in to initialize your account.');
        const user = await guardUser(db, account.id);
        const org = await guardOrganization(db, orgId);
        const access = await authorize(db, user, org);
        if (method === 'POST' && action !== 'preview') {
          if (action === 'archive' ? access.role !== 'admin' : !['admin', 'editor'].includes(access.role))
            fail(403, 'FORBIDDEN', 'Your organization role does not allow this action.');
        }
        if (paging) {
          const { page, pageSize, offset } = paging;
          const totalItems = Number((await one(db, 'SELECT count(*) AS total FROM public.taxonomies WHERE owner_organization_id=$1 AND archived_at IS NULL', [orgId])).total);
          const items = await rows(db, `SELECT t.id,t.current_version_id,v.version_number,v.content->>'productFamilyName' AS family_name,
            v.created_at,v.created_by_user_id,COALESCE(u.display_name,u.email) AS modifier_name
            FROM public.taxonomies t JOIN public.taxonomy_versions v ON v.id=t.current_version_id AND v.taxonomy_id=t.id
            JOIN public.users u ON u.id=v.created_by_user_id
            WHERE t.owner_organization_id=$1 AND t.archived_at IS NULL
            ORDER BY t.created_at DESC,t.id DESC LIMIT $2 OFFSET $3`, [orgId, pageSize, offset]);
          return reply({ items: items.map(v => ({ id: String(v.id), productFamilyName: v.family_name,
            currentVersionId: String(v.current_version_id), versionNumber: v.version_number,
            modifiedAt: iso(v.created_at), modifiedBy: actor(v) })), page, pageSize, totalItems, totalPages: Math.ceil(totalItems / pageSize) });
        }
        if (!taxonomyId) {
          const content = normalizeContent(body.content), changeSummary = summary(body.changeSummary);
          const reserved = await one(db, "SELECT nextval(pg_get_serial_sequence('public.taxonomy_versions','id')) AS id");
          const t = await one(db, `INSERT INTO public.taxonomies(owner_organization_id,current_version_id,created_by_user_id)
            VALUES($1,$2,$3) RETURNING *`, [orgId, reserved.id, user.id]);
          await insertVersion(db, t.id, user.id, 1, content, changeSummary, reserved.id);
          return reply({ taxonomy: resource(t, await version(db, reserved.id), access.role), unchanged: false }, 201);
        }
        const t = await one(db, 'SELECT * FROM public.taxonomies WHERE id=$1 AND owner_organization_id=$2 FOR UPDATE', [taxonomyId, orgId]);
        if (!t) missing();
        if (method === 'GET') return reply({ taxonomy: resource(t, await version(db, t.current_version_id), access.role) });
        if (action === 'archive') {
          expected(body.expectedVersionId, t.current_version_id);
          if (!t.archived_at) {
            const archived = await one(db, `UPDATE public.taxonomies SET archived_at=now(),archived_by_user_id=$1
              WHERE id=$2 AND current_version_id=$3 AND archived_at IS NULL RETURNING archived_at`, [user.id, t.id, body.expectedVersionId]);
            if (!archived) fail(409, 'CONCURRENT_CHANGE', 'The taxonomy changed. Reload.');
            t.archived_at = archived.archived_at;
          }
          return reply({ taxonomyId: String(t.id), archivedAt: iso(t.archived_at) });
        }
        if (t.archived_at) fail(409, 'TAXONOMY_ARCHIVED', 'This taxonomy is archived.');
        expected(action === 'preview' ? body.versionId : body.expectedVersionId, t.current_version_id);
        const previous = await version(db, t.current_version_id);
        if (action === 'preview') return reply({ configuration: { sourceTaxonomyId: String(t.id), sourceVersionId: String(previous.id), ...configure(previous.content, body.selections) } });
        const content = normalizeContent(body.content, previous.content), changeSummary = summary(body.changeSummary);
        if (sameContent(content, previous.content)) return reply({ taxonomy: resource(t, previous, access.role), unchanged: true });
        if (previous.version_number === 2147483647) fail(409, 'CONCURRENT_CHANGE', 'Version limit reached. Contact an administrator.');
        const next = await insertVersion(db, t.id, user.id, previous.version_number + 1, content, changeSummary);
        const advanced = await one(db, `UPDATE public.taxonomies SET current_version_id=$1
          WHERE id=$2 AND current_version_id=$3 AND archived_at IS NULL RETURNING *`, [next.id, t.id, body.expectedVersionId]);
        if (!advanced) fail(409, 'CONCURRENT_CHANGE', 'The taxonomy changed. Reload.');
        return reply({ taxonomy: resource(advanced, await version(db, next.id), access.role), unchanged: false }, 201);
      });
    } catch (error) {
      if (error.code === '40001' || (error.code === '23505' && error.constraint === 'taxonomy_version_number_unique'))
        fail(409, 'CONCURRENT_CHANGE', 'Another change occurred. Reload before trying again.');
      throw error;
    }
  };
}
