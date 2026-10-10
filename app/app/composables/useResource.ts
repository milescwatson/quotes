export function useResource<T>(path: () => string, enabled: () => boolean = () => true) {
  const identity = useIdentity()
  const data = shallowRef<T | null>(null),
    error = ref(''),
    loading = ref(true)
  let controller: AbortController | undefined
  async function load() {
    controller?.abort()
    const current = new AbortController()
    controller = current
    data.value = null
    error.value = ''
    if (!enabled()) {
      loading.value = false
      return
    }
    loading.value = true
    try {
      const result = await identity.request<T>(path(), {
        signal: current.signal,
      })
      if (!current.signal.aborted) data.value = result
    } catch (e) {
      if (!current.signal.aborted) error.value = (e as Error).message
    } finally {
      if (!current.signal.aborted) loading.value = false
    }
  }
  onMounted(load)
  watch([path, enabled], load)
  onBeforeUnmount(() => controller?.abort())
  return { data, error, loading, load }
}
