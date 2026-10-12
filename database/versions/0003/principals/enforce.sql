-- Run ONLY after mapping every existing taxonomy to a real principal.
-- For each legacy taxonomy, append an attributed snapshot and atomically advance
-- principal_id/current_version_id; never modify historical snapshots.
ALTER TABLE public.taxonomies ADD CONSTRAINT taxonomies_principal_required
    CHECK (principal_id IS NOT NULL) NOT VALID;
ALTER TABLE ASYNC public.taxonomies VALIDATE CONSTRAINT taxonomies_principal_required;
