-- Apply only after backfill reaches zero nulls. Await the asynchronous validation job.
ALTER TABLE public.quotes ADD CONSTRAINT quotes_lines_valid
    CHECK (lines IS NOT NULL AND jsonb_typeof(lines) = 'array' AND jsonb_array_length(lines) <= 100) NOT VALID;
ALTER TABLE ASYNC public.quotes VALIDATE CONSTRAINT quotes_lines_valid;
