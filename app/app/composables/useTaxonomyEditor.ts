import { ApiError } from '~/types/identity'
import type { ConfigurationDraft, FieldError, Principal, Taxonomy } from '~/types/taxonomy'
import { blankConfiguration, configurationInput, draftFingerprint, fromTaxonomy } from '~/utils/configuration'
import { useMutation, useQueryClient } from '@tanstack/vue-query'
import { queryKeys } from '~/utils/query-keys'
import { principalChoicesOptions } from '~/composables/useConfigurationList'
export function useTaxonomyEditor() {
  const route = useRoute(), identity = useIdentity()
  const queryClient = useQueryClient()
  const draft = ref<ConfigurationDraft>(blankConfiguration()), saved = shallowRef<Taxonomy | null>(null), choices = ref<Principal[]>([])
  const ready = ref(false)
  const loading = ref(true), failure = ref(''), notice = ref(''), errors = ref<FieldError[]>([]), conflicted = ref(false)
  const baseline = ref(draftFingerprint(draft.value))
  const organization = computed(() => identity.organizationId(route.params.orgId))
  const org = computed(() => identity.state.organizations.find(o => o.id === organization.value))
  const isNew = computed(() => !route.params.taxonomyId)
  const canEdit = computed(() => ready.value && !!org.value && ['administrator', 'sales'].includes(org.value.role) && (isNew.value || !!saved.value?.permissions.canEdit))
  const dirty = computed(() => draftFingerprint(draft.value) !== baseline.value)
  const back = computed(() => `${identity.organizationPath(organization.value)}/configurations`)
  let generation = 0
  const saveMutation = useMutation({
    mutationFn: (input: { organization: string; taxonomyId: string | null; body: Record<string, unknown> }) => identity.request<{ taxonomy: Taxonomy; unchanged: boolean }>(`/organizations/${input.organization}/taxonomies${input.taxonomyId ? `/${input.taxonomyId}/versions` : ''}`, { method: 'POST', body: input.body }),
    onSuccess: async (result, input) => {
      queryClient.setQueryData(queryKeys.taxonomy(input.organization, result.taxonomy.id), { taxonomy: result.taxonomy })
      await queryClient.invalidateQueries({ queryKey: queryKeys.taxonomies(input.organization) })
    },
  })
  const busy = saveMutation.isPending
  function adopt(value: Taxonomy) {
    saved.value = value; draft.value = fromTaxonomy(value); baseline.value = draftFingerprint(draft.value)
  }
  async function load() {
    const current = ++generation
    loading.value = true; ready.value = false; failure.value = ''; errors.value = []; conflicted.value = false
    const orgId = organization.value
    const detailId = String(route.params.taxonomyId || '')
    try {
      if (isNew.value && !['administrator', 'sales'].includes(org.value?.role || '')) throw new ApiError(403, 'FORBIDDEN', 'Your organization role cannot create configurations.')
      const detailKey = isNew.value ? null : queryKeys.taxonomy(orgId, detailId)
      const [principals, result] = await Promise.all([
        queryClient.fetchQuery(principalChoicesOptions(orgId, identity)),
        detailKey ? queryClient.fetchQuery({ queryKey: detailKey, staleTime: 0, queryFn: ({ signal }) => identity.request<{ taxonomy: Taxonomy }>(`/organizations/${orgId}/taxonomies/${detailId}`, { signal }) }) : Promise.resolve(null),
      ])
      if (current !== generation) return
      choices.value = principals
      if (result) adopt(result.taxonomy)
      else { saved.value = null; draft.value = blankConfiguration(); baseline.value = draftFingerprint(draft.value) }
      ready.value = true
    } catch (e) {
      if (current === generation) { failure.value = (e as Error).message; saved.value = null; choices.value = [] }
    } finally { if (current === generation) loading.value = false }
  }
  async function focusError() {
    await nextTick()
    document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }
  async function save() {
    if (!canEdit.value || busy.value || loading.value || conflicted.value) return
    errors.value = []; failure.value = ''; notice.value = ''
    const checked = configurationInput(draft.value)
    errors.value = checked.errors
    if (errors.value.length) { await focusError(); return }
    const current = generation
    try {
      const result = await saveMutation.mutateAsync({ organization: organization.value, taxonomyId: saved.value?.id ?? null, body: { principalId: draft.value.principalId, content: checked.content, ...(saved.value ? { expectedVersionId: saved.value.currentVersionId } : {}) } })
      if (current !== generation) return
      const created = !saved.value
      adopt(result.taxonomy)
      notice.value = result.unchanged ? 'No content changes.' : 'Configuration saved.'
      if (created) await navigateTo(`${identity.organizationPath(organization.value)}/taxonomies/${result.taxonomy.id}`, { replace: true })
    } catch (e) {
      if (current !== generation) return
      failure.value = (e as Error).message
      if (e instanceof ApiError) {
        errors.value = e.fieldErrors || []
        conflicted.value = ['VERSION_CONFLICT', 'CONCURRENT_CHANGE', 'TAXONOMY_ARCHIVED'].includes(e.code)
        if ([401, 403, 404].includes(e.status)) { ready.value = false; saved.value = null; draft.value = blankConfiguration(); choices.value = []; baseline.value = draftFingerprint(draft.value) }
      }
      await focusError()
    }
  }
  function reload() { if (!dirty.value || window.confirm('Discard unsaved changes and reload?')) void load() }
  function mayLeave() { return !identity.state.user || !dirty.value || window.confirm('Leave without saving your configuration changes?') }
  function beforeUnload(e: BeforeUnloadEvent) { if (dirty.value) { e.preventDefault(); e.returnValue = '' } }
  function beforeSignOut(e: Event) { if (!mayLeave()) e.preventDefault() }
  onBeforeRouteLeave(mayLeave)
  onBeforeRouteUpdate(mayLeave)
  onMounted(() => { void load(); window.addEventListener('beforeunload', beforeUnload); window.addEventListener('quotes:before-sign-out', beforeSignOut) })
  watch(() => route.fullPath, () => { notice.value = ''; void load() })
  watch(() => org.value?.role, (role) => {
    if (!role) { ready.value = false; generation++; saved.value = null; draft.value = blankConfiguration(); baseline.value = draftFingerprint(draft.value); choices.value = []; loading.value = false; failure.value = 'You no longer have access to this organization.' }
  })
  onBeforeUnmount(() => { generation++; window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('quotes:before-sign-out', beforeSignOut) })
  return { ready, draft, saved, choices, loading, busy, failure, notice, errors, conflicted, canEdit, dirty, back, load, reload, save }
}
