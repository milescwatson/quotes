<script setup lang="ts">
import type { Organization } from '~/types/identity'
const route = useRoute()
const identity = useIdentity()
const { data, loading, error, load } = useResource<{ organization: Organization }>(
  () => `/organizations/${route.params.orgId}`,
)
const quotesPath = computed(() => `${identity.organizationPath(identity.organizationId(route.params.orgId))}/quotes`)
</script>

<template>
  <ResourceState :loading="loading" :error="error" @retry="load">
    <template v-if="data">
      <PageHeading title="New Quote" :description="`Create a quote for ${data.organization.name}.`">
        <NuxtLink :to="quotesPath" class="button secondary">Back to quotes</NuxtLink>
      </PageHeading>
      <section class="rounded-lg border border-dashed border-gray-300 bg-white px-6 py-12 text-center sm:py-16">
        <div class="mx-auto mb-4 flex size-12 items-center justify-center rounded-lg bg-gray-100 text-gray-500">
          <svg class="size-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8l-5-5Zm0 0v5h5M9 13h6M9 17h4" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </div>
        <h2 class="mb-2">Quote creation is coming soon</h2>
        <p class="mx-auto max-w-md text-gray-600">This is a placeholder for the new quote form. You’ll be able to add customer and project details here.</p>
      </section>
    </template>
  </ResourceState>
</template>
