ALTER TABLE public.organization_memberships ADD CONSTRAINT organization_memberships_role_check CHECK (role IN ('sales','administrator')) NOT VALID;
ALTER TABLE ASYNC public.organization_memberships VALIDATE CONSTRAINT organization_memberships_role_check;
DROP INDEX public.organization_memberships_admin_idx;
CREATE INDEX ASYNC organization_memberships_admin_idx ON public.organization_memberships(organization_id,user_id) WHERE removed_at IS NULL AND role='administrator';
