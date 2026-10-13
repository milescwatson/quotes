-- Additive migration after 0003. Execute each statement separately on Aurora DSQL.
ALTER TABLE public.quotes ADD COLUMN lines jsonb;
ALTER TABLE public.quotes ALTER COLUMN lines SET DEFAULT '[]'::jsonb;
