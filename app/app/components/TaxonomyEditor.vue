<script setup lang="ts">
import { blankOption, blankSegment, formatPrice } from '~/utils/configuration'
import { useQueryClient } from '@tanstack/vue-query'
import type { SegmentDraft, OptionDraft } from '~/types/taxonomy'
const { ready, draft, saved, choices, loading, busy, failure, notice, errors, conflicted, canEdit, dirty, back, reload, save } = useTaxonomyEditor()
const identity = useIdentity(), route = useRoute()
const archiveBusy = ref(false), queryClient = useQueryClient()
async function archive() {
  if (!saved.value?.permissions.canArchive || !window.confirm('This will delete the configuration from your entire organization’s catalog and every organization it is shared with. Existing quotes will retain their saved product details.')) return
  archiveBusy.value=true
  try { await identity.request(`/organizations/${identity.organizationId(route.params.orgId)}/taxonomies/${saved.value.id}/archive`,{method:'POST',body:{expectedVersionId:saved.value.currentVersionId}});await queryClient.invalidateQueries({predicate:q=>q.queryKey.includes('taxonomies')});await navigateTo(back.value) }
  catch(e) { failure.value=(e as Error).message }
  finally { archiveBusy.value=false }
}
const announcement = ref('')
const disabled = computed(() => busy.value || !canEdit.value || conflicted.value)
const message = (path: string) => errors.value.find(e => e.path === path)?.message
function clearErrors() { errors.value = []; notice.value = '' }
function focus(key: string, field: string) { nextTick(() => document.getElementById(`${key}-${field}`)?.focus()) }
function addSegment() { clearErrors(); const s = blankSegment(); if (draft.value.segments.length) draft.value.separators.push('-'); draft.value.segments.push(s); focus(s.key, 'placeholder') }
function addOption(s: SegmentDraft) { clearErrors(); const o = blankOption(); s.options.push(o); focus(o.key, 'code') }
function removeSegment(s: SegmentDraft) {
  if ((s.placeholder.trim() || s.name?.trim() || s.description.trim() || s.options.length) && !window.confirm('Remove this segment and its options? Changes are saved only when you click Save.')) return
  clearErrors(); const i = draft.value.segments.indexOf(s); draft.value.segments.splice(i, 1); draft.value.separators.splice(Math.max(0, draft.value.segments.length - 1))
  const next = draft.value.segments[i] || draft.value.segments[i - 1]
  if (next) focus(next.key, 'placeholder'); else nextTick(() => document.getElementById('add-segment')?.focus())
}
function removeOption(s: SegmentDraft, o: OptionDraft) {
  clearErrors(); const i = s.options.indexOf(o); s.options.splice(i, 1); if (s.defaultKey === o.key) s.defaultKey = null
  const next = s.options[i] || s.options[i - 1]
  if (next) focus(next.key, 'code'); else nextTick(() => document.getElementById(`${s.key}-add`)?.focus())
}
function move<T>(items: T[], from: number, to: number, key: string, field: string) {
  if (disabled.value || to < 0 || to >= items.length || from === to) return
  const [item] = items.splice(from, 1); if (!item) return
  items.splice(to, 0, item); clearErrors(); announcement.value = `Moved to position ${to + 1}.`; focus(key, field)
}
let dragging: { segment: string; option?: string } | null = null
function drag(event: DragEvent, segment: string, option?: string) {
  if (disabled.value) { event.preventDefault(); return }
  dragging = { segment, option }; event.dataTransfer?.setData('text/plain', option || segment)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}
function dropSegment(index: number) {
  if (!dragging || dragging.option) return
  const from = draft.value.segments.findIndex(s => s.key === dragging!.segment)
  if (from >= 0) move(draft.value.segments, from, index, dragging.segment, 'placeholder')
  dragging = null
}
function dropOption(s: SegmentDraft, index: number) {
  if (!dragging?.option || dragging.segment !== s.key) return
  const from = s.options.findIndex(o => o.key === dragging!.option)
  if (from >= 0) move(s.options, from, index, dragging.option, 'code')
  dragging = null
}
function blurPrice(target: { price: string }, path: string) {
  const formatted = formatPrice(target.price)
  if (formatted !== null) target.price = formatted
  else if (target.price) errors.value.push({ path, code: 'INVALID_INPUT', message: 'Enter a valid nonnegative USD amount.' })
}
function blurBase() { const formatted = formatPrice(draft.value.basePrice, true); if (formatted !== null && draft.value.basePrice) draft.value.basePrice = formatted }
</script>
<template>
  <div class="configuration-editor min-w-0">
    <NuxtLink :to="back" class="mb-5 inline-flex items-center gap-3 text-sm text-gray-600"><span aria-hidden="true">‹</span> Configuration Editor</NuxtLink>
    <div class="mb-5 flex items-center justify-between gap-3"><h1>Product Configuration</h1><div class="flex flex-wrap items-center justify-end gap-3"><button v-if="saved?.permissions.canArchive" class="button secondary" :disabled="busy || archiveBusy" @click="archive">Archive configuration</button><span v-if="saved && !dirty" class="text-xs text-gray-500">Saved</span><span v-if="dirty && canEdit" class="text-xs text-gray-500">Unsaved changes</span><button v-if="canEdit" class="button secondary" :disabled="busy || loading || conflicted" @click="save">{{ busy ? 'Saving…' : 'Save' }}</button></div></div>
    <p v-if="notice" role="status" class="success">{{ notice }}</p><p class="sr-only" aria-live="polite">{{ announcement }}</p>
    <p v-if="failure" class="error" role="alert">{{ failure }} <button class="text-button" :disabled="busy" @click="reload">Reload configuration</button></p>
    <div v-if="errors.length" class="error" role="alert"><p>Please correct the following:</p><ul class="list-disc pl-5"><li v-for="(e, i) in errors" :key="i">{{ e.message }}</li></ul></div>
    <p v-if="loading" role="status">Loading configuration…</p>
    <template v-else-if="ready">
      <p v-if="saved?.archivedAt" class="mb-4 text-gray-600">This configuration is archived.</p>
      <p v-else-if="!canEdit" class="mb-4 text-gray-600">Read-only configuration.</p>
      <NuxtLink v-if="saved && !canEdit && identity.state.user?.isSuperAdministrator && saved.ownerOrganizationId !== identity.organizationId(route.params.orgId)" :to="`${identity.organizationPath(saved.ownerOrganizationId)}/taxonomies/${saved.id}`" class="mb-4 inline-block text-blue-600">Switch to owning organization to edit</NuxtLink>
      <ConfigurationSharing v-if="saved?.permissions.canManageSharing" :taxonomy="saved" :organization="identity.organizationId(route.params.orgId)" />
      <fieldset :disabled="disabled" class="min-w-0">
        <div class="rounded-t-md border border-gray-200 bg-white p-4 sm:p-5">
          <div class="flex flex-wrap items-start gap-x-5 gap-y-3">
            <div class="w-full sm:w-80"><label for="product-name" class="!mt-0 !text-xs">Product name</label><input id="product-name" v-model="draft.productFamilyName" :aria-invalid="!!message('/content/productFamilyName')" aria-describedby="name-error" @input="clearErrors"><p id="name-error" class="text-xs text-red-700">{{ message('/content/productFamilyName') }}</p></div>
            <div class="w-full sm:w-56"><label for="configuration-principal" class="!mt-0 !text-xs">Principal</label><select id="configuration-principal" v-model="draft.principalId" class="w-full" :aria-invalid="!!message('/principalId')" aria-describedby="principal-error" @change="clearErrors"><option value="">Choose a principal</option><option v-for="p in choices" :key="p.id" :value="p.id">{{ p.name }}</option></select><p id="principal-error" class="text-xs text-red-700">{{ message('/principalId') }}</p><p v-if="!choices.length" class="mt-2 text-xs text-gray-600">An administrator must add a principal in Admin settings before saving.</p></div>
            <div class="w-44"><label for="base-price" class="!mt-0 !text-xs">Base price</label><CurrencyInput id="base-price" v-model="draft.basePrice" inputmode="decimal" placeholder="$0.00" :aria-invalid="!!message('/content/basePrice')" aria-describedby="base-error" @input="clearErrors" @blur="blurBase" /><p id="base-error" class="text-xs text-red-700">{{ message('/content/basePrice') }}</p></div>
          </div>
          <div class="mt-3"><label for="product-description" class="!text-xs">Product description</label><textarea id="product-description" v-model="draft.productDescription" rows="2" placeholder="Optional" :aria-invalid="!!message('/content/productDescription')" aria-describedby="product-description-error" @input="clearErrors"/><p id="product-description-error" class="text-xs text-red-700">{{ message('/content/productDescription') }}</p></div>
          <p class="mb-2 mt-5 text-xs font-medium text-gray-600">Part number pattern</p><div class="flex min-h-8 flex-wrap items-center gap-2" aria-label="Part number pattern"><template v-for="(s, i) in draft.segments" :key="s.key"><span v-if="i && draft.separators[i - 1]" class="text-gray-400">{{ draft.separators[i - 1] }}</span><span class="rounded bg-gray-100 px-2 py-1 text-lg font-semibold">{{ s.placeholder || '…' }}</span></template></div>
        </div>
        <div class="border-x border-b border-gray-200 bg-gray-100 p-4 sm:p-5">
          <div class="flex items-start gap-3 overflow-x-auto pb-5" role="region" aria-label="Configuration segments" tabindex="0">
            <template v-for="(s, i) in draft.segments" :key="s.key">
            <div v-if="i" class="w-24 shrink-0 pt-3"><label :for="`separator-${i}`" class="!mt-0 !text-xs">Separator</label><select :id="`separator-${i}`" v-model="draft.separators[i - 1]" :aria-label="`Separator between segments ${i} and ${i + 1}`" :aria-invalid="!!message('/content/separators')" @change="clearErrors"><option value="-">-</option><option value="">None</option></select></div>
            <section class="w-[520px] max-w-full shrink-0 overflow-hidden rounded-lg border border-gray-200 bg-white" :aria-label="`Segment ${i + 1}`" @dragover.prevent @drop.prevent="dropSegment(i)">
              <div class="flex items-center gap-2 border-b border-gray-200 px-2 py-3">
                <button :draggable="!disabled" type="button" class="px-1 text-gray-500" :aria-label="`Move segment ${i + 1}. Use left or right arrow keys.`" title="Drag, or use left/right arrow keys" @dragstart="drag($event, s.key)" @dragend="dragging = null" @keydown.left.prevent="move(draft.segments, i, i - 1, s.key, 'placeholder')" @keydown.right.prevent="move(draft.segments, i, i + 1, s.key, 'placeholder')">⠿</button>
                <span class="flex size-5 shrink-0 items-center justify-center rounded-full bg-gray-800 text-xs text-white">{{ i + 1 }}</span>
                <input :id="`${s.key}-placeholder`" v-model="s.placeholder" class="!min-h-9 min-w-0 flex-1 !px-2 !py-1 font-semibold" placeholder="Part number segment name" :aria-label="`Segment ${i + 1} placeholder`" :aria-invalid="!!message(`/content/segments/${i}/placeholder`)" @input="clearErrors">
                <span class="ml-auto whitespace-nowrap text-[10px] text-gray-500">{{ s.options.length }} {{ s.options.length === 1 ? 'option' : 'options' }}</span><button type="button" class="px-1 text-xl text-gray-500" :aria-label="`Remove segment ${i + 1}`" @click="removeSegment(s)">×</button>
              </div>
              <p v-if="message(`/content/segments/${i}/placeholder`)" class="px-3 text-xs text-red-700">{{ message(`/content/segments/${i}/placeholder`) }}</p>
              <div class="px-3 pb-1">
                <label :for="`${s.key}-title`" class="!text-xs">Title</label><input :id="`${s.key}-title`" v-model="s.name" placeholder="Optional" :aria-label="`Title for segment ${i + 1}`" :aria-invalid="!!message(`/content/segments/${i}/name`)" @input="clearErrors"><p class="text-xs text-red-700">{{ message(`/content/segments/${i}/name`) }}</p>
                <label :for="`${s.key}-description`" class="!text-xs">Description</label><textarea :id="`${s.key}-description`" v-model="s.description" rows="2" placeholder="Optional" :aria-label="`Description for segment ${i + 1}`" :aria-invalid="!!message(`/content/segments/${i}/description`)" @input="clearErrors"/><p class="text-xs text-red-700">{{ message(`/content/segments/${i}/description`) }}</p>
              </div>
              <div class="option-grid pt-3 text-xs font-semibold text-gray-600"><span/><span>Code</span><span>Description</span><span class="text-right">Price</span><span/></div>
              <div v-for="(o, j) in s.options" :key="o.key" @dragover.prevent.stop @drop.prevent.stop="dropOption(s, j)">
                <div class="option-grid py-1">
                  <button :draggable="!disabled" type="button" class="text-gray-500" :aria-label="`Move option ${j + 1} in segment ${i + 1}. Use up or down arrow keys.`" title="Drag, or use up/down arrow keys" @dragstart.stop="drag($event, s.key, o.key)" @dragend="dragging = null" @keydown.up.prevent="move(s.options, j, j - 1, o.key, 'code')" @keydown.down.prevent="move(s.options, j, j + 1, o.key, 'code')">⠿</button>
                  <input :id="`${o.key}-code`" v-model="o.code" class="cell font-medium" :aria-label="`Code for option ${j + 1} in segment ${i + 1}`" :aria-invalid="!!message(`/content/segments/${i}/options/${j}/code`)" @input="clearErrors">
                  <input v-model="o.description" class="cell" placeholder="Optional" :aria-label="`Description for option ${j + 1} in segment ${i + 1}`" :aria-invalid="!!message(`/content/segments/${i}/options/${j}/description`)" @input="clearErrors">
                  <CurrencyInput v-model="o.price" class="cell text-right" inputmode="decimal" :aria-label="`Price for option ${j + 1} in segment ${i + 1}`" :aria-invalid="!!message(`/content/segments/${i}/options/${j}/price`)" @input="clearErrors" @blur="blurPrice(o, `/content/segments/${i}/options/${j}/price`)" />
                  <button type="button" class="text-xl text-gray-500" :aria-label="`Remove option ${j + 1} in segment ${i + 1}`" @click="removeOption(s, o)">×</button>
                </div>
                <p v-for="e in errors.filter(e => e.path.startsWith(`/content/segments/${i}/options/${j}/`))" :key="e.path" class="px-3 text-xs text-red-700">{{ e.message }}</p>
              </div>
              <p v-if="!s.options.length" class="px-3 py-4 text-xs text-gray-500">No options yet.</p><p v-if="message(`/content/segments/${i}/options`)" class="px-3 text-xs text-red-700">{{ message(`/content/segments/${i}/options`) }}</p>
              <div v-if="canEdit" class="mt-2 border-t border-gray-100 p-3"><button :id="`${s.key}-add`" class="text-blue-600" :aria-label="`Add option to segment ${i + 1}`" @click="addOption(s)">＋ Add option</button></div>
            </section>
            </template>
            <button v-if="canEdit" id="add-segment" class="min-h-14 w-44 shrink-0 rounded-md border border-dashed border-gray-400 text-gray-600" @click="addSegment">＋ Add segment</button>
          </div>
        </div>
      </fieldset>
    </template>
  </div>
</template>
<style scoped>
.option-grid { display:grid;grid-template-columns:16px 58px minmax(0,1fr) 94px 16px;gap:6px;align-items:center;padding-left:8px;padding-right:8px; }
.cell { min-width:0;min-height:36px;border-color:#9ca3af;padding:6px;font-size:14px; }
.configuration-editor textarea { width:100%;min-width:0;border:1px solid #9ca3af;border-radius:4px;padding:8px;font-size:14px;resize:vertical; }
.configuration-editor input,.configuration-editor select { border-color:#9ca3af; }
.configuration-editor input:hover,.configuration-editor select:hover,.configuration-editor textarea:hover { border-color:#6b7280; }
.configuration-editor [aria-invalid="true"] { border-color:#b91c1c; }
</style>
