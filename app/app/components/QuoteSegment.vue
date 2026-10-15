<script setup lang="ts">
import type { QuoteSnapshot } from '~/types/quotes'
const props = defineProps<{ segment: QuoteSnapshot['content']['segments'][number]; modelValue: string | null; label: string; active: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: string | null]; active: []; validity: [valid: boolean]; text: [value: string] }>()
const filtering = ref(false)
const text = ref(''), opened = ref(false), cursor = ref(0), input = ref<HTMLInputElement>()
const id = useId()
const selected = computed(() => props.segment.options.find(o => o.id === props.modelValue))
watch(() => props.modelValue, () => { text.value = selected.value?.code ?? ''; emit('validity',true); emit('text',text.value) }, { immediate: true })
const matches = computed(() => props.segment.options.filter(o => !filtering.value || o.code.toLowerCase().startsWith(text.value.toLowerCase())))
const pending = computed(() => text.value !== (selected.value?.code ?? ''))
const invalid = computed(() => !!text.value && !props.segment.options.some(o => o.code.toLowerCase().startsWith(text.value.toLowerCase())))
function type() { emit('text',text.value); filtering.value = true; cursor.value = 0; opened.value = true; emit('validity',!pending.value || !text.value) ; if (!text.value) emit('update:modelValue',null) }
function choose(value: string | null) { emit('update:modelValue',value); text.value = props.segment.options.find(o => o.id === value)?.code ?? ''; emit('text',text.value); opened.value = false; filtering.value = false; emit('validity',true); input.value?.focus() }
function exact() {
  if (!pending.value) return true
  if (!text.value) { choose(null); return true }
  const option = props.segment.options.find(o => o.code.toLowerCase() === text.value.toLowerCase())
  if (option) { choose(option.id); return true }
  emit('validity',false); return false
}
function key(e: KeyboardEvent) {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const wasOpen = opened.value; opened.value = true; cursor.value = !wasOpen ? 0 : matches.value.length ? (cursor.value + (e.key === 'ArrowDown' ? 1 : -1) + matches.value.length) % matches.value.length : 0 }
  if (e.key === 'Enter') { e.preventDefault(); if (opened.value && matches.value[cursor.value]) choose(matches.value[cursor.value]!.id); else exact() }
  if (e.key === 'Tab') { exact(); opened.value = false }
  if (e.key === 'Escape') { e.preventDefault(); text.value = selected.value?.code ?? ''; emit('text',text.value); opened.value = false; emit('validity',true) }
}
function focus() { filtering.value = false; emit('active'); opened.value = true; cursor.value = 0; nextTick(() => { const column = input.value?.closest('section'), workspace = column?.parentElement; if (column && workspace) { const c = column.getBoundingClientRect(), w = workspace.getBoundingClientRect(); if (c.left < w.left) workspace.scrollLeft += c.left - w.left; else if (c.right > w.right) workspace.scrollLeft += c.right - w.right } }) }
defineExpose({ focus: () => input.value?.focus(), validate: exact })
</script>
<template>
  <section class="min-w-40 rounded-md border p-3 transition-[flex-grow]" :class="[active ? 'grow-[3] min-w-72' : 'grow', segment.options.length === 1 ? 'bg-gray-100 border-gray-200' : invalid ? 'bg-red-50 border-red-300' : active ? 'bg-blue-50 border-blue-400' : !modelValue ? 'bg-amber-50 border-amber-200' : 'bg-white border-gray-200']">
    <div class="mb-2 font-mono text-lg font-semibold break-all">{{ selected?.code || segment.placeholder }}</div>
    <label :for="id" class="mt-0">{{ label }}</label>
    <template v-if="segment.options.length === 1"><p>{{ segment.options[0]?.description || segment.options[0]?.code }}</p><p class="text-xs text-gray-500">Fixed position</p></template>
    <template v-else>
      <input :id="id" ref="input" v-model="text" role="combobox" autocomplete="off" :aria-expanded="opened" :aria-controls="`${id}-options`" :aria-activedescendant="opened && matches[cursor] ? `${id}-${cursor}` : undefined" :aria-invalid="invalid || pending" :aria-describedby="`${id}-status`" :placeholder="segment.placeholder" @input="type" @focus="focus" @keydown="key" @blur="opened = false" />
      <p :id="`${id}-status`" class="mt-2 text-xs" :class="invalid ? 'text-red-700' : 'text-gray-600'">{{ invalid ? '! Unknown code. Choose an available option or clear it.' : pending ? 'Choice pending — enter an exact code.' : modelValue ? '✓ Complete' : 'Choose an option' }}</p>
      <ul v-if="opened" :id="`${id}-options`" role="listbox" :aria-label="label" class="mt-2 max-h-60 overflow-y-auto rounded border border-gray-200 bg-white">
        <li v-for="(option,i) in matches" :id="`${id}-${i}`" :key="option.id" role="option" :aria-selected="option.id === modelValue" class="cursor-pointer p-2" :class="i === cursor ? 'bg-blue-100' : 'hover:bg-gray-50'" @pointerdown.prevent="choose(option.id)">
          <span class="font-mono font-semibold">{{ option.code }}</span> <span>{{ option.description || option.code }}</span>
          <span v-if="option.id === modelValue" class="ml-1 text-xs text-gray-500">✓</span>
        </li>
        <li v-if="!matches.length" class="p-2 text-red-700">No matching codes.</li>
      </ul>
      <button v-if="modelValue" type="button" tabindex="-1" class="text-button text-xs" @pointerdown.prevent="choose(null)">Clear choice</button>
    </template>
  </section>
</template>
