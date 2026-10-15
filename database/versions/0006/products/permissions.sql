GRANT SELECT, INSERT, UPDATE ON public.regular_products TO :"api_role";
GRANT USAGE ON SEQUENCE public.regular_products_id_seq TO :"api_role";
GRANT UPDATE(multiple) ON public.quotes TO :"api_role";
