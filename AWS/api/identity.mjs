import { HttpError, fail, identifier, fields, rows, one, guardUser, guardOrganization, authorize } from './shared.mjs';
export { HttpError } from './shared.mjs';
function name(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 120)
    fail(422, 'INVALID_INPUT', 'Enter a name between 1 and 120 characters.');
  return value.trim();
}
function role(value) {
  if (!['admin', 'editor', 'member'].includes(value))
    fail(422, 'INVALID_INPUT', 'Choose a valid role.');
  return value;
}
function email(value) {
  if (
    typeof value !== 'string' ||
    value.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) ||
    /[^\x21-\x7e]/.test(value.trim())
  )
    fail(422, 'INVALID_INPUT', 'Enter a valid email address.');
  return value.trim().toLowerCase();
}
const profile = (u) => ({
  id: String(u.id),
  email: u.email,
  displayName: u.display_name,
});
const organization = (o) => ({ id: String(o.id), name: o.name, role: o.role });
const member = (m) => ({
  id: String(m.id),
  userId: String(m.user_id),
  email: m.email,
  displayName: m.display_name,
  role: m.role,
});
async function audit(db, user, org, action, type, id, requestId, details = {}) {
  await db.query(
    `INSERT INTO public.identity_audit_events(organization_id,actor_type,actor_user_id,action,entity_type,entity_id,request_id,details)
    VALUES($1,'user',$2,$3,$4,$5,$6,$7)`,
    [
      org,
      user.id,
      action,
      type,
      id,
      requestId,
      JSON.stringify(details),
    ],
  );
}
async function page(db, sql, args, key, time, query, map) {
  const limit = query.limit === undefined ? 50 : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    fail(422, 'INVALID_INPUT', 'Page size must be between 1 and 100.');
  let after = '';
  if (query.cursor) {
    let cursor;
    try {
      cursor = JSON.parse(Buffer.from(query.cursor, 'base64url').toString());
    } catch {
      fail(422, 'INVALID_INPUT', 'Invalid page cursor.');
    }
    if (
      !Array.isArray(cursor) ||
      cursor.length !== 2 ||
      typeof cursor[0] !== 'string' ||
      cursor[0].length > 40 ||
      Number.isNaN(Date.parse(cursor[0]))
    )
      fail(422, 'INVALID_INPUT', 'Invalid page cursor.');
    identifier(cursor[1]);
    args.push(...cursor);
    after = ` AND (${time},${key}) > ($${args.length - 1}::timestamptz,$${args.length}::bigint)`;
  }
  args.push(limit + 1);
  const result = await rows(
    db,
    `${sql}${after} ORDER BY ${time},${key} LIMIT $${args.length}`,
    args,
  );
  const more = result.length > limit;
  const items = result.slice(0, limit);
  const last = items.at(-1);
  return {
    items: items.map(map),
    nextCursor: more
      ? Buffer.from(
          JSON.stringify([last.cursor_time, String(last.cursor_id)]),
        ).toString('base64url')
      : null,
  };
}
async function quotePage(db, organizationId, query) {
  const integer = (value, fallback, maximum) => {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value) ||
        !Number.isSafeInteger(Number(value)) || Number(value) > maximum)
      fail(422, 'INVALID_INPUT', 'Use a positive page number and a page size between 1 and 100.');
    return Number(value);
  };
  const page = integer(query.page, 1, Number.MAX_SAFE_INTEGER);
  const pageSize = integer(query.pageSize, 50, 100);
  const offset = (page - 1) * pageSize;
  if (!Number.isSafeInteger(offset))
    fail(422, 'INVALID_INPUT', 'The requested page is too large.');
  const args = [organizationId];
  const predicates = ['q.organization_id=$1'];
  for (const [key, column] of [['customer', 'customer_name'], ['project', 'project_name']]) {
    if (query[key] !== undefined) {
      if (typeof query[key] !== 'string' || query[key].length > 120)
        fail(422, 'INVALID_INPUT', 'Filters must contain at most 120 characters.');
      if (query[key].trim()) {
        args.push(query[key].trim());
        predicates.push(`strpos(lower(q.${column}), lower($${args.length})) > 0`);
      }
    }
  }
  if (query.ownerId === 'unassigned') predicates.push('q.owner_user_id IS NULL');
  else if (query.ownerId) {
    args.push(identifier(query.ownerId));
    predicates.push(`q.owner_user_id=$${args.length}`);
  }
  const where = predicates.join(' AND ');
  const totalItems = Number((await one(db,
    `SELECT count(*) AS total FROM public.quotes q WHERE ${where}`, args,
  )).total);
  const quotes = await rows(db,
    `SELECT q.*, COALESCE(u.display_name, u.email) AS modifier_name,
       COALESCE(owner.display_name, owner.email) AS owner_name
     FROM public.quotes q JOIN public.users u ON u.id=q.modified_by
     LEFT JOIN public.users owner ON owner.id=q.owner_user_id
     WHERE ${where}
     ORDER BY q.modified_when DESC, q.id DESC LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
    [...args, pageSize, offset],
  );
  return {
    items: quotes.map(q => ({
      id: String(q.id),
      organizationId: String(q.organization_id),
      customerId: q.customer_id,
      ownerId: q.owner_user_id == null ? null : String(q.owner_user_id),
      ownerName: q.owner_name,
      customerName: q.customer_name,
      projectName: q.project_name,
      title: `${q.customer_name} - ${q.project_name}`,
      modifiedBy: String(q.modified_by),
      modifiedByName: q.modifier_name,
      modifiedWhen: new Date(q.modified_when).toISOString(),
    })),
    page, pageSize, totalItems, totalPages: Math.ceil(totalItems / pageSize),
  };
}
export function createIdentityService(withTransaction) {
  return async ({
    method,
    path,
    body = {},
    query = {},
    identity,
    requestId,
  }) => {
    return withTransaction(async (db) => {
      const parts = path.split('/').filter(Boolean);
      let u = await one(
        db,
        'SELECT * FROM public.users WHERE cognito_issuer=$1 AND cognito_subject=$2',
        [identity.issuer, identity.sub],
      );
      if (path === '/me/bootstrap' && method === 'POST') {
        fields(body, []);
        if (!u) {
          u = await one(
            db,
            `INSERT INTO public.users(cognito_issuer,cognito_subject,email,normalized_email,display_name)
            VALUES($1,$2,$3,$4,$5) RETURNING *`,
            [
              identity.issuer,
              identity.sub,
              identity.email.trim(),
              email(identity.email),
              identity.name?.trim().slice(0, 120) || null,
            ],
          );
          await audit(db, u, null, 'user.created', 'user', u.id, requestId);
        } else {
          await guardUser(db, u.id);
          u = await one(
            db,
            'UPDATE public.users SET email=$1,normalized_email=$2,updated_at=now() WHERE id=$3 RETURNING *',
            [identity.email.trim(), email(identity.email), u.id],
          );
        }
        return { user: profile(u) };
      }
      if (!u)
        fail(
          401,
          'BOOTSTRAP_REQUIRED',
          'Please sign in to initialize your account.',
        );
      // Guard all participant users in numeric ID order before touching an organization.
      const userIds = new Set([u.id]);
      const editingOwner = parts[0] === 'organizations' && parts[2] === 'quotes' && parts.length === 4 && method === 'PATCH';
      if (editingOwner) {
        identifier(parts[1]);
        identifier(parts[3]);
        fields(body, ['ownerId']);
        if (body.ownerId !== null) userIds.add(identifier(body.ownerId));
      }
      if (parts[0] === 'organizations' && parts[2] === 'members' && parts[3]) {
        identifier(parts[1]);
        identifier(parts[3]);
        const target = await one(
          db,
          'SELECT user_id FROM public.organization_memberships WHERE id=$1 AND organization_id=$2',
          [parts[3], parts[1]],
        );
        if (target) userIds.add(target.user_id);
      }
      let addedUser;
      if (
        parts[0] === 'organizations' &&
        parts[2] === 'members' &&
        !parts[3] &&
        method === 'POST'
      ) {
        fields(body, ['email', 'role']);
        role(body.role);
        const matches = await rows(
          db,
          'SELECT * FROM public.users WHERE cognito_issuer=$1 AND normalized_email=$2 AND disabled_at IS NULL',
          [identity.issuer, email(body.email)],
        );
        // Email selects an existing identity; it never merges accounts.
        if (matches.length === 1) {
          addedUser = matches[0];
          userIds.add(addedUser.id);
        }
      }
      for (const id of [...userIds].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0)) {
        if (id === u.id) u = await guardUser(db, id);
        else
          await db.query(
            'UPDATE public.users SET auth_revision=auth_revision+1 WHERE id=$1',
            [id],
          );
      }
      if (path === '/me') {
        if (method === 'PATCH') {
          fields(body, ['displayName']);
          const value =
            body.displayName === null ? null : name(body.displayName);
          u = await one(
            db,
            'UPDATE public.users SET display_name=$1,updated_at=now() WHERE id=$2 RETURNING *',
            [value, u.id],
          );
          await audit(db, u, null, 'profile.updated', 'user', u.id, requestId);
        } else if (method !== 'GET') fail(404, 'NOT_FOUND', 'Route not found.');
        return { user: profile(u) };
      }
      if (path === '/me/organizations' && method === 'GET')
        return page(
          db,
          `SELECT o.*,m.role,o.created_at::text AS cursor_time,o.id AS cursor_id
        FROM public.organizations o JOIN public.organization_memberships m ON m.organization_id=o.id
        WHERE m.user_id=$1 AND m.removed_at IS NULL AND o.status='active'`,
          [u.id],
          'o.id',
          'o.created_at',
          query,
          organization,
        );
      if (parts[0] !== 'organizations' || !parts[1])
        fail(404, 'NOT_FOUND', 'Route not found.');
      const org = await guardOrganization(db, identifier(parts[1]));
      const listingQuotes = parts.length === 3 && parts[2] === 'quotes' && method === 'GET';
      const listingOwners = parts.length === 3 && parts[2] === 'quote-owners' && method === 'GET';
      const access = await authorize(
        db,
        u,
        org,
        !listingQuotes && !listingOwners && !editingOwner && (parts.length > 2 || method !== 'GET'),
      );
      if (listingQuotes) return quotePage(db, org.id, query);
      if (listingOwners) {
        const owners = await rows(db, `SELECT u.id, COALESCE(u.display_name,u.email) AS name
          FROM public.organization_memberships m JOIN public.users u ON u.id=m.user_id
          WHERE m.organization_id=$1 AND m.removed_at IS NULL AND u.disabled_at IS NULL
          ORDER BY lower(COALESCE(u.display_name,u.email)),u.id`, [org.id]);
        return { items: owners.map(owner => ({ id: String(owner.id), name: owner.name })) };
      }
      if (editingOwner) {
        const quote = await one(db, 'SELECT id FROM public.quotes WHERE id=$1 AND organization_id=$2', [parts[3], org.id]);
        if (!quote) fail(404, 'NOT_FOUND', 'Quote not found.');
        if (body.ownerId !== null) {
          const owner = await one(db, `SELECT u.id FROM public.organization_memberships m
            JOIN public.users u ON u.id=m.user_id WHERE m.organization_id=$1 AND m.user_id=$2
            AND m.removed_at IS NULL AND u.disabled_at IS NULL`, [org.id, body.ownerId]);
          if (!owner) fail(422, 'OWNER_UNAVAILABLE', 'Choose an active team member from this organization.');
        }
        await db.query(`UPDATE public.quotes SET owner_user_id=$1, modified_by=$2, modified_when=now()
          WHERE id=$3 AND organization_id=$4`, [body.ownerId, u.id, parts[3], org.id]);
        return { success: true };
      }
      if (parts.length === 2) {
        if (method === 'PATCH') {
          fields(body, ['name']);
          const old = org.name;
          org.name = name(body.name);
          await db.query(
            'UPDATE public.organizations SET name=$1,updated_at=now() WHERE id=$2',
            [org.name, org.id],
          );
          await audit(
            db,
            u,
            org.id,
            'organization.updated',
            'organization',
            org.id,
            requestId,
            { before: old, after: org.name },
          );
        } else if (method !== 'GET') fail(404, 'NOT_FOUND', 'Route not found.');
        return { organization: organization({ ...org, role: access.role }) };
      }
      if (parts[2] === 'members') {
        if (!parts[3] && method === 'POST') {
          if (!addedUser)
            fail(
              422,
              'ACCOUNT_UNAVAILABLE',
              'No unique active account matches this email. Ask your teammate to sign in first.',
            );
          let membership = await one(
            db,
            'SELECT * FROM public.organization_memberships WHERE organization_id=$1 AND user_id=$2',
            [org.id, addedUser.id],
          );
          if (membership && !membership.removed_at)
            fail(
              409,
              'ALREADY_MEMBER',
              'This person is already a member. Change their role from Members.',
            );
          if (membership)
            membership = await one(
              db,
              'UPDATE public.organization_memberships SET role=$1,removed_at=NULL,updated_at=now() WHERE id=$2 RETURNING *',
              [body.role, membership.id],
            );
          else
            membership = await one(
              db,
              'INSERT INTO public.organization_memberships(organization_id,user_id,role) VALUES($1,$2,$3) RETURNING *',
              [org.id, addedUser.id, body.role],
            );
          await audit(
            db,
            u,
            org.id,
            'membership.added',
            'membership',
            membership.id,
            requestId,
            { role: body.role },
          );
          return {
            member: member({
              ...membership,
              email: addedUser.email,
              display_name: addedUser.display_name,
            }),
          };
        }

        if (!parts[3] && method === 'GET')
          return page(
            db,
            `SELECT m.*,u.email,u.display_name,m.joined_at::text AS cursor_time,m.id AS cursor_id FROM public.organization_memberships m JOIN public.users u ON u.id=m.user_id
          WHERE m.organization_id=$1 AND m.removed_at IS NULL`,
            [org.id],
            'm.id',
            'm.joined_at',
            query,
            member,
          );
        const m = await one(
          db,
          'SELECT * FROM public.organization_memberships WHERE id=$1 AND organization_id=$2',
          [identifier(parts[3]), org.id],
        );
        if (!m) fail(404, 'NOT_FOUND', 'Member not found.');
        if (method === 'DELETE' && m.removed_at) return { success: true };
        if (m.removed_at)
          fail(409, 'MEMBER_REMOVED', 'This member no longer has access.');
        const nextRole =
          method === 'PATCH' ? (fields(body, ['role']), role(body.role)) : null;
        if (!['PATCH', 'DELETE'].includes(method))
          fail(404, 'NOT_FOUND', 'Route not found.');
        if (m.role === 'admin' && nextRole !== 'admin') {
          const other = await one(
            db,
            `SELECT m.id FROM public.organization_memberships m JOIN public.users u ON u.id=m.user_id
            WHERE m.organization_id=$1 AND m.role='admin' AND m.removed_at IS NULL AND u.disabled_at IS NULL AND m.id<>$2 LIMIT 1`,
            [org.id, m.id],
          );
          if (!other)
            fail(
              409,
              'LAST_ADMIN',
              'Your organization needs at least one administrator. Make another member an admin first.',
            );
        }
        if (method === 'DELETE')
          await db.query(
            'UPDATE public.organization_memberships SET removed_at=now(),updated_at=now() WHERE id=$1',
            [m.id],
          );
        else
          await db.query(
            'UPDATE public.organization_memberships SET role=$1,updated_at=now() WHERE id=$2',
            [nextRole, m.id],
          );
        await audit(
          db,
          u,
          org.id,
          method === 'DELETE'
            ? 'membership.removed'
            : 'membership.role_changed',
          'membership',
          m.id,
          requestId,
          { before: m.role, after: nextRole },
        );
        return { success: true };
      }
      fail(404, 'NOT_FOUND', 'Route not found.');
    });
  };
}
