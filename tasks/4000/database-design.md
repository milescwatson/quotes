# Shared principals and configuration ownership

Implemented locally as migration 0003 and the principal API. The existing schema and organization authorization model are retained, with an additive principal directory and a required principal relationship for each taxonomy (product configuration). Migration 0003 is applied to development only; see the [deployment ledger](../../database/DEPLOYMENTS.md). Follow the [migration runbook](../../database/versions/0003/principals/README.md) before deployment.

## Confirmed requirements

- Every product configuration belongs to one principal.
- Principals form one shared directory across all organizations.
- The admin section contains a Principals list and an Add principal action.
- An active organization admin can add a principal by entering its name and web address; both are required.
- Principal names and websites are independently unique across the entire directory. A duplicate in either field prevents creation; this is not merely uniqueness of the combined name/website pair.
- Principal website uniqueness uses the root/registrable domain, including across subdomains and page paths.
- Users can set/change a configuration’s principal in the editor, and the configuration list has one principal filter.
- Existing organization ownership, content snapshots, and access rules remain in place. A shared principal does not grant access to another organization's configurations.

## Additive schema

Add `public.principals` in migration `0003`, with:

| Field | Purpose |
| --- | --- |
| `id` | Generated bigint primary key, serialized as a decimal string |
| `name` | Required display name |
| `normalized_name` | Required global name uniqueness key |
| `website_url` | Required validated HTTP(S) web address for display/linking |
| `website_key` | Required global website uniqueness key; normalized root/registrable domain as defined below |
| `created_by_user_id` | Creating user, foreign key to existing users |
| `created_at` | Creation timestamp |

Create independent database uniqueness constraints on `normalized_name` and `website_key`. A pre-submit availability check is not sufficient: simultaneous creates must still produce one principal and one duplicate error. Name normalization should trim outer whitespace, collapse repeated whitespace, normalize Unicode consistently, and compare case-insensitively while retaining the display spelling. This is the implemented normalization rule.

Add `principal_id` to `public.taxonomies`, referencing `public.principals(id)` with restrictive deletion. Require it for every configuration once migration/backfill is complete. Keep `owner_organization_id` and all existing version relationships. Add an index on the principal foreign key if needed for supported lookups; do not introduce cross-organization configuration listing.

Principal rename/delete, merging duplicates, and extra principal profile fields are outside the requested scope. Record attribution without making the creator's organization the owner of the shared directory entry.

## Website validation and uniqueness

Accept a full HTTP(S) URL or a bare hostname, using HTTPS when the scheme is omitted. Reject credentials embedded in URLs and unsupported schemes. Normalize host casing and internationalized hostnames with a standard URL parser. Do not fetch the supplied website as part of creation.

The user selected the “top level domain.” For implementation, this means the root/registrable domain (for example, `example.com` or `example.co.uk`), not a suffix such as `.com`. Use a maintained public-suffix-aware parser, not a last-two-label string split. Thus `https://example.com`, `http://www.example.com/`, `https://shop.example.com/about`, and other subdomains of `example.com` have the same website key. Ignore scheme, port, path, query, and fragment for uniqueness. Normalize host casing and IDNs consistently, and remove a trailing DNS dot before domain extraction. Reject IP addresses and hostnames without a registrable domain. Keep a usable web address separately for display.

A website collision and a name collision each return a field-specific duplicate error.

## New API operations

The routes use the selected organization as authorization context while returning the same global directory:

| Route | Behavior |
| --- | --- |
| `GET /organizations/{orgId}/principals?page=1&pageSize=50` | Active members can read the shared directory for principal selection; admin UI displays the list. Return ID, name, and website, ordered by normalized name then ID. |
| `POST /organizations/{orgId}/principals` | Require active admin membership in the selected active organization. Accept `{name, websiteUrl}` and create one global entry. |

Return `201 {principal}` on creation and `409 PRINCIPAL_NAME_EXISTS` or `409 PRINCIPAL_WEBSITE_EXISTS` with field errors on uniqueness conflicts. Validate required fields and URL syntax before writing. Reuse current account/organization/membership guards, including authorization checks in the transaction. Members/editors cannot create principals. List responses use existing pagination conventions.

Extend taxonomy creation and version-save requests with required top-level `principalId`, and current/list responses with the principal ID and display name. Validate principal existence server-side and insert the relationship in the same transaction as the new taxonomy/version. Update OpenAPI, Gateway routes, Lambda dispatch, fixtures, and generated frontend types.

Principal selection is part of the editor’s explicit Save. Changing it requires the current `expectedVersionId` and creates a new immutable configuration version even when the other content is unchanged. Compare both content and principal ID for no-op detection. Atomically update the current principal relationship and version pointer. Preserve the assigned principal ID with each new version using an additive `taxonomy_versions.principal_id` foreign key, so a later reassignment does not rewrite historical attribution. Existing historical versions can retain null for this newly introduced relationship where no historical principal was recorded; require it for every newly written version. No standalone reassignment endpoint is needed.

Extend `GET /organizations/{orgId}/taxonomies` with optional `principalId`. Apply it together with the existing owning-organization and active-taxonomy restrictions, before both row pagination and counting. Omission means all principals. A valid principal with no matching configurations returns an empty list. Do not add search or other filters.

## Migration and permissions

The JSON taxonomy schema is already recorded as deployed to development. Use a new additive migration; do not rewrite an applied migration. Recheck the next version number and live data immediately before implementation/deployment.

Create the principal table and uniqueness constraints, then add the taxonomy foreign key using the supported DSQL migration sequence. If configurations already exist, obtain an explicit mapping to real principals before enforcing the required-principal constraint. Do not invent a default principal, infer one from organization names, or delete existing configurations. Do not infer principal attribution for immutable historical versions; preserve them and distinguish their absent historical assignment from the required association on newly saved versions. The earlier empty-table ledger is not evidence that tables are still empty.

Allow the API only the principal SELECT/INSERT and sequence access needed for this scope. Retain existing restrictions on immutable version rows. Validate asynchronous indexes/constraints and runtime grants, then release the API/UI only when all configurations have valid principal references. Verify exact DSQL DDL support during implementation.

## Verification

Cover global visibility from two organizations, administrator-only creation, duplicate names and website variants, concurrent duplicate submissions, invalid/missing website input, and principal existence on configuration creation/save. Test root-domain extraction for subdomains, multi-label public suffixes, IDNs, and equivalent URLs. Verify principal-only saves create a version, no-op saves do not, historical associations remain unchanged, and principal-filtered pagination/counts remain organization-scoped. Verify that selecting a shared principal does not expose configurations from another organization. Exercise backfill/restrictive foreign-key behavior, preservation of existing version history, permissions, and live DSQL constraints before deployment.
