<script setup lang="ts">
import type { Member, Page, Role } from '~/types/identity'
const route = useRoute(),
  identity = useIdentity(),
  cursor = ref('')
const { data, loading, error, load } = useResource<Page<Member>>(
  () =>
    `/organizations/${route.params.orgId}/members${cursor.value ? `?cursor=${encodeURIComponent(cursor.value)}` : ''}`,
)
const selected = ref<Member | null>(null),
  action = ref<'remove' | 'role'>('remove'),
  role = ref<Role>('member'),
  busy = ref(false),
  failure = ref(''),
  success = ref('')
const email = ref(''),
  newRole = ref<Role>('member'),
  adding = ref(false),
  addError = ref('')
const isAdmin = computed(
  () =>
    identity.state.organizations.find((o) => o.id === identity.organizationId(route.params.orgId))
      ?.role === 'admin',
)
async function addMember() {
  adding.value = true
  addError.value = ''
  success.value = ''
  try {
    await identity.request(`/organizations/${route.params.orgId}/members`, {
      method: 'POST',
      body: { email: email.value.trim(), role: newRole.value },
    })
    success.value = `${email.value.trim()} now has access to this organization.`
    email.value = ''
    newRole.value = 'member'
    cursor.value = ''
    await load()
  } catch (e) {
    addError.value = (e as Error).message
  } finally {
    adding.value = false
  }
}
function open(member: Member, operation: 'remove' | 'role') {
  selected.value = member
  action.value = operation
  role.value = member.role
  failure.value = ''
}
async function confirm() {
  busy.value = true
  failure.value = ''
  try {
    await identity.request(
      `/organizations/${route.params.orgId}/members/${selected.value!.id}`,
      {
        method: action.value === 'remove' ? 'DELETE' : 'PATCH',
        body: action.value === 'role' ? { role: role.value } : undefined,
      },
    )
    selected.value = null
    success.value = 'Team membership updated.'
    await identity.refresh()
    if (
      identity.state.organizations.find((o) => o.id === identity.organizationId(route.params.orgId))
        ?.role !== 'admin'
    )
      await navigateTo('/organizations')
    else await load()
  } catch (e) {
    failure.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <PageHeading
    eyebrow="WORKSPACE / TEAM"
    title="Good people. Great work."
    description="Manage the people who make this workspace yours."
  />
  <section v-if="isAdmin" class="panel member-form">
    <h2>Add a teammate</h2>
    <form @submit.prevent="addMember">
      <div>
        <label for="add-email">Email address</label>
        <input
          id="add-email"
          v-model="email"
          type="email"
          maxlength="254"
          required
          :disabled="adding"
        />
      </div>
      <div>
        <label for="add-role">Access role</label>
        <select id="add-role" v-model="newRole" :disabled="adding">
          <option value="member">Member</option>
          <option value="editor">Editor</option>
          <option value="admin">Admin</option>
        </select>
      </div>
      <button class="button primary" :disabled="adding">
        {{ adding ? 'Adding…' : 'Add member' }}
      </button>
    </form>
    <p class="muted small">
      Use the email of an existing account. Your teammate must sign in once
      before you add them. Access takes effect immediately.
    </p>
    <p v-if="addError" class="error" role="alert">{{ addError }}</p>
  </section>
  <p v-if="success" class="success" role="status">{{ success }}</p>
  <ResourceState :loading="loading" :error="error" @retry="load"
    ><section class="panel table-panel">
      <div class="panel-heading">
        <h2>Team members</h2>
        <span class="muted small">Access is specific to this organization</span>
      </div>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Member</th>
              <th>Role</th>
              <th class="align-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="member in data?.items" :key="member.id">
              <td>
                <div class="person">
                  <span class="avatar">{{
                    (member.displayName || member.email)
                      .slice(0, 2)
                      .toUpperCase()
                  }}</span>
                  <div>
                    <strong
                      >{{ member.displayName || member.email }}
                      <small
                        v-if="member.userId === identity.state.user?.id"
                        class="muted"
                        >(you)</small
                      ></strong
                    ><small>{{ member.email }}</small>
                  </div>
                </div>
              </td>
              <td>
                <span class="badge">{{ member.role }}</span>
              </td>
              <td class="align-right row-actions">
                <button
                  class="text-button"
                  :aria-label="`Change role for ${member.displayName || member.email}`"
                  @click="open(member, 'role')"
                >
                  Change role</button
                ><button
                  class="text-button danger-text"
                  :aria-label="`Remove ${member.displayName || member.email}`"
                  @click="open(member, 'remove')"
                >
                  Remove
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="!data?.items.length" class="empty-inline">
        No team members to display.
      </p>
    </section>
    <div v-if="cursor || data?.nextCursor" class="pagination">
      <button v-if="cursor" class="button secondary" @click="cursor = ''">
        First page</button
      ><button
        v-if="data?.nextCursor"
        class="button secondary"
        @click="cursor = data.nextCursor"
      >
        Next page
      </button>
    </div>
    <div class="role-guide">
      <div>
        <strong>Admin</strong>
        <p>Manages the team, workspace, and products.</p>
      </div>
      <div>
        <strong>Editor</strong>
        <p>Edits product taxonomies and creates quotes.</p>
      </div>
      <div>
        <strong>Member</strong>
        <p>Configures products and creates quotes.</p>
      </div>
    </div></ResourceState
  ><ConfirmDialog
    :open="!!selected"
    :title="action === 'remove' ? 'Remove team member?' : 'Change member role'"
    :confirm-label="action === 'remove' ? 'Remove member' : 'Save role'"
    :busy="busy"
    :error="failure"
    @cancel="selected = null"
    @confirm="confirm"
    ><p v-if="action === 'remove'">
      {{ selected?.displayName || selected?.email }} will lose access to this
      organization. Their previous work will be retained.
    </p>
    <template v-else
      ><p>
        Choose the access level for
        {{ selected?.displayName || selected?.email }}.
      </p>
      <label for="member-role">Role</label
      ><select id="member-role" v-model="role">
        <option value="admin">Admin</option>
        <option value="editor">Editor</option>
        <option value="member">Member</option>
      </select></template
    ></ConfirmDialog
  >
</template>
