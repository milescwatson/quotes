import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { ApiError } from '~/types/identity'
import type { QuotePage, QuoteFilters } from '~/types/quotes'
import { queryKeys } from '~/utils/query-keys'

export function useQuotes(organization: () => string) {
  const identity = useIdentity(), client = useQueryClient()
  const filters = ref<QuoteFilters>({ customer: '', project: '', ownerId: '' })
  const page = ref(1)
  const org = computed(() => identity.organizationId(organization()))
  const params = computed(() => ({ page: page.value, pageSize: 50, ...filters.value }))
  const query = useQuery<QuotePage | null>({
    queryKey: computed(() => queryKeys.quoteList(org.value, params.value)),
    placeholderData: previous => previous,
    enabled: computed(() => import.meta.client && !!org.value && identity.state.organizations.some(item => item.id === identity.organizationId(org.value))),
    queryFn: async ({ signal }) => {
      const path = `/organizations/${org.value}/quotes`
      const queryString = new URLSearchParams()
      for (const [key, value] of Object.entries(filters.value)) if (value) queryString.set(key, value)
      const url = (requested: number) => `${path}?page=${requested}&pageSize=50&${queryString}`
      try {
        let result = await identity.request<QuotePage>(url(page.value), { signal })
        while (!signal.aborted && result.totalPages > 0 && result.page > result.totalPages) {
          page.value = result.totalPages
          result = await identity.request<QuotePage>(url(result.totalPages), { signal })
        }
        return result
      } catch (error) {
        if (error instanceof ApiError && [401, 403, 404].includes(error.status)) {
          client.setQueryData(queryKeys.quoteList(org.value, params.value), null)
        }
        throw error
      }
    },
  })
  watch([org, () => identity.state.user?.id, () => identity.state.organizations.some(item => item.id === identity.organizationId(org.value))], () => {
    page.value = 1
    filters.value = { customer: '', project: '', ownerId: '' }
  }, { flush: 'sync' })
  async function load(nextPage = page.value) {
    if (nextPage === page.value) await query.refetch()
    else page.value = nextPage
  }
  function applyFilters(value: QuoteFilters) { filters.value = { ...value }; page.value = 1 }
  return {
    data: computed(() => query.data.value ?? null),
    loading: query.isFetching,
    error: computed(() => query.error.value ? (query.error.value as Error).message : ''),
    load,
    filters,
    applyFilters,
    query,
  }
}
