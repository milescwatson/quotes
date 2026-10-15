<script setup lang="ts">
import type { QuoteProduct, RegularProduct } from '~/types/quotes'
import { displayPrice } from '~/utils/configuration'

const props = defineProps<{ open: boolean; products: QuoteProduct[]; regularProducts: RegularProduct[]; lineNumber: number; busy: boolean; disabled: boolean; error: string }>()
const emit = defineEmits<{ close: []; select: [product: QuoteProduct | { kind: 'regular'; product: RegularProduct }] }>()
const dialog = ref<HTMLDialogElement>(), searchInput = ref<HTMLInputElement>()
const search = ref(''), principal = ref(''), selectedKey = ref(''), collapsed = ref(new Set<string>())
const entries = computed(() => [
  ...props.products.map(product => ({ key: `configured-${product.id}`, name: product.productFamilyName, principalId: product.principalId, principalName: product.principalName, detail: product.modelCode || '', kind: 'Configured' as const, price: null, choice: product })),
  ...props.regularProducts.map(product => ({ key: `regular-${product.id}`, name: product.partNumber, principalId: product.principalId ?? 'unassigned', principalName: product.principalName ?? 'No principal', detail: [product.description, props.products.find(p => p.id === product.parentTaxonomyId)?.productFamilyName].filter(Boolean).join(' · '), kind: 'Regular' as const, price: product.listPrice, choice: { kind: 'regular' as const, product } })),
].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })))
const principals = computed(() => [...new Map(entries.value.map(p => [p.principalId, { id: p.principalId, name: p.principalName }])).values()].sort((a, b) => a.name.localeCompare(b.name)))
const filtered = computed(() => {
  const terms = search.value.toLowerCase().trim().split(/\s+/).filter(Boolean)
  return entries.value.filter(p => (!principal.value || p.principalId === principal.value) && terms.every(term => `${p.name} ${p.detail} ${p.principalName} ${p.kind}`.toLowerCase().includes(term)))
})
const groups = computed(() => principals.value.map(p => ({ ...p, products: filtered.value.filter(product => product.principalId === p.id) })).filter(p => p.products.length))
const selected = computed(() => filtered.value.find(p => p.key === selectedKey.value))
watch(() => props.open, async open => {
  if (open) { search.value = ''; principal.value = ''; selectedKey.value = ''; collapsed.value = new Set() }
  await nextTick()
  if (open && !dialog.value?.open) { dialog.value?.showModal(); searchInput.value?.focus() }
  else if (!open) dialog.value?.close()
})
watch([search, principal], () => { collapsed.value = new Set() })
watch(() => props.disabled, disabled => { if (disabled && props.open && !props.busy) emit('close') })
function toggle(id: string) {
  const next = new Set(collapsed.value)
  if (next.has(id)) next.delete(id); else next.add(id)
  collapsed.value = next
}
</script>

<template>
  <Teleport to="body">
    <dialog ref="dialog" class="product-browser" :aria-labelledby="`product-browser-title-${lineNumber}`" @cancel.prevent="!busy && emit('close')">
      <div class="flex items-start justify-between gap-4 border-b border-gray-200 p-5">
        <div><h2 :id="`product-browser-title-${lineNumber}`" class="mb-1">Choose a product</h2><p class="text-sm text-gray-500">Browse by principal, then choose a product for line {{ lineNumber }}.</p></div>
        <button type="button" class="button secondary shrink-0" aria-label="Close product browser" :disabled="busy" @click="emit('close')">✕</button>
      </div>
      <div class="grid gap-3 border-b border-gray-200 p-5 sm:grid-cols-[minmax(0,1fr)_14rem]">
        <div><label :for="`browser-search-${lineNumber}`" class="mt-0">Search products</label><input :id="`browser-search-${lineNumber}`" ref="searchInput" v-model="search" type="search" placeholder="Product, model, part number, or description" :disabled="busy" /></div>
        <div><label :for="`browser-principal-${lineNumber}`" class="mt-0">Filter by principal</label><select :id="`browser-principal-${lineNumber}`" v-model="principal" class="w-full" :disabled="busy"><option value="">All principals</option><option v-for="p in principals" :key="p.id" :value="p.id">{{ p.name }}</option></select></div>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto p-5">
        <p class="mb-3 text-sm text-gray-500" role="status">{{ filtered.length }} {{ filtered.length === 1 ? 'product' : 'products' }} · {{ groups.length }} {{ groups.length === 1 ? 'principal' : 'principals' }}</p>
        <ul v-if="groups.length" aria-label="Products by principal" class="space-y-3">
          <li v-for="group in groups" :key="group.id" class="overflow-hidden rounded-lg border border-gray-200">
            <button type="button" class="flex w-full items-center gap-2 bg-gray-50 px-4 py-3 text-left font-semibold hover:bg-gray-100" :aria-expanded="!collapsed.has(group.id)" :aria-controls="`principal-products-${lineNumber}-${group.id}`" @click="toggle(group.id)">
              <span aria-hidden="true">{{ collapsed.has(group.id) ? '▸' : '▾' }}</span>{{ group.name }}<span class="ml-auto text-sm font-normal text-gray-500">{{ group.products.length }}</span>
            </button>
            <ul v-show="!collapsed.has(group.id)" :id="`principal-products-${lineNumber}-${group.id}`" :aria-label="`${group.name} products`" class="divide-y divide-gray-100 border-l-2 border-blue-100 pl-3 sm:pl-5">
              <li v-for="p in group.products" :key="p.key">
                <button type="button" class="flex w-full items-start gap-3 px-3 py-3 text-left hover:bg-blue-50" :class="selectedKey === p.key ? 'bg-blue-50 ring-1 ring-inset ring-blue-500' : ''" :aria-pressed="selectedKey === p.key" :disabled="busy" @click="selectedKey = p.key">
                  <span aria-hidden="true" class="mt-0.5 text-blue-700">{{ selectedKey === p.key ? '◉' : '○' }}</span>
                  <span class="min-w-0 flex-1"><span class="block break-words font-medium">{{ p.name }}</span><span v-if="p.detail" class="mt-1 block break-words text-sm text-gray-500">{{ p.detail }}</span><span class="mt-1 block text-xs text-gray-500">{{ p.kind }}<template v-if="p.price !== null"> · {{ displayPrice(p.price) }}</template></span></span>
                </button>
              </li>
            </ul>
          </li>
        </ul>
        <div v-else class="py-10 text-center"><p class="font-medium">No matching products</p><p class="mt-1 text-sm text-gray-500">Try another search or principal.</p><button type="button" class="button secondary mt-4" @click="search = ''; principal = ''">Clear filters</button></div>
      </div>
      <div class="border-t border-gray-200 p-5">
        <p v-if="error" role="alert" class="error mb-3">{{ error }}</p>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <p class="min-w-0 break-words text-sm text-gray-600">{{ selected ? `${selected.name} · ${selected.principalName}` : 'Select a product to continue.' }}</p>
          <div class="ml-auto flex shrink-0 gap-2"><button type="button" class="button secondary" :disabled="busy" @click="emit('close')">Cancel</button><button type="button" class="button primary" :disabled="!selected || busy || disabled" @click="selected && emit('select', selected.choice)">{{ busy ? 'Loading…' : 'Use product' }}</button></div>
        </div>
      </div>
    </dialog>
  </Teleport>
</template>

<style scoped>
.product-browser { width: calc(100vw - 2rem); max-width: 56rem; max-height: calc(100dvh - 2rem); padding: 0; }
.product-browser[open] { display: flex; flex-direction: column; }
</style>
