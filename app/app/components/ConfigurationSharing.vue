<script setup lang="ts">
import type { Taxonomy } from '~/types/taxonomy'
import { queryKeys } from '~/utils/query-keys'
import { useQueryClient } from '@tanstack/vue-query'
const props = defineProps<{ taxonomy:Taxonomy; organization:string }>()
const identity=useIdentity(), client=useQueryClient(), selected=ref<string[]>([]), revision=ref(''), busy=ref(false), failure=ref(''), notice=ref('')
const recipients=computed(()=>identity.state.organizations.filter(o=>o.id!==props.taxonomy.ownerOrganizationId))
async function load() {
  failure.value='';revision.value=''
  try { const value=await identity.request<{organizationIds:string[];revision:string}>(`/organizations/${props.organization}/taxonomies/${props.taxonomy.id}/sharing`);selected.value=value.organizationIds;revision.value=value.revision }
  catch(e) { failure.value=(e as Error).message }
}
async function save() {
  busy.value=true;failure.value='';notice.value=''
  try {
    const value=await identity.request<{organizationIds:string[];revision:string}>(`/organizations/${props.organization}/taxonomies/${props.taxonomy.id}/sharing`,{method:'PUT',body:{organizationIds:selected.value,expectedRevision:revision.value}})
    selected.value=value.organizationIds;revision.value=value.revision;notice.value='Configuration sharing updated.'
    await client.invalidateQueries({queryKey:queryKeys.organizations})
  } catch(e) { failure.value=(e as Error).message }
  finally { busy.value=false }
}
onMounted(load)
watch(()=>`${props.organization}:${props.taxonomy.id}`,load)
</script>
<template>
  <section class="panel mb-6 mt-6 p-4 sm:p-6" aria-labelledby="sharing-title"><h2 id="sharing-title">Organization access</h2><p>Selected organizations can use this configuration in quotes. Only the owning organization can edit it.</p>
    <form @submit.prevent="save"><fieldset :disabled="busy || !revision" class="max-h-72 overflow-y-auto"><legend class="sr-only">Organizations with access</legend><label v-for="org in recipients" :key="org.id" class="flex items-center gap-3"><input v-model="selected" type="checkbox" :value="org.id" class="!w-auto">{{ org.name }}</label></fieldset>
      <p v-if="!recipients.length">No other active organizations.</p><p v-if="failure" class="error" role="alert">{{ failure }} <button type="button" class="text-button" @click="load">Reload sharing</button></p><p v-if="notice" class="success" role="status">{{ notice }}</p>
      <div class="form-actions"><button class="button primary" :disabled="busy || !revision">{{ busy ? 'Saving…' : 'Save organization access' }}</button></div>
    </form>
  </section>
</template>
