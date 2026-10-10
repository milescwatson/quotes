<script setup lang="ts">
import type { QuoteFilters, QuoteOwner } from '~/types/quotes'
const props = defineProps<{ modelValue: QuoteFilters; owners: QuoteOwner[]; ownersLoading: boolean }>()
const emit = defineEmits<{ apply: [filters: QuoteFilters] }>()
const draft = reactive({ ...props.modelValue })
const open = ref<'customer' | 'project' | null>(null)
const root = ref<HTMLElement>()
const input = ref<HTMLInputElement>()
let trigger: HTMLButtonElement | undefined
let timer: ReturnType<typeof setTimeout> | undefined
const fields = [{ key: 'customer', label: 'Customer' }, { key: 'project', label: 'Project name' }] as const
const active = computed(() => Object.values(draft).some(value => value.trim()))
watch(() => props.modelValue, value => {
  // A response to another filter must not replace text currently being typed.
  if (!timer) Object.assign(draft, value)
}, { deep: true })
function apply() {
  clearTimeout(timer)
  timer = undefined
  const value = { customer: draft.customer.trim(), project: draft.project.trim(), ownerId: draft.ownerId }
  if (Object.keys(value).some(key => value[key as keyof QuoteFilters] !== props.modelValue[key as keyof QuoteFilters])) emit('apply', value)
}
function schedule() {
  clearTimeout(timer)
  timer = setTimeout(apply, 300)
}
function close(restoreFocus = false) {
  open.value = null
  if (restoreFocus) trigger?.focus()
}
async function toggle(key: 'customer' | 'project', event: MouseEvent) {
  trigger = event.currentTarget as HTMLButtonElement
  open.value = open.value === key ? null : key
  if (open.value) {
    await nextTick()
    input.value?.focus()
  }
}
function remove(key: keyof QuoteFilters) {
  draft[key] = ''
  apply()
}
function clear() {
  Object.assign(draft, { customer: '', project: '', ownerId: '' })
  apply()
  close()
}
function dismiss(event: PointerEvent) {
  if (!root.value?.contains(event.target as Node)) close()
}
function focusOut(event: FocusEvent) {
  if (!root.value?.contains(event.relatedTarget as Node)) close()
}
onMounted(() => document.addEventListener('pointerdown', dismiss))
onBeforeUnmount(() => {
  clearTimeout(timer)
  document.removeEventListener('pointerdown', dismiss)
})
</script>

<template>
  <section ref="root" class="relative mb-4" aria-label="Quote filters" @keydown.esc.stop.prevent="close(true)" @focusout="focusOut">
    <div class="flex flex-wrap items-center gap-2">
      <span class="mr-1 inline-flex h-9 items-center gap-1.5 text-xs font-medium text-gray-500">
        <svg class="size-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden="true"><path d="M3 5h14M6 10h8M8 15h4" stroke-width="1.5" stroke-linecap="round" /></svg>
        Filters
      </span>
      <div v-for="field in fields" :key="field.key" class="inline-flex min-w-0 max-w-full items-center rounded-md border bg-white shadow-xs" :class="draft[field.key] ? 'border-blue-200 text-blue-700' : 'border-gray-200 text-gray-700'">
        <button type="button" :aria-expanded="open === field.key" aria-controls="quote-text-filter" class="inline-flex h-9 min-w-0 items-center gap-2 rounded-md px-3 text-xs font-medium hover:bg-gray-50" @click="toggle(field.key, $event)">
          <svg v-if="!draft[field.key]" class="size-3 shrink-0 text-gray-400" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke-width="1.5" stroke-linecap="round" /></svg>
          <span class="shrink-0">{{ field.label }}</span>
          <template v-if="draft[field.key]">
            <span class="h-3.5 border-l border-blue-200" aria-hidden="true" />
            <span class="max-w-36 truncate">{{ draft[field.key] }}</span>
          </template>
        </button>
        <button v-if="draft[field.key]" type="button" :aria-label="`Remove ${field.label.toLowerCase()} filter`" class="flex h-9 w-8 shrink-0 items-center justify-center rounded-r-md hover:bg-blue-50" @click="remove(field.key)">
          <svg class="size-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" stroke-width="1.5" stroke-linecap="round" /></svg>
        </button>
      </div>
      <div class="relative min-w-0 max-w-full">
        <label for="quote-owner-filter" class="sr-only">Team member owner</label>
        <select id="quote-owner-filter" v-model="draft.ownerId" class="!h-9 !min-h-9 w-auto max-w-60 appearance-none !rounded-md !py-0 !pl-3 !pr-8 !text-xs !font-medium shadow-xs hover:bg-gray-50" :class="draft.ownerId ? '!border-blue-200 !text-blue-700' : '!border-gray-200 !text-gray-700'" @change="apply">
          <option value="">Owner: Anyone</option>
          <option value="unassigned">Unassigned</option>
          <option v-if="ownersLoading" disabled>Loading team members…</option>
          <option v-for="owner in owners" :key="owner.id" :value="owner.id">{{ owner.name }}</option>
        </select>
        <svg class="pointer-events-none absolute right-2.5 top-3 size-3 text-gray-400" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
      </div>
      <button v-if="active" type="button" class="h-9 rounded px-2 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-900" @click="clear">Clear filters</button>
    </div>
    <div v-if="open" id="quote-text-filter" class="absolute left-0 top-full z-20 mt-2 w-80 max-w-full rounded-lg border border-gray-200 bg-white p-4 shadow-lg" role="region" :aria-label="`${open === 'customer' ? 'Customer' : 'Project name'} filter`">
      <label for="quote-filter-value" class="!mb-2 !mt-0 !text-xs">{{ open === 'customer' ? 'Customer' : 'Project name' }}</label>
      <div class="relative">
        <svg class="pointer-events-none absolute left-3 top-3 size-4 text-gray-400" viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5" stroke-width="1.5" /><path d="m12 12 4.5 4.5" stroke-width="1.5" stroke-linecap="round" /></svg>
        <input id="quote-filter-value" ref="input" v-model="draft[open]" type="search" maxlength="120" :placeholder="open === 'customer' ? 'Search customer name…' : 'Search project name…'" class="!pl-9 focus:border-blue-500 focus:ring-2 focus:ring-blue-100" @input="schedule" @keydown.enter.prevent="apply(); close(true)" />
      </div>
      <p class="mt-2 text-xs text-gray-500">Matches any part of the name.</p>
    </div>
  </section>
</template>
