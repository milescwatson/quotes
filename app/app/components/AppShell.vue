<script setup lang="ts">
const identity = useIdentity()
const route = useRoute()
const org = computed(() =>
  identity.state.organizations.find((o) => o.id === identity.organizationId(route.params.orgId)),
)
const initials = computed(() =>
  (identity.state.user?.displayName || identity.state.user?.email || 'Q')
    .slice(0, 2)
    .toUpperCase(),
)
const menu = ref(false)
// Refresh access when a teammate adds this account while the app is open.
let refreshing = false
async function refreshOrganizations() {
  if (refreshing || !identity.state.user || document.visibilityState === 'hidden') return
  refreshing = true
  try { await identity.refresh() } catch { /* Keep current choices during transient failures. */ }
  finally { refreshing = false }
}
let refreshTimer: ReturnType<typeof setInterval>
onMounted(() => {
  window.addEventListener('focus', refreshOrganizations)
  refreshTimer = setInterval(refreshOrganizations, 30_000)
})
onBeforeUnmount(() => {
  window.removeEventListener('focus', refreshOrganizations)
  clearInterval(refreshTimer)
})
</script>
<template>
  <div class="app-shell">
    <aside class="sidebar" :class="{ expanded: menu }">
      <NuxtLink :to="org ? `${identity.organizationPath(org.id)}/quotes` : '/'" class="brand" aria-label="Quotes home">Quotes</NuxtLink>
      <nav aria-label="Main navigation" @click="menu = false">
        <template v-if="org"
          ><p class="sidebar-label section-label">{{ org.name }}</p>
          <NuxtLink
            :to="`${identity.organizationPath(org.id)}/quotes`"
            active-class="selected"
            > Quotes</NuxtLink
          ><template v-if="org.role === 'admin'"
            ><NuxtLink
              :to="`${identity.organizationPath(org.id)}/members`"
              active-class="selected"
              > Members</NuxtLink
            ></template
          ></template
        >
      </nav>
      <div class="sidebar-bottom">
        <div v-if="identity.state.fixture" class="mb-4">
          <label for="demo-scenario" class="text-xs text-gray-500">Demo scenario</label>
          <select id="demo-scenario" class="w-full" @change="identity.scenario(($event.target as HTMLSelectElement).value)">
            <option value="admin">Admin</option>
            <option value="member">Member</option>
            <option value="empty">No organizations</option>
          </select>
        </div>
        <NuxtLink to="/profile" class="user-link"
          ><span class="avatar">{{ initials }}</span
          ><span
            ><strong>{{
              identity.state.user?.displayName || 'Your profile'
            }}</strong
            ><small>{{ identity.state.user?.email }}</small></span
          ></NuxtLink
        >
      </div>
    </aside>
    <div class="app-main">
      <header class="topbar">
        <button
          class="icon-button mobile-toggle"
          aria-label="Toggle navigation"
          :aria-expanded="menu"
          @click="menu = !menu"
        >
          ☰
        </button>
        <div class="breadcrumb hidden min-w-0 truncate md:block">
          Workspace <span>/</span> {{ org?.name || 'Your account' }}
        </div>
        <div class="topbar-right ml-auto min-w-0">
          <OrganizationNav @focusin="refreshOrganizations" />
          <NuxtLink
            v-if="org?.role === 'admin'"
            :to="`${identity.organizationPath(org.id)}/settings`"
            aria-label="Admin settings"
            title="Admin settings"
            class="flex min-h-10 min-w-10 items-center justify-center gap-2 rounded-md px-2 text-sm font-medium text-gray-700 hover:bg-gray-100 sm:px-3"
            active-class="bg-gray-100 text-gray-900"
          >
            <svg class="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9.75 3h4.5l.6 2.4 2.1 1.2 2.4-.6 2.25 3.9-1.8 1.8v2.6l1.8 1.8-2.25 3.9-2.4-.6-2.1 1.2-.6 2.4h-4.5l-.6-2.4-2.1-1.2-2.4.6-2.25-3.9 1.8-1.8v-2.6L2.4 9.9l2.25-3.9 2.4.6 2.1-1.2L9.75 3Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            <span class="hidden sm:inline">Admin settings</span>
          </NuxtLink>
          <button class="text-button" @click="identity.signOut()">
            Sign out
          </button>
        </div>
      </header>
      <main id="main-content" class="content" :class="{ 'content-editor': route.path.includes('/taxonomies/') }"><slot /></main>
    </div>
  </div>
</template>
