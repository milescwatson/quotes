import { test, expect, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
const shortId = (id: string) => createHash('sha256').update(id.toLowerCase()).digest('hex').slice(0, 12)
const org = '10'
async function login(page: Page, path = '/organizations') {
  await page.goto(`/login?returnTo=${encodeURIComponent(path)}`)
  await expect(page.getByRole('button', { name: 'Open demo workspace' })).toBeVisible()
  await expect(page.getByText('Your session has expired. Please sign in again.')).toHaveCount(0)
  await page.getByRole('button', { name: 'Open demo workspace' }).click()
  const destination = /^\/organizations\/[^/]+$/.test(path) ? `${path}/quotes` : path
  await expect(page).toHaveURL((url) => url.pathname === destination.replace(/(?<=\/organizations\/)[1-9][0-9]*(?=\/|$)/, id => shortId(id)))
}
test('workspace navigation, organization switcher, and profile updates', async ({
  page,
}) => {
  await login(page)
  await expect(
    page.getByRole('heading', { name: 'Organizations', exact: true }),
  ).toBeVisible()
  await page
    .locator('.org-card')
    .filter({ hasText: 'Northstar Industries' })
    .click()
  await expect(
    page.getByRole('heading', { name: 'Quotes', exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('link', { name: 'Admin settings', exact: true })).toBeVisible()
  await page.goto('/')
  await expect(page).toHaveURL(new RegExp(`/organizations/${shortId(org)}/quotes$`))
  await expect(page.getByRole('link', { name: 'Overview', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Switch organization' }).click()
  await page.getByRole('navigation', { name: 'Organization navigation' })
    .getByRole('link', { name: 'Forma Studio', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Quotes', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('link', { name: 'Members', exact: true }),
  ).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Admin settings', exact: true })).toHaveCount(0)
  await page.getByRole('link', { name: /Alex Morgan/ }).click()
  await page.getByLabel('Display name').fill('Alex Updated')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByRole('main').getByRole('status')).toContainText(
    'Your profile has been updated.',
  )
  await expect(page.getByRole('link', { name: /Alex Updated/ })).toBeVisible()
})
test('member roles, modal focus, last-admin conflict, and removal', async ({
  page,
}) => {
  await login(page, `/organizations/${org}/members`)
  await page.getByRole('button', { name: 'Remove Alex Morgan' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Cancel', exact: true }),
  ).toBeFocused()
  await page.getByRole('button', { name: 'Remove member', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText(
    'at least one administrator',
  )
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Remove Alex Morgan' }),
  ).toBeFocused()
  await page.getByRole('button', { name: 'Change role for Jamie Chen' }).click()
  await page.getByLabel('Role', { exact: true }).selectOption('member')
  await page.getByRole('button', { name: 'Save role' }).click()
  await expect(
    page.getByRole('row').filter({ hasText: 'Jamie Chen' }),
  ).toContainText('member')
  await page.getByRole('button', { name: 'Remove Morgan Lee' }).click()
  await page.getByRole('button', { name: 'Remove member', exact: true }).click()
  await expect(
    page.getByRole('row').filter({ hasText: 'Morgan Lee' }),
  ).toHaveCount(0)
})
test('admin adds members immediately and handles duplicate and unknown accounts', async ({ page }) => {
  await login(page, `/organizations/${org}/members`)
  await page.getByLabel('Email address', { exact: true }).fill('new@example.com')
  await page.getByLabel('Access role', { exact: true }).selectOption('editor')
  await page.getByRole('button', { name: 'Add member', exact: true }).click()
  await expect(page.getByRole('main').getByRole('status').filter({ hasText: 'now has access' })).toBeVisible()
  await expect(page.getByRole('row').filter({ hasText: 'new@example.com' })).toContainText('editor')
  await page.getByLabel('Email address', { exact: true }).fill('new@example.com')
  await page.getByRole('button', { name: 'Add member', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('already a member')
  await page.getByLabel('Email address', { exact: true }).fill('unknown@example.com')
  await page.getByRole('button', { name: 'Add member', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('sign in first')
  await expect(page.getByRole('link', { name: /invitation/i })).toHaveCount(0)
})
test('empty organization and member-only views', async ({ page }) => {
  await login(page)
  await page.getByLabel('Demo scenario').selectOption('empty')
  await expect(
    page.getByRole('heading', { name: 'No organizations yet.' }),
  ).toBeVisible()
  await page.getByLabel('Demo scenario').selectOption('member')
  await page.goto(`/organizations/${org}/members`)
  await expect(page.getByRole('alert')).toContainText('Only an administrator')
  await expect(
    page.getByRole('link', { name: 'Members', exact: true }),
  ).toHaveCount(0)
})
test('transient loading errors retry once and expired sessions clear workspace data', async ({
  page,
}) => {
  await login(page, `/organizations/${org}`)
  await expect(
    page.getByRole('heading', { name: 'Quotes', exact: true }),
  ).toBeVisible()
  await expect(page.locator('tbody tr').first()).toBeVisible()
  await page.evaluate(() =>
    sessionStorage.setItem('quotes:fixture:failure', '503'),
  )
  await page.getByRole('link', { name: 'Members', exact: true }).click()
  await expect(
    page.getByText('jamie@example.com', { exact: true }),
  ).toBeVisible()
  await page.evaluate(() =>
    sessionStorage.removeItem('quotes:fixture:signed-in'),
  )
  await page.getByRole('link', { name: 'Admin settings', exact: true }).click()
  await expect(
    page.getByText('Your session has expired.', { exact: false }),
  ).toBeVisible()
  await expect(page.getByText('jamie@example.com')).toHaveCount(0)
})
test('revoked organization access is handled without showing stale member data', async ({
  page,
}) => {
  await login(page, `/organizations/${org}/members`)
  await expect(
    page.getByText('jamie@example.com', { exact: true }),
  ).toBeVisible()
  await page.evaluate(() =>
    sessionStorage.setItem(
      'quotes:fixture:revoke-org',
      '10',
    ),
  )
  await page.getByRole('link', { name: 'Admin settings', exact: true }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByText('jamie@example.com')).toHaveCount(0)
})
test('mobile layout, keyboard navigation and sign-out', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await login(page)
  await expect(
    page.getByRole('heading', { name: 'Organizations', exact: true }),
  ).toBeVisible()
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390)
  await page.getByRole('button', { name: 'Toggle navigation' }).click()
  await page.getByRole('button', { name: 'Toggle navigation' }).click()
  await page.getByRole('button', { name: 'Switch organization' }).click()
  await page.getByRole('link', { name: 'View all organizations', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Organizations', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(
    page.getByRole('heading', { name: 'Sign in' }),
  ).toBeVisible()
  await page.goto('/organizations')
  await expect(page).toHaveURL(/\/login/)
})

test('late responses cannot repopulate a previous organization', async ({
  page,
}) => {
  await login(page, `/organizations/${org}`)
  await expect(
    page.getByRole('heading', { name: 'Quotes', exact: true }),
  ).toBeVisible()
  await page.evaluate(() =>
    sessionStorage.setItem('quotes:fixture:delay', '700'),
  )
  await page.getByRole('link', { name: 'Members', exact: true }).click()
  await expect(page.getByRole('main').getByRole('status')).toContainText(
    'Loading',
  )
  await page.getByRole('button', { name: 'Switch organization' }).click()
  await page.getByRole('navigation', { name: 'Organization navigation' })
    .getByRole('link', { name: 'Forma Studio', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Quotes', exact: true }),
  ).toBeVisible()
  await expect(page.getByText('jamie@example.com')).toHaveCount(0)
})


test('short organization links survive reloads and legacy links redirect', async ({ page }) => {
  await login(page)
  const card = page.locator('.org-card').filter({ hasText: 'Northstar Industries' })
  await expect(card).toHaveAttribute('href', `/organizations/${shortId(org)}/quotes`)
  await card.click()
  await expect(page).toHaveURL(new RegExp(`/organizations/${shortId(org)}/quotes$`))
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Quotes', exact: true })).toBeVisible()
  await page.goto(`/organizations/${org}/settings?source=bookmark#details`)
  await expect(page).toHaveURL(new RegExp(`/organizations/${shortId(org)}/settings\\?source=bookmark#details$`))
  await expect(page.getByLabel('Organization name')).toBeVisible()
  await page.getByLabel('Organization name').fill('Renamed organization')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByRole('main').getByRole('status').filter({ hasText: 'Organization updated.' })).toContainText('Organization updated.')
  await page.reload()
  await expect(page.getByRole('button', { name: 'Switch organization' })).toContainText('Renamed organization')
  await expect(page).toHaveURL(new RegExp(`/organizations/${shortId(org)}/settings`))
})


test('short organization destinations survive sign-in and unknown aliases show no data', async ({ page }) => {
  await login(page, `/organizations/${shortId(org)}/members`)
  await expect(page.getByText('jamie@example.com', { exact: true })).toBeVisible()
  await page.goto('/organizations/ffffffffffff/members')
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByText('jamie@example.com', { exact: true })).toHaveCount(0)
})
