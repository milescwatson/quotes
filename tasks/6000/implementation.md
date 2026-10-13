# Implementation and verification

Implemented October 13, 2026. Source, migration package, OpenAPI/generated types, fixtures, and browser/API coverage are complete locally. Live development migration and coordinated release completed October 13, 2026; authenticated Cognito browser verification remains unrun.

## Delivered

- Sales/Administrator membership migration and defaults; separate global Super Administrator privilege and organization switching without membership. Global access is derived from the three hardcoded verified emails; grant/revoke endpoints, controls, stored flags, and seed commands have been removed.
- Team navigation, Sales additions of existing accounts, Administrator role/removal/name controls, and read-only Super Administrator badges. Shared profile-name changes and work-domain removal restoration are explained in the UI.
- Product Configurations in the main navigation, redirects for old settings/catalog bookmarks, and first/last-name profile initials.
- Optional company address, website, email, and phone with server validation and null clearing. Super Administrator exact-domain management, with inputs disabled until existing assignments have loaded.
- Verified exact-domain enrollment: unique domain/organization upsert, default/restored Sales membership, preserved active roles and other memberships, personal-provider exclusions, and no automatic archival reversal. Periodic access refresh uses profile reads rather than bootstrap.
- Configuration recipients selected independently of content. Recipient organizations can read/preview/use current shared configurations but cannot edit/archive. Super Administrators get an owner-switch link. Sharing has a separate concurrency revision, so ordinary quote use does not invalidate sharing edits.
- Shared quote-source validation and guard writes; revocation/archive blocks new selections/products while saved snapshots and quantity changes retain prices. A Super Administrator without membership starts a new quote Unassigned rather than with an ineligible owner.
- Checkpointed 0005 migration, restricted grants, temporary IAM-role database validation, read-only authenticated release verification, and Terraform concurrency configuration for keeping API traffic paused through cutover.

## Verification

| Check | Result |
| --- | --- |
| Server tests | 92 passed, including current-schema role, migration, enrollment, sharing, quote and authenticated Gateway scenarios |
| Database baseline tests | 12 passed |
| Frontend API generation | Passed; expanded Gateway YAML contains no aliases |
| Frontend type checking | Passed |
| Server build and actual bundled Lambda invocation | Passed |
| Frontend production build | Passed |
| Terraform development validation | Passed with installed providers outside the filesystem sandbox |
| Browser suite | 52 passed, including six new organization scenarios and updated historical-quote authorization |
| Desktop/mobile visual inspection | Sharing panel and company settings inspected; mobile checks assert no page overflow |
| Live development AWS/DSQL | Migration 0005, Lambda 11, Gateway, Amplify job 20, runtime-role checks and public health/auth/CORS checks passed; Terraform reports no changes |
| Real Cognito user browser check | Not run: no development user access token/session available |

The service suite loads 0005 into its local database fixtures; historical database suites continue to verify earlier schemas. A dedicated migration test starts with old admin/editor/member rows and checks exact mappings, defaults, retained membership identities, and constraints. Enrollment tests exercise simultaneous in-process bootstrap requests with a serialized PGlite connection; existing transaction tests cover bounded retry handling. The deployment smoke handler also passed locally using restricted runtime grants, with every fixture rolled back. Actual Aurora concurrency/runtime verification is reserved for the live validation script.

Tests cover Sales escalation attempts, same-organization name/role/removal authorization, last organization administrators, exact email matching, stale email/flag rejection, disabled users, organization boundaries, sharing conflicts and owner-only mutations, source revocation, snapshot retention, domain collisions, personal providers, subdomains, removed memberships, email changes, company validation, navigation/redirects, initials, mobile controls, and keyboard navigation. Browser fixtures serialize request bodies like the HTTP adapter and enforce the server's archived/shared quote rules.

Screenshots: [desktop sharing](screenshots/sharing-desktop.png) and [mobile company settings](screenshots/company-mobile.png). Browser traces/build outputs remain ignored development artifacts; existing task screenshots are preserved.

## Release status

Development release completed October 13, 2026. Integration commit `31c8e4b` and pagination/auth-regression fix `f68defd` are pushed to development. Migration 0005 converted the existing Administrator membership, installed company/domain/sharing schema and grants, and validated asynchronous indexes/constraints. The initial domain mapping is empty. The three verified allowlisted accounts receive Super Administrator access without seeding.

The reviewed API plan changed only Lambda, its alias, and Gateway (0 added, 3 changed, 0 destroyed). Lambda version 11 is Active/Successful and its code hash matches the built archive. All 30 Gateway routes match OpenAPI; business routes use JWT. Gateway metadata was reconciled separately. Amplify job 20 passed BUILD, DEPLOY and VERIFY for `f68defd`. The API stayed paused throughout cutover and its original unreserved concurrency was restored through a reviewed concurrency-only plan. The final Terraform plan reports no changes.

Live checks through the actual restricted IAM/database role passed enrollment/restoration, company authorization, shared read-only configuration access, quote pricing, revocation/snapshot retention, and exact email privilege rules. Every fixture was rolled back and the temporary Lambda deleted. Public checks passed frontend/login and API health (200), anonymous business routes (401), and configured-origin PUT preflight (204). No real Cognito user token was available, so the signed-in public browser check was not run.

Evidence: [migration journal](../../database/deployments/development-0005.json), [runtime-role validation](../../database/deployments/development-0005-validation.json), and [release verification](development-verification.json). Staging and production were not modified. The prior API version must not receive traffic with the new membership-role constraint.

## Email allowlist revision

The Super Administrator source is now `shared/super-administrators.json`: `mc.watson415@gmail.com`, `miles@baysideio.com`, and `miles@milescwatson.com`. Server authorization uses the current verified email; Team badges use stored verified profile emails. Case/whitespace normalization is allowed, but plus aliases, dot variants, other domain users, and similar domains are excluded. The undeployed 0005 migration no longer introduces a writable privilege flag. Its platform guard remains for enrollment/domain serialization.
