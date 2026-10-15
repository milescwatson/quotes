-- Apply with the existing restricted runtime role after deploying archive/restore API behavior.
GRANT UPDATE (archived_at, modified_by, modified_when) ON public.quotes TO :"api_role";
