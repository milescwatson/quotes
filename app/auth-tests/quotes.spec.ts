import { test, expect } from '@playwright/test'
const issuer = 'https://cognito-idp.us-west-2.amazonaws.com/us-west-2_test'
const headers = {
  'access-control-allow-origin': 'http://127.0.0.1:3101',
  'access-control-allow-headers': 'authorization,content-type',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
}

test('quotes HTTP pagination recovers when the last page disappears and clears revoked data', async ({ page }) => {
  await page.route(`${issuer}/.well-known/openid-configuration`, route => route.fulfill({ headers, json: {
    issuer, authorization_endpoint: 'https://login.quotes.test/oauth2/authorize',
    token_endpoint: 'https://login.quotes.test/oauth2/token', jwks_uri: 'https://login.quotes.test/jwks',
    response_types_supported: ['code'], subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'],
  } }))
  let nonce = ''
  await page.route('https://login.quotes.test/**', route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    const url = new URL(route.request().url())
    if (url.pathname === '/oauth2/authorize') {
      nonce = url.searchParams.get('nonce') || ''
      const callback = new URL(url.searchParams.get('redirect_uri')!)
      callback.searchParams.set('code', 'test-code')
      callback.searchParams.set('state', url.searchParams.get('state')!)
      return route.fulfill({ status: 302, headers: { location: callback.href } })
    }
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
    const now = Math.floor(Date.now() / 1000)
    return route.fulfill({ headers, json: {
      access_token: 'quote-test-token', token_type: 'Bearer', expires_in: 3600,
      scope: 'openid email profile quotes-api/access',
      id_token: `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iss: issuer, aud: 'test-client', sub: 'subject', exp: now + 3600, iat: now, ...(nonce ? { nonce } : {}) })}.signature`,
    } })
  })
  let totalItems = 55
  let quoteStatus = 503
  const requestedPages: number[] = []
  await page.route('https://api.quotes.test/**', route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    expect(route.request().headers().authorization).toBe('Bearer quote-test-token')
    const url = new URL(route.request().url())
    if (url.pathname === '/me/bootstrap') return route.fulfill({ headers, json: {
      user: { id: '1', displayName: 'Alex', email: 'alex@example.com' },
    } })
    if (url.pathname === '/me/organizations') return route.fulfill({ headers, json: {
      items: [{ id: '10', name: 'Test team', role: 'member' }], nextCursor: null,
    } })
    if (url.pathname === '/organizations/10/quote-owners') return route.fulfill({ headers, json: { items: [{ id: '1', name: 'Alex' }] } })
    if (url.pathname === '/organizations/10/quotes') {
      const requested = Number(url.searchParams.get('page'))
      expect(url.searchParams.get('pageSize')).toBe('50')
      expect(url.searchParams.has('cursor')).toBe(false)
      requestedPages.push(requested)
      if (quoteStatus !== 200) return route.fulfill({ status: quoteStatus, headers, json: {
        code: quoteStatus === 503 ? 'SERVICE_UNAVAILABLE' : 'NOT_FOUND',
        message: quoteStatus === 503 ? 'The service is temporarily unavailable.' : 'You no longer have access to this organization.',
      } })
      return route.fulfill({ headers, json: {
        items: Array.from({ length: Math.max(0, Math.min(50, totalItems - (requested - 1) * 50)) }, (_, index) => ({
          id: String((requested - 1) * 50 + index + 1), organizationId: '10', customerId: null, ownerId: null, ownerName: null,
          customerName: 'Acme', projectName: `Project ${(requested - 1) * 50 + index + 1}`,
          title: `Acme - Project ${(requested - 1) * 50 + index + 1}`, modifiedBy: '1', modifiedByName: 'Alex',
          modifiedWhen: '2026-10-10T12:00:00.000Z',
        })), page: requested, pageSize: 50, totalItems, totalPages: Math.ceil(totalItems / 50),
      } })
    }
    return route.fulfill({ status: 404, headers, json: { code: 'NOT_FOUND', message: 'Not found' } })
  })
  await page.goto('/login?returnTo=%2Forganizations%2F10%2Fquotes')
  await page.getByRole('button', { name: 'Continue to sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Quotes', exact: true })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('temporarily unavailable')
  quoteStatus = 200
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.locator('tbody tr')).toHaveCount(50)
  totalItems = 3
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.locator('tbody tr')).toHaveCount(3)
  await expect(page.getByRole('navigation', { name: 'Quotes pagination' })).toContainText('Page 1 of 1 · 3 quotes')
  expect(requestedPages.slice(-2)).toEqual([2, 1])

  // Navigate away/back through the shell to refresh the read-only list.
  await page.getByRole('button', { name: 'Switch organization' }).click()
  await page.getByRole('link', { name: 'View all organizations', exact: true }).click()
  totalItems = 55
  await page.locator('.org-card').click()
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Quotes', exact: true }).click()
  await expect(page.locator('tbody tr')).toHaveCount(50)
  quoteStatus = 404
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('no longer have access')
  await expect(page.locator('tbody tr')).toHaveCount(0)
})
