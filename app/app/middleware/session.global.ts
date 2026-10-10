export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server || to.path === '/auth/callback') return
  const identity = useIdentity()
  await identity.ensure()
  if (
    !identity.state.user &&
    to.path !== '/login' &&
    to.path !== '/'
  ) {
    return navigateTo({ path: '/login', query: { returnTo: to.fullPath } })
  }
  const reference = to.params.orgId
  if (identity.state.user && typeof reference === 'string') {
    const id = identity.organizationId(reference)
    const organization = identity.state.organizations.find(org => org.id === id)
    if (organization) {
      const canonical = identity.organizationPath(organization.id)
      const prefix = `/organizations/${reference}`
      const suffix = to.path.slice(prefix.length) || '/quotes'
      if (canonical !== prefix || !to.path.slice(prefix.length)) {
        return navigateTo({ path: canonical + suffix, query: to.query, hash: to.hash }, { replace: true })
      }
    }
  }
})
