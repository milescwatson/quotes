import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'

export default defineNuxtPlugin((nuxtApp) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnMount: true,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        retry: (failureCount, error) => {
          const status = (error as { status?: number }).status
          if (status && status >= 400 && status < 500) return false
          return failureCount < 1
        },
      },
    },
  })
  nuxtApp.vueApp.use(VueQueryPlugin, { queryClient })
  if (import.meta.client) {
    window.addEventListener('quotes:clear-query-cache', () => queryClient.clear())
  }
})
