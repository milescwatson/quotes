export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const fail = (status, code, message) => {
  throw new HttpError(status, code, message);
};
function identifier(value) {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,18}$/.test(value) ||
      BigInt(value) > 9223372036854775807n)
    fail(422, 'INVALID_INPUT', 'A valid identifier is required.');
  return value;
}
function fields(body, names) {
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).some((k) => !names.includes(k))
  )
    fail(422, 'INVALID_INPUT', 'The request contains unsupported fields.');
}
const rows = async (db, sql, args = []) => (await db.query(sql, args)).rows;
const one = async (db, sql, args = []) => (await rows(db, sql, args))[0];
function activeUser(u) {
  if (!u || u.disabled_at)
    fail(
      403,
      'ACCOUNT_DISABLED',
      'This account has been disabled. Contact your administrator.',
    );
  return u;
}
async function readUser(db, identity) {
  const u = await one(db,
    'SELECT * FROM public.users WHERE cognito_issuer=$1 AND cognito_subject=$2',
    [identity.issuer, identity.sub],
  );
  if (!u) fail(401, 'BOOTSTRAP_REQUIRED', 'Please sign in to initialize your account.');
  return activeUser(u);
}
async function guardUser(db, id) {
  return activeUser(await one(db,
    'UPDATE public.users SET auth_revision = auth_revision + 1 WHERE id = $1 RETURNING *',
    [id],
  ));
}
function activeOrganization(o) {
  if (!o || o.status === 'archived')
    fail(404, 'NOT_FOUND', 'You no longer have access to this organization.');
  return o;
}
async function readOrganization(db, id) {
  return activeOrganization(await one(db,
    'SELECT * FROM public.organizations WHERE id = $1', [id],
  ));
}
async function guardOrganization(db, id) {
  return activeOrganization(await one(db,
    'UPDATE public.organizations SET auth_revision = auth_revision + 1 WHERE id = $1 RETURNING *',
    [id],
  ));
}
async function authorize(db, user, org, admin = false) {
  const m = await one(
    db,
    `SELECT * FROM public.organization_memberships WHERE organization_id = $1 AND user_id = $2 AND removed_at IS NULL`,
    [org.id, user.id],
  );
  if (!m || org.status !== 'active')
    fail(404, 'NOT_FOUND', 'You no longer have access to this organization.');
  if (admin && m.role !== 'admin')
    fail(
      403,
      'FORBIDDEN',
      'Only an administrator can manage this organization.',
    );
  return m;
}

export { fail, identifier, fields, rows, one, readUser, readOrganization, guardUser, guardOrganization, authorize };
