<script setup lang="ts">
import { displayPrice } from '~/utils/configuration'
const { saved, customer, project, owner, lines, keys, pending, owners, products, back, organization, ready, loading, busy, error, catalogError, catalogLoading, notice, conflicted, errors, dirty, load, catalog, save, add, remove, reload, invalidate } = useQuoteEditor()
type LineEditor = { validate: () => boolean; done: () => Promise<boolean> }
const editors = ref<Record<string, LineEditor | null>>({}), submitting = ref(false), addButton = ref<HTMLButtonElement>()
const total = computed(() => {
  const amount = lines.value.reduce((sum,line) => sum + (line ? BigInt(line.lineTotal.replace('.','')) : 0n),0n)
  return displayPrice(`${amount / 100n}.${String(amount % 100n).padStart(2,'0')}`)
})
const partial = computed(() => lines.value.some(l => !l?.complete))
function fieldError(path: string) { return errors.value.find(e => e.path === path)?.message }
async function submit() {
  if (busy.value || submitting.value) return
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
</script>
<template>
  <ResourceState :loading="loading" :error="ready ? '' : error" @retry="load">
    <template v-if="ready">
      <PageHeading :title="saved ? 'Edit quote' : 'New quote'" :description="saved ? `Last modified by ${saved.modifiedByName} · ${new Date(saved.modifiedWhen).toLocaleString()}` : 'Choose products and options for your customer project.'">
        <NuxtLink :to="back" class="button secondary">Quotes</NuxtLink>
        <span class="text-xs text-gray-500" role="status">{{ dirty ? 'Unsaved changes' : saved ? 'Saved' : 'New quote' }}</span>
        <button class="button primary" :disabled="busy || submitting || conflicted" @click="submit">{{ busy ? 'Saving…' : 'Save' }}</button>
      </PageHeading>
      <p v-if="notice" class="success" role="status">{{ notice }}</p>
      <div v-if="error" class="error" role="alert"><p>{{ error }}</p><button v-if="conflicted" class="button secondary mt-2" @click="reload">Reload quote and catalog</button></div>
      <form @submit.prevent="submit">
        <fieldset :disabled="busy || submitting || conflicted" class="panel mb-6 grid min-w-0 gap-x-6 p-4 sm:grid-cols-3 sm:p-5">
          <div><label for="quote-customer" class="mt-0">Customer</label><input id="quote-customer" v-model="customer" maxlength="120" required :aria-invalid="!!fieldError('/customerName')" aria-describedby="customer-error" /><p v-if="fieldError('/customerName')" id="customer-error" class="mt-2 text-red-700" role="alert">{{ fieldError('/customerName') }}</p></div>
          <div><label for="quote-project" class="sm:mt-0">Project</label><input id="quote-project" v-model="project" maxlength="120" required :aria-invalid="!!fieldError('/projectName')" aria-describedby="project-error" /><p v-if="fieldError('/projectName')" id="project-error" class="mt-2 text-red-700" role="alert">{{ fieldError('/projectName') }}</p></div>
          <div><label for="quote-owner" class="sm:mt-0">Owner</label><select id="quote-owner" v-model="owner" class="w-full" :aria-invalid="!!fieldError('/ownerId')"><option :value="null">Unassigned</option><option v-if="owner && !owners.some(o => o.id === owner)" :value="owner" disabled>{{ saved?.ownerName || 'Unavailable owner' }}</option><option v-for="o in owners" :key="o.id" :value="o.id">{{ o.name }}</option></select><p v-if="fieldError('/ownerId')" class="text-red-700" role="alert">{{ fieldError('/ownerId') }}</p></div>
          <p class="mt-4 break-words text-gray-500 sm:col-span-3">{{ customer.trim() || 'Customer' }} - {{ project.trim() || 'Project' }}</p>
        </fieldset>
        <div v-if="catalogLoading" class="mb-4 text-gray-600" role="status">Loading product configurations…</div>
        <div v-else-if="catalogError" class="error" role="alert">{{ catalogError }} <button type="button" class="button secondary" @click="catalog()">Retry products</button></div>
        <p v-else-if="!products.length" class="panel mb-4 p-4">No product configurations are available. An administrator must create a product configuration first. You can still save quote details.</p>
        <h2 class="mb-4">Line items <span class="ml-2 text-sm font-normal text-gray-500">{{ keys.length }} lines</span></h2>
        <div class="space-y-4"><QuoteLineEditor v-for="(key,i) in keys" :key="key" :ref="el => editors[key] = el as unknown as LineEditor | null" :model-value="lines[i] ?? null" :line-key="key" :index="i" :products="products" :organization="organization" :disabled="busy || submitting || conflicted" @update:model-value="lines[i] = $event" @pending="$event ? pending.add(key) : pending.delete(key)" @remove="removeLine(i)" @access-lost="invalidate()" /></div>
        <div class="mt-5 flex flex-wrap items-start justify-between gap-6">
          <button ref="addButton" type="button" class="button secondary" :disabled="busy || submitting || conflicted || catalogLoading || !!catalogError || !products.length || keys.length >= 100" @click="add">+ Add line</button>
          <div class="text-right"><p class="text-gray-600">{{ partial ? 'Estimated quote total' : 'Quote total' }}</p><p class="text-3xl font-semibold">{{ total }}</p><p v-if="partial" class="mt-1 text-xs text-gray-500">Missing options excluded. Amounts may change as choices are added.</p></div>
        </div>
      </form>
    </template>
  </ResourceState>
</template>
