import { ApiError } from '~/types/identity'
import type { ConfigurationDraft, FieldError, Principal, Taxonomy } from '~/types/taxonomy'
import { blankConfiguration, configurationInput, draftFingerprint, fromTaxonomy } from '~/utils/configuration'
export function useTaxonomyEditor() {
  const route = useRoute(), identity = useIdentity()
  const draft = ref<ConfigurationDraft>(blankConfiguration()), saved = shallowRef<Taxonomy | null>(null), choices = ref<Principal[]>([])
  const ready = ref(false)
  const loading = ref(true), busy = ref(false), failure = ref(''), notice = ref(''), errors = ref<FieldError[]>([]), conflicted = ref(false)
  const baseline = ref(draftFingerprint(draft.value))
  const organization = computed(() => identity.organizationId(route.params.orgId))
  const org = computed(() => identity.state.organizations.find(o => o.id === organization.value))
  const isNew = computed(() => !route.params.taxonomyId)
  const canEdit = computed(() => ready.value && !!org.value && ['admin', 'editor'].includes(org.value.role) && (isNew.value || !!saved.value?.permissions.canEdit))
  const dirty = computed(() => draftFingerprint(draft.value) !== baseline.value)
  const back = computed(() => `${identity.organizationPath(organization.value)}/settings/configurations`)
  let controller: AbortController | undefined, generation = 0
  function adopt(value: Taxonomy) {
    saved.value = value; draft.value = fromTaxonomy(value); baseline.value = draftFingerprint(draft.value)
  }
  async function load() {
    controller?.abort(); const c = new AbortController(); controller = c; const current = ++generation
    loading.value = true; ready.value = false; failure.value = ''; errors.value = []; conflicted.value = false
    try {
      if (isNew.value && !['admin', 'editor'].includes(org.value?.role || '')) throw new ApiError(403, 'FORBIDDEN', 'Your organization role cannot create configurations.')
      const [principals, result] = await Promise.all([
        loadPrincipalChoices(organization.value, c.signal),
        isNew.value ? Promise.resolve(null) : identity.request<{ taxonomy: Taxonomy }>(`/organizations/${organization.value}/taxonomies/${route.params.taxonomyId}`, { signal: c.signal }),
      ])
      if (c.signal.aborted || current !== generation) return
      choices.value = principals
      if (result) adopt(result.taxonomy)
      else { saved.value = null; draft.value = blankConfiguration(); baseline.value = draftFingerprint(draft.value) }
      ready.value = true
    } catch (e) {
      if (!c.signal.aborted && current === generation) { failure.value = (e as Error).message; saved.value = null; choices.value = [] }
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
    busy.value = true; const current = generation
    try {
      const result = await identity.request<{ taxonomy: Taxonomy; unchanged: boolean }>(`/organizations/${organization.value}/taxonomies${saved.value ? `/${saved.value.id}/versions` : ''}`, {
        method: 'POST', body: { principalId: draft.value.principalId, content: checked.content, ...(saved.value ? { expectedVersionId: saved.value.currentVersionId } : {}) },
      })
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
    } finally { busy.value = false }
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
    if (!role) { ready.value = false; controller?.abort(); generation++; saved.value = null; draft.value = blankConfiguration(); baseline.value = draftFingerprint(draft.value); choices.value = []; loading.value = false; failure.value = 'You no longer have access to this organization.' }
  })
  onBeforeUnmount(() => { controller?.abort(); generation++; window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('quotes:before-sign-out', beforeSignOut) })
  return { ready, draft, saved, choices, loading, busy, failure, notice, errors, conflicted, canEdit, dirty, back, load, reload, save }
}
