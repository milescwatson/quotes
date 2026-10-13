REVOKE ALL ON public.organization_domains,public.taxonomy_organization_access,public.platform_authorization_guard FROM PUBLIC;
GRANT SELECT,INSERT,DELETE ON public.organization_domains,public.taxonomy_organization_access TO :"api_role";
GRANT SELECT,UPDATE ON public.platform_authorization_guard TO :"api_role";
GRANT INSERT ON public.organizations TO :"api_role";
GRANT UPDATE (address,website_url,email,phone) ON public.organizations TO :"api_role";
GRANT UPDATE (auth_revision,sharing_revision) ON public.taxonomies TO :"api_role";
GRANT USAGE ON SEQUENCE public.organizations_id_seq TO :"api_role";
GRANT SELECT,INSERT,DELETE ON public.organization_domains TO :"operator_role";
GRANT SELECT,UPDATE ON public.platform_authorization_guard TO :"operator_role";
