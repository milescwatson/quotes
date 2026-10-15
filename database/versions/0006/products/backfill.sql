-- Repeat bounded batches until no null multiples remain; preserve all quote metadata.
UPDATE public.quotes SET multiple = 1 WHERE id IN (
  SELECT id FROM public.quotes WHERE multiple IS NULL ORDER BY id LIMIT 1000
);
