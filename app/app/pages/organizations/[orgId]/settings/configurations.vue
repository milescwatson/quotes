<script setup lang="ts">
const route = useRoute(), identity = useIdentity()
await navigateTo({ path: `${identity.organizationPath(identity.organizationId(route.params.orgId))}/configurations`, query: route.query, hash: route.hash }, { replace: true })
</script>
<template><p role="status">Opening product configurations…</p></template>
