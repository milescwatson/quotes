<script setup lang="ts">
const identity = useIdentity()
const error = ref('')
onMounted(async () => {
  try {
    const destination = await identity.complete()
    const orgs = identity.state.organizations
    await navigateTo(
      destination === '/organizations' && orgs.length === 1
        ? `${identity.organizationPath(orgs[0]!.id)}/quotes`
        : destination,
      { replace: true },
    )
  } catch (e) {
    error.value = (e as Error).message
  }
})
</script>
<template>
  <div class="initial-loading">
    <template v-if="error"
      ><h1>Sign-in couldn’t be completed</h1>
      <p role="alert">{{ error }}</p>
      <NuxtLink class="button primary" to="/login"
        >Try signing in again</NuxtLink
      ></template
    >
    <p v-else role="status">Signing you in…</p>
  </div>
</template>
