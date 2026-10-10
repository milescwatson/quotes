<script setup lang="ts">
defineProps<{ eyebrow?: string; title: string; description?: string }>()
</script>
<template>
  <header class="page-heading">
    <div>
      <h1>{{ title }}</h1>
      <p v-if="description" class="subtitle">{{ description }}</p>
    </div>
    <div class="heading-actions"><slot /></div>
  </header>
</template>
