import { ApiError } from '~/types/identity'
import type { QuotePage, QuoteFilters } from '~/types/quotes'

export function useQuotes(organization: () => string) {
  const identity = useIdentity()
  const data = shallowRef<QuotePage | null>(null)
  const loading = ref(true)
  const error = ref('')
  const filters = ref<QuoteFilters>({ customer: '', project: '', ownerId: '' })
  let controller: AbortController | undefined
  let requestedPage = 1
  let mounted = false

  async function load(page = requestedPage) {
    controller?.abort()
    const current = new AbortController()
    controller = current
    requestedPage = page
    loading.value = true
    error.value = ''
    const path = `/organizations/${organization()}/quotes`
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(filters.value)) if (value) query.set(key, value)
    const url = (page: number) => `${path}?page=${page}&pageSize=50&${query}`
    try {
      let result = await identity.request<QuotePage>(url(page), {
        signal: current.signal,
      })
      if (current.signal.aborted) return
      // Recover if writes removed the last page between requests.
      while (!current.signal.aborted && result.totalPages > 0 && result.page > result.totalPages) {
        requestedPage = result.totalPages
        result = await identity.request<QuotePage>(url(result.totalPages), {
          signal: current.signal,
        })
      }
      if (!current.signal.aborted) data.value = result
    } catch (cause) {
      if (!current.signal.aborted) {
        // Retain rows only for retryable failures, never for lost access.
        if (cause instanceof ApiError && [401, 403, 404].includes(cause.status)) data.value = null
        error.value = (cause as Error).message
      }
    } finally {
      if (!current.signal.aborted) loading.value = false
    }
  }

  watch([
    organization,
    () => identity.state.organizations.some(org => org.id === identity.organizationId(organization())),
    () => identity.state.user?.id,
  ], () => {
    if (!mounted) return
    controller?.abort()
    data.value = null
    requestedPage = 1
    filters.value = { customer: '', project: '', ownerId: '' }
    void load(1)
  }, { flush: 'sync' })
  onMounted(() => {
    mounted = true
    void load(1)
  })
  onBeforeUnmount(() => {
    mounted = false
    controller?.abort()
  })
  function applyFilters(value: QuoteFilters) {
    filters.value = { ...value }
    data.value = null
    void load(1)
  }
  return { data, loading, error, load, filters, applyFilters }
}
