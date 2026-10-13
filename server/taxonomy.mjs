import { pagination, requirePrincipal } from './principals.mjs';
import {
  HttpError,
  fail,
  identifier,
  rows,
  one,
  readUser,
  readOrganization,
  guardUser,
  guardOrganization,
  authorize,
} from './shared.mjs';
import {
  bounded,
  object,
  invalid,
  normalizeContent,
  checkedSnapshot,
  sameContent,
  summary,
  configure,
} from './taxonomy-content.mjs';
const iso = (date) => (date == null ? null : new Date(date).toISOString());
const actor = (version) => ({
  id: String(version.created_by_user_id),
  name: version.modifier_name,
});
const reply = (body, statusCode = 200) => ({ statusCode, body });
const missing = () => fail(404, 'NOT_FOUND', 'Taxonomy not found.');
function expected(value, current) {
  identifier(value);
  if (value !== String(current)) {
    const error = new HttpError(
      409,
      'VERSION_CONFLICT',
      'The taxonomy changed. Reload before saving or configuring.',
    );
    error.currentVersionId = String(current);
    throw error;
  }
}
async function version(db, id) {
  const v = await one(
    db,
    `SELECT v.*, COALESCE(u.display_name,u.email) AS modifier_name
    FROM public.taxonomy_versions v JOIN public.users u ON u.id=v.created_by_user_id WHERE v.id=$1`,
    [id],
  );
  if (!v) throw new Error('Missing current taxonomy version');
  checkedSnapshot(v.content);
  return v;
}
function resource(t, v, role) {
  return {
    id: String(t.id),
    ownerOrganizationId: String(t.owner_organization_id),
    createdAt: iso(t.created_at),
    archivedAt: iso(t.archived_at),
    currentVersionId: String(t.current_version_id),
    principalId: String(t.principal_id),
    principalName: t.principal_name,
    permissions: {
      canEdit: !t.archived_at && ['admin', 'editor'].includes(role),
      canArchive: !t.archived_at && role === 'admin',
      canPreview: !t.archived_at,
    },
    version: {
      id: String(v.id),
      versionNumber: v.version_number,
      createdAt: iso(v.created_at),
      principalId: v.principal_id == null ? null : String(v.principal_id),
      modifiedBy: actor(v),
      changeSummary: v.change_summary,
      content: v.content,
    },
  };
}
async function insertVersion(
  db,
  taxonomyId,
  userId,
  number,
  content,
  changeSummary,
  principalId,
  id = null,
) {
  if (id !== null)
    return one(
      db,
      `INSERT INTO public.taxonomy_versions(id,taxonomy_id,version_number,content,created_by_user_id,change_summary,principal_id)
    VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        id,
        taxonomyId,
        number,
        JSON.stringify(content),
        userId,
        changeSummary,
        principalId,
      ],
    );
  return one(
    db,
    `INSERT INTO public.taxonomy_versions(taxonomy_id,version_number,content,created_by_user_id,change_summary,principal_id)
    VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
    [
      taxonomyId,
      number,
      JSON.stringify(content),
      userId,
      changeSummary,
      principalId,
    ],
  );
}
export function createTaxonomyService(withTransaction) {
  // Reads authorize against the transaction snapshot without writing guard rows.
  // Mutations retain guards and run once, surfacing concurrent changes.
  async function transaction(identity, orgId, work, read = false) {
    identifier(orgId);
    try {
      return await withTransaction(async (db) => {
        if (read) {
          const user = await readUser(db, identity);
          const org = await readOrganization(db, orgId);
          const access = await authorize(db, user, org);
          return work(db, { user, org, access });
        }
        const account = await one(
          db,
          'SELECT id FROM public.users WHERE cognito_issuer=$1 AND cognito_subject=$2',
          [identity.issuer, identity.sub],
        );
        if (!account)
          fail(
            401,
            'BOOTSTRAP_REQUIRED',
            'Please sign in to initialize your account.',
          );
        const user = await guardUser(db, account.id);
        const org = await guardOrganization(db, orgId);
        const access = await authorize(db, user, org);
        return work(db, { user, org, access });
      });
    } catch (error) {
      if (
        error.code === '40001' ||
        (error.code === '23505' &&
          error.constraint === 'taxonomy_version_number_unique')
      )
        fail(
          409,
          'CONCURRENT_CHANGE',
          'Another change occurred. Reload before trying again.',
        );
      throw error;
    }
  }
  function editable(access, archive = false) {
    if (
      archive
        ? access.role !== 'admin'
        : !['admin', 'editor'].includes(access.role)
    )
      fail(
        403,
        'FORBIDDEN',
        'Your organization role does not allow this action.',
      );
  }
  return {
    async listTaxonomies({ body = {}, query = {}, orgId, identity }) {
      bounded(body);
      identifier(orgId);
      const paging = pagination(query, ['principalId']);
      if (query.principalId !== undefined) identifier(query.principalId);
      object(body, []);
      return transaction(identity, orgId, async (db, { user, access }) => {
        const { page, pageSize, offset } = paging;
        const totalItems = Number(
          (
            await one(
              db,
              'SELECT count(*) AS total FROM public.taxonomies WHERE owner_organization_id=$1 AND archived_at IS NULL AND ($2::bigint IS NULL OR principal_id=$2)',
              [orgId, query.principalId ?? null],
            )
          ).total,
        );
        const items = await rows(
          db,
          `SELECT t.id,t.principal_id,p.name AS principal_name,t.current_version_id,v.version_number,v.content->>'productFamilyName' AS family_name,v.content->'segments' AS segments,v.content->'separators' AS separators,
            v.created_at,v.created_by_user_id,COALESCE(u.display_name,u.email) AS modifier_name
            FROM public.taxonomies t JOIN public.taxonomy_versions v ON v.id=t.current_version_id AND v.taxonomy_id=t.id
            JOIN public.users u ON u.id=v.created_by_user_id JOIN public.principals p ON p.id=t.principal_id
            WHERE t.owner_organization_id=$1 AND t.archived_at IS NULL AND ($4::bigint IS NULL OR t.principal_id=$4)
            ORDER BY t.created_at DESC,t.id DESC LIMIT $2 OFFSET $3`,
          [orgId, pageSize, offset, query.principalId ?? null],
        );
        return reply({
          items: items.map((v) => ({
            id: String(v.id),
            productFamilyName: v.family_name,
            modelCode: v.segments.map(s => s.options.length === 1 ? s.options[0].code : s.placeholder).map((code,i) => (i ? (v.separators?.[i-1] ?? '-') : '') + code).join(''),
            principalId: String(v.principal_id),
            principalName: v.principal_name,
            currentVersionId: String(v.current_version_id),
            versionNumber: v.version_number,
            modifiedAt: iso(v.created_at),
            modifiedBy: actor(v),
          })),
          page,
          pageSize,
          totalItems,
          totalPages: Math.ceil(totalItems / pageSize),
        });
      }, true);
    },
    async createTaxonomy({ body = {}, query = {}, orgId, identity }) {
      bounded(body);
      identifier(orgId);
      object(query, []);
      object(body, ['principalId', 'content', 'changeSummary'], '', [
        'principalId',
        'content',
      ]);
      return transaction(identity, orgId, async (db, { user, access }) => {
        editable(access);
        const content = normalizeContent(body.content),
          changeSummary = summary(body.changeSummary);
        const principal = await requirePrincipal(db, body.principalId);
        const reserved = await one(
          db,
          "SELECT nextval(pg_get_serial_sequence('public.taxonomy_versions','id')) AS id",
        );
        const t = await one(
          db,
          `INSERT INTO public.taxonomies(owner_organization_id,current_version_id,created_by_user_id,principal_id)
            VALUES($1,$2,$3,$4) RETURNING *`,
          [orgId, reserved.id, user.id, principal.id],
        );
        await insertVersion(
          db,
          t.id,
          user.id,
          1,
          content,
          changeSummary,
          principal.id,
          reserved.id,
        );
        t.principal_name = principal.name;
        return reply(
          {
            taxonomy: resource(t, await version(db, reserved.id), access.role),
            unchanged: false,
          },
          201,
        );
      });
    },
    async readTaxonomy({ body = {}, query = {}, orgId, taxonomyId, identity }) {
      bounded(body);
      identifier(orgId);
      identifier(taxonomyId);
      object(query, []);
      object(body, []);
      return transaction(identity, orgId, async (db, { user, access }) => {
        const t = await one(
          db,
          'SELECT * FROM public.taxonomies WHERE id=$1 AND owner_organization_id=$2',
          [taxonomyId, orgId],
        );
        if (!t) missing();
        t.principal_name = (
          await requirePrincipal(db, String(t.principal_id))
        ).name;
        return reply({
          taxonomy: resource(
            t,
            await version(db, t.current_version_id),
            access.role,
          ),
        });
      }, true);
    },
    async archiveTaxonomy({
      body = {},
      query = {},
      orgId,
      taxonomyId,
      identity,
    }) {
      bounded(body);
      identifier(orgId);
      identifier(taxonomyId);
      object(query, []);
      object(body, ['expectedVersionId']);
      return transaction(identity, orgId, async (db, { user, access }) => {
        editable(access, true);
        const t = await one(
          db,
          'SELECT * FROM public.taxonomies WHERE id=$1 AND owner_organization_id=$2 FOR UPDATE',
          [taxonomyId, orgId],
        );
        if (!t) missing();
        t.principal_name = (
          await requirePrincipal(db, String(t.principal_id))
        ).name;
        expected(body.expectedVersionId, t.current_version_id);
        if (!t.archived_at) {
          const archived = await one(
            db,
            `UPDATE public.taxonomies SET archived_at=now(),archived_by_user_id=$1
              WHERE id=$2 AND current_version_id=$3 AND archived_at IS NULL RETURNING archived_at`,
            [user.id, t.id, body.expectedVersionId],
          );
          if (!archived)
            fail(409, 'CONCURRENT_CHANGE', 'The taxonomy changed. Reload.');
          t.archived_at = archived.archived_at;
        }
        return reply({
          taxonomyId: String(t.id),
          archivedAt: iso(t.archived_at),
        });
      });
    },
    async previewTaxonomy({
      body = {},
      query = {},
      orgId,
      taxonomyId,
      identity,
    }) {
      bounded(body);
      identifier(orgId);
      identifier(taxonomyId);
      object(query, []);
      object(body, ['versionId', 'selections']);
      return transaction(identity, orgId, async (db, { user, access }) => {
        const t = await one(
          db,
          'SELECT * FROM public.taxonomies WHERE id=$1 AND owner_organization_id=$2',
          [taxonomyId, orgId],
        );
        if (!t) missing();
        t.principal_name = (
          await requirePrincipal(db, String(t.principal_id))
        ).name;
        if (t.archived_at)
          fail(409, 'TAXONOMY_ARCHIVED', 'This taxonomy is archived.');
        expected(body.versionId, t.current_version_id);
        const previous = await version(db, t.current_version_id);
        return reply({
          configuration: {
            sourceTaxonomyId: String(t.id),
            sourceVersionId: String(previous.id),
            ...configure(previous.content, body.selections),
          },
        });
      }, true);
    },
    async saveTaxonomyVersion({
      body = {},
      query = {},
      orgId,
      taxonomyId,
      identity,
    }) {
      bounded(body);
      identifier(orgId);
      identifier(taxonomyId);
      object(query, []);
      object(
        body,
        ['expectedVersionId', 'principalId', 'content', 'changeSummary'],
        '',
        ['expectedVersionId', 'principalId', 'content'],
      );
      return transaction(identity, orgId, async (db, { user, access }) => {
        editable(access);
        const t = await one(
          db,
          'SELECT * FROM public.taxonomies WHERE id=$1 AND owner_organization_id=$2 FOR UPDATE',
          [taxonomyId, orgId],
        );
        if (!t) missing();
        t.principal_name = (
          await requirePrincipal(db, String(t.principal_id))
        ).name;
        if (t.archived_at)
          fail(409, 'TAXONOMY_ARCHIVED', 'This taxonomy is archived.');
        expected(body.expectedVersionId, t.current_version_id);
        const previous = await version(db, t.current_version_id);
        const content = normalizeContent(body.content, previous.content),
          changeSummary = summary(body.changeSummary);
        const principal = await requirePrincipal(db, body.principalId);
        if (
          sameContent(content, previous.content) &&
          String(t.principal_id) === body.principalId
        )
          return reply({
            taxonomy: resource(t, previous, access.role),
            unchanged: true,
          });
        if (previous.version_number === 2147483647)
          fail(
            409,
            'CONCURRENT_CHANGE',
            'Version limit reached. Contact an administrator.',
          );
        const next = await insertVersion(
          db,
          t.id,
          user.id,
          previous.version_number + 1,
          content,
          changeSummary,
          principal.id,
        );
        const advanced = await one(
          db,
          `UPDATE public.taxonomies SET current_version_id=$1, principal_id=$4
          WHERE id=$2 AND current_version_id=$3 AND archived_at IS NULL RETURNING *`,
          [next.id, t.id, body.expectedVersionId, principal.id],
        );
        if (!advanced)
          fail(409, 'CONCURRENT_CHANGE', 'The taxonomy changed. Reload.');
        advanced.principal_name = principal.name;
        return reply(
          {
            taxonomy: resource(
              advanced,
              await version(db, next.id),
              access.role,
            ),
            unchanged: false,
          },
          201,
        );
      });
    },
  };
}
