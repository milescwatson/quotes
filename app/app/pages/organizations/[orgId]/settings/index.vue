<script setup lang="ts">
import { useMutation, useQueryClient } from '@tanstack/vue-query'
import { queryKeys } from '~/utils/query-keys'
import type { Organization } from '~/types/identity'
const props = defineProps<{ organization: string; details: Organization }>()
const identity = useIdentity(), queryClient = useQueryClient()
const form = reactive({ name: '', address: '', websiteUrl: '', email: '', phone: '' })
const { mutate, isPending: busy, isSuccess: saved, error } = useMutation({
  mutationFn: () => identity.request(`/organizations/${props.organization}`, { method: 'PATCH', body: Object.fromEntries(Object.entries(form).map(([key,value]) => [key,value.trim() || null])) }),
  onSuccess: async () => { await identity.refresh(); await queryClient.invalidateQueries({ queryKey: queryKeys.organization(identity.organizationId(props.organization)) }) },
})
watch(() => props.details, value => { Object.assign(form, { name:value.name,address:value.address || '',websiteUrl:value.websiteUrl || '',email:value.email || '',phone:value.phone || '' }) }, { immediate:true })
const domains = ref(''), domainFailure = ref(''), domainNotice = ref(''), domainBusy = ref(false), domainLoading = ref(!!identity.state.user?.isSuperAdministrator)
async function loadDomains() {
  if (!identity.state.user?.isSuperAdministrator) return
  domainFailure.value = ''; domainLoading.value = true
  try { const result = await identity.request<{domains:string[]}>(`/organizations/${props.organization}/domains`); domains.value=result.domains.join('\n') }
  catch(e) { domainFailure.value=(e as Error).message }
  finally { domainLoading.value=false }
}
async function saveDomains() {
  domainBusy.value=true; domainFailure.value=''; domainNotice.value=''
  try {
    const result=await identity.request<{domains:string[]}>(`/organizations/${props.organization}/domains`, {method:'PUT',body:{domains:domains.value.split(/[\n,]/).map(d=>d.trim()).filter(Boolean)}})
    domains.value=result.domains.join('\n');domainNotice.value='Email domains updated.'
  } catch(e) { domainFailure.value=(e as Error).message }
  finally { domainBusy.value=false }
}
onMounted(loadDomains)
watch(() => props.organization,loadDomains)
</script>
<template>
  <section class="panel form-panel">
    <h2>General Information</h2>
    <form @submit.prevent="mutate()">
      <label for="organization-name">Organization name</label><input id="organization-name" v-model="form.name" required maxlength="120">
      <label for="organization-address">Organization address</label><textarea id="organization-address" v-model="form.address" rows="3" maxlength="2000" class="w-full rounded border border-gray-300 p-2" />
      <label for="organization-website">Organization website</label><input id="organization-website" v-model="form.websiteUrl" type="url" maxlength="2048" placeholder="https://example.com">
      <label for="organization-email">Organization email address</label><input id="organization-email" v-model="form.email" type="email" maxlength="254">
      <label for="organization-phone">Organization phone</label><input id="organization-phone" v-model="form.phone" type="tel" maxlength="80">
      <p v-if="error" class="error" role="alert">{{ error.message }}</p><p v-if="saved" class="success" role="status">Organization updated.</p>
      <div class="form-actions"><button class="button primary" :disabled="busy || !form.name.trim()">{{ busy ? 'Saving…' : 'Save changes' }}</button></div>
    </form>
  </section>
  <section v-if="identity.state.user?.isSuperAdministrator" class="panel form-panel mt-6">
    <h2>Automatic enrollment domains</h2><p>Verified users with these exact email domains join as Sales when they sign in. Removed users regain Sales access at their next sign-in. Website changes do not change enrollment.</p>
    <form @submit.prevent="saveDomains"><label for="organization-domains">Email domains (one per line)</label><textarea id="organization-domains" v-model="domains" :disabled="domainBusy || domainLoading" rows="4" class="w-full rounded border border-gray-300 p-2" />
      <p v-if="domainFailure" class="error" role="alert">{{ domainFailure }} <button type="button" class="text-button" @click="loadDomains">Reload domains</button></p><p v-if="domainNotice" class="success" role="status">{{ domainNotice }}</p>
      <div class="form-actions"><button class="button primary" :disabled="domainBusy || domainLoading">{{ domainBusy ? 'Saving…' : 'Save domains' }}</button></div>
    </form>
  </section>
</template>
