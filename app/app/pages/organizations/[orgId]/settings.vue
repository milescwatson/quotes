<script setup lang="ts">
import type { Organization } from '~/types/identity'
const route = useRoute(),
  identity = useIdentity()
const { data, loading, error, load } = useResource<{
  organization: Organization
}>(() => `/organizations/${route.params.orgId}`)
const name = ref(''),
  busy = ref(false),
  failure = ref(''),
  saved = ref(false)
watch(data, (value) => {
  if (value) name.value = value.organization.name
})
async function save() {
  busy.value = true
  failure.value = ''
  saved.value = false
  try {
    await identity.request(`/organizations/${route.params.orgId}`, {
      method: 'PATCH',
      body: { name: name.value.trim() },
    })
    await identity.refresh()
    saved.value = true
  } catch (e) {
    failure.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <PageHeading
    eyebrow="WORKSPACE"
    title="Organization settings"
    description="The essentials that make this workspace yours."
  /><ResourceState :loading="loading" :error="error" @retry="load"
    ><section
      v-if="data?.organization.role === 'admin'"
      class="panel form-panel"
    >
      <h2>General information</h2>
      <form @submit.prevent="save">
        <label for="organization-name">Organization name</label
        ><input
          id="organization-name"
          v-model="name"
          required
          maxlength="120"
        />
        <p v-if="failure" class="error" role="alert">{{ failure }}</p>
        <p v-if="saved" class="success" role="status">Organization updated.</p>
        <div class="form-actions">
          <button class="button primary" :disabled="busy || !name.trim()">
            {{ busy ? 'Saving…' : 'Save changes' }}
          </button>
        </div>
      </form>
    </section>
    <section v-else class="panel empty-state">
      <h2>Administrator access required</h2>
      <p>Only your organization’s administrators can change these settings.</p>
    </section></ResourceState
  >
</template>
