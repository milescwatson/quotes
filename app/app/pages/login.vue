<script setup lang="ts">
import { safeDestination } from '~/types/identity'
const identity = useIdentity(),
  route = useRoute()
const busy = ref(false),
  error = ref('')
async function signIn() {
  busy.value = true
  error.value = ''
  try {
    await identity.signIn(safeDestination(route.query.returnTo))
  } catch (e) {
    error.value = (e as Error).message
    busy.value = false
  }
}
onMounted(async () => {
  await identity.ensure()
  if (identity.state.user)
    await navigateTo(safeDestination(route.query.returnTo))
})
</script>
<template>
  <main class="flex min-h-screen items-center justify-center p-4">
    <section class="w-full max-w-sm rounded-md border border-gray-200 bg-white p-6">
      <NuxtLink class="text-lg font-semibold" to="/">Quotes</NuxtLink>
      <h1 class="mt-6">Sign in</h1>
      <p class="mb-6 mt-2 text-gray-600">Sign in to view quotes and work with your team.</p>
      <p v-if="error || identity.state.error" class="error" role="alert">{{ error || identity.state.error }}</p>
      <button class="button primary full-width" :disabled="busy" @click="signIn">
        {{ busy ? 'Connecting…' : identity.state.fixture ? 'Open demo workspace' : 'Continue to sign in' }}
      </button>
      <p class="mt-4 text-sm text-gray-600">You can create an account on the sign-in page. Share your account email with an organization administrator so they can add you.</p>
    </section>
  </main>
</template>
