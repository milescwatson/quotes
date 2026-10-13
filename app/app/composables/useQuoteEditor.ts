import { ApiError } from '~/types/identity'
import type { QuoteDetail, LocalQuoteLine, QuoteOwners, QuoteProduct } from '~/types/quotes'
import type { TaxonomyPage, FieldError } from '~/types/taxonomy'
import { lineInput } from '~/utils/quote'
export function useQuoteEditor() {
  const route = useRoute(), identity = useIdentity()
  const organization = computed(() => identity.organizationId(route.params.orgId))
  const org = computed(() => identity.state.organizations.find(o => o.id === organization.value))
  const back = computed(() => `${identity.organizationPath(organization.value)}/quotes`)
  const saved = ref<QuoteDetail | null>(null), customer = ref(''), project = ref(''), owner = ref<string | null>(null), lines = ref<(LocalQuoteLine | null)[]>([])
  const keys = ref<string[]>([]), pending = ref(new Set<string>())
  const products = ref<QuoteProduct[]>([]), owners = ref<QuoteOwners['items']>([])
  const loading = ref(true), ready = ref(false), busy = ref(false), error = ref(''), catalogError = ref(''), catalogLoading = ref(false), notice = ref(''), conflicted = ref(false), errors = ref<FieldError[]>([])
  const fingerprint = () => JSON.stringify({ customer: customer.value, project: project.value, owner: owner.value, lines: lines.value, keys: keys.value })
  const baseline = ref(''), dirty = computed(() => ready.value && (fingerprint() !== baseline.value || pending.value.size > 0))
  let generation = 0, controller: AbortController | undefined
  function adopt(q: QuoteDetail) {
    saved.value = q; customer.value = q.customerName; project.value = q.projectName; owner.value = q.ownerId
    lines.value = q.lines.map(l => ({ ...l, key: l.id })); keys.value = q.lines.map(l => l.id); pending.value.clear(); baseline.value = fingerprint()
  }
  async function catalog(signal = controller?.signal) {
    catalogLoading.value = true; catalogError.value = ''; const current = generation
    try {
      const all: QuoteProduct[] = []; let page = 1, pages = 1
      do { const result = await identity.request<TaxonomyPage>(`/organizations/${organization.value}/taxonomies?page=${page}&pageSize=100`, { signal }); all.push(...result.items); pages = result.totalPages; page++ } while (page <= pages)
      if (current === generation && !signal?.aborted) products.value = all
    } catch (e) { if (current === generation && !signal?.aborted) { catalogError.value = (e as Error).message; if (e instanceof ApiError && [401,403,404].includes(e.status)) invalidate((e as Error).message) } }
    finally { if (current === generation) catalogLoading.value = false }
  }
  async function load() {
    controller?.abort(); const c = new AbortController(); controller = c; const current = ++generation
    loading.value = true; ready.value = false; error.value = ''; conflicted.value = false; errors.value = []
    try {
      const [team, result] = await Promise.all([
        identity.request<QuoteOwners>(`/organizations/${organization.value}/quote-owners`, { signal: c.signal }),
        route.params.quoteId ? identity.request<{ quote: QuoteDetail }>(`/organizations/${organization.value}/quotes/${route.params.quoteId}`, { signal: c.signal }) : Promise.resolve(null),
      ])
      if (c.signal.aborted || current !== generation) return
      owners.value = team.items
      if (result) adopt(result.quote)
      else { saved.value = null; customer.value = ''; project.value = ''; owner.value = identity.state.user?.id ?? null; lines.value = []; keys.value = []; pending.value.clear(); baseline.value = fingerprint() }
      ready.value = true; void catalog(c.signal)
    } catch (e) { if (!c.signal.aborted && current === generation) error.value = (e as Error).message }
    finally { if (current === generation) loading.value = false }
  }
  function clear() { ready.value = false; saved.value = null; customer.value = ''; project.value = ''; owner.value = null; lines.value = []; keys.value = []; products.value = []; owners.value = []; pending.value.clear() }
  function invalidate(message = 'You no longer have access to this organization.') { controller?.abort(); generation++; clear(); loading.value = false; error.value = message }
  async function save() {
    if (!ready.value || busy.value || conflicted.value) return
    error.value = ''; errors.value = []; notice.value = ''
    for (const [field,value] of [['customerName',customer.value],['projectName',project.value]]) if (!value?.trim() || value.trim().length > 120 || /[\p{Cc}\p{Cs}]/u.test(value)) errors.value.push({ path: `/${field}`, code: 'INVALID_INPUT', message: 'Enter 1–120 characters without control characters.' })
    if (lines.value.some(l => !l)) error.value = 'Choose a product for every line, or remove the empty line.'
    if (errors.value.length || error.value) { await nextTick(); document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(); return }
    busy.value = true; const current = generation
    try {
      const result = await identity.request<{ quote: QuoteDetail; unchanged: boolean }>(`/organizations/${organization.value}/quotes${saved.value ? `/${saved.value.id}` : ''}`, { method: saved.value ? 'PUT' : 'POST', body: {
        customerName: customer.value.trim(), projectName: project.value.trim(), ownerId: owner.value, lines: lines.value.map(l => lineInput(l!)), ...(saved.value ? { expectedToken: saved.value.token } : {}),
      }, signal: controller?.signal })
      if (current !== generation) return
      const created = !saved.value; adopt(result.quote); notice.value = result.unchanged ? 'No changes to save.' : 'Quote saved.'
      if (created) await navigateTo(`${back.value}/${result.quote.id}`, { replace: true })
    } catch (e) {
      if (current !== generation) return
      error.value = (e as Error).message
      if (e instanceof ApiError) { errors.value = e.fieldErrors || []; conflicted.value = ['QUOTE_CONFLICT','CONCURRENT_CHANGE'].includes(e.code); if (e.code === 'CONFIGURATION_CHANGED') void catalog(); if ([401,403,404].includes(e.status)) clear() }
    } finally { busy.value = false }
  }
  function add() { keys.value.push(crypto.randomUUID()); lines.value.push(null) }
  function remove(index: number) { pending.value.delete(keys.value[index]!); lines.value.splice(index,1); keys.value.splice(index,1) }
  function reload() { if (!dirty.value || window.confirm('Discard your unsaved changes and reload?')) void load() }
  function mayLeave() { return !identity.state.user || !dirty.value || window.confirm('Leave without saving your quote changes?') }
  function unload(e: BeforeUnloadEvent) { if (dirty.value) { e.preventDefault(); e.returnValue = '' } }
  function signOut(e: Event) { if (!mayLeave()) e.preventDefault() }
  onBeforeRouteLeave(mayLeave); onBeforeRouteUpdate(mayLeave)
  onMounted(() => { void load(); window.addEventListener('beforeunload',unload); window.addEventListener('quotes:before-sign-out',signOut) })
  watch(() => route.fullPath, () => { void load() })
  watch(() => org.value, value => { if (!value) invalidate() })
  watch(() => identity.state.user?.id, () => invalidate('Your session changed. Reload to continue.'))
  onBeforeUnmount(() => { controller?.abort(); generation++; window.removeEventListener('beforeunload',unload); window.removeEventListener('quotes:before-sign-out',signOut) })
  return { saved, customer, project, owner, lines, keys, pending, owners, products, back, organization, ready, loading, busy, error, catalogError, catalogLoading, notice, conflicted, errors, dirty, load, catalog, save, add, remove, reload, invalidate }
}
