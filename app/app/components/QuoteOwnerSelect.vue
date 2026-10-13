<script setup lang="ts">
import { useMutation, useQueryClient } from '@tanstack/vue-query'
import { ApiError } from '~/types/identity'
import type { Quote, QuoteOwner } from '~/types/quotes'
import { queryKeys } from '~/utils/query-keys'
const props = defineProps<{ quote: Quote; owners: QuoteOwner[]; organizationId: string; disabled?: boolean }>()
const emit = defineEmits<{ saved: []; accessLost: [] }>()
const identity = useIdentity()
const queryClient = useQueryClient()
const selected = ref(props.quote.ownerId ?? '')
const error = ref('')
let controller: AbortController | undefined
const ownerMutation = useMutation({
  mutationFn: (input: { ownerId: string | null; signal: AbortSignal }) => identity.request(`/organizations/${props.organizationId}/quotes/${props.quote.id}`, {
    method: 'PATCH', body: { ownerId: input.ownerId }, signal: input.signal,
  }),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.quotes(identity.organizationId(props.organizationId)) }),
})
const saving = ownerMutation.isPending

watch(() => props.quote.ownerId, value => { selected.value = value ?? '' })
const unavailableOwner = computed(() => props.quote.ownerId && !props.owners.some(owner => owner.id === props.quote.ownerId))
async function save() {
  if (selected.value === (props.quote.ownerId ?? '')) return
  error.value = ''
  controller = new AbortController()
  try {
    await ownerMutation.mutateAsync({ ownerId: selected.value || null, signal: controller.signal })
    if (!controller.signal.aborted) emit('saved')
  } catch (cause) {
    if (!controller.signal.aborted) {
      selected.value = props.quote.ownerId ?? ''
      error.value = (cause as Error).message
      if (cause instanceof ApiError && [401, 403, 404].includes(cause.status)) emit('accessLost')
    }
  }
}
onBeforeUnmount(() => controller?.abort())
</script>

<template>
  <div>
    <select v-model="selected" :aria-label="`Owner for ${quote.title}`" :aria-describedby="error ? `owner-error-${quote.id}` : undefined" :disabled="saving || disabled" class="w-full min-w-40 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100" @change="save">
      <option value="">Unassigned</option>
      <option v-if="unavailableOwner" :value="quote.ownerId!" disabled>{{ quote.ownerName }} (unavailable)</option>
      <option v-for="owner in owners" :key="owner.id" :value="owner.id">{{ owner.name }}</option>
    </select>
    <p v-if="saving" class="mt-1 text-xs text-gray-500" role="status">Saving owner…</p>
    <p v-if="error" :id="`owner-error-${quote.id}`" class="mt-1 text-xs text-red-700" role="alert">{{ error }}</p>
  </div>
</template>
