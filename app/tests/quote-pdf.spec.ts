import { test, expect, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
// @ts-expect-error The renderer is a JavaScript server module.
import { renderQuotePdf } from '../../server/quote-pdf-layout.mjs'
const org = `/organizations/${createHash('sha256').update('10').digest('hex').slice(0,12)}`
async function login(page: Page) {
  await page.goto(`/login?returnTo=${encodeURIComponent(`${org}/quotes/new`)}`)
  await page.getByRole('button', { name: 'Open demo workspace' }).click()
  await expect(page.getByLabel('Customer', { exact: true })).toBeVisible()
}
async function details(page: Page) {
  await page.getByLabel('Customer', { exact: true }).fill('Acme')
  await page.getByLabel('Project', { exact: true }).fill('Office')
}
const save = (page: Page) => page.getByRole('button', { name: 'Save changes', exact: true })
// Full Chromium includes the PDF viewer; headless shell turns PDF previews into downloads.
test.use({ channel: 'chromium' })
test('PDF preview and download use saved tokens, binary auth, and report errors', async ({ page }) => {
  let httpModule = ''
  page.on('request', request => { if (request.url().includes('/services/http.ts')) httpModule = request.url() })
  const pdf = await renderQuotePdf({ id: '10001', customer: 'Acme', project: 'Office', organization: { name: 'Company', contact: [] }, draft: true, total: '0.00', lines: [] })
  let failed = false, stored = false
  const requests: string[] = []
  await page.route('**/__pdf-test/organizations/*/quotes/*/pdf-url?*', async route => {
    expect(route.request().headers().authorization).toBe('Bearer pdf-test-token')
    const url = new URL(route.request().url())
    expect(url.searchParams.get('expectedToken')).toBeTruthy()
    if (failed) await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ code: 'QUOTE_CONFLICT', message: 'Reload the page before exporting a PDF.' }) })
    else await route.fulfill({ json: { url: stored ? `https://pdf-storage.example/stored-quote.pdf?disposition=${url.searchParams.get('disposition')}` : null } })
  })
  await page.context().route('https://pdf-storage.example/stored-quote.pdf?*', async route => {
    expect(route.request().headers().authorization).toBeUndefined()
    const disposition = new URL(route.request().url()).searchParams.get('disposition')
    await route.fulfill({ contentType: 'application/pdf', headers: { 'content-disposition': `${disposition}; filename="quote-stored.pdf"` }, body: pdf })
  })
  await page.route('**/__pdf-test/organizations/*/quotes/*/pdf?*', async route => {
    expect(route.request().headers().authorization).toBe('Bearer pdf-test-token')
    const url = new URL(route.request().url()); requests.push(url.href)
    expect(url.searchParams.get('expectedToken')).toBeTruthy()
    if (failed) await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ code: 'QUOTE_CONFLICT', message: 'Reload the page before exporting a PDF.' }) })
    else await route.fulfill({ contentType: 'application/pdf', body: pdf })
  })
  await login(page)
  const preview = page.getByRole('button', { name: 'Preview PDF', exact: true })
  const download = page.getByRole('button', { name: 'Download PDF', exact: true })
  await expect(preview).toBeDisabled(); await expect(download).toBeDisabled()
  await details(page); await save(page).click(); await expect(page).toHaveURL(/\/quotes\/\d+$/)
  expect(httpModule).toBeTruthy()
  await page.evaluate(async moduleUrl => {
    const { createHttp } = await import(moduleUrl)
    const app = (document.querySelector('#__nuxt') as any).__vue_app__.config.globalProperties.$nuxt
    const original = app.$identity.request.bind(app.$identity)
    const http = createHttp('/__pdf-test', async () => 'pdf-test-token')
    app.$identity.request = (path: string, options: unknown) => (/\/pdf(?:-url)?\?/.test(path)) ? http(path, options) : original(path, options)
  }, httpModule)
  await expect(preview).toBeEnabled()
  const downloaded = page.waitForEvent('download')
  await download.click()
  const file = await downloaded
  expect(file.suggestedFilename()).toMatch(/^quote-\d+\.pdf$/)
  const stream = await file.createReadStream()
  const chunks: Buffer[] = []; for await (const chunk of stream!) chunks.push(chunk)
  expect(Buffer.concat(chunks)).toEqual(pdf)
  const popup = page.waitForEvent('popup')
  await preview.click()
  const tab = await popup
  await expect.poll(() => tab.url()).toMatch(/^blob:/)
  await tab.close()
  expect(new URL(requests[0]!).searchParams.get('disposition')).toBe('attachment')
  expect(new URL(requests[1]!).searchParams.get('disposition')).toBe('inline')
  stored = true
  const storedDownload = page.waitForEvent('download')
  await download.click()
  expect((await storedDownload).suggestedFilename()).toBe('quote-stored.pdf')
  const storedPopup = page.waitForEvent('popup')
  await preview.click()
  const storedTab = await storedPopup
  await expect.poll(() => storedTab.url()).toContain('https://pdf-storage.example/stored-quote.pdf?disposition=inline')
  await storedTab.close()
  expect(requests).toHaveLength(2) // Stored exports bypass the blob endpoint.
  stored = false
  await page.getByLabel('Project', { exact: true }).fill('Unsaved project')
  await expect(preview).toBeDisabled(); await expect(download).toBeDisabled()
  await save(page).click(); await expect(preview).toBeEnabled()
  failed = true; await preview.click()
  await expect(page.getByRole('alert')).toContainText('Reload the page before exporting a PDF.')
  await expect(preview).toBeEnabled()
  // Simulate a popup blocker: the fetched preview remains available as a link.
  failed = false
  await page.evaluate(() => { window.open = () => null })
  await preview.click()
  await expect(page.getByRole('link', { name: 'Open PDF preview' })).toHaveAttribute('href', /^blob:/)
})
