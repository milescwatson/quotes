<script setup lang="ts">
import { Combobox, ComboboxLabel, ComboboxInput, ComboboxButton, ComboboxOptions, ComboboxOption } from '@headlessui/vue'
import type { LocalQuoteLine, QuoteProduct } from '~/types/quotes'
import type { Taxonomy } from '~/types/taxonomy'
import { quoteAmount, quoteNumber } from '~/utils/quote'
import { displayPrice } from '~/utils/configuration'
const props = defineProps<{ modelValue: LocalQuoteLine | null; lineKey: string; index: number; products: QuoteProduct[]; organization: string; disabled: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: LocalQuoteLine]; pending: [value: boolean]; remove: []; accessLost: [] }>()
const controller = new AbortController()
onBeforeUnmount(() => controller.abort())
const identity = useIdentity(), editor = ref(!props.modelValue), draft = ref<LocalQuoteLine | null>(null), query = ref(''), codeText = ref<Record<number,string>>({}), failure = ref(''), loading = ref(false), active = ref(-1)
const picker = ref<InstanceType<typeof ComboboxInput>>(), editButton = ref<HTMLButtonElement>(), root = ref<HTMLElement>(), segments = ref<({ focus: () => void; validate: () => boolean } | null)[]>([]), valid = ref<Record<number,boolean>>({})
const copy = (value: LocalQuoteLine | null) => value ? JSON.parse(JSON.stringify(value)) as LocalQuoteLine : null
watch(() => props.modelValue, value => { draft.value = copy(value); valid.value = {}; codeText.value = {} }, { immediate: true })
const filtered = computed(() => props.products.filter(p => `${p.productFamilyName} ${p.principalName} ${p.modelCode || ''}`.toLowerCase().includes(query.value.toLowerCase())))
const product = computed(() => props.products.find(p => p.id === draft.value?.taxonomyId) ?? null)
const amounts = computed(() => draft.value ? quoteAmount(draft.value) : null)
async function choose(p: QuoteProduct | null) {
  if (!p || props.disabled || loading.value) return
  if (draft.value && !window.confirm('Switch products and discard this line’s selections?')) { query.value = ''; return }
  loading.value = true; failure.value = ''; query.value = ''
  try {
    const { taxonomy: t } = await identity.request<{ taxonomy: Taxonomy }>(`/organizations/${props.organization}/taxonomies/${p.id}`, { signal: controller.signal })
    if (controller.signal.aborted) return
    if (t.archivedAt) throw Error('This product is archived. Choose another configuration.')
    const content = t.version.content
    draft.value = { id: props.modelValue?.id ?? null, key: props.lineKey, taxonomyId: t.id, versionId: t.version.id,
      snapshot: { content, principalId: t.version.principalId, principalName: t.principalName },
      selections: content.segments.map(s => s.options.length === 1 ? s.options[0]!.id : s.defaultOptionId), quantity: 1,
      partNumber: '', complete: false, unitPrice: '0.00', lineTotal: '0.00' }
    valid.value = {}; codeText.value = {}; active.value = -1; emit('pending',true)
  } catch (e) { if (controller.signal.aborted) return; failure.value = (e as Error).message; if ('status' in (e as object) && [401,403,404].includes((e as { status: number }).status)) emit('accessLost') }
  finally { loading.value = false }
}
function start() { draft.value = copy(props.modelValue); editor.value = true; failure.value = ''; emit('pending',true) }
function validate() {
  if (!editor.value) return true
  if (loading.value) { failure.value = 'Wait for the product to load.'; return false }
  if (!draft.value) { failure.value = 'Choose a product, or remove this empty line.'; picker.value?.$el?.focus(); return false }
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
      </div>
    </div>
    <fieldset :disabled="disabled || loading" class="min-w-0">
      <template v-if="editor">
        <Combobox :model-value="product" nullable @update:model-value="choose">
          <div class="relative mb-4 max-w-xl">
            <ComboboxLabel class="mt-0">Product</ComboboxLabel>
            <div class="relative"><ComboboxInput :id="`product-${lineKey}`" ref="picker" class="pr-10" autocomplete="off" :display-value="() => draft?.snapshot.content.productFamilyName ?? ''" placeholder="Search product, model, or principal" @change="query = $event.target.value" @blur="query = ''" /><ComboboxButton class="absolute inset-y-0 right-0 px-3" aria-label="Show products">⌄</ComboboxButton></div>
            <ComboboxOptions class="absolute z-10 mt-1 max-h-72 w-full overflow-auto rounded-md border border-gray-200 bg-white shadow-lg">
              <ComboboxOption v-for="p in filtered" :key="p.id" v-slot="{ active: highlighted, selected }" :value="p" as="template"><li class="cursor-pointer p-3" :class="highlighted ? 'bg-blue-50' : ''"><span class="block font-medium">{{ p.productFamilyName }} <span v-if="selected">✓</span></span><span class="text-xs text-gray-500">{{ p.principalName }} <template v-if="p.modelCode">· {{ p.modelCode }}</template></span></li></ComboboxOption>
              <li v-if="!filtered.length" class="p-3 text-gray-600">No matching products. Try a product or principal name.</li>
            </ComboboxOptions>
          </div>
        </Combobox>
        <p v-if="loading" role="status">Loading product…</p>
        <template v-if="draft">
          <p v-if="draft.snapshot.content.productDescription" class="mb-3 text-gray-600">{{ draft.snapshot.content.productDescription }}</p>
          <p class="mb-2 text-xs text-gray-500">Saved configuration version {{ draft.versionId }} · {{ draft.selections.filter(Boolean).length }} of {{ draft.selections.length }} positions complete<span v-if="active >= 0"> · Position {{ active + 1 }}</span></p>
          <div class="mb-3 flex flex-wrap items-center font-mono text-xl" aria-label="Full part number">
            <template v-for="(s,i) in draft.snapshot.content.segments" :key="s.id"><span v-if="i">{{ (draft.snapshot.content.separators ?? Array(draft.selections.length - 1).fill('-'))[i - 1] }}</span><button v-if="s.options.length > 1" type="button" class="rounded px-1 py-2" :class="active === i ? 'bg-blue-100 text-blue-800' : valid[i] === false ? 'bg-red-50 text-red-700' : !draft.selections[i] ? 'bg-amber-50 text-amber-900' : ''" :aria-label="`Choose ${s.name || s.placeholder}, position ${i + 1}`" @click="focusSegment(i)" @keydown.right.prevent="focusSegment(Math.min(i + 1,draft.selections.length - 1))" @keydown.left.prevent="focusSegment(Math.max(0,i - 1))">{{ codeText[i] || s.options.find(o => o.id === draft!.selections[i])?.code || s.placeholder }}<span class="text-xs">{{ valid[i] === false ? '!' : !draft.selections[i] ? '?' : '' }}</span></button><span v-else class="px-1 text-gray-500">{{ s.options[0]?.code }}</span></template>
          </div>
          <div class="flex max-w-full items-start gap-2 overflow-x-auto pb-3" role="region" aria-label="Part number segments">
            <template v-for="(s,i) in draft.snapshot.content.segments" :key="`${draft.versionId}-${s.id}`"><span v-if="i" class="mt-4 self-start text-lg text-gray-500">{{ (draft.snapshot.content.separators ?? Array(draft.selections.length - 1).fill('-'))[i - 1] }}</span><QuoteSegment :ref="el => segments[i] = el as unknown as { focus: () => void; validate: () => boolean } | null" :segment="s" :model-value="draft.selections[i] ?? null" :label="`${s.name || s.placeholder} (position ${i + 1})`" :active="active === i" @update:model-value="draft!.selections[i] = $event; change()" @active="active = i" @validity="valid[i] = $event; if (!$event) change()" @text="codeText[i] = $event" /></template>
          </div>
          <label :for="`qty-${lineKey}`">Quantity</label><div class="flex max-w-48 items-center gap-2"><button type="button" class="button secondary" :disabled="draft.quantity <= 1" aria-label="Decrease quantity" @click="draft.quantity--; change()">−</button><input :id="`qty-${lineKey}`" v-model.number="draft.quantity" type="number" min="1" max="1000000" step="1" :aria-invalid="!Number.isInteger(draft.quantity) || draft.quantity < 1 || draft.quantity > 1000000" @input="change" /><button type="button" class="button secondary" aria-label="Increase quantity" @click="draft.quantity++; change()">+</button></div>
          <p class="mt-3 text-gray-600">{{ draft.selections.some(s => s === null) ? 'Estimated' : 'Preview' }} unit {{ displayPrice(amounts!.unitPrice) }} · Line {{ displayPrice(amounts!.lineTotal) }}</p>
          <p v-if="modelValue" class="mt-1 text-xs text-gray-500">Quote total keeps the previous amount until Done.</p>
        </template>
        <p v-if="failure" class="error" role="alert">{{ failure }}</p>
        <div class="mt-4 flex justify-end gap-2"><button v-if="modelValue" type="button" class="button secondary" @click="cancel">Cancel</button><button type="button" class="button primary" @click="done">Done</button></div>
      </template>
      <template v-else-if="modelValue">
        <div class="grid items-center gap-4 border-t border-gray-200 pt-4 lg:grid-cols-[minmax(0,1fr)_24rem] lg:gap-6">
          <div class="min-w-0">
            <p class="mb-1 text-xs font-medium text-gray-500">Part number</p>
            <div class="flex flex-wrap items-center break-all font-mono text-xl font-semibold" aria-label="Saved part number"><template v-for="(s,i) in modelValue.snapshot.content.segments" :key="s.id"><span v-if="i">{{ (modelValue.snapshot.content.separators ?? Array(modelValue.selections.length - 1).fill('-'))[i - 1] }}</span><button v-if="s.options.length > 1" type="button" class="rounded px-1 py-2 text-blue-700 hover:bg-blue-50" :aria-label="`Edit ${s.name || s.placeholder} in line ${index + 1}`" @click="focusSegment(i)">{{ s.options.find(o => o.id === modelValue!.selections[i])?.code || s.placeholder }}</button><span v-else class="px-1">{{ s.options[0]?.code }}</span></template></div>
            <p v-if="!modelValue.complete" class="mt-1 text-xs text-amber-800">Incomplete options — estimated price. Blank choices are saved.</p>
          </div>
          <dl class="grid grid-cols-[minmax(0,0.65fr)_minmax(0,1fr)_minmax(0,1.15fr)] items-start gap-3 border-t border-gray-200 pt-4 text-right tabular-nums lg:border-t-0 lg:pt-0">
            <div><dt class="text-xs text-gray-500">Quantity</dt><dd class="mt-2 font-medium">{{ modelValue.quantity }}</dd></div>
            <div><dt class="text-xs text-gray-500">Unit price</dt><dd class="mt-2 font-medium">{{ displayPrice(modelValue.unitPrice) }}</dd></div>
            <div class="border-l border-gray-200 pl-3"><dt class="text-xs text-gray-500">Line total</dt><dd class="mt-2 font-semibold">{{ displayPrice(modelValue.lineTotal) }}</dd></div>
          </dl>
        </div>
        <details class="group mt-4 rounded-md border border-gray-200 bg-gray-50">
          <summary class="flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-md px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-100 [&::-webkit-details-marker]:hidden">
            <svg aria-hidden="true" class="size-4 shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6" /></svg>
            Option and price breakdown
          </summary>
          <ul class="space-y-2 border-t border-gray-200 px-3 py-3 text-xs text-gray-600">
            <li class="flex justify-between gap-4"><span>Base price</span><span class="shrink-0 tabular-nums">{{ displayPrice(modelValue.snapshot.content.basePrice) }}</span></li>
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
