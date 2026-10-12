<script setup lang="ts">
import type { Principal, PrincipalPage, TaxonomyPage, FieldError } from '~/types/taxonomy'
import { ApiError } from '~/types/identity'
const props = defineProps<{ organization: string }>()
const identity = useIdentity(), filter = ref(''), choices = ref<Principal[]>([]), choicesError = ref('')
const configs = useConfigurationList<TaxonomyPage>(() => props.organization, 'taxonomies', () => filter.value)
const principals = useConfigurationList<PrincipalPage>(() => props.organization, 'principals')
const adding = ref(false), name = ref(''), website = ref(''), busy = ref(false), failure = ref(''), fields = ref<FieldError[]>([]), success = ref('')
let controller: AbortController | undefined
async function loadChoices() {
  controller?.abort(); const c = new AbortController(); controller = c; choicesError.value = ''
  try { const rows = await loadPrincipalChoices(props.organization, c.signal); if (!c.signal.aborted) choices.value = rows }
  catch (e) { if (!c.signal.aborted) choicesError.value = (e as Error).message }
}
onMounted(() => {
  void loadChoices()
  if (useRoute().query.section === 'configurations') nextTick(() => document.getElementById('configurations')?.scrollIntoView())
})
watch(() => props.organization, () => { filter.value = ''; choices.value = []; adding.value = false; success.value = ''; void loadChoices() })
onBeforeUnmount(() => controller?.abort())
async function add() {
  busy.value = true; failure.value = ''; fields.value = []; success.value = ''
  const org = props.organization
  try {
    await identity.request(`/organizations/${org}/principals`, { method: 'POST', body: { name: name.value, websiteUrl: website.value } })
    if (props.organization !== org) return
    adding.value = false; name.value = ''; website.value = ''; success.value = 'Principal added.'
    await Promise.all([principals.load(1), loadChoices()])
  } catch (e) { if (props.organization === org) { failure.value = (e as Error).message; fields.value = e instanceof ApiError ? e.fieldErrors || [] : [] } }
  finally { busy.value = false }
}
const message = (path: string) => fields.value.find(f => f.path === path)?.message
const editor = (id: string) => `${identity.organizationPath(identity.organizationId(props.organization))}/taxonomies/${id}`
const date = (value: string) => new Date(value).toLocaleString()
</script>
<template>
  <section id="configurations" class="panel mb-6 p-4 sm:p-6" aria-labelledby="configurations-title">
    <div class="section-heading"><h2 id="configurations-title">Product Configurations</h2><NuxtLink :to="editor('new')" class="button primary">New configuration</NuxtLink></div>
    <label for="principal-filter">Principal</label><select id="principal-filter" v-model="filter" class="mb-4 w-full sm:max-w-sm"><option value="">All principals</option><option v-for="p in choices" :key="p.id" :value="p.id">{{ p.name }}</option></select>
    <p v-if="choicesError" class="error" role="alert">{{ choicesError }} <button class="text-button" @click="loadChoices">Retry principals</button></p>
    <p v-if="configs.error.value" class="error" role="alert">{{ configs.error.value }} <button class="text-button" @click="configs.load()">Retry configurations</button></p>
    <p v-if="configs.loading.value && !configs.data.value" role="status">Loading configurations…</p>
    <template v-if="configs.data.value">
      <p v-if="!configs.data.value.totalItems">{{ filter ? 'No configurations for this principal.' : 'No product configurations yet.' }}</p>
      <div v-else class="overflow-x-auto" role="region" aria-label="Product configurations table" tabindex="0"><table><thead><tr><th>Product name</th><th>Principal</th><th>Last modified</th></tr></thead><tbody><tr v-for="t in configs.data.value.items" :key="t.id"><td><NuxtLink class="text-blue-600 hover:underline" :to="editor(t.id)">{{ t.productFamilyName }}</NuxtLink></td><td>{{ t.principalName }}</td><td><time :datetime="t.modifiedAt">{{ date(t.modifiedAt) }}</time></td></tr></tbody></table></div>
      <nav v-if="configs.data.value.totalPages" aria-label="Configurations pagination" class="mt-4 flex flex-wrap items-center justify-between gap-3"><span>Page {{ configs.data.value.page }} of {{ configs.data.value.totalPages }}</span><div class="flex gap-2"><button class="button secondary" :disabled="configs.loading.value || configs.data.value.page <= 1" @click="configs.load(configs.data.value.page - 1)">Previous</button><button class="button secondary" :disabled="configs.loading.value || configs.data.value.page >= configs.data.value.totalPages" @click="configs.load(configs.data.value.page + 1)">Next</button></div></nav>
    </template>
  </section>
  <section id="principals" class="panel p-4 sm:p-6" aria-labelledby="principals-title">
    <div class="section-heading"><h2 id="principals-title">Principals</h2><button class="button secondary" :disabled="busy" @click="adding = !adding">{{ adding ? 'Cancel' : 'Add principal' }}</button></div>
    <p class="text-gray-500">Shared across all organizations.</p>
    <form v-if="adding" class="my-4 max-w-lg" @submit.prevent="add"><fieldset :disabled="busy"><label for="principal-name">Principal name</label><input id="principal-name" v-model="name" required maxlength="120" :aria-invalid="!!message('/name')" aria-describedby="principal-name-error"><p id="principal-name-error" class="text-red-700">{{ message('/name') }}</p><label for="principal-website">Web address</label><input id="principal-website" v-model="website" required maxlength="2048" placeholder="example.com" :aria-invalid="!!message('/websiteUrl')" aria-describedby="principal-website-error"><p id="principal-website-error" class="text-red-700">{{ message('/websiteUrl') }}</p><p class="field-help">Names and root domains must be unique.</p><button class="button primary mt-4">{{ busy ? 'Adding…' : 'Create principal' }}</button></fieldset></form>
    <p v-if="failure" class="error" role="alert">{{ failure }}</p><p v-if="success" class="success" role="status">{{ success }}</p>
    <p v-if="principals.error.value" class="error" role="alert">{{ principals.error.value }} <button class="text-button" @click="principals.load()">Retry principals list</button></p>
    <p v-if="principals.loading.value && !principals.data.value" role="status">Loading principals…</p>
    <template v-if="principals.data.value"><p v-if="!principals.data.value.totalItems">No principals yet.</p><div v-else class="overflow-x-auto" role="region" aria-label="Principals table" tabindex="0"><table><thead><tr><th>Name</th><th>Website</th></tr></thead><tbody><tr v-for="p in principals.data.value.items" :key="p.id"><td>{{ p.name }}</td><td class="break-all"><a :href="p.websiteUrl" target="_blank" rel="noopener noreferrer" class="text-blue-600 hover:underline">{{ p.websiteUrl }}</a></td></tr></tbody></table></div><nav v-if="principals.data.value.totalPages" aria-label="Principals pagination" class="mt-4 flex flex-wrap items-center justify-between gap-3"><span>Page {{ principals.data.value.page }} of {{ principals.data.value.totalPages }}</span><div class="flex gap-2"><button class="button secondary" :disabled="principals.loading.value || principals.data.value.page <= 1" @click="principals.load(principals.data.value.page - 1)">Previous</button><button class="button secondary" :disabled="principals.loading.value || principals.data.value.page >= principals.data.value.totalPages" @click="principals.load(principals.data.value.page + 1)">Next</button></div></nav></template>
  </section>
</template>
