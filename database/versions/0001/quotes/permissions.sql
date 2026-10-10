-- Parameterized psql template; execute each statement separately on DSQL.
-- Apply after schema.sql. Use dedicated non-owner roles without broader grants.
REVOKE ALL ON public.quotes FROM PUBLIC;
REVOKE ALL ON public.quotes FROM :"api_role", :"operator_role";
-- DSQL public is system-managed and already grants USAGE; explicit schema grants are unsupported.
GRANT SELECT ON public.quotes TO :"api_role";
GRANT UPDATE (owner_user_id, modified_by, modified_when) ON public.quotes TO :"api_role";
GRANT SELECT, INSERT ON public.quotes TO :"operator_role";
GRANT USAGE ON SEQUENCE public.quotes_id_seq TO :"operator_role";
