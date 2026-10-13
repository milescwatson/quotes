<script setup lang="ts">
const identity = useIdentity()
const ready = ref(false),
  error = ref('')
async function load() {
  ready.value = false
  error.value = ''
  try {
    await identity.refresh()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    ready.value = true
  }
}
onMounted(load)
</script>
<template>
  <PageHeading
    eyebrow="YOUR WORKSPACE"
    title="Organizations"
    description="Choose an organization to pick up where you left off."
    ></PageHeading
  ><ResourceState :loading="!ready" :error="error" @retry="load"
    ><section class="section-heading">
      <h2>
        Your organizations
        <span class="count">{{ identity.state.organizations.length }}</span>
      </h2>
      <span class="muted small">Your access is managed by each team</span>
    </section>
    <div v-if="identity.state.organizations.length" class="organization-grid">
      <NuxtLink
        v-for="org in identity.state.organizations"
        :key="org.id"
        :to="`${identity.organizationPath(org.id)}/quotes`"
        class="org-card"
        ><div class="org-card-top">
          <span class="badge">{{ org.role }}</span>
        </div>
        <h3>{{ org.name }}</h3>
        <p>
          {{
            org.role === 'administrator'
              ? 'Manage your team and workspace.'
              : org.role === 'sales'
                ? 'Shape your products with your team.'
                : 'Your team’s shared workspace.'
          }}
        </p>
        <div class="org-card-footer">
          Open workspace <span aria-hidden="true">→</span>
        </div></NuxtLink
      >
    </div>
    <div v-else class="panel empty-state">
      <div class="empty-icon">▦</div>
      <h2>No organizations yet.</h2>
      <p>
        Once an administrator adds you, your organization will appear here automatically.
        Share your account email with your team administrator.
      </p>

    </div>
    <div class="help-strip">
      <div>
        <strong>Working with another team?</strong>
        <p>
          An organization administrator can add you using your account email.
          You can belong to more than one organization.
        </p>
      </div>
    </div></ResourceState
  >
</template>
