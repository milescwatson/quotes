<script setup lang="ts">
import { useMutation, useQueryClient } from '@tanstack/vue-query'
import { queryKeys } from '~/utils/query-keys'
import type { Organization } from '~/types/identity'
const props = defineProps<{ organization: string; details: Organization }>()
const route = useRoute(),
  identity = useIdentity()
const queryClient = useQueryClient()
const name = ref('')
const { mutate, isPending: busy, isSuccess: saved, error } = useMutation({
  mutationFn: (value: { organization: string; name: string }) => identity.request(`/organizations/${value.organization}`, {
    method: 'PATCH', body: { name: value.name },
  }),
  onSuccess: async (_data, input) => {
    await identity.refresh()
    await queryClient.invalidateQueries({ queryKey: queryKeys.organization(identity.organizationId(input.organization)) })
  },
})
const failure = computed(() => error.value?.message || '')
watch(() => props.details, (value) => { name.value = value.name }, { immediate: true })
const save = () => mutate({ organization: String(route.params.orgId), name: name.value.trim() })
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
