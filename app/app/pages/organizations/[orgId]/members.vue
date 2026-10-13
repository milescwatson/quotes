<script setup lang="ts">
import { useMutation, useQueryClient } from '@tanstack/vue-query'
import type { Member, Page, Role } from '~/types/identity'
import { queryKeys } from '~/utils/query-keys'
const route = useRoute(),
  identity = useIdentity(),
  queryClient = useQueryClient(),
  cursor = ref('')
const { data, loading, error, load } = useResource<Page<Member>>(
  () =>
    `/organizations/${route.params.orgId}/members${cursor.value ? `?cursor=${encodeURIComponent(cursor.value)}` : ''}`,
  () => true,
  () => queryKeys.memberPage(identity.organizationId(route.params.orgId), cursor.value),
)
const selected = ref<Member | null>(null),
  action = ref<'remove' | 'role' | 'name'>('remove'),
  role = ref<Role>('sales'),
  failure = ref(''),
  success = ref('')
const displayName = ref('')
const email = ref(''),
  newRole = ref<Role>('sales'),
  addError = ref('')
const isAdmin = computed(
  () =>
    identity.state.organizations.find((o) => o.id === identity.organizationId(route.params.orgId))
      ?.role === 'administrator',
)
const memberMutation = useMutation({
  mutationFn: (input: { organization: string; operation: 'add' | 'remove' | 'role' | 'name'; displayName?: string; memberId?: string; role?: Role; email?: string }) => {
    if (input.operation === 'add') return identity.request(`/organizations/${input.organization}/members`, {
      method: 'POST', body: { email: input.email, role: input.role },
    })
    return identity.request(`/organizations/${input.organization}/members/${input.memberId}`, {
      method: input.operation === 'remove' ? 'DELETE' : 'PATCH',
      body: input.operation === 'role' ? { role: input.role } : input.operation === 'name' ? { displayName: input.displayName || null } : undefined,
    })
  },
  onSuccess: (_data, input) => Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.members(identity.organizationId(input.organization)), refetchType: 'none' }),
    queryClient.invalidateQueries({ queryKey: queryKeys.quoteOwners(identity.organizationId(input.organization)) }),
  ]),
})
const adding = computed(() => memberMutation.isPending.value && memberMutation.variables.value?.operation === 'add')
const busy = computed(() => memberMutation.isPending.value && memberMutation.variables.value?.operation !== 'add')
async function addMember() {
  addError.value = ''
  success.value = ''
  try {
    await memberMutation.mutateAsync({ organization: String(route.params.orgId), operation: 'add', email: email.value.trim(), role: newRole.value })
    success.value = `${email.value.trim()} now has access to this organization.`
    email.value = ''
    newRole.value = 'sales'
    cursor.value = ''
    await load()
  } catch (e) {
    addError.value = (e as Error).message
  }
}
function open(member: Member, operation: 'remove' | 'role' | 'name') {
  selected.value = member
  action.value = operation
  role.value = member.role
  displayName.value = member.displayName || ''
  failure.value = ''
}
async function confirm() {
  failure.value = ''
  try {
    await memberMutation.mutateAsync({ organization: String(route.params.orgId), operation: action.value, memberId: selected.value!.id, role: role.value, displayName: displayName.value.trim() })
    selected.value = null
    success.value = 'Team membership updated.'
    await identity.refresh()
    if (
      identity.state.organizations.find((o) => o.id === identity.organizationId(route.params.orgId))
        ?.role === undefined
    )
      await navigateTo('/organizations')
    else await load()
  } catch (e) {
    failure.value = (e as Error).message
  }
}
</script>
<template>
  <PageHeading
    eyebrow="WORKSPACE / TEAM"
    title="Team"
    description="Manage the people who make this workspace yours."
  />
  <section class="panel member-form">
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
      <div v-if="isAdmin">
        <label for="add-role">Access role</label>
        <select id="add-role" v-model="newRole" :disabled="adding">
          <option value="sales">Sales</option>
          <option value="administrator">Administrator</option>
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
  <p v-if="failure && !selected" class="error" role="alert">{{ failure }}</p>
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
              <th v-if="isAdmin" class="align-right">Actions</th>
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
                <span class="badge">{{ member.role === 'administrator' ? 'Administrator' : 'Sales' }}</span><span v-if="member.isSuperAdministrator" class="badge">Super Administrator</span>
              </td>
              <td v-if="isAdmin" class="align-right row-actions">
                <button class="text-button" :aria-label="`Edit name for ${member.displayName || member.email}`" @click="open(member, 'name')">Edit name</button>
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
      <div><strong>Sales</strong><p>Manages owned product configurations and quotes, and adds Sales teammates.</p></div>
      <div><strong>Administrator</strong><p>Also manages company details, teammate names, roles, and membership.</p></div>
      <div><strong>Super Administrator</strong><p>Accesses all organizations and manages configuration sharing and enrollment domains.</p></div>
    </div></ResourceState
  ><ConfirmDialog
    :open="!!selected"
    :title="action === 'remove' ? 'Remove team member?' : action === 'name' ? 'Edit teammate name' : 'Change member role'"
    :confirm-label="action === 'remove' ? 'Remove member' : action === 'role' ? 'Save role' : 'Save name'"
    :busy="busy"
    :error="failure"
    @cancel="selected = null"
    @confirm="confirm"
    ><p v-if="action === 'remove'">
      {{ selected?.displayName || selected?.email }} will lose access to this
      organization. Their previous work will be retained. Users with a work email domain assigned to this organization will regain Sales access the next time they sign in.
    </p>
    <template v-else-if="action === 'name'"><label for="teammate-name">Display name</label><input id="teammate-name" v-model="displayName" maxlength="120"><p>This changes their profile name in every organization.</p></template>
    <template v-else
      ><p>
        Choose the access level for
        {{ selected?.displayName || selected?.email }}.
      </p>
      <label for="member-role">Role</label
      ><select id="member-role" v-model="role">
        <option value="administrator">Administrator</option>
        <option value="sales">Sales</option>
      </select></template
    ></ConfirmDialog
  >
</template>
