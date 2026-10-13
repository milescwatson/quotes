import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { ApiError } from '~/types/identity'
import type { Principal, PrincipalPage, TaxonomyPage } from '~/types/taxonomy'
import { queryKeys } from '~/utils/query-keys'

export function useConfigurationList<T extends PrincipalPage | TaxonomyPage>(organization: () => string, endpoint: 'principals' | 'taxonomies', principalId: () => string = () => '') {
  const identity = useIdentity(), client = useQueryClient()
  const org = computed(() => identity.organizationId(organization())), filter = computed(principalId), page = ref(1)
  const queryKey = computed(() => endpoint === 'principals'
    ? queryKeys.principalList(org.value, page.value)
    : queryKeys.taxonomyList(org.value, page.value, filter.value))
  const query = useQuery<T | null>({
    queryKey,
    placeholderData: previous => previous,
    enabled: computed(() => import.meta.client && !!org.value),
    queryFn: async ({ signal }) => {
      const makeUrl = (n: number) => `/organizations/${org.value}/${endpoint}?page=${n}&pageSize=50${endpoint === 'taxonomies' && filter.value ? `&principalId=${encodeURIComponent(filter.value)}` : ''}`
      try {
        let result = await identity.request<T>(makeUrl(page.value), { signal })
        if (result.totalPages && result.page > result.totalPages) {
          page.value = result.totalPages
          result = await identity.request<T>(makeUrl(result.totalPages), { signal })
        }
        return result
      } catch (error) {
        if (error instanceof ApiError && [401, 403, 404].includes(error.status)) client.setQueryData(queryKey.value, null)
        throw error
      }
    },
  })
  watch([org, filter, () => identity.state.user?.id], () => { page.value = 1 })
  return {
    data: computed(() => query.data.value ?? null),
    loading: query.isFetching,
    error: computed(() => query.error.value ? (query.error.value as Error).message : ''),
    load: async (nextPage = page.value) => {
      if (nextPage !== page.value) { page.value = nextPage; return }
      await query.refetch()
    },
    query,
  }
}

export function principalChoicesOptions(organization: string, identity: ReturnType<typeof useIdentity>) {
  return {
    queryKey: queryKeys.principalChoices(organization),
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      const items: Principal[] = []
      let page = 1, totalPages = 1
      do {
        const result = await identity.request<PrincipalPage>(`/organizations/${organization}/principals?page=${page}&pageSize=100`, { signal })
        items.push(...result.items); totalPages = result.totalPages; page++
      } while (page <= totalPages)
      return items
    },
  }
}

export function usePrincipalChoices(organization: () => string) {
  const identity = useIdentity(), org = computed(() => identity.organizationId(organization()))
  return useQuery(computed(() => ({
    ...principalChoicesOptions(org.value, identity),
    enabled: import.meta.client && !!org.value,
  })))
}
