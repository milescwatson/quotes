<script setup lang="ts">
import { Combobox, ComboboxLabel, ComboboxInput, ComboboxButton, ComboboxOptions, ComboboxOption, Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/vue'
import type { LocalQuoteLine, QuoteProduct, RegularProduct } from '~/types/quotes'
import { quoteAmount, quoteNumber, adjustedAmount } from '~/utils/quote'
import { displayPrice } from '~/utils/configuration'
import { useQueryClient } from '@tanstack/vue-query'
import { descriptionRuns, type DescriptionRun } from '~/utils/description'
import { queryKeys } from '~/utils/query-keys'
const props = defineProps<{ modelValue: LocalQuoteLine | null; lineKey: string; index: number; products: QuoteProduct[]; regularProducts: RegularProduct[]; quoteMultiple: number; organization: string; disabled: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: LocalQuoteLine]; pending: [value: boolean]; remove: []; accessLost: [] }>()
let disposed = false
const identity = useIdentity(), queryClient = useQueryClient(), editor = ref(!props.modelValue), draft = ref<LocalQuoteLine | null>(null), query = ref(''), codeText = ref<Record<number,string>>({}), failure = ref(''), loading = ref(false), active = ref(-1)
onBeforeUnmount(() => { disposed = true })
const browserOpen = ref(false)
const picker = ref<InstanceType<typeof ComboboxInput>>(), editButton = ref<HTMLButtonElement>(), root = ref<HTMLElement>(), segments = ref<({ focus: () => void; validate: () => boolean } | null)[]>([]), valid = ref<Record<number,boolean>>({})
const copy = (value: LocalQuoteLine | null) => value ? JSON.parse(JSON.stringify(value)) as LocalQuoteLine : null
watch(() => props.modelValue, value => { draft.value = copy(value); valid.value = {}; codeText.value = {} }, { immediate: true })
const filtered = computed(() => props.products.filter(p => `${p.productFamilyName} ${p.principalName} ${p.modelCode || ''}`.toLowerCase().includes(query.value.toLowerCase())))
const regularFiltered = computed(() => [...props.regularProducts].filter(p => `${p.partNumber} ${p.description} ${p.principalName ?? ''} ${parentName(p)}`.toLowerCase().includes(query.value.toLowerCase())).sort((a,b) => parentName(a).localeCompare(parentName(b)) || a.partNumber.localeCompare(b.partNumber)))
const regularChoices = computed(() => regularFiltered.value.map(product => ({ kind: 'regular' as const, product })))
const freeformChoice = { kind: 'freeform' as const }
function parentName(p: RegularProduct) { return p.parentTaxonomyId ? props.products.find(t => t.id === p.parentTaxonomyId)?.productFamilyName ?? 'Unavailable parent' : 'Unparented' }
const flat = computed(() => draft.value?.kind === 'regular' || draft.value?.kind === 'freeform')
function chooseFlat(p: RegularProduct | null) {
  if (draft.value || props.disabled || loading.value) return
  const partNumber = p?.partNumber ?? '', price = p?.listPrice ?? '0.00'
  draft.value = { id: props.modelValue?.id ?? null, key: props.lineKey, kind: p ? 'regular' : 'freeform', regularProductId: p?.id ?? null, parentTaxonomyId: p?.parentTaxonomyId ?? null, taxonomyId: null, versionId: null,
    snapshot: { content: { schemaVersion: 1, productFamilyName: partNumber, productDescription: p?.description ?? '', currency: 'USD', basePrice: price, separators: [], segments: [] }, principalId: p?.principalId ?? null, principalName: p?.principalName ?? null },
    selections: [], quantity: 1, partNumber, complete: true, unitPrice: price, lineTotal: price }
  valid.value = {}; codeText.value = {}; query.value = ''; emit('pending', true)
  return true
}
const product = computed(() => props.products.find(p => p.id === draft.value?.taxonomyId) ?? null)
const amounts = computed(() => { try { return draft.value ? quoteAmount(draft.value) : null } catch { return { unitPrice: '0.00', lineTotal: '0.00' } } })
function selectProduct(p: QuoteProduct | { kind: 'regular'; product: RegularProduct } | { kind: 'freeform' } | null) {
  if (p && 'kind' in p) { chooseFlat(p.kind === 'regular' ? p.product : null); return }
  void choose(p)
}
async function choose(p: QuoteProduct | null) {
  if (!p || draft.value || props.disabled || loading.value) return
  loading.value = true; failure.value = ''; query.value = ''
  try {
    const { taxonomy: t } = await queryClient.fetchQuery({
      queryKey: queryKeys.taxonomy(identity.organizationId(props.organization), p.id),
      queryFn: ({ signal }) => identity.request<{ taxonomy: Taxonomy }>(`/organizations/${props.organization}/taxonomies/${p.id}`, { signal }),
    })
    if (disposed) return
    if (t.archivedAt) throw Error('This product is archived. Choose another configuration.')
    const content = t.version.content
    draft.value = { id: props.modelValue?.id ?? null, key: props.lineKey, taxonomyId: t.id, versionId: t.version.id,
      snapshot: { content, principalId: t.version.principalId, principalName: t.principalName },
      selections: content.segments.map(s => s.options.length === 1 ? s.options[0]!.id : s.defaultOptionId), quantity: 1,
      partNumber: '', complete: false, unitPrice: '0.00', lineTotal: '0.00' }
    valid.value = {}; codeText.value = {}; active.value = -1; emit('pending',true)
    return true
  } catch (e) { if (disposed) return; failure.value = (e as Error).message; if ('status' in (e as object) && [401,403,404].includes((e as { status: number }).status)) emit('accessLost') }
  finally { loading.value = false }
}
async function chooseFromBrowser(p: QuoteProduct | { kind: 'regular'; product: RegularProduct }) {
  const chosen = 'kind' in p ? chooseFlat(p.product) : await choose(p)
  if (chosen) browserOpen.value = false
}
function updateDescription(value: DescriptionRun[]) {
  if (!draft.value || props.disabled) return
  draft.value.descriptionContent = value
  if (!editor.value) emit('update:modelValue', copy(draft.value)!)
  else change()
}
function toggleDescription() {
  if (!draft.value || props.disabled) return
  draft.value.descriptionVisible = draft.value.descriptionVisible === false
  if (!editor.value) emit('update:modelValue', copy(draft.value)!)
}
function start() { draft.value = copy(props.modelValue); editor.value = true; failure.value = ''; emit('pending',true) }
function validate() {
  if (draft.value?.descriptionContent && (draft.value.descriptionContent.length > 1000 || draft.value.descriptionContent.reduce((sum, run) => sum + run.text.length, 0) > 5000)) { failure.value = 'Use at most 5,000 description characters and 1,000 formatting runs.'; return false }
  if (!editor.value) return true
  if (loading.value) { failure.value = 'Wait for the product to load.'; return false }
  if (!draft.value) { failure.value = 'Choose a product, or remove this empty line.'; picker.value?.$el?.focus(); return false }
  if (draft.value.kind === 'freeform') {
    const c = draft.value.snapshot.content
    if (!c.productFamilyName.trim() || c.productFamilyName.trim().length > 120 || /[\p{Cc}\p{Cs}]/u.test(c.productFamilyName) || (c.productDescription ?? '').length > 500 || /[\p{Cc}\p{Cs}]/u.test(c.productDescription ?? '') || !/^(0|[1-9][0-9]{0,11})(\.[0-9]{1,2})?$/.test(c.basePrice)) { failure.value = 'Enter a part number, a description up to 500 characters, and a nonnegative List Price with at most two decimals.'; return false }
    c.productFamilyName = c.productFamilyName.trim(); c.productDescription = (c.productDescription ?? '').trim()
  }
  for (const segment of segments.value) segment?.validate()
  if (Object.values(valid.value).some(v => !v)) { nextTick(() => root.value?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()); failure.value = 'Resolve pending or unknown codes, or clear them to save blank options.'; return false }
  if (!Number.isInteger(draft.value.quantity) || draft.value.quantity < 1 || draft.value.quantity > 1000000) { nextTick(() => root.value?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()); failure.value = 'Use a whole quantity between 1 and 1,000,000.'; return false }
  return true
}
async function done() {
  if (!validate() || !draft.value) return false
  const line = { ...copy(draft.value)!, ...quoteAmount(draft.value), partNumber: quoteNumber(draft.value), complete: draft.value.selections.every(s => s !== null) }
  emit('update:modelValue',line); emit('pending',false); editor.value = false; failure.value = ''; await nextTick(); editButton.value?.focus(); return true
}
async function cancel() { draft.value = copy(props.modelValue); valid.value = {}; codeText.value = {}; failure.value = ''; emit('pending',false); editor.value = false; await nextTick(); editButton.value?.focus() }
function focusSegment(i: number) { if (!editor.value) start(); nextTick(() => segments.value[i]?.focus()) }
function remove() { if (!draft.value || window.confirm('Remove this product line?')) emit('remove') }
function change() { emit('pending',true) }
onMounted(() => { if (!props.modelValue) nextTick(() => picker.value?.$el?.focus()) })
defineExpose({ validate, done })
</script>
<template>
  <article ref="root" class="panel min-w-0 p-4 sm:p-5" :aria-label="`Line ${index + 1}`" :aria-busy="loading">
    <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h2 class="mb-0 text-base">Line {{ index + 1 }} <span v-if="draft" class="ml-2 font-normal text-gray-500">{{ draft.snapshot.content.productFamilyName }} · {{ draft.snapshot.principalName }}</span></h2>
      <div class="flex shrink-0 items-center gap-1">
        <button v-if="!editor" ref="editButton" type="button" class="inline-flex min-h-10 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900" :disabled="disabled" :aria-label="`Edit line ${index + 1}`" @click="start">
          <svg aria-hidden="true" class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m16 3 5 5M4 20l4-1L21 6a2.1 2.1 0 0 0-3-3L5 16l-1 4Z" /></svg>
          Edit
        </button>
        <button type="button" class="inline-flex min-h-10 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-gray-500 hover:bg-red-50 hover:text-red-700" :disabled="disabled" :aria-label="`Remove line ${index + 1}`" @click="remove">
          <svg aria-hidden="true" class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M5 6l1 14a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1l1-14M10 10v7M14 10v7" /></svg>
          Remove
        </button>
        <Menu v-if="draft" as="div" class="relative">
          <MenuButton type="button" class="inline-flex min-h-10 min-w-10 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100" :disabled="disabled" :aria-label="`Line ${index + 1} settings`"><span aria-hidden="true">⋯</span></MenuButton>
          <MenuItems class="absolute right-0 z-20 mt-1 w-56 rounded-md border border-gray-200 bg-white p-1 shadow-lg focus:outline-none">
            <MenuItem v-slot="{ active: highlighted }"><button type="button" class="w-full rounded px-3 py-2 text-left text-sm" :class="highlighted ? 'bg-gray-100' : ''" @click="toggleDescription">{{ draft.descriptionVisible === false ? 'Show description' : 'Hide description' }}</button></MenuItem>
          </MenuItems>
        </Menu>
      </div>
    </div>
    <p v-if="!editor && failure" class="error" role="alert">{{ failure }}</p>
    <fieldset :disabled="disabled || loading" class="min-w-0">
      <template v-if="editor">
        <div v-if="!draft" class="mb-4 flex max-w-2xl items-end gap-2">
        <Combobox :model-value="product" nullable @update:model-value="selectProduct">
          <div class="relative min-w-0 flex-1">
            <ComboboxLabel class="mt-0">Product</ComboboxLabel>
            <div class="relative"><ComboboxInput :id="`product-${lineKey}`" ref="picker" class="pr-10" autocomplete="off" :display-value="() => draft?.snapshot.content.productFamilyName ?? ''" placeholder="Search product, model, or principal" @change="query = $event.target.value" @blur="query = ''" /><ComboboxButton class="absolute inset-y-0 right-0 px-3" aria-label="Show products">⌄</ComboboxButton></div>
            <ComboboxOptions class="absolute z-10 mt-1 max-h-72 w-full overflow-auto rounded-md border border-gray-200 bg-white shadow-lg">
              <ComboboxOption v-for="p in filtered" :key="p.id" v-slot="{ active: highlighted, selected }" :value="p" as="template"><li class="cursor-pointer p-3" :class="highlighted ? 'bg-blue-50' : ''"><span class="block font-medium">{{ p.productFamilyName }} <span v-if="selected">✓</span></span><span class="text-xs text-gray-500">{{ p.principalName }} <template v-if="p.modelCode">· {{ p.modelCode }}</template></span></li></ComboboxOption>
              <ComboboxOption v-for="choice in regularChoices" :key="`regular-${choice.product.id}`" v-slot="{ active: highlighted }" :value="choice" as="template"><li class="cursor-pointer p-3" :class="highlighted ? 'bg-blue-50' : ''"><span class="block text-xs text-gray-500">Regular · {{ parentName(choice.product) }}</span><span class="block font-medium">{{ choice.product.partNumber }}</span><span class="text-xs text-gray-500">{{ choice.product.principalName }} {{ choice.product.description }} · {{ displayPrice(choice.product.listPrice) }}</span></li></ComboboxOption>
              <ComboboxOption v-if="!query || (!filtered.length && !regularFiltered.length)" v-slot="{ active: highlighted }" :value="freeformChoice" as="template"><li class="cursor-pointer p-3 font-medium" :class="highlighted ? 'bg-blue-50' : ''">Add freeform part</li></ComboboxOption>
              <li v-if="!filtered.length && !regularFiltered.length" class="p-3 text-gray-600">No matching products. Try a product or principal name.</li>
            </ComboboxOptions>
          </div>
        </Combobox>
        <button type="button" class="button secondary shrink-0" aria-label="Expand product search" @click="failure = ''; browserOpen = true">
          <svg aria-hidden="true" class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M3 3l6 6m12-6-6 6M3 21l6-6m12 6-6-6" /></svg>
          Expand
        </button>
        </div>
        <QuoteProductBrowser v-if="!draft" :open="browserOpen" :products="products" :regular-products="regularProducts" :line-number="index + 1" :busy="loading" :disabled="disabled" :error="failure" @close="browserOpen = false" @select="chooseFromBrowser" />
        <p v-if="loading" role="status">Loading product…</p>
        <template v-if="draft">
          <QuoteDescriptionEditor v-if="draft.descriptionVisible !== false" :model-value="descriptionRuns(draft)" :input-id="`description-${lineKey}`" :disabled="disabled || loading" @update:model-value="updateDescription" />
          <template v-if="!flat"><p class="mb-2 text-xs text-gray-500">Saved configuration version {{ draft.versionId }} · {{ draft.selections.filter(Boolean).length }} of {{ draft.selections.length }} positions complete<span v-if="active >= 0"> · Position {{ active + 1 }}</span></p>
          <div class="mb-3 flex flex-wrap items-center font-mono text-xl" aria-label="Full part number">
            <template v-for="(s,i) in draft.snapshot.content.segments" :key="s.id"><span v-if="i">{{ (draft.snapshot.content.separators ?? Array(draft.selections.length - 1).fill('-'))[i - 1] }}</span><button v-if="s.options.length > 1" type="button" class="rounded px-1 py-2" :class="active === i ? 'bg-blue-100 text-blue-800' : valid[i] === false ? 'bg-red-50 text-red-700' : !draft.selections[i] ? 'bg-amber-50 text-amber-900' : ''" :aria-label="`Choose ${s.name || s.placeholder}, position ${i + 1}`" @click="focusSegment(i)" @keydown.right.prevent="focusSegment(Math.min(i + 1,draft.selections.length - 1))" @keydown.left.prevent="focusSegment(Math.max(0,i - 1))">{{ codeText[i] || s.options.find(o => o.id === draft!.selections[i])?.code || s.placeholder }}<span class="text-xs">{{ valid[i] === false ? '!' : !draft.selections[i] ? '?' : '' }}</span></button><span v-else class="px-1 text-gray-500">{{ s.options[0]?.code }}</span></template>
          </div>
          <div class="flex max-w-full items-start gap-2 overflow-x-auto pb-3" role="region" aria-label="Part number segments">
            <template v-for="(s,i) in draft.snapshot.content.segments" :key="`${draft.versionId}-${s.id}`"><span v-if="i" class="mt-4 self-start text-lg text-gray-500">{{ (draft.snapshot.content.separators ?? Array(draft.selections.length - 1).fill('-'))[i - 1] }}</span><QuoteSegment :ref="el => segments[i] = el as unknown as { focus: () => void; validate: () => boolean } | null" :segment="s" :model-value="draft.selections[i] ?? null" :label="`${s.name || s.placeholder} (position ${i + 1})`" :active="active === i" @update:model-value="draft!.selections[i] = $event; change()" @active="active = i" @validity="valid[i] = $event; if (!$event) change()" @text="codeText[i] = $event" /></template>
          </div>
          </template>
          <template v-if="draft.kind === 'freeform'">
            <label :for="`part-${lineKey}`">Part number</label><input :id="`part-${lineKey}`" v-model="draft.snapshot.content.productFamilyName" maxlength="120" @input="change" />
          </template>
          <div class="mt-5 border-t border-gray-200 pt-4">
            <div class="quote-pricing-grid xl:ml-auto">
              <div>
                <label v-if="draft.kind === 'freeform'" :for="`price-${lineKey}`" class="quote-pricing-label">List Price</label>
                <p v-else class="quote-pricing-label">List Price</p>
                <input v-if="draft.kind === 'freeform'" :id="`price-${lineKey}`" v-model="draft.snapshot.content.basePrice" class="text-right tabular-nums" inputmode="decimal" @input="change" />
                <p v-else class="quote-pricing-value">{{ displayPrice(amounts!.unitPrice) }}</p>
              </div>
              <div>
                <label :for="`qty-${lineKey}`" class="quote-pricing-label">Quantity</label>
                <input :id="`qty-${lineKey}`" v-model.number="draft.quantity" class="text-right tabular-nums" type="number" min="1" max="1000000" step="1" :aria-invalid="!Number.isInteger(draft.quantity) || draft.quantity < 1 || draft.quantity > 1000000" @input="change" />
              </div>
            </div>
          </div>
          <p v-if="modelValue" class="mt-1 text-xs text-gray-500">Quote total keeps the previous amount until Done.</p>
        </template>
        <p v-if="failure" class="error" role="alert">{{ failure }}</p>
        <div class="mt-4 flex justify-end gap-2"><button v-if="modelValue" type="button" class="button secondary" @click="cancel">Cancel</button><button type="button" class="button primary" @click="done">Done</button></div>
      </template>
      <template v-else-if="modelValue">
        <div class="grid items-center gap-4 border-t border-gray-200 pt-4 xl:grid-cols-[minmax(0,1fr)_40rem] xl:gap-6">
          <div class="min-w-0">
            <p class="mb-1 text-xs font-medium text-gray-500">Part number</p>
            <div class="flex flex-wrap items-center break-all font-mono text-xl font-semibold" aria-label="Saved part number"><span v-if="modelValue.kind === 'regular' || modelValue.kind === 'freeform'">{{ modelValue.partNumber }}</span><template v-for="(s,i) in modelValue.snapshot.content.segments" :key="s.id"><span v-if="i">{{ (modelValue.snapshot.content.separators ?? Array(modelValue.selections.length - 1).fill('-'))[i - 1] }}</span><button v-if="s.options.length > 1" type="button" class="rounded px-1 py-2 text-blue-700 hover:bg-blue-50" :aria-label="`Edit ${s.name || s.placeholder} in line ${index + 1}`" @click="focusSegment(i)">{{ s.options.find(o => o.id === modelValue!.selections[i])?.code || s.placeholder }}</button><span v-else class="px-1">{{ s.options[0]?.code }}</span></template></div>
            <p v-if="!modelValue.complete" class="mt-1 text-xs text-amber-800">Incomplete options — estimated price. Blank choices are saved.</p>
          </div>
          <dl class="quote-pricing-grid border-t border-gray-200 pt-4 xl:border-t-0 xl:pt-0">
            <div><dt class="quote-pricing-label">List Price</dt><dd class="quote-pricing-value">{{ displayPrice(modelValue.unitPrice) }}</dd></div>
            <div><dt class="quote-pricing-label">Quantity</dt><dd class="quote-pricing-value">{{ modelValue.quantity }}</dd></div>
            <div><dt class="quote-pricing-label">List Line Total</dt><dd class="quote-pricing-value">{{ displayPrice(modelValue.lineTotal) }}</dd></div>
            <div class="quote-pricing-final"><dt class="quote-pricing-label">After Multiple</dt><dd class="quote-pricing-value font-semibold">{{ displayPrice(adjustedAmount(modelValue.lineTotal, quoteMultiple)) }}</dd></div>
          </dl>
        </div>
        <QuoteDescriptionEditor v-if="modelValue.descriptionVisible !== false" :model-value="descriptionRuns(modelValue)" :input-id="`description-${lineKey}`" :disabled="disabled" @update:model-value="updateDescription" />
        <details v-if="!flat" class="group mt-4 rounded-md border border-gray-200 bg-gray-50">
          <summary class="flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-md px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-100 [&::-webkit-details-marker]:hidden">
            <svg aria-hidden="true" class="size-4 shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6" /></svg>
            Option and price breakdown
          </summary>
          <ul class="space-y-2 border-t border-gray-200 px-3 py-3 text-xs text-gray-600">
            <li class="flex justify-between gap-4"><span>Base List Price</span><span class="shrink-0 tabular-nums">{{ displayPrice(modelValue.snapshot.content.basePrice) }}</span></li>
            <li v-for="(s,i) in modelValue.snapshot.content.segments" :key="s.id" class="flex justify-between gap-4">
              <button v-if="s.options.length > 1" type="button" class="min-w-0 rounded text-left hover:text-blue-700 hover:underline" @click="focusSegment(i)">{{ s.name || s.placeholder }}: {{ s.options.find(o => o.id === modelValue!.selections[i])?.code || 'Not selected' }} — {{ s.options.find(o => o.id === modelValue!.selections[i])?.description }}</button>
              <span v-else>{{ s.name || s.placeholder }}: {{ s.options[0]?.code }}</span>
              <span class="shrink-0 tabular-nums">+{{ displayPrice(s.options.find(o => o.id === modelValue!.selections[i])?.price || '0.00') }}</span>
            </li>
          </ul>
        </details>
      </template>
    </fieldset>
  </article>
</template>
