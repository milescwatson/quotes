-- Development only. Supply psql variables org_id and actor_id for an existing
-- active organization and enabled member. One execution adds 55 new quotes.
-- No identity records are provisioned. Do not apply as a production migration.
INSERT INTO public.quotes
    (organization_id, customer_id, customer_name, project_name, modified_by, modified_when)
SELECT o.id,
       CASE WHEN n % 2 = 0 THEN n ELSE NULL END,
       'Customer ' || n,
       'Project ' || n,
       u.id,
       CURRENT_TIMESTAMP - n * INTERVAL '1 hour'
FROM public.organizations o
JOIN public.organization_memberships m ON m.organization_id = o.id
JOIN public.users u ON u.id = m.user_id
CROSS JOIN generate_series(1, 55) AS n
WHERE o.id = :'org_id'::bigint
  AND u.id = :'actor_id'::bigint
  AND o.status = 'active'
  AND m.removed_at IS NULL
  AND u.disabled_at IS NULL;
