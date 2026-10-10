<script setup lang="ts">
const props = defineProps<{
  open: boolean
  title: string
  confirmLabel?: string
  busy?: boolean
  error?: string
}>()
const emit = defineEmits<{ cancel: []; confirm: [] }>()
const dialog = ref<HTMLDialogElement>()
watch(
  () => props.open,
  async (open) => {
    await nextTick()
    if (open && !dialog.value?.open) dialog.value?.showModal()
    else if (!open) dialog.value?.close()
  },
)
onMounted(() => {
  if (props.open) dialog.value?.showModal()
})
</script>
<template>
  <dialog
    ref="dialog"
    aria-labelledby="dialog-title"
    @cancel.prevent="!busy && emit('cancel')"
  >
    <h2 id="dialog-title">{{ title }}</h2>
    <div class="dialog-content"><slot /></div>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <div class="dialog-actions">
      <button
        autofocus
        class="button secondary"
        :disabled="busy"
        @click="emit('cancel')"
      >
        Cancel</button
      ><button class="button danger" :disabled="busy" @click="emit('confirm')">
        {{ busy ? 'Saving…' : confirmLabel || 'Confirm' }}
      </button>
    </div>
  </dialog>
</template>
