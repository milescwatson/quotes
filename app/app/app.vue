<script setup lang="ts">
const app = useNuxtApp()
const route = useRoute()
const pageTitle = computed(() => {
  if (route.path.includes('/taxonomies/')) return 'Configuration Editor'
  const section = route.path.split('/').filter(Boolean).at(-1) || 'Workspace'
  return (
    (
      {
        login: 'Sign in',
        callback: 'Signing in',
        members: 'Team members',
        quotes: 'Quotes',
        new: 'New Quote',
        settings: 'Organization settings',
        configurations: 'Product Configurations',
        principals: 'Principals',
        profile: 'Your profile',
        organizations: 'Your organizations',
      } as Record<string, string>
    )[section] || 'Your workspace'
  )
})
useHead({
  title: () => `${pageTitle.value} · Quotes`,
  meta: [
    {
      name: 'description',
      content: 'Manage your Quotes account, organizations, and team.',
    },
  ],
})
const isPublic = computed(() =>
  ['/login', '/auth/callback', '/'].includes(route.path),
)
</script>
<template>
  <NuxtRouteAnnouncer /><a class="skip-link" href="#main-content"
    >Skip to content</a
  ><ClientOnly
    ><AppShell v-if="!isPublic && app.$identity.state.user"
      ><NuxtPage :page-key="(r) => r.fullPath"
    /></AppShell>
    <main v-else id="main-content">
      <NuxtPage :page-key="(r) => r.fullPath" />
    </main>
    <template #fallback
      ><div class="initial-loading" role="status">
        Opening Quotes…
      </div></template
    ></ClientOnly
  >
</template>
