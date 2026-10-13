-- Apply after 0004 with API writes paused, one statement per transaction.
ALTER TABLE public.organizations ADD COLUMN address text;
ALTER TABLE public.organizations ADD COLUMN website_url text;
ALTER TABLE public.organizations ADD COLUMN email text;
ALTER TABLE public.organizations ADD COLUMN phone text;
ALTER TABLE public.organization_memberships DROP CONSTRAINT organization_memberships_role_check;
ALTER TABLE public.organization_memberships ALTER COLUMN role SET DEFAULT 'sales';
CREATE TABLE public.organization_domains (
    domain text PRIMARY KEY CHECK (domain = lower(btrim(domain)) AND domain <> ''),
    organization_id bigint NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT
);
CREATE INDEX ASYNC organization_domains_organization_idx ON public.organization_domains(organization_id);
CREATE TABLE public.platform_authorization_guard (
    id integer PRIMARY KEY CHECK (id = 1),
    auth_revision bigint NOT NULL DEFAULT 0
);
INSERT INTO public.platform_authorization_guard(id) VALUES(1);
ALTER TABLE public.identity_audit_events DROP CONSTRAINT identity_audit_events_entity_type_check;
ALTER TABLE public.identity_audit_events ADD CONSTRAINT identity_audit_events_entity_type_check CHECK (entity_type IN ('user','organization','membership','taxonomy')) NOT VALID;
ALTER TABLE ASYNC public.identity_audit_events VALIDATE CONSTRAINT identity_audit_events_entity_type_check;
