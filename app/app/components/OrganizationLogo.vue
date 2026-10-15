<script setup lang="ts">
import { useQueryClient } from '@tanstack/vue-query'
import { queryKeys } from '~/utils/query-keys'
const props = defineProps<{ organization: string; version: string | null }>()
const identity = useIdentity(), queryClient = useQueryClient()
const file = ref<File | null>(null), input = ref<HTMLInputElement | null>(null)
const preview = ref(''), busy = ref(false), loading = ref(false), failure = ref(''), notice = ref('')
let generation = 0
function release() { if (preview.value) URL.revokeObjectURL(preview.value); preview.value = '' }
async function load() {
  const current = ++generation
  release(); failure.value = ''; loading.value = !!props.version
  if (!props.version) return
  try {
    const image = await identity.request<Blob>(`/organizations/${props.organization}/logo`, { responseType: 'image' })
    if (generation === current) preview.value = URL.createObjectURL(image)
  } catch (error) { if (generation === current) failure.value = (error as Error).message }
  finally { if (generation === current) loading.value = false }
}
watch(() => [props.organization, props.version], load, { immediate: true })
onBeforeUnmount(() => { generation++; release() })
function select(event: Event) {
  file.value = (event.target as HTMLInputElement).files?.[0] ?? null
  failure.value = ''; notice.value = ''
  if (file.value && (!['image/png', 'image/jpeg'].includes(file.value.type) || file.value.size > 2 * 1024 * 1024)) {
    failure.value = 'Choose a PNG or JPEG image up to 2 MiB.'
    file.value = null
    if (input.value) input.value.value = ''
  }
}
async function save(remove = false) {
  if (!remove && !file.value) return
  busy.value = true; failure.value = ''; notice.value = ''
  try {
    let imageBase64: string | undefined
    if (!remove) {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result).split(',')[1]!)
        reader.onerror = () => reject(new Error('Could not read the image. Please select it again.'))
        reader.readAsDataURL(file.value!)
      })
      imageBase64 = data
    }
    await identity.request(`/organizations/${props.organization}/logo`, { method: remove ? 'DELETE' : 'PUT', ...(!remove ? { body: { imageBase64 } } : {}) })
    file.value = null
    if (input.value) input.value.value = ''
    await queryClient.invalidateQueries({ queryKey: queryKeys.organization(identity.organizationId(props.organization)) })
    notice.value = remove ? 'Logo removed.' : 'Logo uploaded.'
  } catch (error) { failure.value = (error as Error).message }
  finally { busy.value = false }
}
</script>
<template>
  <section class="panel form-panel mt-6" aria-labelledby="organization-logo-heading">
    <h2 id="organization-logo-heading">Logo</h2>
    <p>Your logo appears on newly generated quote PDFs. Use a PNG or JPEG up to 2 MiB.</p>
    <p v-if="loading" role="status">Loading logo…</p>
    <img v-if="preview" :src="preview" alt="Current organization logo" class="my-4 max-h-36 max-w-full object-contain object-left">
    <p v-else-if="!version">No logo uploaded.</p>
    <form @submit.prevent="save()">
      <label for="organization-logo">Logo image</label>
      <input id="organization-logo" ref="input" type="file" accept="image/png,image/jpeg" :disabled="busy" @change="select">
      <p v-if="failure" class="error" role="alert">{{ failure }} <button v-if="version && !preview" type="button" class="text-button" :disabled="busy || loading" @click="load">Reload logo</button></p>
      <p v-if="notice" class="success" role="status">{{ notice }}</p>
      <div class="form-actions">
        <button class="button primary" :disabled="busy || !file">{{ busy ? 'Saving…' : version ? 'Replace logo' : 'Upload logo' }}</button>
        <button v-if="version" type="button" class="button" :disabled="busy" @click="save(true)">Remove logo</button>
      </div>
    </form>
  </section>
</template>
