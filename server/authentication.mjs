import { HttpError } from './shared.mjs';
export function verifiedIdentityLookup(config, fetchUser = fetch) {
  return async (request, claims) => {
    const token = request.headers.authorization;
    if (!/^Bearer [^ ]+$/.test(token || ''))
      throw new HttpError(401, 'UNAUTHORIZED', 'Please sign in to continue.');
    if (!config.COGNITO_DOMAIN)
      throw new HttpError(
        503,
        'CONFIGURATION',
        'Sign-in is not configured yet.',
      );
    let response;
    try {
      response = await fetchUser(`${config.COGNITO_DOMAIN}/oauth2/userInfo`, {
        headers: { Authorization: token },
        signal: AbortSignal.timeout(4000),
      });
    } catch {
      throw new HttpError(
        503,
        'IDENTITY_UNAVAILABLE',
        'We could not verify your account. Please try again.',
      );
    }
    if (!response.ok)
      throw new HttpError(
        response.status === 401 ? 401 : 503,
        'IDENTITY_UNAVAILABLE',
        'We could not verify your account. Please sign in again.',
      );
    const attributes = await response.json();
    if (
      attributes.sub !== claims.sub ||
      !attributes.email ||
      ![true, 'true'].includes(attributes.email_verified)
    )
      throw new HttpError(
        403,
        'EMAIL_UNVERIFIED',
        'Verify your email address before continuing.',
      );
    return {
      issuer: claims.iss,
      sub: claims.sub,
      email: attributes.email,
      name: attributes.name,
    };
  };
}
export function validateClaims(claims, config) {
  if (
    !claims ||
    typeof claims.sub !== 'string' ||
    !claims.sub ||
    claims.iss !== config.COGNITO_ISSUER ||
    claims.client_id !== config.COGNITO_CLIENT_ID ||
    claims.token_use !== 'access' ||
    !Number.isFinite(Number(claims.exp)) ||
    Number(claims.exp) <= Date.now() / 1000 ||
    !String(claims.scope).split(' ').includes('quotes-api/access')
  )
    throw new HttpError(401, 'UNAUTHORIZED', 'Please sign in to continue.');
  return claims;
}
