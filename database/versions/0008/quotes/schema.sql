-- Apply as an additive quote migration, one statement per transaction.
ALTER TABLE public.quotes ADD COLUMN archived_at timestamptz;
