<script setup lang="ts">
const identity = useIdentity()
const route = useRoute()
const current = computed(() =>
  identity.state.organizations.find((org) => org.id === identity.organizationId(route.params.orgId)),
)
const open = ref(false)
const navigation = ref<HTMLElement>()
const trigger = ref<HTMLButtonElement>()
function dismiss(event: PointerEvent) {
  if (!navigation.value?.contains(event.target as Node)) open.value = false
}
function closeOnFocusOut(event: FocusEvent) {
  if (!navigation.value?.contains(event.relatedTarget as Node)) open.value = false
}
function closeWithEscape() {
  open.value = false
  trigger.value?.focus()
}
watch(() => route.fullPath, () => { open.value = false })
onMounted(() => document.addEventListener('pointerdown', dismiss))
onBeforeUnmount(() => document.removeEventListener('pointerdown', dismiss))
</script>

<template>
  <nav
    ref="navigation"
    aria-label="Organization navigation"
    class="relative min-w-0"
    @keydown.esc.stop.prevent="closeWithEscape"
    @focusout="closeOnFocusOut"
  >
    <button
      ref="trigger"
      type="button"
      aria-label="Switch organization"
      aria-controls="organization-navigation"
      :aria-expanded="open"
      class="flex min-h-10 max-w-36 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 sm:max-w-64"
      @click="open = !open"
    >
      <span class="truncate">{{ current?.name || 'Organizations' }}</span>
      <svg class="size-4 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden="true">
        <path d="m6 8 4 4 4-4" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>
    <div
      v-if="open"
      id="organization-navigation"
      class="absolute right-0 z-30 mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-md border border-gray-200 bg-white p-1 shadow-sm"
    >
      <ul class="max-h-72 overflow-y-auto">
        <li v-for="org in identity.state.organizations" :key="org.id">
          <NuxtLink
            :to="`${identity.organizationPath(org.id)}/quotes`"
            :aria-current="current?.id === org.id ? 'true' : undefined"
            class="block break-words rounded px-3 py-2 text-sm hover:bg-gray-100"
            :class="current?.id === org.id ? 'bg-gray-100 font-medium text-gray-900' : 'text-gray-700'"
            @click="open = false"
          >{{ org.name }}</NuxtLink>
        </li>
      </ul>
      <p v-if="!identity.state.organizations.length" class="px-3 py-2 text-sm text-gray-500">No organizations yet.</p>
      <NuxtLink to="/organizations" class="mt-1 block rounded border-t border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100" @click="open = false">
        View all organizations
      </NuxtLink>
    </div>
  </nav>
</template>
