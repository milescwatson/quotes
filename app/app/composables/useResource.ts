import { ApiError } from '~/types/identity'
import { useQuery, useQueryClient, type QueryKey } from '@tanstack/vue-query'

export function useResource<T>(path: () => string, enabled: () => boolean = () => true, queryKey?: () => QueryKey) {
  const identity = useIdentity()
  const client = useQueryClient()
  const resourcePath = computed(path)
  const query = useQuery<T | null>({
    queryKey: computed(() => queryKey?.() ?? ['resource', resourcePath.value]),
    enabled: computed(() => import.meta.client && enabled()),
    queryFn: async ({ signal }) => {
      try {
        return await identity.request<T>(resourcePath.value, { signal })
      } catch (error) {
        if (error instanceof ApiError && [401, 403, 404].includes(error.status)) {
          client.setQueryData(queryKey?.() ?? ['resource', resourcePath.value], null)
        }
        throw error
      }
    },
  })
  return {
    data: computed(() => query.data.value ?? null),
    error: computed(() => query.error.value ? (query.error.value as Error).message : ''),
    loading: computed(() => query.isLoading.value),
    load: async () => { await query.refetch() },
    query,
  }
}
