-- psql template; execute each statement separately after schema/index validation.
-- Dedicated non-owner roles; apply identity grants first. No inherited broad grants.
REVOKE ALL ON public.taxonomies, public.taxonomy_versions FROM PUBLIC;
REVOKE ALL ON public.taxonomies, public.taxonomy_versions FROM :"api_role", :"operator_role";
-- DSQL public is system-managed and already grants USAGE; explicit schema grants are unsupported.
GRANT SELECT, INSERT ON public.taxonomies, public.taxonomy_versions TO :"api_role";
GRANT UPDATE (current_version_id, archived_at, archived_by_user_id) ON public.taxonomies TO :"api_role";
GRANT USAGE ON SEQUENCE public.taxonomies_id_seq, public.taxonomy_versions_id_seq TO :"api_role";
GRANT SELECT ON public.taxonomies, public.taxonomy_versions TO :"operator_role";
-- No UPDATE, DELETE, TRUNCATE on snapshots, and no DDL/table ownership.
