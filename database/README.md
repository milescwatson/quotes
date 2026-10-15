# Database layout

See [deployment status](DEPLOYMENTS.md) for the applied modules in development, staging, and production. Source directories alone do not indicate deployment.

- `versions/0001/`: the identity/quote baseline and retained legacy relational
  taxonomy reference. Only identity and quotes are in the DSQL installation.
- `versions/0002/`: the JSON taxonomy first-install module. New structural
  changes to applied modules belong in `versions/0003/` and later.
- `functions/`: current function definitions, maintained in place and reapplied
  using `CREATE OR REPLACE FUNCTION` independently of schema versions.
- `procedures/`: current stored procedure definitions; currently empty.
- `seeds/`: optional development data, excluded from schema installation.
- `tests/`: local schema and function behavior checks.
- `legacy/`: pre-baseline upgrade scripts retained for older databases. These
  are excluded from the version sequence and must not run after version 0001.

Functions and procedures remain in source control, but do not receive numbered
migrations for body changes. Signature changes, removals, and changes to their
table dependencies still require a coordinated deployment. Trigger bindings are
versioned because they attach enforcement to schema objects.

## Existing DSQL installation

The implemented identity and quote modules use this dependency order:

1. `versions/0001/identity/schema.sql`
2. `versions/0001/quotes/schema.sql`
3. Their `permissions.sql` templates, using the intended runtime/operator roles.

Run one DDL statement per transaction and wait for asynchronous jobs. The
[taxonomy MVP](../design/taxonomy/api-specification.md) is implemented locally in
[versions/0002/taxonomy](versions/0002/taxonomy/README.md) with two tables and
complete JSONB version documents. Follow its first-install procedure after these
modules. Do not install the old taxonomy module on DSQL. The development installation and its verification are tracked in the
[deployment ledger](DEPLOYMENTS.md). Existing relational taxonomy data, if found in another environment,
requires a preservation/conversion path before this first-install script.

## Legacy PostgreSQL reference installation

The existing relational taxonomy test/reference schema has this dependency
order. It is not the installation path for the selected DSQL taxonomy MVP.

1. `versions/0001/identity/schema.sql`
2. `versions/0001/quotes/schema.sql`
3. `versions/0001/taxonomy/schema.sql`
4. `functions/taxonomy.sql`
5. `versions/0001/taxonomy/triggers.sql`
6. The identity and quote `permissions.sql` templates, using the intended role names.

For that reference schema, complete installation before allowing writes. On subsequent releases,
apply the new schema version in its documented order and reapply the current
functions and procedures once their dependencies exist. Do not rerun version 0001
on an existing database. Verify an existing database matches the baseline before
recording it as version 0001 in deployment records.

The taxonomy SQL and functions retain their existing PostgreSQL implementation
and are not DSQL-ready. This layout does not add a migration runner or automatic
applied-version tracking.

## Local validation

From `database`, run `npm ci --ignore-scripts` followed by `npm test`.
Alternatively, set `PGLITE_MODULE` to an installed PGlite `dist/index.js` and run
`node --test tests/*.test.mjs`. The suites load the separated functions and
triggers and reapply the functions to verify replacement preserves behavior.
The original taxonomy suite tests the legacy relational model. The new
`tests/taxonomy-json.test.mjs` tests JSONB constraints and immutable grants;
`server/tests/taxonomy.test.mjs` covers the MVP API using the new schema.
Run `npm test` from `server` for API integration and legacy upgrade coverage.

## Shared principals (0003)

Apply the additive [principal migration](versions/0003/principals/README.md) after the JSON taxonomy schema and before releasing the Configuration Editor API. It adds global name/domain uniqueness and versioned principal assignments; it requires explicit mapping when configurations already exist. The deployment script uses the explicit development-only `apply-principals` mode for 0003; its original `apply` mode remains the baseline installer.

## Quote editor (0004)

Follow the additive [quote migration](versions/0004/quotes/README.md) after 0003. It adds snapshot documents and runtime quote-write grants, with a bounded backfill of empty documents for existing quotes. The migration is applied to development; see the deployment ledger for live evidence. Quote service/migration coverage is in `server/tests/quote-editor.test.mjs`.

## Organization roles and sharing (0005)

[0005](versions/0005/organizations/README.md) replaces membership roles with Sales/Administrator, adds global Super Administrator privileges, company contact fields, exact enrollment-domain assignments, and configuration sharing. Its checkpoint runner keeps the API paused until the matching release. [Task 6000](../tasks/6000/implementation.md) records local checks and live-release status; older version-specific identity tests remain historical schema coverage.

## Regular products and quote multiples (0006)

The additive [0006 migration and coordinated release procedure](versions/0006/products/README.md) adds a regular-product catalog and quote-wide price multiples. Legacy quote snapshots remain unchanged. Pricing uses only the quote multiple; historical line multiples are ignored. 0006 is applied and verified in development; see the deployment ledger and migration journal. Staging and production remain unchanged.

## Regular-product principals (0007)

[0007](versions/0007/products/README.md) adds optional principal selection to regular products and preserves existing product/quote data. It is applied and verified in development; see the deployment ledger. Staging and production remain unchanged.

## Owner quote archiving (0008)

[0008](versions/0008/quotes/README.md) adds an archive timestamp and grants the runtime API role permission to update it. Apply the additive migration after deploying owner-checked archive and restore behavior, then verify owner and non-owner cases using the actual runtime role.

## Organization logos (0009)

[0009](versions/0009/organizations/README.md) adds an optional logo reference and
runtime column permissions. Deploy its additive migration and private S3 storage
before releasing the logo settings UI.
