import { createConfigurationFixtures } from './configuration-fixtures'
import {
  ApiError,
  type ApiOptions,
  type Member,
  type Organization,
  type Profile,
} from '~/types/identity'
import { quoteAmount, quoteNumber } from '~/utils/quote'
import type { Taxonomy } from '~/types/taxonomy'
import type { Quote, QuoteDetail, LocalQuoteLine } from '~/types/quotes'
export function createFixtures() {
  if (!import.meta.dev)
    throw new Error('Fixtures are unavailable in production')
  const configurations = createConfigurationFixtures()
  const id = (n: number) => String(n)
  let nextMemberId = 100
  const me = id(1),
    north = id(10),
    studio = id(11)
  function seed(scenario = 'admin') {
    const user: Profile = {
      id: me,
      email: 'alex@example.com',
      displayName: 'Alex Morgan',
    }
    const organizations: Organization[] =
      scenario === 'empty'
        ? []
        : [
            {
              id: north,
              name: 'Northstar Industries',
              role: scenario === 'member' ? 'member' : 'admin',
            },
            { id: studio, name: 'Forma Studio', role: 'editor' },
            { id: id(12), name: 'Harbor Workshop', role: 'member' },
          ]
    const members: Record<string, Member[]> = {
      [north]: [
        {
          id: id(20),
          userId: me,
          email: user.email,
          displayName: user.displayName,
          role: scenario === 'member' ? 'member' : 'admin',
        },
        {
          id: id(21),
          userId: id(2),
          email: 'jamie@example.com',
          displayName: 'Jamie Chen',
          role: 'editor',
        },
        {
          id: id(22),
          userId: id(3),
          email: 'morgan@example.com',
          displayName: 'Morgan Lee',
          role: 'member',
        },
      ],
      [id(12)]: [{ id: id(32), userId: me, email: user.email, displayName: user.displayName, role: 'member' }],
      [studio]: [{ id: id(30), userId: me, email: user.email, displayName: user.displayName, role: 'editor' },
        { id: id(31), userId: id(2), email: 'jamie@example.com', displayName: 'Jamie Chen', role: 'member' }],
    }
    const accounts: Profile[] = [
      user,
      ...members[north]!.slice(1).map(({ userId, email, displayName }) => ({
        id: userId,
        email,
        displayName,
      })),
      { id: id(4), email: 'new@example.com', displayName: 'New Teammate' },
      { id: id(5), email: 'former@example.com', displayName: null },
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
        customerName, projectName, title: `${customerName} - ${projectName}`,
        modifiedBy: index % 2 === 0 ? me : id(5),
        modifiedByName: index % 2 === 0 ? user.displayName! : 'Unnamed team member',
        modifiedWhen: new Date(Date.UTC(2026, 9, 10, 12) - index * 3600000).toISOString(),
      }
    }
    const quotes: Record<string, (Quote & Partial<QuoteDetail>)[]> = {
      [north]: Array.from({ length: 55 }, (_, index) => makeQuote(north, index)),
      [studio]: [{ ...makeQuote(studio, 0), customerName: 'Forma', title: 'Forma - Office Renovation' }],
      [id(12)]: [],
    }
    return { user, organizations, members, accounts, quotes }
  }
  let state = seed()
  try {
    const stored = sessionStorage.getItem('quotes:fixture:data:v2')
    if (stored) state = { ...state, ...JSON.parse(stored) }
  } catch {
    /* Reset invalid preview data. */
  }
  // Upgrade existing demo sessions without resetting the user's data.
  for (const quotes of Object.values(state.quotes)) for (const quote of quotes) {
    quote.ownerId ??= null
    quote.ownerName ??= null
  }
  for (const orgId of [studio, id(12)]) if (!state.members[orgId]?.length) state.members[orgId] = seed().members[orgId]!
  const save = () =>
    sessionStorage.setItem('quotes:fixture:data:v2', JSON.stringify(state))
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
        body = options.body as any
      const [pathname] = path.split('?')
      const parts = pathname!.split('/').filter(Boolean)
      let result: any
      const page = (items: unknown[]) => ({ items, nextCursor: null })
      if (pathname === '/me/bootstrap' || pathname === '/me') {
        if (method === 'PATCH') state.user.displayName = body.displayName
        result = { user: state.user }
      } else if (pathname === '/me/organizations')
        result = page(state.organizations)
      else if (parts[0] === 'organizations') {
        const orgId = parts[1]!,
          org = state.organizations.find((o) => o.id === orgId)
        if (!org)
          fail(
            404,
            'NOT_FOUND',
            'You no longer have access to this organization.',
          )
        if (['taxonomies', 'principals'].includes(parts[2] || '')) return structuredClone(configurations.request(path, method, body, org!, state.user)) as T
        const quoteDetail = (quote: Quote & Partial<QuoteDetail>): QuoteDetail => ({ ...quote, token: quote.modifiedWhen, lines: quote.lines ?? [], currency: 'USD', total: (() => { const n = (quote.lines ?? []).reduce((sum,l) => sum + BigInt(l.lineTotal.replace('.','')),0n); return `${n / 100n}.${String(n % 100n).padStart(2,'0')}` })() })
        if (parts[2] === 'quotes' && ((parts.length === 4 && ['GET','PUT'].includes(method)) || (parts.length === 3 && method === 'POST'))) {
          const previous = state.quotes[orgId]?.find(q => q.id === parts[3])
          if (parts[3] && !previous) fail(404,'NOT_FOUND','Quote not found.')
          if (method === 'GET') return structuredClone({ quote: quoteDetail(previous!) }) as T
          if (previous && (body.expectedToken !== previous.modifiedWhen || sessionStorage.getItem('quotes:fixture:quote-conflict'))) { sessionStorage.removeItem('quotes:fixture:quote-conflict'); fail(409,'QUOTE_CONFLICT','This quote changed. Reload before saving; your changes have been retained.') }
          if (!body.customerName?.trim() || !body.projectName?.trim()) fail(422,'INVALID_INPUT','Customer and Project are required.')
          const owner = (state.members[orgId] || []).find(m => m.userId === body.ownerId)
          if (body.ownerId !== null && !owner) fail(422,'OWNER_UNAVAILABLE','Choose an active team member.')
          if (!Array.isArray(body.lines) || body.lines.length > 100) fail(422,'INVALID_INPUT','Use at most 100 lines.')
          const lines = body.lines.map((input: any) => {
            const old = previous?.lines?.find(l => l.id === input.id)
            if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 1000000) fail(422,'INVALID_INPUT','Use a positive whole quantity.')
            let snapshot = old && old.taxonomyId === input.taxonomyId && old.versionId === input.versionId ? old.snapshot : null
            if (!snapshot) {
              const { taxonomy: t } = configurations.request(`/organizations/${orgId}/taxonomies/${input.taxonomyId}`, 'GET', {}, org!, state.user) as { taxonomy: Taxonomy }
              if (t.archivedAt || t.version.id !== input.versionId) fail(409,'CONFIGURATION_CHANGED','The configuration changed or was archived. Select the current product again and review its options.')
              snapshot = { content: t.version.content, principalId: t.version.principalId, principalName: t.principalName }
            }
            if (input.selections.length !== snapshot.content.segments.length || input.selections.some((id: string | null,i: number) => id !== null && !snapshot!.content.segments[i]?.options.some(o => o.id === id))) fail(422,'INVALID_INPUT','Choose valid options.')
            const line: LocalQuoteLine = { ...input, id: old?.id ?? crypto.randomUUID(), key: '', snapshot, complete: input.selections.every((id: string | null) => id !== null) }
            return { ...line, key: undefined, ...quoteAmount(line), partNumber: quoteNumber(line) }
          })
          const quote: Quote & Partial<QuoteDetail> = { id: previous?.id ?? String(Math.max(10000,...Object.values(state.quotes).flat().map(q => Number(q.id))) + 1), organizationId: orgId, customerId: previous?.customerId ?? null, customerName: body.customerName.trim(), projectName: body.projectName.trim(), title: `${body.customerName.trim()} - ${body.projectName.trim()}`, ownerId: body.ownerId, ownerName: owner ? owner.displayName?.trim() || 'Unnamed team member' : null, modifiedBy: state.user.id, modifiedByName: state.user.displayName?.trim() || 'Unnamed team member', modifiedWhen: new Date().toISOString(), lines }
          const unchanged = previous && previous.customerName === quote.customerName && previous.projectName === quote.projectName && previous.ownerId === quote.ownerId && JSON.stringify(previous.lines ?? []) === JSON.stringify(lines)
          if (unchanged) return structuredClone({ quote: quoteDetail(previous), unchanged: true }) as T
          if (previous) state.quotes[orgId]!.splice(state.quotes[orgId]!.indexOf(previous),1,quote); else (state.quotes[orgId] ??= []).push(quote)
          save(); return structuredClone({ quote: quoteDetail(quote), unchanged: false }) as T
        }
        const listingQuotes = parts.length === 3 && parts[2] === 'quotes' && method === 'GET'
        const listingOwners = parts.length === 3 && parts[2] === 'quote-owners' && method === 'GET'
        const editingOwner = parts.length === 4 && parts[2] === 'quotes' && method === 'PATCH'
        if (!listingQuotes && !listingOwners && !editingOwner && (parts.length > 2 || method !== 'GET')) {
          if (org!.role !== 'admin')
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
          const items = [...(state.quotes[orgId] || [])].filter(quote =>
            quote.customerName.toLowerCase().includes(customer) && quote.projectName.toLowerCase().includes(project) &&
            (!owner || (owner === 'unassigned' ? quote.ownerId === null : quote.ownerId === owner)),
          ).sort((a, b) =>
            b.modifiedWhen.localeCompare(a.modifiedWhen) || Number(b.id) - Number(a.id),
          )
          result = {
            items: items.slice((page - 1) * pageSize, page * pageSize), page, pageSize,
            totalItems: items.length, totalPages: Math.ceil(items.length / pageSize),
          }
        } else if (parts.length === 2) {
          if (method === 'PATCH') org!.name = body.name
          result = { organization: org }
        } else if (parts[2] === 'members') {
          const members = state.members[orgId] || []
          if (parts[3]) {
            const member = members.find((m) => m.id === parts[3])
            if (!member) fail(404, 'NOT_FOUND', 'Member not found.')
            if (
              member!.role === 'admin' &&
              (method === 'DELETE' || body.role !== 'admin') &&
              members.filter((m) => m.role === 'admin').length === 1
            )
              fail(
                409,
                'LAST_ADMIN',
                'Your organization needs at least one administrator. Make another member an admin first.',
              )
            if (method === 'DELETE')
              state.members[orgId] = members.filter((m) => m.id !== parts[3])
            else member!.role = body.role
            if (member!.userId === me) {
              if (method === 'DELETE')
                state.organizations = state.organizations.filter(
                  (o) => o.id !== orgId,
                )
              else org!.role = body.role
            }
            result = { success: true }
          } else if (method === 'POST') {
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
                'This person is already a member. Change their role from Members.',
              )
            const added: Member = {
              id: String(nextMemberId = Math.max(nextMemberId, ...Object.values(state.members).flat().map(member => Number(member.id))) + 1),
              userId: account!.id,
              email: account!.email,
              displayName: account!.displayName,
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
