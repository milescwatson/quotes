<script setup lang="ts">
import type { Organization } from '~/types/identity'
const route = useRoute(), identity = useIdentity()
const { data, loading, error, load } = useResource<{ organization: Organization }>(
  () => `/organizations/${route.params.orgId}`,
)
const settingsPath = computed(() => `${identity.organizationPath(identity.organizationId(String(route.params.orgId)))}/settings`)
const sections = computed(() => [
  { label: 'General Information', to: settingsPath.value },
  { label: 'Product Configurations', to: `${settingsPath.value}/configurations` },
  { label: 'Principals', to: `${settingsPath.value}/principals` },
])
// Preserve existing configuration bookmarks.
if (route.query.section === 'configurations') {
  const { section, ...query } = route.query
  await navigateTo({ path: `${settingsPath.value}/configurations`, query }, { replace: true })
}
</script>
<template>
  <PageHeading eyebrow="WORKSPACE" title="Organization settings" description="Manage your workspace, product configurations, and principals." />
  <ResourceState :loading="loading" :error="error" @retry="load">
    <div v-if="data?.organization.role === 'admin'" class="grid min-w-0 gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
      <nav aria-label="Settings sections" class="self-start rounded-md border border-gray-200 bg-white p-2">
        <ul class="space-y-1">
          <li v-for="section in sections" :key="section.to">
            <NuxtLink :to="section.to" :aria-current="route.path === section.to ? 'page' : undefined"
              class="block rounded-md px-3 py-2 text-sm font-medium transition-colors"
              :class="route.path === section.to ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'"
            >{{ section.label }}</NuxtLink>
          </li>
        </ul>
      </nav>
      <div class="min-w-0">
        <NuxtPage :page-key="route.path" :organization="String(route.params.orgId)" :details="data.organization" />
      </div>
    </div>
    <section v-else class="panel empty-state">
      <h2>Administrator access required</h2>
      <p>Only your organization’s administrators can change these settings.</p>
    </section>
  </ResourceState>
</template>
