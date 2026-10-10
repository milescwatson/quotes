<script setup lang="ts">
defineProps<{ loading: boolean; error: string }>()
defineEmits<{ retry: [] }>()
</script>
<template>
  <div v-if="loading" class="panel status-panel" role="status">
    <span class="spinner" /> Loading your workspace…
  </div>
  <div v-else-if="error" class="panel status-panel" role="alert">
    <h2>We couldn’t load this page</h2>
    <p>{{ error }}</p>
    <button class="button secondary" @click="$emit('retry')">Try again</button>
  </div>
  <slot v-else />
</template>
