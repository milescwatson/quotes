-- Version 1 trigger bindings. Apply after database/functions/taxonomy.sql.
BEGIN;

CREATE TRIGGER taxonomy_versions_immutable
    BEFORE UPDATE OR DELETE OR TRUNCATE ON public.taxonomy_versions
    FOR EACH STATEMENT EXECUTE FUNCTION public.taxonomy_reject_history_mutation();

CREATE TRIGGER taxonomy_segments_immutable
    BEFORE UPDATE OR DELETE OR TRUNCATE ON public.taxonomy_version_segments
    FOR EACH STATEMENT EXECUTE FUNCTION public.taxonomy_reject_history_mutation();

CREATE TRIGGER taxonomy_options_immutable
    BEFORE UPDATE OR DELETE OR TRUNCATE ON public.taxonomy_version_options
    FOR EACH STATEMENT EXECUTE FUNCTION public.taxonomy_reject_history_mutation();

CREATE TRIGGER taxonomies_no_delete
    BEFORE DELETE OR TRUNCATE ON public.taxonomies
    FOR EACH STATEMENT EXECUTE FUNCTION public.taxonomy_reject_history_mutation();

CREATE TRIGGER taxonomy_subscriptions_no_delete
    BEFORE DELETE OR TRUNCATE ON public.taxonomy_subscriptions
    FOR EACH STATEMENT EXECUTE FUNCTION public.taxonomy_reject_history_mutation();

CREATE TRIGGER taxonomy_version_prepare BEFORE INSERT ON public.taxonomy_versions
    FOR EACH ROW EXECUTE FUNCTION public.taxonomy_prepare_version();

CREATE TRIGGER taxonomy_segment_insert BEFORE INSERT ON public.taxonomy_version_segments
    FOR EACH ROW EXECUTE FUNCTION public.taxonomy_check_snapshot_insert();

CREATE TRIGGER taxonomy_option_insert BEFORE INSERT ON public.taxonomy_version_options
    FOR EACH ROW EXECUTE FUNCTION public.taxonomy_check_snapshot_insert();

CREATE TRIGGER taxonomy_identity_immutable BEFORE UPDATE ON public.taxonomies
    FOR EACH ROW EXECUTE FUNCTION public.taxonomy_guard_identity();

CREATE CONSTRAINT TRIGGER taxonomy_current_version_check
    AFTER INSERT OR UPDATE ON public.taxonomies DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION public.taxonomy_check_current_version();

CREATE CONSTRAINT TRIGGER taxonomy_new_version_check
    AFTER INSERT ON public.taxonomy_versions DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION public.taxonomy_check_current_version();

CREATE TRIGGER taxonomy_subscription_guard BEFORE INSERT OR UPDATE ON public.taxonomy_subscriptions
    FOR EACH ROW EXECUTE FUNCTION public.taxonomy_guard_subscription();

COMMIT;
