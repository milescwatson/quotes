import { ApiError } from '~/types/identity'
import type { Principal, PrincipalPage, TaxonomyPage } from '~/types/taxonomy'
export function useConfigurationList<T extends PrincipalPage | TaxonomyPage>(organization: () => string, endpoint: 'principals' | 'taxonomies', principalId: () => string = () => '') {
  const identity = useIdentity(), data = shallowRef<T | null>(null), loading = ref(true), error = ref('')
  let controller: AbortController | undefined, requested = 1
  async function load(page = requested) {
    controller?.abort()
    const request = new AbortController(); controller = request
    requested = page; loading.value = true; error.value = ''
    const filter = principalId()
    const url = (n: number) => `/organizations/${organization()}/${endpoint}?page=${n}&pageSize=50${filter ? `&principalId=${encodeURIComponent(filter)}` : ''}`
    try {
      let result = await identity.request<T>(url(page), { signal: request.signal })
      if (result.totalPages && result.page > result.totalPages) result = await identity.request<T>(url(result.totalPages), { signal: request.signal })
      if (!request.signal.aborted) data.value = result
    } catch (cause) {
      if (!request.signal.aborted) {
        if (cause instanceof ApiError && [401, 403, 404].includes(cause.status)) data.value = null
        error.value = (cause as Error).message
      }
    } finally { if (!request.signal.aborted) loading.value = false }
  }
  onMounted(() => load(1))
  watch([organization, principalId, () => identity.state.user?.id], () => { data.value = null; void load(1) })
  onBeforeUnmount(() => controller?.abort())
  return { data, loading, error, load }
}
// Selectors must include principals beyond page 1. Requests are sequential and cancellable.
export async function loadPrincipalChoices(organization: string, signal: AbortSignal): Promise<Principal[]> {
  const identity = useIdentity(), items: Principal[] = []
  let page = 1, totalPages = 1
  do {
    const result = await identity.request<PrincipalPage>(`/organizations/${organization}/principals?page=${page}&pageSize=100`, { signal })
    signal.throwIfAborted(); items.push(...result.items); totalPages = result.totalPages; page++
  } while (page <= totalPages)
  return items
}
