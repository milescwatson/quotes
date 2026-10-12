<script setup lang="ts">
import type { Organization } from '~/types/identity'
const props = defineProps<{ organization: string; details: Organization }>()
const route = useRoute(),
  identity = useIdentity()
const name = ref(''),
  busy = ref(false),
  failure = ref(''),
  saved = ref(false)
watch(() => props.details, (value) => { name.value = value.name }, { immediate: true })
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
  <section
      class="panel form-panel"
    >
      <h2>General Information</h2>
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
</template>
