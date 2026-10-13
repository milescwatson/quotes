CREATE TABLE public.taxonomy_organization_access (
    taxonomy_id bigint NOT NULL REFERENCES public.taxonomies(id) ON DELETE RESTRICT,
    organization_id bigint NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    PRIMARY KEY (taxonomy_id,organization_id)
);
CREATE INDEX ASYNC taxonomy_access_organization_idx ON public.taxonomy_organization_access(organization_id,taxonomy_id);
ALTER TABLE public.taxonomies ADD COLUMN auth_revision bigint;
ALTER TABLE public.taxonomies ALTER COLUMN auth_revision SET DEFAULT 0;
ALTER TABLE public.taxonomies ADD COLUMN sharing_revision bigint;
ALTER TABLE public.taxonomies ALTER COLUMN sharing_revision SET DEFAULT 0;
