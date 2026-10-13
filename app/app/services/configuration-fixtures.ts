import { parse } from 'tldts'
import { ApiError, type Organization, type Profile } from '~/types/identity'
import type { Principal, Taxonomy, TaxonomyInput, ConfigurationDraft } from '~/types/taxonomy'
import { configurationInput } from '~/utils/configuration'
const defaults = (content: Taxonomy['version']['content']) => ({ productDescription: null, separators: Array(Math.max(0, content.segments.length - 1)).fill('-'), ...content, segments: content.segments.map(s => ({ description: null, ...s })) })
const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)
const storage = 'quotes:fixture:configurations:v1'
const actor = { id: '1', name: 'Alex Morgan' }
export function createConfigurationFixtures() {
  const seed = () => {
    const principals: Principal[] = [{ id: '1', name: 'Acme', websiteUrl: 'https://acme.com/' }, { id: '2', name: 'Beacon', websiteUrl: 'https://beacon.com/' }]
    const taxonomies: Taxonomy[] = Array.from({ length: 56 }, (_, i) => {
      const id = String(100 + i), principalId = i % 2 ? '2' : '1'
      return { id, ownerOrganizationId: i === 55 ? '11' : '10', principalId, principalName: principals.find(p => p.id === principalId)!.name, createdAt: '2026-10-10T12:00:00.000Z', archivedAt: null, currentVersionId: String(1000 + i), permissions: { canEdit: true, canArchive: true, canPreview: true },
        version: { id: String(1000 + i), principalId, versionNumber: 1, createdAt: '2026-10-10T12:00:00.000Z', modifiedBy: actor, changeSummary: null,
          content: { schemaVersion: 1, productFamilyName: i === 0 ? 'F Series' : i === 55 ? 'Studio configuration' : `Product ${i + 1}`, currency: 'USD', basePrice: '100.00',
            segments: [['F', 'F'], ['XX', '12', '13', '15'], ['YY', 'AA', 'BZ'], ['ZZ', '01']].map((values, si) => ({ id: `${id}-s${si}`, placeholder: values[0]!, name: si === 1 ? 'Size' : null, defaultOptionId: si === 1 ? `${id}-s${si}-o0` : null, options: values.slice(1).map((code, oi) => ({ id: `${id}-s${si}-o${oi}`, code, description: null, price: si === 1 ? '20.00' : '0.00' })) })) } } }
    })
    return { principals, taxonomies, nextId: 200, nextVersion: 2000 }
  }
  let state = seed()
  try { const value = sessionStorage.getItem(storage); if (value) state = JSON.parse(value) } catch { /* Reset malformed development data. */ }
  const persist = () => sessionStorage.setItem(storage, JSON.stringify(state))
  persist()
  const fail = (status: number, code: string, message: string, path?: string): never => { throw new ApiError(status, code, message, undefined, path ? [{ path, code, message }] : undefined) }
  const page = <T>(items: T[], query: URLSearchParams) => {
    const page = Number(query.get('page') || 1), pageSize = Number(query.get('pageSize') || 50)
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) fail(422, 'INVALID_INPUT', 'Invalid page.')
    return { items: items.slice((page - 1) * pageSize, page * pageSize), page, pageSize, totalItems: items.length, totalPages: Math.ceil(items.length / pageSize) }
  }
  return {
    reset() { state = seed(); persist() },
    request(path: string, method: string, body: any, org: Organization, user: Profile) {
      const url = new URL(path, 'http://fixture'), parts = url.pathname.split('/'), endpoint = parts[3], id = parts[4], action = parts[5]
      if (endpoint === 'principals') {
        if (method === 'GET') return page([...state.principals].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase())), url.searchParams)
        if (method !== 'POST' || org.role !== 'admin') fail(403, 'FORBIDDEN', 'Only administrators can add principals.')
        const name = String(body?.name || '').normalize('NFC').trim().replace(/\s+/gu, ' ')
        if (!name || [...name].length > 120 || /[\p{Cc}\p{Cs}]/u.test(name)) fail(422, 'INVALID_INPUT', 'Enter a valid principal name.', '/name')
        let website: URL
        try {
          const raw = String(body.websiteUrl || '').trim()
          if (!raw || /[\s\\]/u.test(raw)) throw Error()
          website = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`)
          website.hostname = website.hostname.replace(/\.$/, '')
          if (!['http:', 'https:'].includes(website.protocol) || website.username || website.password || website.href.length > 2048) throw Error()
        } catch { return fail(422, 'INVALID_INPUT', 'Enter a valid public website.', '/websiteUrl') }
        const domain = parse(website.hostname, { allowPrivateDomains: false })
        if (!domain.domain || !domain.isIcann || domain.isIp) fail(422, 'INVALID_INPUT', 'Use a public root domain.', '/websiteUrl')
        if (state.principals.some(p => p.name.toLowerCase() === name.toLowerCase())) fail(409, 'PRINCIPAL_NAME_EXISTS', 'A principal with this name already exists.', '/name')
        if (state.principals.some(p => parse(new URL(p.websiteUrl).hostname).domain === domain.domain)) fail(409, 'PRINCIPAL_WEBSITE_EXISTS', 'A principal with this root domain already exists.', '/websiteUrl')
        const principal = { id: String(state.nextId++), name, websiteUrl: website.href }; state.principals.push(principal); persist(); return { principal }
      }
      if (endpoint !== 'taxonomies') fail(404, 'NOT_FOUND', 'Page not found.')
      const visible = state.taxonomies.filter(t => t.ownerOrganizationId === org.id && !t.archivedAt)
      if (method === 'GET' && !id) {
        const filter = url.searchParams.get('principalId')
        return page(visible.filter(t => !filter || t.principalId === filter).map(t => ({ id: t.id, principalId: t.principalId, principalName: state.principals.find(p => p.id === t.principalId)!.name, productFamilyName: t.version.content.productFamilyName, modelCode: t.version.content.segments.map((s,i) => (i ? (t.version.content.separators?.[i-1] ?? '-') : '') + (s.options.length === 1 ? s.options[0]!.code : s.placeholder)).join(''), currentVersionId: t.currentVersionId, versionNumber: t.version.versionNumber, modifiedAt: t.version.createdAt, modifiedBy: t.version.modifiedBy })), url.searchParams)
      }
      const current = id ? state.taxonomies.find(t => t.id === id && t.ownerOrganizationId === org.id) : null
      if (id && !current) fail(404, 'NOT_FOUND', 'Configuration not found.')
      const resource = (t: Taxonomy) => ({ ...t, principalName: state.principals.find(p => p.id === t.principalId)!.name, permissions: { canEdit: !t.archivedAt && org.role !== 'member', canArchive: !t.archivedAt && org.role === 'admin', canPreview: !t.archivedAt } })
      if (method === 'GET' && current) return { taxonomy: resource(current) }
      if (method !== 'POST' || (id && action !== 'versions')) fail(404, 'NOT_FOUND', 'Page not found.')
      if (org.role === 'member') fail(403, 'FORBIDDEN', 'Your role cannot save configurations.')
      if (current?.archivedAt) fail(409, 'TAXONOMY_ARCHIVED', 'This configuration is archived.')
      if (current && (body.expectedVersionId !== current.currentVersionId || sessionStorage.getItem('quotes:fixture:configuration-conflict'))) {
        sessionStorage.removeItem('quotes:fixture:configuration-conflict'); fail(409, 'VERSION_CONFLICT', 'The configuration changed. Reload before saving.')
      }
      const principal = state.principals.find(p => p.id === body.principalId)
      if (!principal) fail(422, 'INVALID_INPUT', 'Choose a principal.', '/principalId')
      const input = body.content as TaxonomyInput
      const draft: ConfigurationDraft = { ...input, productDescription: input.productDescription ?? '', separators: input.separators ?? Array(Math.max(0, input.segments.length - 1)).fill('-'), currency: 'USD', principalId: body.principalId, segments: input.segments.map(s => {
        if (s.id && !current?.version.content.segments.some(old => old.id === s.id)) fail(422, 'INVALID_INPUT', 'Invalid segment identity.')
        return { ...s, description: s.description ?? '', key: s.id || crypto.randomUUID(), defaultKey: s.defaultOptionIndex == null ? null : String(s.defaultOptionIndex), options: s.options.map((o, i) => {
          if (o.id && !current?.version.content.segments.find(old => old.id === s.id)?.options.some(old => old.id === o.id)) fail(422, 'INVALID_INPUT', 'Invalid option identity.')
          return { ...o, key: String(i), description: o.description || '' }
        }) }
      }) }
      const checked = configurationInput(draft)
      if (checked.errors.length) throw new ApiError(422, 'INVALID_INPUT', 'Correct the configuration fields.', undefined, checked.errors)
      const content: Taxonomy['version']['content'] = { ...checked.content, currency: 'USD', schemaVersion: 1, segments: checked.content.segments.map(s => {
        const options = s.options.map(o => ({ ...o, id: o.id || crypto.randomUUID() }))
        return { id: s.id || crypto.randomUUID(), placeholder: s.placeholder, name: s.name, description: s.description, defaultOptionId: s.defaultOptionIndex == null ? null : options[s.defaultOptionIndex]!.id, options }
      }) }
      if (current && current.principalId === principal!.id && canonical(defaults(content)) === canonical(defaults(current.version.content))) return { taxonomy: resource(current), unchanged: true }
      const versionId = String(state.nextVersion++), now = new Date().toISOString()
      const taxonomy: Taxonomy = { id: current?.id || String(state.nextId++), ownerOrganizationId: org.id, principalId: principal!.id, principalName: principal!.name, createdAt: current?.createdAt || now, archivedAt: null, currentVersionId: versionId, permissions: { canEdit: true, canArchive: org.role === 'admin', canPreview: true },
        version: { id: versionId, principalId: principal!.id, versionNumber: (current?.version.versionNumber || 0) + 1, createdAt: now, modifiedBy: { id: user.id, name: user.displayName || user.email }, changeSummary: null, content } }
      if (current) state.taxonomies.splice(state.taxonomies.indexOf(current), 1, taxonomy); else state.taxonomies.unshift(taxonomy)
      persist(); return { taxonomy: resource(taxonomy), unchanged: false }
    },
  }
}
