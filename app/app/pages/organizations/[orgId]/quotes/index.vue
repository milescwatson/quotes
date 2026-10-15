<script setup lang="ts">
import type { QuoteOwners } from '~/types/quotes'
import { queryKeys } from '~/utils/query-keys'
import { useQueryClient } from '@tanstack/vue-query'
const route = useRoute()
const identity = useIdentity()
const queryClient = useQueryClient()
const { data, loading, error, load, filters, applyFilters, showArchived } = useQuotes(() => String(route.params.orgId))
const owners = useResource<QuoteOwners>(() => `/organizations/${route.params.orgId}/quote-owners`, () => true, () => queryKeys.quoteOwners(identity.organizationId(route.params.orgId)))
const success = ref('')
const filtered = computed(() => Object.values(filters.value).some(Boolean))
async function ownerSaved() {
  success.value = 'Quote owner updated.'
}
async function accessLost() {
  const queryKey = queryKeys.quotes(identity.organizationId(route.params.orgId))
  await queryClient.cancelQueries({ queryKey })
  queryClient.setQueriesData({ queryKey }, null)
  queryClient.removeQueries({ queryKey })
  await load()
  await owners.load()
}
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const dateLabel = (value: string) => dateFormat.format(new Date(value))
</script>

<template>
  <PageHeading title="Quotes" description="Customer projects and their latest updates.">
    <button type="button" class="button secondary" :aria-pressed="showArchived" @click="showArchived = !showArchived; success = ''">{{ showArchived ? 'Show active quotes' : 'Show archived quotes' }}</button>
    <NuxtLink :to="`${identity.organizationPath(identity.organizationId(route.params.orgId))}/quotes/new`" class="button primary">
      <svg class="size-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden="true"><path d="M10 4v12M4 10h12" stroke-width="1.5" stroke-linecap="round" /></svg>
      New Quote
    </NuxtLink>
  </PageHeading>
  <QuoteFilters :model-value="filters" :owners="owners.data.value?.items || []" :owners-loading="owners.loading.value" @apply="applyFilters($event); success = ''" />
  <div v-if="owners.error.value" class="error flex flex-wrap items-center justify-between gap-2" role="alert">
    <p>Team members could not be loaded. {{ owners.error.value }}</p>
    <button class="button secondary" @click="owners.load">Retry team members</button>
  </div>
  <p v-if="success" class="success" role="status">{{ success }}</p>
  <ResourceState :loading="loading && !data" :error="data ? '' : error" @retry="load()">
    <template v-if="data">
      <div v-if="error" class="error flex flex-wrap items-center justify-between gap-3" role="alert">
        <p>{{ error }}</p>
        <button class="button secondary" :disabled="loading" @click="load()">Try again</button>
      </div>
      <section v-if="data.totalItems === 0" class="panel empty-state">
        <h2>{{ filtered ? 'No matching quotes.' : showArchived ? 'No archived quotes.' : 'No quotes yet.' }}</h2>
        <p>{{ filtered ? 'Try different filters or clear them to see all quotes.' : showArchived ? 'Quotes you archive will appear here and can be restored.' : 'Quotes for this organization will appear here.' }}</p>
        <button v-if="filtered" class="button secondary" @click="applyFilters({ customer: '', project: '', ownerId: '' })">Show all quotes</button>
      </section>
      <section v-else class="panel overflow-hidden" aria-label="Quotes list" :aria-busy="loading">
        <div class="overflow-x-auto" role="region" aria-label="Quotes table" tabindex="0">
          <table class="min-w-[68rem] table-fixed">
            <caption class="sr-only">Quotes, newest updates first</caption>
            <thead>
              <tr>
                <th scope="col" class="w-[24%]">Quote title</th>
                <th scope="col" class="w-[16%]">Customer Name</th>
                <th scope="col" class="w-[16%]">Project Name</th>
                <th scope="col" class="w-[18%]">Owner</th>
                <th scope="col" class="w-[12%]">ModifiedBy</th>
                <th scope="col" class="w-[14%]">ModifiedWhen</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="quote in data.items" :key="quote.id" class="align-top">
                <td class="break-words font-medium"><NuxtLink :to="`${identity.organizationPath(identity.organizationId(route.params.orgId))}/quotes/${quote.id}`" class="text-blue-700 hover:underline">{{ quote.title }}</NuxtLink><span v-if="quote.archivedAt" class="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-normal text-gray-600">Archived</span></td>
                <td class="break-words">{{ quote.customerName }}</td>
                <td class="break-words">{{ quote.projectName }}</td>
                <td><QuoteOwnerSelect :quote="quote" :owners="owners.data.value?.items || []" :organization-id="String(route.params.orgId)" :disabled="loading || owners.loading.value || !!owners.error.value || !!quote.archivedAt" @saved="ownerSaved" @access-lost="accessLost" /></td>
                <td class="break-words">{{ quote.modifiedByName }}</td>
                <td><time :datetime="quote.modifiedWhen" :title="quote.modifiedWhen">{{ dateLabel(quote.modifiedWhen) }}</time></td>
              </tr>
            </tbody>
          </table>
        </div>
        <nav aria-label="Quotes pagination" class="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 p-4">
          <p class="text-gray-600" role="status">
            <template v-if="loading">Loading quotes… </template>
            Page {{ data.page }} of {{ data.totalPages }} · {{ data.totalItems }} {{ data.totalItems === 1 ? 'quote' : 'quotes' }}
          </p>
          <div class="flex gap-2">
            <button class="button secondary" :disabled="loading || data.page <= 1" @click="load(data.page - 1)">Previous</button>
            <button class="button secondary" :disabled="loading || data.page >= data.totalPages" @click="load(data.page + 1)">Next</button>
          </div>
        </nav>
      </section>
    </template>
  </ResourceState>
</template>
