<script setup lang="ts">
import type { PrincipalPage, FieldError } from '~/types/taxonomy'
import { ApiError } from '~/types/identity'
const props = defineProps<{ organization: string }>()
const identity = useIdentity()
const principals = useConfigurationList<PrincipalPage>(() => props.organization, 'principals')
const adding = ref(false), name = ref(''), website = ref(''), busy = ref(false), failure = ref(''), fields = ref<FieldError[]>([]), success = ref('')
async function add() {
  busy.value = true; failure.value = ''; fields.value = []; success.value = ''
  const org = props.organization
  try {
    await identity.request(`/organizations/${org}/principals`, { method: 'POST', body: { name: name.value, websiteUrl: website.value } })
    if (props.organization !== org) return
    adding.value = false; name.value = ''; website.value = ''; success.value = 'Principal added.'
    await principals.load(1)
  } catch (e) { if (props.organization === org) { failure.value = (e as Error).message; fields.value = e instanceof ApiError ? e.fieldErrors || [] : [] } }
  finally { busy.value = false }
}
const message = (path: string) => fields.value.find(f => f.path === path)?.message
</script>
<template>
  <section id="principals" class="panel p-4 sm:p-6" aria-labelledby="principals-title">
    <div class="section-heading"><h2 id="principals-title">Principals</h2><button class="button secondary" :disabled="busy" @click="adding = !adding">{{ adding ? 'Cancel' : 'Add principal' }}</button></div>
    <p class="text-gray-500">Shared across all organizations.</p>
    <form v-if="adding" class="my-4 max-w-lg" @submit.prevent="add"><fieldset :disabled="busy"><label for="principal-name">Principal name</label><input id="principal-name" v-model="name" required maxlength="120" :aria-invalid="!!message('/name')" aria-describedby="principal-name-error"><p id="principal-name-error" class="text-red-700">{{ message('/name') }}</p><label for="principal-website">Web address</label><input id="principal-website" v-model="website" required maxlength="2048" placeholder="example.com" :aria-invalid="!!message('/websiteUrl')" aria-describedby="principal-website-error"><p id="principal-website-error" class="text-red-700">{{ message('/websiteUrl') }}</p><p class="field-help">Names and root domains must be unique.</p><button class="button primary mt-4">{{ busy ? 'Adding…' : 'Create principal' }}</button></fieldset></form>
    <p v-if="failure" class="error" role="alert">{{ failure }}</p><p v-if="success" class="success" role="status">{{ success }}</p>
    <p v-if="principals.error.value" class="error" role="alert">{{ principals.error.value }} <button class="text-button" @click="principals.load()">Retry principals list</button></p>
    <p v-if="principals.loading.value && !principals.data.value" role="status">Loading principals…</p>
    <template v-if="principals.data.value"><p v-if="!principals.data.value.totalItems">No principals yet.</p><div v-else class="overflow-x-auto" role="region" aria-label="Principals table" tabindex="0"><table><thead><tr><th>Name</th><th>Website</th></tr></thead><tbody><tr v-for="p in principals.data.value.items" :key="p.id"><td>{{ p.name }}</td><td class="break-all"><a :href="p.websiteUrl" target="_blank" rel="noopener noreferrer" class="text-blue-600 hover:underline">{{ p.websiteUrl }}</a></td></tr></tbody></table></div><nav v-if="principals.data.value.totalPages" aria-label="Principals pagination" class="mt-4 flex flex-wrap items-center justify-between gap-3"><span>Page {{ principals.data.value.page }} of {{ principals.data.value.totalPages }}</span><div class="flex gap-2"><button class="button secondary" :disabled="principals.loading.value || principals.data.value.page <= 1" @click="principals.load(principals.data.value.page - 1)">Previous</button><button class="button secondary" :disabled="principals.loading.value || principals.data.value.page >= principals.data.value.totalPages" @click="principals.load(principals.data.value.page + 1)">Next</button></div></nav></template>
  </section>
</template>
