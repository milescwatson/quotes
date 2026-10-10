import { test, expect } from '@playwright/test'
import { createHash } from 'node:crypto'
const issuer = 'https://cognito-idp.us-west-2.amazonaws.com/us-west-2_test'
const organizationId = '10'
const jsonHeaders = {
  'content-type': 'application/json',
  'access-control-allow-origin': 'http://127.0.0.1:3101',
  'access-control-allow-headers': 'authorization,content-type',
  'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
}
test('real OIDC adapter uses PKCE, returns to organization, and uses HTTP client without storing tokens', async ({
  page,
}) => {
  let challenge = '',
    nonce = '',
    exchanged = false,
    authenticatedCalls = 0,
    addedOrganization = false
  await page.route(`${issuer}/.well-known/openid-configuration`, (route) =>
    route.fulfill({
      headers: jsonHeaders,
      json: {
        issuer,
        authorization_endpoint: 'https://login.quotes.test/oauth2/authorize',
        token_endpoint: 'https://login.quotes.test/oauth2/token',
        jwks_uri: 'https://login.quotes.test/.well-known/jwks.json',
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
      },
    }),
  )
  await page.route('https://login.quotes.test/**', async (route) => {
    const url = new URL(route.request().url())
    if (route.request().method() === 'OPTIONS')
      return route.fulfill({ status: 204, headers: jsonHeaders })
    if (url.pathname === '/oauth2/authorize') {
      expect(url.searchParams.get('response_type')).toBe('code')
      expect(url.searchParams.get('code_challenge_method')).toBe('S256')
      challenge = url.searchParams.get('code_challenge')!
      nonce = url.searchParams.get('nonce') || ''
      const callback = new URL(url.searchParams.get('redirect_uri')!)
      expect(callback.origin).toBe('http://127.0.0.1:3101')
      callback.searchParams.set('code', 'test-code')
      callback.searchParams.set('state', url.searchParams.get('state')!)
      return route.fulfill({
        status: 302,
        headers: { location: callback.href },
      })
    }
    if (url.pathname === '/oauth2/token') {
      const body = new URLSearchParams(route.request().postData()!)
      expect(body.get('grant_type')).toBe('authorization_code')
      expect(
        createHash('sha256')
          .update(body.get('code_verifier')!)
          .digest('base64url'),
      ).toBe(challenge)
      const encode = (value: unknown) =>
        Buffer.from(JSON.stringify(value)).toString('base64url')
      const now = Math.floor(Date.now() / 1000)
      const idToken = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iss: issuer, aud: 'test-client', sub: 'test-subject', exp: now + 3600, iat: now, ...(nonce ? { nonce } : {}) })}.test-signature`
      exchanged = true
      return route.fulfill({
        headers: jsonHeaders,
        json: {
          access_token: 'test-access-token',
          id_token: idToken,
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'openid email profile quotes-api/access',
        },
      })
    }
    return route.fulfill({ status: 404 })
  })
  await page.route('https://api.quotes.test/**', (route) => {
    if (route.request().method() === 'OPTIONS')
      return route.fulfill({ status: 204, headers: jsonHeaders })
    expect(route.request().headers().authorization).toBe(
      'Bearer test-access-token',
    )
    authenticatedCalls++
    const path = new URL(route.request().url()).pathname
    const data =
      path === '/v1/me/bootstrap'
        ? {
            user: {
              id: '1',
              displayName: 'Alex',
              email: 'alex@example.com',
            },
          }
        : path === '/v1/me/organizations'
          ? {
              items: [
                { id: organizationId, name: 'Quotes', role: 'member' },
                ...(addedOrganization
                  ? [
                      {
                        id: '11',
                        name: 'New team',
                        role: 'editor',
                      },
                    ]
                  : []),
              ],
              nextCursor: null,
            }
          : path === `/v1/organizations/${organizationId}/quotes`
            ? { items: [], page: 1, pageSize: 50, totalItems: 0, totalPages: 0 }
            : path === `/v1/organizations/${organizationId}/quote-owners`
              ? { items: [] }
          : path === `/v1/organizations/${organizationId}`
            ? {
                organization: {
                  id: organizationId,
                  name: 'Quotes',
                  role: 'member',
                },
              }
            : null
    return route.fulfill({
      status: data ? 200 : 404,
      headers: jsonHeaders,
      json: data || { code: 'NOT_FOUND', message: 'Not found' },
    })
  })
  await page.goto('/login')
  await expect(page.getByText('Demo workspace')).toHaveCount(0)
  await page.getByRole('button', { name: 'Continue to sign in' }).click()
  await expect(page).toHaveURL(
    (url) => url.pathname === `/organizations/${createHash('sha256').update(organizationId).digest('hex').slice(0, 12)}/quotes`,
  )
  await expect(
    page.getByRole('heading', { name: 'Quotes', exact: true }),
  ).toBeVisible()
  addedOrganization = true
  await page.getByRole('button', { name: 'Switch organization' }).click()
  await expect(
    page
      .getByRole('navigation', { name: 'Organization navigation' })
      .getByRole('link', { name: 'New team', exact: true }),
  ).toBeVisible()
  expect(exchanged).toBe(true)
  expect(authenticatedCalls).toBeGreaterThanOrEqual(3)
  const stored = await page.evaluate(() =>
    JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
    }),
  )
  expect(stored).not.toContain('test-access-token')
  expect(stored).not.toContain('test-signature')
})
test('an unsolicited OAuth callback is rejected', async ({ page }) => {
  await page.goto('/auth/callback?code=forged&state=unknown')
  await expect(
    page.getByRole('heading', { name: 'Sign-in couldn’t be completed' }),
  ).toBeVisible()
  await expect(
    page.getByRole('link', { name: 'Try signing in again' }),
  ).toBeVisible()
  await expect(page.getByLabel('Switch organization')).toHaveCount(0)
})
