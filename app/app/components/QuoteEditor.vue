<script setup lang="ts">
import { useQueryClient } from '@tanstack/vue-query'
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/vue'
import { adjustedAmount } from '~/utils/quote'
import { displayPrice } from '~/utils/configuration'
import { queryKeys } from '~/utils/query-keys'
const { multiple, regularProducts, saved, customer, project, owner, lines, keys, pending, owners, products, back, organization, ready, loading, busy, error, catalogError, catalogLoading, notice, conflicted, errors, dirty, load, catalog, save, add, remove, reload, invalidate, discardChanges } = useQuoteEditor()
const identity = useIdentity(), queryClient = useQueryClient()
const archiveOpen = ref(false), archiveBusy = ref(false), archiveError = ref('')
const editingQuoteNumber = ref(false), quoteNumberDraft = ref(''), quoteNumberError = ref('')
type LineEditor = { validate: () => boolean; done: () => Promise<boolean> }
const editors = ref<Record<string, LineEditor | null>>({}), submitting = ref(false), addButton = ref<HTMLButtonElement>()
const listTotal = computed(() => {
  const amount = lines.value.reduce((sum,line) => sum + (line ? BigInt(line.lineTotal.replace('.','')) : 0n),0n)
  return displayPrice(`${amount / 100n}.${String(amount % 100n).padStart(2,'0')}`)
})
const total = computed(() => {
  const amount = lines.value.reduce((sum, line) => sum + BigInt(adjustedAmount(line?.lineTotal ?? '0.00', multiple.value, line?.multiple ?? 1).replace('.', '')), 0n)
  return displayPrice(`${amount / 100n}.${String(amount % 100n).padStart(2, '0')}`)
})
const partial = computed(() => lines.value.some(l => !l?.complete))
function fieldError(path: string) { return errors.value.find(e => e.path === path)?.message }
async function submit() {
  if (busy.value || submitting.value || saved.value?.archivedAt) return
  submitting.value = true
  try {
    let valid = true
    for (const key of keys.value) if (editors.value[key] && !editors.value[key].validate()) valid = false
    if (!valid) return
    for (const key of keys.value) if (editors.value[key]) await editors.value[key].done()
    await save()
  } finally { submitting.value = false }
}
async function removeLine(i: number) { remove(i); await nextTick(); addButton.value?.focus() }
function editQuoteNumber() {
  if (!saved.value) return
  quoteNumberDraft.value = saved.value.id
  quoteNumberError.value = ''
  editingQuoteNumber.value = true
}
async function goToQuoteNumber() {
  const quoteNumber = quoteNumberDraft.value.trim()
  if (!/^[1-9]\d{0,18}$/.test(quoteNumber) || BigInt(quoteNumber) > 9223372036854775807n) {
    quoteNumberError.value = 'Enter a valid quote number.'
    return
  }
  if (quoteNumber === saved.value?.id) { editingQuoteNumber.value = false; return }
  try {
    await identity.request(`/organizations/${organization.value}/quotes/${quoteNumber}`)
    editingQuoteNumber.value = false
    quoteNumberError.value = ''
    await navigateTo(`${back.value}/${quoteNumber}`)
  } catch {
    quoteNumberError.value = 'Quote number not found.'
  }
}
async function changeArchiveState(archive: boolean) {
  if (!saved.value || archiveBusy.value) return
  archiveBusy.value = true; archiveError.value = ''
  try {
    await identity.request(`/organizations/${organization.value}/quotes/${saved.value.id}/${archive ? 'archive' : 'restore'}`, { method: 'POST' })
    await queryClient.invalidateQueries({ queryKey: queryKeys.quotes(organization.value) })
    discardChanges()
    archiveOpen.value = false
    await navigateTo(back.value)
  } catch (e) { archiveError.value = (e as Error).message }
  finally { archiveBusy.value = false }
}
</script>
<template>
  <ResourceState :loading="loading" :error="ready ? '' : error" @retry="load">
    <template v-if="ready">
      <nav aria-label="Quote navigation" class="mb-4 text-sm">
        <NuxtLink :to="back" class="inline-flex min-h-10 items-center gap-2 rounded-md font-medium text-blue-700 hover:text-blue-900 hover:underline">
          <svg aria-hidden="true" class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6M9 12h12" /></svg>
          Back to quotes
        </NuxtLink>
      </nav>
      <header class="mb-6">
        <div class="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div class="min-w-0">
            <h1 class="flex flex-wrap items-center gap-2">
              {{ saved ? `Quote #${saved.id}` : 'New quote' }}
              <button v-if="saved && !editingQuoteNumber" type="button" class="inline-flex size-9 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-blue-700" :aria-label="`Quote number ${saved.id}. Edit quote number`" title="Jump to a quote number" @click="editQuoteNumber">
                <svg aria-hidden="true" class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m16 4 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15l-1 6Z" /></svg>
              </button>
            </h1>
            <form v-if="editingQuoteNumber" class="mt-2 flex flex-wrap items-center gap-2" @submit.prevent="goToQuoteNumber">
              <input v-model="quoteNumberDraft" aria-label="Quote number" class="w-28" inputmode="numeric" autocomplete="off" autofocus @keydown.esc="editingQuoteNumber = false; quoteNumberError = ''" />
              <button class="button secondary" type="submit">Go</button>
              <button class="text-button" type="button" @click="editingQuoteNumber = false; quoteNumberError = ''">Cancel</button>
            </form>
            <p v-if="quoteNumberError" class="mt-2 text-sm text-red-700" role="alert">{{ quoteNumberError }}</p>
            <p class="mt-1 break-words text-sm text-gray-600">{{ customer.trim() || 'Customer' }} · {{ project.trim() || 'Project' }}</p>
            <p v-if="saved" class="mt-1 text-xs text-gray-500">Last edited by {{ saved.modifiedByName }} · {{ new Date(saved.modifiedWhen).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) }}</p>
            <p v-else class="mt-1 text-xs text-gray-500">Choose products and options for your customer project.</p>
          </div>
          <div class="flex shrink-0 flex-wrap items-center gap-3 sm:pt-1">
            <span
              class="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium"
              :class="busy ? 'bg-gray-100 text-gray-600' : dirty ? 'bg-amber-50 text-amber-800' : saved ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'"
              role="status"
            >
              <svg v-if="busy" aria-hidden="true" class="size-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle class="opacity-25" cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 9 9"/></svg>
              <svg v-else-if="saved && !dirty" aria-hidden="true" class="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></svg>
              <span v-else aria-hidden="true" class="size-1.5 rounded-full bg-current" />
              {{ busy ? 'Saving…' : dirty ? 'Unsaved changes' : saved ? 'Saved' : 'New quote' }}
            </span>
            <button class="button primary whitespace-nowrap" :disabled="busy || submitting || conflicted || !!saved?.archivedAt || (!!saved && !dirty)" @click="submit">{{ busy || submitting ? 'Saving…' : 'Save changes' }}</button>
          </div>
        </div>
        <div class="mt-5 flex flex-wrap items-center gap-2 border-b border-gray-200 pb-4" aria-label="Quote actions" role="group">
          <Menu as="div" class="relative">
            <MenuButton class="button secondary">
              <svg aria-hidden="true" class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V3m-4 4 4-4 4 4M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" /></svg>
              Share quote
            </MenuButton>
            <MenuItems class="absolute left-0 z-10 mt-2 w-60 rounded-md border border-gray-200 bg-white p-1 shadow-lg focus:outline-none">
              <MenuItem disabled><button type="button" disabled class="w-full rounded px-3 py-2 text-left text-sm text-gray-500">Copy view-only link <span class="block text-xs">Coming soon</span></button></MenuItem>
            </MenuItems>
          </Menu>
          <button type="button" class="button secondary" title="Coming soon" disabled>
            <svg aria-hidden="true" class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h5"/></svg>
            Preview PDF
          </button>
          <button type="button" class="button secondary" title="Coming soon" disabled>
            <svg aria-hidden="true" class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m-4-4 4 4 4-4M5 16v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"/></svg>
            Download PDF
          </button>
          <Menu v-if="saved && saved.ownerId === identity.state.user?.id" as="div" class="relative ml-auto">
            <MenuButton class="button secondary min-w-10 px-2" aria-label="More quote actions">
              <svg aria-hidden="true" class="size-5" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
            </MenuButton>
            <MenuItems class="absolute right-0 z-10 mt-2 w-44 rounded-md border border-gray-200 bg-white p-1 shadow-lg focus:outline-none">
              <MenuItem v-if="!saved.archivedAt" v-slot="{ active }" :disabled="busy || submitting"><button type="button" class="w-full rounded px-3 py-2 text-left text-sm text-red-700" :class="{ 'bg-red-50': active }" :disabled="busy || submitting" @click="archiveOpen = true">Archive quote</button></MenuItem>
              <MenuItem v-else v-slot="{ active }" :disabled="archiveBusy"><button type="button" class="w-full rounded px-3 py-2 text-left text-sm text-gray-700" :class="{ 'bg-gray-100': active }" :disabled="archiveBusy" @click="changeArchiveState(false)">Restore quote</button></MenuItem>
            </MenuItems>
          </Menu>
        </div>
      </header>
      <p v-if="notice" class="success" role="status">{{ notice }}</p>
      <p v-if="saved?.archivedAt" class="panel mb-4 p-4 text-gray-700" role="status">This quote is archived. Restore it before making changes.</p>
      <p v-if="saved?.archivedAt && archiveError" class="error mb-4" role="alert">{{ archiveError }}</p>
      <div v-if="error" class="error" role="alert"><p>{{ error }}</p><button v-if="conflicted" class="button secondary mt-2" @click="reload">Reload quote and catalog</button></div>
      <form @submit.prevent="submit">
        <fieldset :disabled="busy || submitting || conflicted || !!saved?.archivedAt" class="panel mb-6 grid min-w-0 gap-x-6 p-4 sm:grid-cols-3 sm:p-5">
          <div><label for="quote-customer" class="mt-0">Customer</label><input id="quote-customer" v-model="customer" maxlength="120" required :aria-invalid="!!fieldError('/customerName')" aria-describedby="customer-error" /><p v-if="fieldError('/customerName')" id="customer-error" class="mt-2 text-red-700" role="alert">{{ fieldError('/customerName') }}</p></div>
          <div><label for="quote-project" class="sm:mt-0">Project</label><input id="quote-project" v-model="project" maxlength="120" required :aria-invalid="!!fieldError('/projectName')" aria-describedby="project-error" /><p v-if="fieldError('/projectName')" id="project-error" class="mt-2 text-red-700" role="alert">{{ fieldError('/projectName') }}</p></div>
          <div><label for="quote-owner" class="sm:mt-0">Owner</label><select id="quote-owner" v-model="owner" class="w-full" :aria-invalid="!!fieldError('/ownerId')"><option :value="null">Unassigned</option><option v-if="owner && !owners.some(o => o.id === owner)" :value="owner" disabled>{{ saved?.ownerName || 'Unavailable owner' }}</option><option v-for="o in owners" :key="o.id" :value="o.id">{{ o.name }}</option></select><p v-if="fieldError('/ownerId')" class="text-red-700" role="alert">{{ fieldError('/ownerId') }}</p></div>
        </fieldset>
        <div v-if="catalogLoading" class="mb-4 text-gray-600" role="status">Loading product configurations…</div>
        <div v-else-if="catalogError" class="error" role="alert">{{ catalogError }} <button type="button" class="button secondary" @click="catalog()">Retry products</button></div>
        <p v-else-if="!products.length && !regularProducts.length" class="panel mb-4 p-4">No product configurations are available. An administrator must create a product configuration first. You can add freeform parts or save quote details.</p>
        <h2 class="mb-4">Line items <span class="ml-2 text-sm font-normal text-gray-500">{{ keys.length }} lines</span></h2>
        <div class="space-y-4"><QuoteLineEditor v-for="(key,i) in keys" :key="key" :ref="el => editors[key] = el as unknown as LineEditor | null" :model-value="lines[i] ?? null" :line-key="key" :index="i" :products="products" :regular-products="regularProducts" :quote-multiple="multiple" :organization="organization" :disabled="busy || submitting || conflicted || !!saved?.archivedAt" @update:model-value="lines[i] = $event" @pending="$event ? pending.add(key) : pending.delete(key)" @remove="removeLine(i)" @access-lost="invalidate()" /></div>
        <div class="mt-5 flex flex-wrap items-start justify-between gap-6">
          <button ref="addButton" type="button" class="button secondary" :disabled="busy || submitting || conflicted || !!saved?.archivedAt || catalogLoading || !!catalogError || keys.length >= 100" @click="add">+ Add line</button>
          <section aria-label="Quote totals" class="panel w-full p-5 sm:ml-auto sm:max-w-md">
            <h2 class="mb-4 text-base">Quote summary</h2>
            <dl class="space-y-4 tabular-nums">
              <div class="flex items-baseline justify-between gap-4"><dt class="text-gray-600">{{ partial ? 'Estimated List Quote Total' : 'List Quote Total' }}</dt><dd class="text-right font-medium">{{ listTotal }}</dd></div>
              <div class="flex items-center justify-between gap-4">
                <dt><label for="quote-multiple" class="m-0">Quote multiple</label><p id="quote-multiple-help" class="text-xs text-gray-500">Applies to every line · increments of 0.01</p></dt>
                <dd class="w-28 shrink-0"><input id="quote-multiple" v-model.number="multiple" class="text-right tabular-nums" type="number" min="0" max="1000" step="0.01" :disabled="busy || submitting || conflicted || !!saved?.archivedAt" :aria-invalid="!!fieldError('/multiple')" aria-describedby="quote-multiple-help" /></dd>
              </div>
              <div class="flex items-baseline justify-between gap-4 border-t border-gray-200 pt-4"><dt class="font-semibold">{{ partial ? 'Estimated After Multiple' : 'After Multiple' }}</dt><dd class="text-right text-2xl font-semibold">{{ total }}</dd></div>
            </dl>
            <p v-if="fieldError('/multiple')" class="mt-2 text-red-700" role="alert">{{ fieldError('/multiple') }}</p>
            <p v-if="pending.size" class="mt-3 text-xs text-gray-500">Finish editing lines to update quote totals.</p>
            <p v-if="partial" class="mt-3 text-xs text-gray-500">Missing options excluded. Amounts may change as choices are added.</p>
          </section>
        </div>
      </form>
      <ConfirmDialog :open="archiveOpen" title="Archive this quote?" confirm-label="Archive quote" :busy="archiveBusy" :error="archiveError" @cancel="archiveOpen = false; archiveError = ''" @confirm="changeArchiveState(true)">
        <p>“{{ saved?.title }}” will move out of the active quotes list. You can restore it later.</p>
        <p v-if="dirty" class="mt-2">Your unsaved changes will also be discarded.</p>
      </ConfirmDialog>
    </template>
  </ResourceState>
</template>
