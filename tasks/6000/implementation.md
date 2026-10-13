# Implementation and verification

Implemented October 13, 2026. Source, migration package, OpenAPI/generated types, fixtures, and browser/API coverage are complete locally. Live development migration/release is pending.

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
| Live development AWS/DSQL/Cognito | Pending: existing AWS session expired; no live migration or release performed |

The service suite loads 0005 into its local database fixtures; historical database suites continue to verify earlier schemas. A dedicated migration test starts with old admin/editor/member rows and checks exact mappings, defaults, retained membership identities, and constraints. Enrollment tests exercise simultaneous in-process bootstrap requests with a serialized PGlite connection; existing transaction tests cover bounded retry handling. The deployment smoke handler also passed locally using restricted runtime grants, with every fixture rolled back. Actual Aurora concurrency/runtime verification is reserved for the live validation script.

Tests cover Sales escalation attempts, same-organization name/role/removal authorization, last organization administrators, exact email matching, stale email/flag rejection, disabled users, organization boundaries, sharing conflicts and owner-only mutations, source revocation, snapshot retention, domain collisions, personal providers, subdomains, removed memberships, email changes, company validation, navigation/redirects, initials, mobile controls, and keyboard navigation. Browser fixtures serialize request bodies like the HTTP adapter and enforce the server's archived/shared quote rules.

Screenshots: [desktop sharing](screenshots/sharing-desktop.png) and [mobile company settings](screenshots/company-mobile.png). Browser traces/build outputs remain ignored development artifacts; existing task screenshots are preserved.

## Release status

The development AWS connection returned `Your session has expired. Please reauthenticate using 'aws login'.` The user supplied no existing domain mapping or designated seed account. No membership-domain inference or initial privilege grant was performed.

After `aws login --profile quotes-development`, follow [database-design.md](database-design.md): run the checkpointed migration, release the matching Lambda/Gateway/frontend with API concurrency held at zero, restore the journaled concurrency, and run the restricted-role/public authenticated checks. The three verified allowlisted accounts receive Super Administrator access without seeding. These steps remain pending and are not represented as verified live behavior.

## Email allowlist revision

The Super Administrator source is now `shared/super-administrators.json`: `mc.watson415@gmail.com`, `miles@baysideio.com`, and `miles@milescwatson.com`. Server authorization uses the current verified email; Team badges use stored verified profile emails. Case/whitespace normalization is allowed, but plus aliases, dot variants, other domain users, and similar domains are excluded. The undeployed 0005 migration no longer introduces a writable privilege flag. Its platform guard remains for enrollment/domain serialization.
