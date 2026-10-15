-- Apply after 0009, one statement per transaction on Aurora DSQL.
ALTER TABLE public.quotes ADD COLUMN location text;
ALTER TABLE public.quotes ALTER COLUMN location SET DEFAULT '';
-- Leave historical authors unknown; modified_by is not necessarily the creator.
ALTER TABLE public.quotes ADD COLUMN created_by_user_id bigint;
ALTER TABLE public.quotes ADD CONSTRAINT quotes_created_by_user_fk
  FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) NOT VALID;
ALTER TABLE ASYNC public.quotes VALIDATE CONSTRAINT quotes_created_by_user_fk;
