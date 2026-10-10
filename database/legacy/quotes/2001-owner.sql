-- Existing quote tables only; fresh installations use the updated schema.sql.
-- Execute one statement at a time. Wait for the validation job to complete.
ALTER TABLE public.quotes ADD COLUMN owner_user_id bigint;
ALTER TABLE public.quotes ADD CONSTRAINT quotes_owner_user_id_fkey
    FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE ASYNC public.quotes VALIDATE CONSTRAINT quotes_owner_user_id_fkey;
-- Apply ../../versions/0001/quotes/permissions.sql afterwards. Existing quotes remain unassigned.
