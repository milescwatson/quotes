<script setup lang="ts">
import { displayPrice } from '~/utils/configuration'

const model = defineModel<string>({ required: true })
const focused = ref(false)
function focus(event: FocusEvent) {
  const input = event.target as HTMLInputElement
  input.value = model.value
  input.select()
  focused.value = true
}
</script>

<template>
  <input
    :value="focused ? model : displayPrice(model)"
    inputmode="decimal"
    @focus="focus"
    @input="model = ($event.target as HTMLInputElement).value"
    @blur="focused = false"
  >
</template>
