-- psql template; execute each statement separately on DSQL.
-- Dedicated non-owner roles must not inherit broader grants.
REVOKE ALL ON public.users, public.organizations, public.organization_memberships,
    public.identity_audit_events FROM PUBLIC;
REVOKE ALL ON public.users, public.organizations, public.organization_memberships,
    public.identity_audit_events FROM :"api_role", :"operator_role";
-- DSQL public is system-managed and already grants USAGE; explicit schema grants are unsupported.
GRANT SELECT ON public.users, public.organizations, public.organization_memberships TO :"api_role";
GRANT INSERT ON public.users, public.organization_memberships, public.identity_audit_events TO :"api_role";
GRANT UPDATE (email, normalized_email, display_name, updated_at, auth_revision) ON public.users TO :"api_role";
GRANT UPDATE (name, updated_at, auth_revision) ON public.organizations TO :"api_role";
GRANT UPDATE ON public.organization_memberships TO :"api_role";
GRANT SELECT, INSERT, UPDATE ON public.users, public.organizations, public.organization_memberships TO :"operator_role";
GRANT SELECT, INSERT ON public.identity_audit_events TO :"operator_role";
-- No runtime mutation/deletion of existing audit records or hard deletions.
