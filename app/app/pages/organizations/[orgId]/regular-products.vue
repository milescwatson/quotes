<script setup lang="ts">
import type { RegularProduct, QuoteProduct } from '~/types/quotes'
import type { TaxonomyPage } from '~/types/taxonomy'
import { ApiError } from '~/types/identity'
import { displayPrice } from '~/utils/configuration'
import { useQueryClient } from '@tanstack/vue-query'
import { queryKeys } from '~/utils/query-keys'
const route = useRoute(), identity = useIdentity(), cache = useQueryClient()
const orgId = computed(() => identity.organizationId(route.params.orgId))
const canEdit = computed(() => identity.state.user?.isSuperAdministrator || identity.state.organizations.find(o => o.id === orgId.value)?.role === 'administrator')
const products = ref<RegularProduct[]>([]), parents = ref<QuoteProduct[]>([]), search = ref(''), loading = ref(true), busy = ref(false), error = ref(''), notice = ref(''), editing = ref(false)
const original = ref<RegularProduct | null>(null)
const draft = reactive({ partNumber: '', description: '', listPrice: '0.00', parentTaxonomyId: null as string | null })
const filtered = computed(() => products.value.filter(p => `${p.partNumber} ${p.description} ${parentLabel(p.parentTaxonomyId)}`.toLowerCase().includes(search.value.toLowerCase())))
function parentLabel(id: string | null) { return id ? parents.value.find(p => p.id === id)?.productFamilyName ?? 'Unavailable parent' : 'Unparented' }
async function load() {
  loading.value = true; error.value = ''
  try {
    const [regular, configured] = await Promise.all([
      identity.request<{ items: RegularProduct[] }>(`/organizations/${orgId.value}/regular-products`),
      (async () => { const all: QuoteProduct[] = []; let page = 1, pages = 1; do { const result = await identity.request<TaxonomyPage>(`/organizations/${orgId.value}/taxonomies?page=${page}&pageSize=100`); all.push(...result.items); pages = result.totalPages; page++ } while (page <= pages); return all })(),
    ])
    products.value = regular.items; parents.value = configured
  } catch (e) { error.value = (e as Error).message; if (e instanceof ApiError && [401,403,404].includes(e.status)) { products.value = []; parents.value = []; editing.value = false } }
  finally { loading.value = false }
}
function edit(product: RegularProduct | null) {
  original.value = product; Object.assign(draft, product ? { partNumber: product.partNumber, description: product.description, listPrice: product.listPrice, parentTaxonomyId: product.parentTaxonomyId } : { partNumber: '', description: '', listPrice: '0.00', parentTaxonomyId: null }); editing.value = true; error.value = ''; notice.value = ''
  nextTick(() => document.getElementById('regular-part')?.focus())
}
async function save() {
  busy.value = true; error.value = ''
  try {
    await identity.request(`/organizations/${orgId.value}/regular-products${original.value ? `/${original.value.id}` : ''}`, { method: original.value ? 'PUT' : 'POST', body: { ...draft, ...(original.value ? { expectedToken: original.value.token } : {}) } })
    await cache.invalidateQueries({ queryKey: queryKeys.regularProducts(orgId.value) }); editing.value = false; await load(); notice.value = 'Product saved.'
  } catch (e) { error.value = e instanceof ApiError && e.fieldErrors?.length ? e.fieldErrors.map(f => f.message).join(' ') : (e as Error).message }
  finally { busy.value = false }
}
async function reload() {
  if (editing.value && !window.confirm('Discard your unsaved changes and reload?')) return
  const id = original.value?.id
  editing.value = false
  await load()
  if (id && !error.value) edit(products.value.find(p => p.id === id) ?? null)
}
onBeforeRouteLeave(() => !editing.value || window.confirm('Leave without saving your product changes?'))
onMounted(load)
</script>
<template>
  <PageHeading title="Regular Products" description="Manage part numbers with independent list prices and optional configured parents."><button v-if="canEdit" type="button" class="button primary" :disabled="busy" @click="edit(null)">New regular product</button></PageHeading>
  <p v-if="error" class="error" role="alert">{{ error }} <button type="button" class="text-button" :disabled="busy" @click="reload">Reload products</button></p>
  <p v-if="notice" class="success" role="status">{{ notice }}</p>
  <form v-if="editing && canEdit" class="panel mb-6 p-4" @submit.prevent="save">
    <h2>{{ original ? 'Edit regular product' : 'New regular product' }}</h2>
    <fieldset :disabled="busy">
      <label for="regular-part">Part number</label><input id="regular-part" v-model="draft.partNumber" maxlength="120" required />
      <label for="regular-description">Description</label><input id="regular-description" v-model="draft.description" maxlength="500" />
      <label for="regular-price">List Price</label><input id="regular-price" v-model="draft.listPrice" inputmode="decimal" required />
      <label for="regular-parent">Parent configured product</label><select id="regular-parent" v-model="draft.parentTaxonomyId" class="w-full"><option :value="null">Unparented</option><option v-if="draft.parentTaxonomyId && !parents.some(p => p.id === draft.parentTaxonomyId)" :value="draft.parentTaxonomyId">Unavailable parent (retained)</option><option v-for="p in parents" :key="p.id" :value="p.id">{{ p.productFamilyName }}</option></select>
      <div class="mt-4 flex gap-2"><button class="button primary" type="submit">{{ busy ? 'Saving…' : 'Save product' }}</button><button class="button secondary" type="button" @click="editing = false">Cancel</button></div>
    </fieldset>
  </form>
  <section class="panel p-4">
    <label for="regular-search" class="mt-0">Search regular products</label><input id="regular-search" v-model="search" type="search" />
    <p v-if="loading" class="mt-4" role="status">Loading products…</p>
    <p v-else-if="!filtered.length" class="mt-4">No regular products found.</p>
    <div v-else class="mt-4 overflow-x-auto" role="region" aria-label="Regular products table" tabindex="0"><table><thead><tr><th>Part number</th><th>Description</th><th>Parent</th><th>List Price</th><th v-if="canEdit">Actions</th></tr></thead><tbody><tr v-for="p in filtered" :key="p.id"><td>{{ p.partNumber }}</td><td>{{ p.description }}</td><td>{{ parentLabel(p.parentTaxonomyId) }}</td><td>{{ displayPrice(p.listPrice) }}</td><td v-if="canEdit"><button type="button" class="text-button" :aria-label="`Edit ${p.partNumber}`" @click="edit(p)">Edit</button></td></tr></tbody></table></div>
  </section>
</template>
