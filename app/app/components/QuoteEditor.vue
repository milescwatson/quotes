<script setup lang="ts">
import { useQueryClient } from '@tanstack/vue-query'
import { adjustedAmount } from '~/utils/quote'
import { displayPrice } from '~/utils/configuration'
import { queryKeys } from '~/utils/query-keys'
const { multiple, regularProducts, saved, customer, project, owner, lines, keys, pending, owners, products, back, organization, ready, loading, busy, error, catalogError, catalogLoading, notice, conflicted, errors, dirty, load, catalog, save, add, remove, reload, invalidate, discardChanges } = useQuoteEditor()
const identity = useIdentity(), queryClient = useQueryClient()
const archiveOpen = ref(false), archiveBusy = ref(false), archiveError = ref('')
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
      <nav aria-label="Breadcrumb" class="mb-4 text-sm text-gray-500">
        <ol class="flex flex-wrap items-center gap-2">
          <li><NuxtLink :to="back" class="inline-flex min-h-10 items-center gap-2 rounded-md pr-2 font-medium text-blue-700 hover:text-blue-900 hover:underline">
            <svg aria-hidden="true" class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6M9 12h12" /></svg>
            Back to quotes
          </NuxtLink></li>
          <li aria-hidden="true" class="text-gray-400">/</li>
          <li aria-current="page" class="font-medium text-gray-700">{{ saved ? 'Edit quote' : 'New quote' }}</li>
        </ol>
      </nav>
      <PageHeading :title="saved ? 'Edit quote' : 'New quote'" :description="saved ? `Last modified by ${saved.modifiedByName} · ${new Date(saved.modifiedWhen).toLocaleString()}` : 'Choose products and options for your customer project.'">
        <button v-if="saved && saved.ownerId === identity.state.user?.id && !saved.archivedAt" type="button" class="button danger" :disabled="busy || submitting" @click="archiveOpen = true">Archive quote</button>
        <button v-else-if="saved && saved.ownerId === identity.state.user?.id && saved.archivedAt" type="button" class="button secondary" :disabled="archiveBusy" @click="changeArchiveState(false)">Restore quote</button>
        <button type="button" class="button secondary" title="Coming soon">
          <svg aria-hidden="true" class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg>
          Copy View Only Quote Link
        </button>
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
        <button class="button primary" :disabled="busy || submitting || conflicted || !!saved?.archivedAt" @click="submit">{{ busy ? 'Saving…' : 'Save' }}</button>
      </PageHeading>
      <p v-if="notice" class="success" role="status">{{ notice }}</p>
      <p v-if="saved?.archivedAt" class="panel mb-4 p-4 text-gray-700" role="status">This quote is archived. Restore it before making changes.</p>
      <p v-if="saved?.archivedAt && archiveError" class="error mb-4" role="alert">{{ archiveError }}</p>
      <div v-if="error" class="error" role="alert"><p>{{ error }}</p><button v-if="conflicted" class="button secondary mt-2" @click="reload">Reload quote and catalog</button></div>
      <form @submit.prevent="submit">
        <fieldset :disabled="busy || submitting || conflicted || !!saved?.archivedAt" class="panel mb-6 grid min-w-0 gap-x-6 p-4 sm:grid-cols-3 sm:p-5">
          <div><label for="quote-customer" class="mt-0">Customer</label><input id="quote-customer" v-model="customer" maxlength="120" required :aria-invalid="!!fieldError('/customerName')" aria-describedby="customer-error" /><p v-if="fieldError('/customerName')" id="customer-error" class="mt-2 text-red-700" role="alert">{{ fieldError('/customerName') }}</p></div>
          <div><label for="quote-project" class="sm:mt-0">Project</label><input id="quote-project" v-model="project" maxlength="120" required :aria-invalid="!!fieldError('/projectName')" aria-describedby="project-error" /><p v-if="fieldError('/projectName')" id="project-error" class="mt-2 text-red-700" role="alert">{{ fieldError('/projectName') }}</p></div>
          <div><label for="quote-owner" class="sm:mt-0">Owner</label><select id="quote-owner" v-model="owner" class="w-full" :aria-invalid="!!fieldError('/ownerId')"><option :value="null">Unassigned</option><option v-if="owner && !owners.some(o => o.id === owner)" :value="owner" disabled>{{ saved?.ownerName || 'Unavailable owner' }}</option><option v-for="o in owners" :key="o.id" :value="o.id">{{ o.name }}</option></select><p v-if="fieldError('/ownerId')" class="text-red-700" role="alert">{{ fieldError('/ownerId') }}</p></div>
          <div><label for="quote-multiple">Quote multiple</label><input id="quote-multiple" v-model.number="multiple" type="number" min="0" max="1000" step="0.0001" :aria-invalid="!!fieldError('/multiple')" /><p v-if="fieldError('/multiple')" class="text-red-700" role="alert">{{ fieldError('/multiple') }}</p></div>
          <p class="mt-4 break-words text-gray-500 sm:col-span-3">{{ customer.trim() || 'Customer' }} - {{ project.trim() || 'Project' }}</p>
        </fieldset>
        <div v-if="catalogLoading" class="mb-4 text-gray-600" role="status">Loading product configurations…</div>
        <div v-else-if="catalogError" class="error" role="alert">{{ catalogError }} <button type="button" class="button secondary" @click="catalog()">Retry products</button></div>
        <p v-else-if="!products.length && !regularProducts.length" class="panel mb-4 p-4">No product configurations are available. An administrator must create a product configuration first. You can add freeform parts or save quote details.</p>
        <h2 class="mb-4">Line items <span class="ml-2 text-sm font-normal text-gray-500">{{ keys.length }} lines</span></h2>
        <div class="space-y-4"><QuoteLineEditor v-for="(key,i) in keys" :key="key" :ref="el => editors[key] = el as unknown as LineEditor | null" :model-value="lines[i] ?? null" :line-key="key" :index="i" :products="products" :regular-products="regularProducts" :quote-multiple="multiple" :organization="organization" :disabled="busy || submitting || conflicted || !!saved?.archivedAt" @update:model-value="lines[i] = $event" @pending="$event ? pending.add(key) : pending.delete(key)" @remove="removeLine(i)" @access-lost="invalidate()" /></div>
        <div class="mt-5 flex flex-wrap items-start justify-between gap-6">
          <button ref="addButton" type="button" class="button secondary" :disabled="busy || submitting || conflicted || !!saved?.archivedAt || catalogLoading || !!catalogError || keys.length >= 100" @click="add">+ Add line</button>
          <div class="text-right"><p class="text-gray-600">{{ partial ? 'Estimated List Quote Total' : 'List Quote Total' }}</p><p class="text-xl font-semibold">{{ listTotal }}</p><p class="mt-3 text-gray-600">{{ partial ? 'Estimated After Multiple' : 'After Multiple' }}</p><p class="text-3xl font-semibold">{{ total }}</p><p v-if="partial" class="mt-1 text-xs text-gray-500">Missing options excluded. Amounts may change as choices are added.</p></div>
        </div>
      </form>
      <ConfirmDialog :open="archiveOpen" title="Archive this quote?" confirm-label="Archive quote" :busy="archiveBusy" :error="archiveError" @cancel="archiveOpen = false; archiveError = ''" @confirm="changeArchiveState(true)">
        <p>“{{ saved?.title }}” will move out of the active quotes list. You can restore it later.</p>
        <p v-if="dirty" class="mt-2">Your unsaved changes will also be discarded.</p>
      </ConfirmDialog>
    </template>
  </ResourceState>
</template>
