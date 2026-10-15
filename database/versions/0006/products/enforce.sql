-- Apply after backfill, then await the asynchronous validation job.
ALTER TABLE public.quotes ADD CONSTRAINT quotes_multiple_valid
  CHECK (multiple IS NOT NULL AND multiple BETWEEN 0 AND 1000) NOT VALID;
ALTER TABLE ASYNC public.quotes VALIDATE CONSTRAINT quotes_multiple_valid;
