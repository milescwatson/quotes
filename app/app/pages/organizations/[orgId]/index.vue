<script setup lang="ts">
const route = useRoute()
const identity = useIdentity()
onMounted(() => navigateTo({
  path: `${identity.organizationPath(identity.organizationId(route.params.orgId))}/quotes`,
  query: route.query,
  hash: route.hash,
}, { replace: true }))
</script>
<template>
  <div class="initial-loading" role="status">Opening quotes…</div>
</template>
