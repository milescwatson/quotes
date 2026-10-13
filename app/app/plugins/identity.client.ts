import { organizationRouteId } from '~/utils/organization-routes'
import { reactive } from 'vue'
import { createAuth } from '~/services/auth'
import { createHttp } from '~/services/http'
import {
  ApiError,
  safeDestination,
  type ApiOptions,
  type Organization,
  type Page,
  type Profile,
} from '~/types/identity'
export default defineNuxtPlugin(async () => {
  const config = useRuntimeConfig().public
  const router = useRouter()
  let sessionEpoch = 0
  const fixture = import.meta.dev && String(config.identityFixtures) === 'true'
  const state = reactive({
    user: null as Profile | null,
    organizations: [] as Organization[],
    ready: false,
    error: '',
    fixture,
  })
  const auth = createAuth(config)
  const demo = fixture
    ? await import('~/services/fixtures').then((m) => m.createFixtures())
    : null
  const transport =
    demo?.request ?? createHttp(String(config.apiBase), auth.token)
  const routeIds = reactive<Record<string, string>>({})
  function organizationId(value: unknown): string {
    const reference = String(value || '')
    if (state.organizations.some(org => org.id === reference)) return reference
    const matches = state.organizations.filter(org => routeIds[org.id] === reference)
    if (matches.length === 1) return matches[0]!.id
    // Never resolve an ambiguous short ID to an arbitrary organization.
    return reference
  }
  function organizationPath(id: string): string {
    return `/organizations/${routeIds[id] || id}`
  }
  let initializing: Promise<void> | null = null
  const clear = () => {
    sessionEpoch++
    window.dispatchEvent(new Event('quotes:clear-query-cache'))
    state.user = null
    state.organizations = []
    for (const id of Object.keys(routeIds)) delete routeIds[id]
  }
  async function request<T>(path: string, options?: ApiOptions): Promise<T> {
    const epoch = sessionEpoch
    try {
      const apiPath = path.replace(/^\/organizations\/([^/?]+)/, (_, id: string) => `/organizations/${organizationId(id)}`)
      const result = await transport<T>(apiPath, options)
      if (epoch !== sessionEpoch)
        throw new DOMException('Session changed', 'AbortError')
      return result
    } catch (error) {
      if (
        epoch === sessionEpoch &&
        error instanceof ApiError &&
        (error.status === 401 || error.code === 'ACCOUNT_DISABLED')
      ) {
        clear()
        state.error = error.message
        await auth.clear()
        if (
          state.ready &&
          !['/login', '/auth/callback'].includes(router.currentRoute.value.path)
        )
          await router.replace({
            path: '/login',
            query: {
              returnTo: safeDestination(router.currentRoute.value.fullPath),
            },
          })
      }
      throw error
    }
  }
  async function refresh({ bootstrap = false } = {}) {
    const epoch = sessionEpoch
    const result = await request<{ user: Profile }>(bootstrap ? '/me/bootstrap' : '/me', bootstrap ? { method:'POST' } : {})
    state.user = result.user
    const organizations: Organization[] = []
    let cursor: string | null = null
    do {
      const page: Page<Organization> = await request(
        `/me/organizations${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
      )
      organizations.push(...page.items)
      cursor = page.nextCursor
    } while (cursor)
    const aliases = await Promise.all(organizations.map(async org => [org.id, await organizationRouteId(org.id)] as const))
    if (epoch !== sessionEpoch) throw new DOMException('Session changed', 'AbortError')
    const counts = new Map<string, number>()
    for (const [, alias] of aliases) counts.set(alias, (counts.get(alias) || 0) + 1)
    for (const id of Object.keys(routeIds)) delete routeIds[id]
    for (const [id, alias] of aliases) routeIds[id] = counts.get(alias) === 1 ? alias : id
    state.organizations = organizations
    state.error = ''
  }
  async function ensure() {
    if (state.ready) return
    initializing ??= refresh({ bootstrap:true })
      .catch((error) => {
        clear()
        state.error = error instanceof ApiError && error.status === 401
          ? ''
          : error.message
      })
      .finally(() => {
        state.ready = true
        initializing = null
      })
    await initializing
  }
  async function signIn(destination: string) {
    if (demo) {
      demo.signIn()
      await refresh({ bootstrap:true })
      state.ready = true
      await navigateTo(destination)
    } else await auth.signIn(destination)
  }
  async function signOut() {
    if (!window.dispatchEvent(new Event('quotes:before-sign-out', { cancelable: true }))) return
    clear()
    state.error = ''
    state.ready = true
    if (demo) {
      demo.signOut()
      await navigateTo('/login')
    } else {
      await auth.signOut()
      await navigateTo('/login')
    }
  }
  async function scenario(name: string) {
    if (demo) {
      demo.scenario(name)
      await refresh()
      await navigateTo('/organizations')
    }
  }
  return {
    provide: {
      identity: {
        state,
        organizationId,
        organizationPath,
        request,
        refresh,
        ensure,
        signIn,
        signOut,
        scenario,
        async complete() {
          const destination = await auth.complete()
          await refresh({ bootstrap:true })
          state.ready = true
          return destination
        },
      },
    },
  }
})
