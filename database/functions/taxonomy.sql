-- Current PostgreSQL function definitions; reapply after schema changes.
-- Apply after versions/0001/taxonomy/schema.sql and before its triggers.sql.

-- Append-only history: reject UPDATE, DELETE, and TRUNCATE even when a caller
-- accidentally attempts them. New snapshots must be assembled with INSERTs.
CREATE OR REPLACE FUNCTION public.taxonomy_reject_history_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
    RAISE EXCEPTION '% is append-only; create a new version or revoke access', TG_TABLE_NAME
        USING ERRCODE = '23514';
END;
$$;

CREATE OR REPLACE FUNCTION public.taxonomy_prepare_version() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
    parent public.taxonomies%ROWTYPE;
    next_number integer;
BEGIN
    SELECT * INTO parent FROM public.taxonomies WHERE id = NEW.taxonomy_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Taxonomy does not exist' USING ERRCODE = '23503';
    END IF;
    IF parent.archived_at IS NOT NULL THEN
        RAISE EXCEPTION 'Archived taxonomies cannot receive new versions' USING ERRCODE = '23514';
    END IF;
    SELECT coalesce(max(version_number), 0) + 1 INTO next_number
        FROM public.taxonomy_versions WHERE taxonomy_id = NEW.taxonomy_id;
    IF NEW.version_number <> next_number THEN
        RAISE EXCEPTION 'Expected version %, received %', next_number, NEW.version_number
            USING ERRCODE = '23514';
    END IF;
    NEW.created_in_transaction := pg_current_xact_id();
    NEW.created_at := CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;

-- Prevent additions to snapshots from earlier transactions, not only edits.
CREATE OR REPLACE FUNCTION public.taxonomy_check_snapshot_insert() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.taxonomy_versions
        WHERE id = NEW.version_id AND created_in_transaction = pg_current_xact_id()
    ) THEN
        RAISE EXCEPTION 'Snapshot children must be inserted with their new version'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.taxonomy_guard_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
    IF (NEW.id, NEW.owner_organization_id, NEW.created_by_user_id, NEW.created_at)
       IS DISTINCT FROM (OLD.id, OLD.owner_organization_id, OLD.created_by_user_id, OLD.created_at) THEN
        RAISE EXCEPTION 'Taxonomy identity, ownership, and creation attribution are fixed'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

-- At commit the current pointer must identify the latest version. Check both
-- sides so an inserted version cannot be committed without advancing the pointer.
CREATE OR REPLACE FUNCTION public.taxonomy_check_current_version() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
    target_id bigint;
    current_id bigint;
    latest_id bigint;
BEGIN
    IF TG_TABLE_NAME = 'taxonomies' THEN target_id := NEW.id;
    ELSE target_id := NEW.taxonomy_id;
    END IF;
    SELECT current_version_id INTO current_id FROM public.taxonomies WHERE id = target_id;
    SELECT id INTO latest_id FROM public.taxonomy_versions
        WHERE taxonomy_id = target_id ORDER BY version_number DESC LIMIT 1;
    IF latest_id IS NULL OR current_id IS DISTINCT FROM latest_id THEN
        RAISE EXCEPTION 'Current version must point to the latest taxonomy version'
            USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.taxonomy_guard_subscription() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
    parent public.taxonomies%ROWTYPE;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF OLD.revoked_at IS NOT NULL OR
           (NEW.id, NEW.taxonomy_id, NEW.subscriber_organization_id, NEW.granted_by_user_id, NEW.created_at)
           IS DISTINCT FROM
           (OLD.id, OLD.taxonomy_id, OLD.subscriber_organization_id, OLD.granted_by_user_id, OLD.created_at)
           OR NEW.revoked_at IS NULL THEN
            RAISE EXCEPTION 'Subscriptions can only be revoked once; regrant with a new row'
                USING ERRCODE = '23514';
        END IF;
    ELSE
        SELECT * INTO parent FROM public.taxonomies WHERE id = NEW.taxonomy_id FOR SHARE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Taxonomy does not exist' USING ERRCODE = '23503';
        END IF;
        IF parent.owner_organization_id = NEW.subscriber_organization_id THEN
            RAISE EXCEPTION 'Owners do not need a subscription' USING ERRCODE = '23514';
        END IF;
        IF parent.archived_at IS NOT NULL OR NEW.revoked_at IS NOT NULL THEN
            RAISE EXCEPTION 'New subscriptions must be active and target an unarchived taxonomy'
                USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
