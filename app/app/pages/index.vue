<script setup lang="ts">
onMounted(async () => {
  const identity = useIdentity()
  await identity.ensure()
  const organization = identity.state.organizations[0]
  await navigateTo(identity.state.user
    ? organization ? `${identity.organizationPath(organization.id)}/quotes` : '/organizations'
    : '/login', {
    replace: true,
  })
})
</script>
<template>
  <div class="initial-loading" role="status">Opening your workspace…</div>
</template>
