# Taxonomy MVP API implementation plan

Status: implemented locally following approval, October 10, 2026. The [API specification](../../design/taxonomy/api-specification.md) contains the contract. See the [implementation record](implementation.md) for delivered changes, passing local checks, and outstanding deployment validation. The editor UI and quote-line persistence remain separate tasks.

## Intended result

Organization members can list and preview their organization's product taxonomies. Admins and editors save a complete valid taxonomy in one action. Only changed content creates a new immutable version. Admins can archive a taxonomy.

Use Aurora DSQL with a complete ordered JSONB document per version. Retain historical snapshots and their editor/time metadata, but expose only the current version. Defer sharing, history browsing/restoration, publishing, separate audits, autosave, and mutation replay infrastructure.

## 1 Finalize the MVP contract

Use the six endpoints in the specification: list, create, read current, save version, preview, and archive. Require `expectedVersionId` for saves and archive. Reject invalid or incomplete content instead of persisting drafts. Save immediately makes changed content current; identical normalized content does not increment the version.

Document the explicit no-retry tradeoff: a lost save response requires reloading; repeating an uncertain create may create a duplicate family. No mutation ID, creation request ID, receipt table, or automatic merge is included. Confirm the initial count/text/byte caps against a real taxonomy example when available.

## 2 Introduce JSON snapshot storage

Inventory installed database objects before choosing the migration path. In the next available schema version, define only `taxonomies` and `taxonomy_versions`, their required identity/organization/current-version references, indexes, and runtime grants. Provide a direct first-install path when the old taxonomy module was never installed. If populated relational data exists, explicitly convert and preserve historical IDs, array order, defaults, prices, and attribution before retiring anything.

Store family name, base price, currency, ordered segments, ordered options, and stable nested IDs in one version document. Add an internal document format version. Keep the current pointer, ownership, creation attribution, and archival actor/time on the aggregate. Allocate nested UUIDs in the application rather than use relational child identities.

Version rows are INSERT/SELECT only for the runtime role. Remove the need for child tables, subscription tables, count/position enforcement, taxonomy trigger functions, and a monetary domain. Validate nested content in the service; retain basic database checks, relationship constraints, and version-number uniqueness.

Update the database installation documentation when SQL is implemented. Verify asynchronous indexes and grants on the actual DSQL target before declaring the schema release-ready.

## 3 Implement validation and explicit saves

Add a focused taxonomy module and extract only the existing shared authorization/error helpers it needs. Validate names/codes, uniqueness, defaults, stable IDs, required nonempty arrays, exact money, maximum possible total, and final UTF-8 document size.

Use canonical content comparison that ignores object-key order and preserves array order. Creation inserts version 1 atomically. A changed update inserts the next snapshot and conditionally advances the current pointer in one transaction. An unchanged save returns the existing version. A stale expected version never overwrites current content.

Use a single-attempt transaction path for taxonomy, while preserving existing identity/quote retry behavior. Keep user/organization authorization guards and DSQL conflict protection. Map serialization conflicts to a reload-required response rather than retrying. Record content changes only through version metadata; archive stores its actor and timestamp directly.

## 4 Add reads and preview

Implement the active, owned-taxonomy catalog with page-number pagination and no search/access/status filters. Read the current JSON snapshot directly. Do not add historical-version or sharing routes.

Implement configuration preview using the current version, explicit selections, single-option selection, and defaults. Generate part numbers in segment-array order and calculate exact unit prices on the server. Add admin-only one-way archive; archived taxonomies leave the catalog and cannot be edited or previewed.

The future editor will keep unsaved/incomplete work locally, submit only on Save, preserve edits after validation errors, and reload/reconcile after a version conflict or uncertain response. This backend task defines that behavior but does not add an editor page.

## 5 Integrate and validate

Update Lambda dispatch, explicit API Gateway routes, `AWS/openapi.yaml`, generated frontend API types, and API documentation. Support 201 for creation/changed saves and 200 for no-ops. Keep existing response shapes intact for other services. The six routes need no new HTTP method or custom CORS header.

| Area | Required checks |
| --- | --- |
| Validation | Invalid/empty content rejected without writes; defaults, nested IDs, uniqueness, limits, and maximum possible total |
| Snapshot behavior | Ordered JSON round-trip; all relevant fields preserved; changed save increments once; no-op does not; immutable historical rows |
| Authorization | All roles, foreign organization IDs, removed membership, disabled user, inactive organization, and archived taxonomy |
| Concurrency | Same-version competing saves; save/archive race; authorization change during save; rollback if pointer/commit fails; no automatic retry |
| Preview | Default/single-option selection, missing choice, wrong IDs, stale version, leading zeros, exact prices and part-number order |
| Integration | Endpoint/status/schema consistency; list pagination; existing database/API regressions; Lambda build and frontend generated-type/type checks |
| Live DSQL | Installation path, constraints/indexes, restricted grants, maximum JSON document, and actual concurrent transactions |

Run the existing database/API suites plus the new focused checks, build the Lambda, regenerate API types, and typecheck/build the frontend. No new UI browser flow is included in this API scope. Apply schema and grants before enabling new routes. Rollback should disable/revert the API routes while preserving saved data.

After implementation, write `tasks/3000/implementation.md` with files delivered, tests actually run, migration/deployment status, and remaining live validation. Local PGlite results do not establish deployed DSQL behavior.

## Completion criteria

All six endpoints meet the specification, valid changed saves produce immutable attributed JSON snapshots, stale saves are rejected, and existing identity/quote behavior remains intact. Code completion and live deployment validation are recorded separately.

Runtime code, first-install SQL, OpenAPI routes, and generated client types are implemented locally. No schema or deployment was applied. Live DSQL validation remains a release gate.
