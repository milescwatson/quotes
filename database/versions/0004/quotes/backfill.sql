-- Repeat in separate transactions until zero rows are updated; quote writes must be paused.
UPDATE public.quotes SET lines='[]'::jsonb
WHERE id IN (SELECT id FROM public.quotes WHERE lines IS NULL ORDER BY id LIMIT 1000);
