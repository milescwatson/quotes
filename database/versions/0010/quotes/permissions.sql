GRANT UPDATE (location) ON public.quotes TO :"api_role";
-- Existing INSERT grants cover created_by_user_id; runtime cannot update it.
