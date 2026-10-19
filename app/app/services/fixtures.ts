import { isSuperAdministratorEmail } from '~/utils/super-administrators'
import { createConfigurationFixtures } from './configuration-fixtures'
import {
  ApiError,
  type ApiOptions,
  type Member,
  type Organization,
  type Profile,
} from '~/types/identity'
import { quoteAmount, quoteNumber, adjustedAmount, validMultiple } from '~/utils/quote'
import type { Taxonomy } from '~/types/taxonomy'
import type { Quote, QuoteDetail, LocalQuoteLine, RegularProduct } from '~/types/quotes'
export function createFixtures() {
  if (!import.meta.dev)
    throw new Error('Fixtures are unavailable in production')
  const configurations = createConfigurationFixtures()
  const id = (n: number) => String(n)
  let nextMemberId = 100
  const me = id(1),
    north = id(10),
    studio = id(11)
  function seed(scenario = 'administrator') {
    scenario = scenario === 'admin' ? 'administrator' : scenario === 'member' ? 'sales' : scenario
    const user: Profile = {
      id: me,
      email: scenario === 'super' ? 'mc.watson415@gmail.com' : 'alex@example.com',
      displayName: 'Alex Morgan',
      isSuperAdministrator: isSuperAdministratorEmail(scenario === 'super' ? 'mc.watson415@gmail.com' : 'alex@example.com'),
    }
    const organizations: Organization[] =
      scenario === 'empty'
        ? []
        : [
            {
              id: north,
              name: 'Northstar Industries',
              role: scenario === 'sales' ? 'sales' : 'administrator',
              logoVersion: null,
            },
            { id: studio, name: 'Forma Studio', role: 'sales', logoVersion: null },
            { id: id(12), name: 'Harbor Workshop', role: 'sales', logoVersion: null },
          ]
    const members: Record<string, Member[]> = {
      [north]: [
        {
          id: id(20),
          userId: me,
          email: user.email,
          displayName: user.displayName,
          isSuperAdministrator: user.isSuperAdministrator,
          role: scenario === 'sales' ? 'sales' : 'administrator',
        },
        {
          id: id(21),
          userId: id(2),
          email: 'jamie@example.com',
          displayName: 'Jamie Chen',
          isSuperAdministrator: false,
          role: 'sales',
        },
        {
          id: id(22),
          userId: id(3),
          email: 'morgan@example.com',
          displayName: 'Morgan Lee',
          isSuperAdministrator: false,
          role: 'sales',
        },
      ],
      [id(12)]: [{ id: id(32), userId: me, email: user.email, displayName: user.displayName, isSuperAdministrator:user.isSuperAdministrator, role: 'sales' }],
      [studio]: [{ id: id(30), userId: me, email: user.email, displayName: user.displayName, isSuperAdministrator:user.isSuperAdministrator, role: 'sales' },
        { id: id(31), userId: id(2), email: 'jamie@example.com', displayName: 'Jamie Chen', isSuperAdministrator:false, role: 'sales' }],
    }
    const accounts: Profile[] = [
      user,
      ...members[north]!.slice(1).map(({ userId, email, displayName }) => ({
        id: userId,
        email,
        displayName,
        isSuperAdministrator:false,
      })),
      { id: id(4), email: 'new@example.com', displayName: 'New Teammate', isSuperAdministrator:false },
      { id: id(5), email: 'former@example.com', displayName: null, isSuperAdministrator:false },
    ]
    const makeQuote = (organizationId: string, index: number): Quote => {
      const customerName = index === 0 ? 'Acme' : `Customer ${index + 1}`
      const projectName = index === 0 ? 'Office Renovation' : index === 1
        ? 'Manufacturing campus expansion and renovation of the customer experience center'
        : `Project ${String(index + 1).padStart(2, '0')}`
      return {
        id: String(1000 + Number(organizationId) * 100 + index), organizationId,
        customerId: index % 2 === 0 ? null : index + 100,
        ownerId: index % 3 === 2 ? null : index % 3 === 0 ? me : id(2),
        ownerName: index % 3 === 2 ? null : index % 3 === 0 ? user.displayName! : 'Jamie Chen',
        customerName, projectName, location: '', title: `${customerName} - ${projectName}`,
        modifiedBy: index % 2 === 0 ? me : id(5),
        modifiedByName: index % 2 === 0 ? user.displayName! : 'Unnamed team member',
        modifiedWhen: new Date(Date.UTC(2026, 9, 10, 12) - index * 3600000).toISOString(),
        archivedAt: null,
      }
    }
    const quotes: Record<string, (Quote & Partial<QuoteDetail>)[]> = {
      [north]: Array.from({ length: 55 }, (_, index) => makeQuote(north, index)),
      [studio]: [{ ...makeQuote(studio, 0), customerName: 'Forma', title: 'Forma - Office Renovation' }],
      [id(12)]: [],
    }
    return { user, organizations, members, accounts, quotes, logos: {} as Record<string,string>, domains: {} as Record<string,string[]> }
  }
  let state = seed()
  try {
    const stored = sessionStorage.getItem('quotes:fixture:data:v3')
    if (stored) state = { ...state, ...JSON.parse(stored) }
  } catch {
    /* Reset invalid preview data. */
  }
  state.logos ??= {}
  for (const org of state.organizations) org.logoVersion ??= null
  state.user.isSuperAdministrator=isSuperAdministratorEmail(state.user.email)
  for (const member of Object.values(state.members).flat()) member.isSuperAdministrator=isSuperAdministratorEmail(member.email)
  // Upgrade existing demo sessions without resetting the user's data.
  for (const quotes of Object.values(state.quotes)) for (const quote of quotes) {
    quote.ownerId ??= null
    quote.ownerName ??= null
    quote.archivedAt ??= null
  }
  for (const orgId of [studio, id(12)]) if (!state.members[orgId]?.length) state.members[orgId] = seed().members[orgId]!
  const save = () =>
    sessionStorage.setItem('quotes:fixture:data:v3', JSON.stringify(state))
  const fail = (status: number, code: string, message: string): never => {
    throw new ApiError(status, code, message)
  }
  return {
    signIn() {
      sessionStorage.setItem('quotes:fixture:signed-in', 'true')
    },
    signOut() {
      sessionStorage.removeItem('quotes:fixture:signed-in')
    },
    scenario(name: string) {
      state = seed(name)
      configurations.reset()
      save()
    },
    async request<T>(path: string, options: ApiOptions = {}): Promise<T> {
      const delay = Number(sessionStorage.getItem('quotes:fixture:delay') || 80)
      await new Promise((resolve) => setTimeout(resolve, Math.min(delay, 3000)))
      options.signal?.throwIfAborted()
      if (sessionStorage.getItem('quotes:fixture:signed-in') !== 'true')
        fail(
          401,
          'SESSION_EXPIRED',
          'Your session has expired. Please sign in again.',
        )
      const revoked = sessionStorage.getItem('quotes:fixture:revoke-org')
      if (revoked) {
        state.organizations = state.organizations.filter(
          (o) => o.id !== revoked,
        )
        sessionStorage.removeItem('quotes:fixture:revoke-org')
        save()
      }
      const fault = sessionStorage.getItem('quotes:fixture:failure')
      if (fault) {
        sessionStorage.removeItem('quotes:fixture:failure')
        fail(
          Number(fault),
          'TEST_ERROR',
          'We could not reach the service. Please try again.',
        )
      }
      const method = options.method || 'GET',
        body = JSON.parse(JSON.stringify(options.body ?? {})) as any
      const [pathname] = path.split('?')
      const parts = pathname!.split('/').filter(Boolean)
      let result: any
      const page = (items: unknown[]) => ({ items, nextCursor: null })
      if (pathname === '/me/bootstrap' || pathname === '/me') {
        if (method === 'PATCH') state.user.displayName = body.displayName
        state.user.isSuperAdministrator=isSuperAdministratorEmail(state.user.email)
        result = { user: state.user }
      } else if (pathname === '/me/organizations')
        result = page(state.organizations.map(org => state.user.isSuperAdministrator ? {...org,role:'administrator'} : org))
      else if (parts[0] === 'organizations') {
        const orgId = parts[1]!,
          org = state.organizations.find((o) => o.id === orgId)
        if (!org)
          fail(
            404,
            'NOT_FOUND',
            'You no longer have access to this organization.',
          )
        if (parts[2] === 'logo') {
          if (method === 'GET') {
            if (!state.logos[orgId]) fail(404, 'NOT_FOUND', 'No organization logo has been uploaded.')
            const data = atob(state.logos[orgId]!)
            return new Blob([Uint8Array.from(data, ch => ch.charCodeAt(0))], { type: 'image/png' }) as T
          }
          if (org!.role !== 'administrator' && !state.user.isSuperAdministrator) fail(403, 'FORBIDDEN', 'Administrator access required.')
          if (method === 'PUT') { state.logos[orgId] = body.imageBase64; org!.logoVersion = crypto.randomUUID() }
          else if (method === 'DELETE') { delete state.logos[orgId]; org!.logoVersion = null }
          save(); return structuredClone({ organization: org }) as T
        }
        if (parts[2]==='domains') {
          if (!state.user.isSuperAdministrator) fail(403,'FORBIDDEN','Super Administrator access required.')
          if (method==='PUT') {
            for (const domain of body.domains) if (Object.entries(state.domains).some(([id,values])=>id!==orgId && values.includes(domain))) fail(409,'DOMAIN_ASSIGNED','This domain is already assigned.')
            state.domains[orgId]=body.domains
          }
          save(); return structuredClone({domains:state.domains[orgId] || []}) as T
        }
        if (['taxonomies', 'principals'].includes(parts[2] || '')) return structuredClone(configurations.request(path, method, body, org!, state.user)) as T
        const regularKey = `quotes:fixture:regular-products:${orgId}`
        const regular: RegularProduct[] = JSON.parse(sessionStorage.getItem(regularKey) || '[]')
        if (parts[2] === 'regular-products') {
          if (method === 'GET') return structuredClone({ items: regular }) as T
          if (org!.role !== 'administrator' && !state.user.isSuperAdministrator) fail(403, 'FORBIDDEN', 'Only an administrator can manage products.')
          const old = regular.find(p => p.id === parts[3])
          if (parts[3] && !old) fail(404, 'NOT_FOUND', 'Product not found.')
          if (old && old.token !== body.expectedToken) fail(409, 'PRODUCT_CONFLICT', 'This product changed. Reload before saving.')
          if (!body.partNumber?.trim() || body.partNumber.trim().length > 120 || /[\p{Cc}\p{Cs}]/u.test(body.partNumber) || typeof body.description !== 'string' || body.description.length > 500 || !/^(0|[1-9][0-9]{0,11})(\.[0-9]{1,2})?$/.test(body.listPrice)) fail(422, 'INVALID_INPUT', 'Enter valid part number, description and List Price.')
          if (regular.some(p => p.id !== old?.id && p.partNumber === body.partNumber.trim())) fail(409, 'PRODUCT_DUPLICATE', 'This part number already exists in this organization.')
          if (body.parentTaxonomyId && body.parentTaxonomyId !== old?.parentTaxonomyId) {
            const parent = (configurations.request(`/organizations/${orgId}/taxonomies/${body.parentTaxonomyId}`, 'GET', {}, org!, state.user) as { taxonomy: Taxonomy }).taxonomy
            if (parent.archivedAt) fail(422, 'INVALID_INPUT', 'Choose an accessible active configured product.')
          }
          const principalId = Object.hasOwn(body, 'principalId') ? body.principalId : old?.principalId ?? null
          const principals = (configurations.request(`/organizations/${orgId}/principals?pageSize=100`, 'GET', {}, org!, state.user) as { items: { id: string; name: string }[] }).items
          const principal = principals.find(p => p.id === principalId)
          if (principalId !== null && !principal) fail(422, 'INVALID_INPUT', 'Choose an existing principal.')
          const product: RegularProduct = { id: old?.id ?? String(Math.max(0, ...regular.map(p => Number(p.id))) + 1), partNumber: body.partNumber.trim(), description: body.description.trim(), listPrice: Number(body.listPrice).toFixed(2), parentTaxonomyId: body.parentTaxonomyId, principalId, principalName: principal?.name ?? null, token: new Date().toISOString() }
          if (old) regular.splice(regular.indexOf(old), 1, product); else regular.push(product)
          sessionStorage.setItem(regularKey, JSON.stringify(regular)); return structuredClone({ product }) as T
        }
        const sumMoney = (values: string[]) => { const n = values.reduce((sum, v) => sum + BigInt(v.replace('.', '')), 0n); return `${n / 100n}.${String(n % 100n).padStart(2, '0')}` }
        const quoteDetail = (quote: Quote & Partial<QuoteDetail>): QuoteDetail => ({ ...quote, location: quote.location ?? '', authorName: quote.authorName ?? null, archivedAt: quote.archivedAt ?? null, token: quote.modifiedWhen, lines: (quote.lines ?? []).map(({ multiple: _removed, ...line }: any) => line), multiple: quote.multiple ?? 1, currency: 'USD', listTotal: sumMoney((quote.lines ?? []).map(l => l.lineTotal)), total: sumMoney((quote.lines ?? []).map(l => adjustedAmount(l.lineTotal, quote.multiple ?? 1))) })
        if (parts[2] === 'quotes' && parts[4] === 'pdf-url' && method === 'GET') {
          const quote = state.quotes[orgId]?.find(q => q.id === parts[3])
          if (!quote) fail(404, 'NOT_FOUND', 'Quote not found.')
          if (quote!.modifiedWhen !== new URL(path, 'https://fixture.invalid').searchParams.get('expectedToken')) fail(409, 'QUOTE_CONFLICT', 'This quote changed. Reload the page before exporting a PDF.')
          return { url: null } as T
        }
        if (parts[2] === 'quotes' && parts.length === 5 && ['archive', 'restore'].includes(parts[4]!) && method === 'POST') {
          const quote = state.quotes[orgId]?.find(q => q.id === parts[3])
          if (!quote) fail(404, 'NOT_FOUND', 'Quote not found.')
          if (quote!.ownerId !== state.user.id) fail(403, 'FORBIDDEN', 'Only the quote owner can archive or restore this quote.')
          const archivedAt = parts[4] === 'archive' ? new Date().toISOString() : null
          if (!!quote!.archivedAt === !!archivedAt) fail(409, 'QUOTE_CONFLICT', 'This quote has already changed. Reload before trying again.')
          quote!.archivedAt = archivedAt
          quote!.modifiedBy = state.user.id
          quote!.modifiedByName = state.user.displayName?.trim() || 'Unnamed team member'
          quote!.modifiedWhen = new Date().toISOString()
          save()
          return structuredClone({ success: true, quote: quoteDetail(quote!) }) as T
        }
        if (parts[2] === 'quotes' && ((parts.length === 4 && ['GET','PUT'].includes(method)) || (parts.length === 3 && method === 'POST'))) {
          const previous = state.quotes[orgId]?.find(q => q.id === parts[3])
          if (parts[3] && !previous) fail(404,'NOT_FOUND','Quote not found.')
          if (method === 'GET') return structuredClone({ quote: quoteDetail(previous!) }) as T
          if (previous && (body.expectedToken !== previous.modifiedWhen || sessionStorage.getItem('quotes:fixture:quote-conflict'))) { sessionStorage.removeItem('quotes:fixture:quote-conflict'); fail(409,'QUOTE_CONFLICT','This quote changed. Reload before saving; your changes have been retained.') }
          if (!body.customerName?.trim() || !body.projectName?.trim()) fail(422,'INVALID_INPUT','Customer and Project are required.')
          const owner = (state.members[orgId] || []).find(m => m.userId === body.ownerId)
          if (body.ownerId !== null && !owner) fail(422,'OWNER_UNAVAILABLE','Choose an active team member.')
          if (!Array.isArray(body.lines) || body.lines.length > 100) fail(422,'INVALID_INPUT','Use at most 100 lines.')
          if (!validMultiple(body.multiple ?? 1)) fail(422, 'INVALID_INPUT', 'Enter a valid quote multiple.')
          const lines = body.lines.map((input: any) => {
            const old = previous?.lines?.find(l => l.id === input.id)
            if (old && ((old.kind ?? 'configured') !== (input.kind ?? 'configured') || ((input.kind ?? 'configured') === 'configured' && (old.taxonomyId !== input.taxonomyId || old.versionId !== input.versionId)) || (input.kind === 'regular' && old.regularProductId !== input.regularProductId))) fail(422, 'INVALID_INPUT', 'To change products, remove this line and add a new product.')
            if (input.descriptionContent === undefined && old?.descriptionContent !== undefined) input.descriptionContent = old.descriptionContent
            if (input.descriptionVisible === undefined && old?.descriptionVisible !== undefined) input.descriptionVisible = old.descriptionVisible
            if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 1000000) fail(422,'INVALID_INPUT','Use a positive whole quantity.')
            if ('multiple' in input) fail(422, 'INVALID_INPUT', 'Unknown line field: multiple.')
            if (input.kind === 'regular' || input.kind === 'freeform') {
              const p = input.kind === 'regular' ? regular.find(p => p.id === input.regularProductId) : { partNumber: input.partNumber, description: input.description, listPrice: input.listPrice, parentTaxonomyId: null, principalId: null, principalName: null }
              const retained = old?.kind === 'regular' && old.regularProductId === input.regularProductId ? old : null
              if (!p && !retained) fail(422, 'INVALID_INPUT', 'Choose a regular product.')
              const snapshot = retained?.snapshot ?? { content: { schemaVersion: 1 as const, productFamilyName: p!.partNumber.trim(), productDescription: p!.description, currency: 'USD' as const, basePrice: p!.listPrice, separators: [], segments: [] }, principalId: p!.principalId ?? null, principalName: p!.principalName ?? null }
              const line: LocalQuoteLine = { ...input, id: old?.id ?? crypto.randomUUID(), key: '', taxonomyId: null, versionId: null, parentTaxonomyId: retained?.parentTaxonomyId ?? p?.parentTaxonomyId, snapshot, selections: [], complete: true }
              return { ...line, key: undefined, ...quoteAmount(line), partNumber: quoteNumber(line) }
            }
            let snapshot = old && old.taxonomyId === input.taxonomyId && old.versionId === input.versionId && JSON.stringify(old.selections) === JSON.stringify(input.selections) ? old.snapshot : null
            if (!snapshot) {
              let t: Taxonomy
              try { t = (configurations.request(`/organizations/${orgId}/taxonomies/${input.taxonomyId}`, 'GET', {}, org!, state.user) as { taxonomy:Taxonomy }).taxonomy }
              catch(e) { if (e instanceof ApiError && e.status===404) fail(422,'INVALID_INPUT','Choose a configuration with current access.'); throw e }
              if (t.archivedAt || t.version.id !== input.versionId) fail(409,'CONFIGURATION_CHANGED','The configuration changed or was archived. Remove this line and add the current product again to review its options.')
              snapshot = { content: t.version.content, principalId: t.version.principalId, principalName: t.principalName }
            }
            if (input.selections.length !== snapshot.content.segments.length || input.selections.some((id: string | null,i: number) => id !== null && !snapshot!.content.segments[i]?.options.some(o => o.id === id))) fail(422,'INVALID_INPUT','Choose valid options.')
            const line: LocalQuoteLine = { ...input, id: old?.id ?? crypto.randomUUID(), key: '', snapshot, complete: input.selections.every((id: string | null) => id !== null) }
            return { ...line, key: undefined, ...quoteAmount(line), partNumber: quoteNumber(line) }
          })
          if (previous?.archivedAt) fail(409, 'QUOTE_ARCHIVED', 'This quote is archived. Restore it before making changes.')
          const quote: Quote & Partial<QuoteDetail> = { id: previous?.id ?? String(Math.max(10000,...Object.values(state.quotes).flat().map(q => Number(q.id))) + 1), organizationId: orgId, customerId: previous?.customerId ?? null, customerName: body.customerName.trim(), projectName: body.projectName.trim(), location: body.location?.trim() ?? previous?.location ?? '', authorName: previous ? previous.authorName ?? null : state.user.displayName?.trim() || null, title: `${body.customerName.trim()} - ${body.projectName.trim()}`, ownerId: body.ownerId, ownerName: owner ? owner.displayName?.trim() || 'Unnamed team member' : null, modifiedBy: state.user.id, modifiedByName: state.user.displayName?.trim() || 'Unnamed team member', modifiedWhen: new Date().toISOString(), archivedAt: previous?.archivedAt ?? null, multiple: body.multiple ?? 1, lines }
          const unchanged = previous && previous.customerName === quote.customerName && previous.projectName === quote.projectName && (previous.location ?? '') === quote.location && previous.ownerId === quote.ownerId && (previous.multiple ?? 1) === quote.multiple && JSON.stringify(previous.lines ?? []) === JSON.stringify(lines)
          if (unchanged) return structuredClone({ quote: quoteDetail(previous), unchanged: true }) as T
          if (previous) state.quotes[orgId]!.splice(state.quotes[orgId]!.indexOf(previous),1,quote); else (state.quotes[orgId] ??= []).push(quote)
          save(); return structuredClone({ quote: quoteDetail(quote), unchanged: false }) as T
        }
        const listingQuotes = parts.length === 3 && parts[2] === 'quotes' && method === 'GET'
        const listingOwners = parts.length === 3 && parts[2] === 'quote-owners' && method === 'GET'
        const editingOwner = parts.length === 4 && parts[2] === 'quotes' && method === 'PATCH'
        if (!listingQuotes && !listingOwners && !editingOwner && !(parts[2] === 'members' && !parts[3] && ['GET','POST'].includes(method)) && (parts.length > 2 || method !== 'GET')) {
          if (org!.role !== 'administrator' && !state.user.isSuperAdministrator)
            fail(
              403,
              'FORBIDDEN',
              'Only an administrator can manage this organization.',
            )
        }
        if (listingOwners) {
          result = { items: (state.members[orgId] || []).map(member => ({ id: member.userId, name: member.displayName?.trim() || 'Unnamed team member' })) }
        } else if (editingOwner) {
          const quote = state.quotes[orgId]?.find(quote => quote.id === parts[3])
          if (!quote) fail(404, 'NOT_FOUND', 'Quote not found.')
          const owner = (state.members[orgId] || []).find(member => member.userId === body.ownerId)
          if (body.ownerId !== null && !owner) fail(422, 'OWNER_UNAVAILABLE', 'Choose an active team member from this organization.')
          quote!.ownerId = owner?.userId ?? null
          quote!.ownerName = owner ? owner.displayName?.trim() || 'Unnamed team member' : null
          quote!.modifiedBy = state.user.id
          quote!.modifiedByName = state.user.displayName?.trim() || 'Unnamed team member'
          quote!.modifiedWhen = new Date().toISOString()
          result = { success: true }
        } else if (listingQuotes) {
          const params = new URLSearchParams(path.split('?')[1])
          const page = Number(params.get('page') ?? 1)
          const pageSize = Number(params.get('pageSize') ?? 50)
          if (!Number.isSafeInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100)
            fail(422, 'INVALID_INPUT', 'Use a positive page number and a page size between 1 and 100.')
          const customer = (params.get('customer') || '').trim().toLowerCase()
          const project = (params.get('project') || '').trim().toLowerCase()
          const owner = params.get('ownerId') || ''
          const archived = params.get('archived') === 'true'
          const items = [...(state.quotes[orgId] || [])].filter(quote =>
            !!quote.archivedAt === archived && quote.customerName.toLowerCase().includes(customer) && quote.projectName.toLowerCase().includes(project) &&
            (!owner || (owner === 'unassigned' ? quote.ownerId === null : quote.ownerId === owner)),
          ).sort((a, b) =>
            b.modifiedWhen.localeCompare(a.modifiedWhen) || Number(b.id) - Number(a.id),
          )
          result = {
            items: items.slice((page - 1) * pageSize, page * pageSize), page, pageSize,
            totalItems: items.length, totalPages: Math.ceil(items.length / pageSize),
          }
        } else if (parts.length === 2) {
          if (method === 'PATCH') Object.assign(org!,body)
          result = { organization: org }
        } else if (parts[2] === 'members') {
          const members = state.members[orgId] || []
          if (parts[3]) {
            const member = members.find((m) => m.id === parts[3])
            if (!member) fail(404, 'NOT_FOUND', 'Member not found.')
            if (
              member!.role === 'administrator' &&
              (method === 'DELETE' || (body.role !== undefined && body.role !== 'administrator')) &&
              members.filter((m) => m.role === 'administrator').length === 1
            )
              fail(
                409,
                'LAST_ADMIN',
                'Your organization needs at least one administrator. Make another member an admin first.',
              )
            if (method === 'DELETE')
              state.members[orgId] = members.filter((m) => m.id !== parts[3])
            else { if (body.role !== undefined) member!.role = body.role; if (body.displayName !== undefined) { for (const m of Object.values(state.members).flat()) if (m.userId===member!.userId) m.displayName=body.displayName; if (member!.userId===me) state.user.displayName=body.displayName } }
            if (member!.userId === me) {
              if (method === 'DELETE')
                state.organizations = state.organizations.filter(
                  (o) => o.id !== orgId,
                )
              else if (body.role !== undefined) org!.role = body.role
            }
            result = { success: true }
          } else if (method === 'POST') {
            if (org!.role === 'sales' && !state.user.isSuperAdministrator && body.role !== 'sales') fail(403,'FORBIDDEN','Sales users can only add Sales teammates.')
            const email = String(body.email).trim().toLowerCase()
            const account = state.accounts.find(
              (a) => a.email.toLowerCase() === email,
            )
            if (!account)
              fail(
                422,
                'ACCOUNT_UNAVAILABLE',
                'No unique active account matches this email. Ask your teammate to sign in first.',
              )
            if (members.some((m) => m.userId === account!.id))
              fail(
                409,
                'ALREADY_MEMBER',
                'This person is already a member. Change their role from Team.',
              )
            const added: Member = {
              id: String(nextMemberId = Math.max(nextMemberId, ...Object.values(state.members).flat().map(member => Number(member.id))) + 1),
              userId: account!.id,
              email: account!.email,
              displayName: account!.displayName,
              isSuperAdministrator:account!.isSuperAdministrator,
              role: body.role,
            }
            members.push(added)
            state.members[orgId] = members
            result = { member: added }
          } else result = page(members)
        }
      }
      if (!result) fail(404, 'NOT_FOUND', 'This page could not be found.')
      save()
      return structuredClone(result) as T
    },
  }
}
