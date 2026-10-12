import { parse } from 'tldts';
import {
  fail,
  identifier,
  rows,
  one,
  guardUser,
  guardOrganization,
  authorize,
} from './shared.mjs';
import { bounded, object, invalid } from './taxonomy-content.mjs';
export function principalInput(body) {
  object(body, ['name', 'websiteUrl']);
  if (typeof body.name !== 'string' || /[\p{Cc}\p{Cs}]/u.test(body.name))
    invalid('/name', 'Enter a principal name.');
  const name = body.name.normalize('NFC').trim().replace(/\s+/gu, ' ');
  if (!name || [...name].length > 120)
    invalid('/name', 'Use 1–120 characters.');
  let url;
  try {
    if (
      typeof body.websiteUrl !== 'string' ||
      !body.websiteUrl.trim() ||
      body.websiteUrl.length > 2048 ||
      /[\s\\]/u.test(body.websiteUrl.trim())
    )
      throw Error();
    const raw = body.websiteUrl.trim();
    url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw Error();
    url.hostname = url.hostname.replace(/\.$/, '');
    if (url.href.length > 2048) throw Error();
  } catch {
    invalid('/websiteUrl', 'Enter a valid public HTTP or HTTPS website.');
  }
  const domain = parse(url.hostname, { allowPrivateDomains: false });
  if (!domain.domain || !domain.isIcann || domain.isIp)
    invalid('/websiteUrl', 'Use a website with a public root domain.');
  return {
    name,
    normalizedName: name.toLowerCase(),
    websiteUrl: url.href,
    websiteKey: domain.domain,
  };
}
export function pagination(query, extra = []) {
  object(query, ['page', 'pageSize', ...extra], '', []);
  const value = (v, fallback, max) => {
    if (v === undefined) return fallback;
    if (
      typeof v !== 'string' ||
      !/^[1-9][0-9]*$/.test(v) ||
      !Number.isSafeInteger(Number(v)) ||
      Number(v) > max
    )
      invalid('', 'Use positive page numbers and page sizes of at most 100.');
    return Number(v);
  };
  const page = value(query.page, 1, Number.MAX_SAFE_INTEGER),
    pageSize = value(query.pageSize, 50, 100);
  const offset = (page - 1) * pageSize;
  if (!Number.isSafeInteger(offset)) invalid('', 'Page is too large.');
  return { page, pageSize, offset };
}
export const principalResource = (p) => ({
  id: String(p.id),
  name: p.name,
  websiteUrl: p.website_url,
});
export async function requirePrincipal(db, id) {
  if (
    typeof id !== 'string' ||
    !/^[1-9][0-9]{0,18}$/.test(id) ||
    BigInt(id) > 9223372036854775807n
  )
    invalid('/principalId', 'Choose a principal.');
  const p = await one(db, 'SELECT * FROM public.principals WHERE id=$1', [id]);
  if (!p) invalid('/principalId', 'Choose an existing principal.');
  return p;
}
export function createPrincipalService(withTransaction) {
  async function transaction(identity, orgId, admin, work) {
    identifier(orgId);
    try {
      return await withTransaction(async (db) => {
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
        const user = await guardUser(db, account.id),
          org = await guardOrganization(db, orgId);
        await authorize(db, user, org, admin);
        return work(db, user);
      });
    } catch (e) {
      if (e.code === '23505' && e.constraint === 'principals_name_unique')
        invalid(
          '/name',
          'A principal with this name already exists.',
          'PRINCIPAL_NAME_EXISTS',
          409,
        );
      if (e.code === '23505' && e.constraint === 'principals_website_unique')
        invalid(
          '/websiteUrl',
          'A principal with this root domain already exists.',
          'PRINCIPAL_WEBSITE_EXISTS',
          409,
        );
      if (e.code === '40001')
        fail(
          409,
          'CONCURRENT_CHANGE',
          'Another change occurred. Refresh and try again.',
        );
      throw e;
    }
  }
  return {
    async listPrincipals({ orgId, body = {}, query = {}, identity }) {
      bounded(body);
      identifier(orgId);
      const paging = pagination(query);
      object(body, []);
      return transaction(identity, orgId, false, async (db) => {
        const { page, pageSize, offset } = paging;
        const totalItems = Number(
          (await one(db, 'SELECT count(*) AS total FROM public.principals'))
            .total,
        );
        const items = await rows(
          db,
          'SELECT * FROM public.principals ORDER BY normalized_name,id LIMIT $1 OFFSET $2',
          [pageSize, offset],
        );
        return {
          statusCode: 200,
          body: {
            items: items.map(principalResource),
            page,
            pageSize,
            totalItems,
            totalPages: Math.ceil(totalItems / pageSize),
          },
        };
      });
    },
    async createPrincipal({ orgId, body = {}, query = {}, identity }) {
      bounded(body);
      identifier(orgId);
      object(query, []);
      return transaction(identity, orgId, true, async (db, user) => {
        const p = principalInput(body);
        const row = await one(
          db,
          `INSERT INTO public.principals(name,normalized_name,website_url,website_key,created_by_user_id)
          VALUES($1,$2,$3,$4,$5) RETURNING *`,
          [p.name, p.normalizedName, p.websiteUrl, p.websiteKey, user.id],
        );
        return { statusCode: 201, body: { principal: principalResource(row) } };
      });
    },
  };
}
