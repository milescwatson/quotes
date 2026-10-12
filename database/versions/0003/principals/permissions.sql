REVOKE ALL ON public.principals FROM PUBLIC;
REVOKE ALL ON public.principals FROM :"api_role", :"operator_role";
GRANT SELECT, INSERT ON public.principals TO :"api_role";
GRANT USAGE ON SEQUENCE public.principals_id_seq TO :"api_role";
GRANT SELECT ON public.principals TO :"operator_role";
GRANT UPDATE (principal_id) ON public.taxonomies TO :"api_role";
-- Existing taxonomy SELECT/INSERT grants include new columns. History stays immutable.
