<script setup lang="ts">
const identity = useIdentity()
const name = ref(identity.state.user?.displayName || ''),
  busy = ref(false),
  error = ref(''),
  saved = ref(false)
async function save() {
  busy.value = true
  error.value = ''
  saved.value = false
  try {
    const result = await identity.request<{
      user: import('~/types/identity').Profile
    }>('/me', {
      method: 'PATCH',
      body: { displayName: name.value.trim() || null },
    })
    identity.state.user = result.user
    saved.value = true
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <PageHeading
    eyebrow="YOUR ACCOUNT"
    title="Your profile"
    description="The details your teammates know you by."
  />
  <section class="panel form-panel">
    <h2>Personal information</h2>
    <form @submit.prevent="save">
      <label for="display-name">Display name</label
      ><input
        id="display-name"
        v-model="name"
        maxlength="120"
        autocomplete="name"
        placeholder="Your name"
      /><label for="profile-email">Email address</label
      ><input
        id="profile-email"
        :value="identity.state.user?.email"
        readonly
        type="email"
      />
      <p class="field-help">Your email is managed by your sign-in account.</p>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <p v-if="saved" class="success" role="status">
        Your profile has been updated.
      </p>
      <div class="form-actions">
        <button class="button primary" :disabled="busy">
          {{ busy ? 'Saving…' : 'Save changes' }}
        </button>
      </div>
    </form>
  </section>
  <section class="panel form-panel">
    <h2>Sign out</h2>
    <p class="muted">End your session on this device.</p>
    <button class="button secondary" @click="identity.signOut()">
      Sign out
    </button>
  </section>
</template>
