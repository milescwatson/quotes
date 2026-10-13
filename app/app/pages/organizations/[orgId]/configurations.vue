<script setup lang="ts">
import type { TaxonomyPage } from '~/types/taxonomy'
const route = useRoute()
const props = computed(() => ({ organization: String(route.params.orgId) }))
const identity = useIdentity(), filter = ref('')
const configs = useConfigurationList<TaxonomyPage>(() => props.value.organization, 'taxonomies', () => filter.value)
const choices = usePrincipalChoices(() => props.value.organization)
const choicesError = computed(() => choices.error.value ? (choices.error.value as Error).message : '')
const loadChoices = () => choices.refetch()
watch(() => props.value.organization, () => { filter.value = '' })
const editor = (id: string) => `${identity.organizationPath(identity.organizationId(props.value.organization))}/taxonomies/${id}`
const date = (value: string) => new Date(value).toLocaleString()
</script>
<template>
  <section id="configurations" class="panel p-4 sm:p-6" aria-labelledby="configurations-title">
    <div class="section-heading"><h2 id="configurations-title">Product Configurations</h2><NuxtLink :to="editor('new')" class="button primary">New configuration</NuxtLink></div>
    <label for="principal-filter">Principal</label><select id="principal-filter" v-model="filter" class="mb-4 w-full sm:max-w-sm"><option value="">All principals</option><option v-for="p in choices.data.value || []" :key="p.id" :value="p.id">{{ p.name }}</option></select>
    <p v-if="choicesError" class="error" role="alert">{{ choicesError }} <button class="text-button" @click="loadChoices">Retry principals</button></p>
    <p v-if="configs.error.value" class="error" role="alert">{{ configs.error.value }} <button class="text-button" @click="configs.load()">Retry configurations</button></p>
    <p v-if="configs.loading.value && !configs.data.value" role="status">Loading configurations…</p>
    <template v-if="configs.data.value">
      <p v-if="!configs.data.value.totalItems">{{ filter ? 'No configurations for this principal.' : 'No product configurations yet.' }}</p>
      <div v-else class="overflow-x-auto" role="region" aria-label="Product configurations table" tabindex="0"><table><thead><tr><th>Product name</th><th>Principal</th><th>Last modified</th></tr></thead><tbody><tr v-for="t in configs.data.value.items" :key="t.id"><td><NuxtLink class="text-blue-600 hover:underline" :to="editor(t.id)">{{ t.productFamilyName }}</NuxtLink></td><td>{{ t.principalName }}</td><td><time :datetime="t.modifiedAt">{{ date(t.modifiedAt) }}</time></td></tr></tbody></table></div>
      <nav v-if="configs.data.value.totalPages" aria-label="Configurations pagination" class="mt-4 flex flex-wrap items-center justify-between gap-3"><span>Page {{ configs.data.value.page }} of {{ configs.data.value.totalPages }}</span><div class="flex gap-2"><button class="button secondary" :disabled="configs.loading.value || configs.data.value.page <= 1" @click="configs.load(configs.data.value.page - 1)">Previous</button><button class="button secondary" :disabled="configs.loading.value || configs.data.value.page >= configs.data.value.totalPages" @click="configs.load(configs.data.value.page + 1)">Next</button></div></nav>
    </template>
  </section>
</template>
