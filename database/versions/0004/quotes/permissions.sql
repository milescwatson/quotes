-- Apply after schema.sql, using the existing restricted runtime role.
GRANT INSERT ON public.quotes TO :"api_role";
GRANT UPDATE (customer_name, project_name, owner_user_id, lines, modified_by, modified_when) ON public.quotes TO :"api_role";
GRANT USAGE ON SEQUENCE public.quotes_id_seq TO :"api_role";
