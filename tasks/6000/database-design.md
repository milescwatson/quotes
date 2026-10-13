# Schema 0005 and release procedure

The additive migration follows 0004. Super Administrator access is computed from the hardcoded email allowlist, with no stored privilege column. It adds company address/website/email/phone columns, `organization_domains` (unique exact normalized domain), `taxonomy_organization_access` (unique configuration/recipient pair), a singleton platform authorization guard, and configuration authorization and sharing revisions. Audit entities now include taxonomies.

Backfill existing admins to `administrator`, editors/members to `sales` in 1,000-row batches. Preserve identity, ownership, membership IDs/join timestamps, quote snapshots, and immutable configuration versions. Update role defaults/checks and the active Administrator index. Existing configuration revisions use `COALESCE(...,0)` until touched.

[0005 SQL and instructions](../../database/versions/0005/organizations/README.md) separate schema, backfill, enforcement, sharing, and runtime grants. Each DDL statement has its own transaction and every asynchronous job is checkpointed and awaited. This follows the [AWS DSQL ALTER TABLE constraint workflow](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/alter-table-syntax-support.html).

## Interfaces

- Existing profile/Team responses add `isSuperAdministrator`; memberships expose only Sales/Administrator. Organization responses/updates include optional `address`, `websiteUrl`, `email`, and `phone`.
- Membership PATCH accepts an optional `role` and/or `displayName`. Sales additions always grant Sales.
- `GET/PUT /organizations/{orgId}/domains`: `{domains: string[]}`, Super Administrator only, at most 100 unique normalized domains. Domains already assigned elsewhere must be removed there first.
- Profile/Team `isSuperAdministrator` is read-only and email-derived; no global privilege mutation endpoint exists.
- `GET /organizations/{orgId}/taxonomies/{taxonomyId}/sharing`: `{organizationIds, revision}`. PUT replaces recipients using `{organizationIds, expectedRevision}`. Only a Super Administrator in owner context can use these endpoints.
- Configuration lists/details include ownership and edit/archive/preview/sharing permissions. Shared configurations use the original current version, not copies.

New/reconfigured quote saves update the source configuration guard and, for shared sources, the owner organization guard. Content edits, archival, and sharing changes update the same source guard, so conflicting authorization/catalog changes cannot silently commit. Sharing writes require their saved revision; content version IDs retain their existing concurrency contract.

## Development cutover

1. Renew the `quotes-development` AWS login. No known enrollment-domain mappings were supplied; the initial mapping is empty.
2. Run local tests/type checking/builds before migration. Review the migration files and a development Terraform plan; the target is fixed to account `415221799122`, region `us-west-2`.
3. Run `node server/scripts/deploy-organizations-database.mjs` (optionally pass a JSON domain-map file with domain → decimal organization-ID strings). It pauses the development API, drains requests, applies/checkpoints 0005, verifies constraints/roles, and leaves the API paused.
4. Build the matching server bundle, apply the reviewed Lambda/alias/Gateway release with `-var=api_reserved_concurrent_executions=0`, and release the matching frontend. Verify the published alias and expanded OpenAPI routes before restoring concurrency from `database/deployments/development-0005.json`.
5. Run `node server/scripts/validate-organizations-database.mjs`: a temporary Lambda authenticates using the real API IAM role, verifies runtime behavior/grants, and rolls back its fixtures. Run `verify-organizations-release.mjs` with `QUOTES_VERIFY_ACCESS_TOKEN` set to a verified development Cognito access token; the script never logs that token.
6. Sign in with one of the three verified allowlisted emails to receive Super Administrator access automatically. No operator seed is necessary.

Failed or partial migrations remain paused; inspect the journal before resuming. Do not restore an old API against the new membership-role constraint. Roll back application traffic to maintenance while retaining 0005 data; any reverse role migration needs its own reviewed procedure. No live migration or release is claimed by local tests.
