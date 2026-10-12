# Taxonomy MVP API implementation

Implemented locally on October 10, 2026 following approval of the [plan](plan.md) and [API contract](../../design/taxonomy/api-specification.md). No cloud schema changes or deployment were performed during the implementation step. A subsequent authorized development database deployment is recorded in the [database ledger](../../database/DEPLOYMENTS.md); that ledger supersedes the database installation status below.

## Delivered

- Six authenticated organization-scoped operations: list, create, read current, save version, configuration preview, and archive. Admins/editors write; members read/preview; admins archive.
- One immutable ordered JSONB document per version, with stable nested UUIDs, all content fields, author/time, and optional change summary. No sharing, history browsing, publishing, separate audit system, or automatic taxonomy retries.
- Full-document validation, canonical no-op detection, atomic current-pointer updates, and `expectedVersionId` conflicts. Invalid saves leave storage unchanged. Prices use exact integer cents; defaults and part-number generation follow segment order.
- Two-table first-install SQL and restricted permissions in `database/versions/0002/taxonomy/`. Runtime can insert/read versions but cannot update/delete historical content. Legacy relational schema remains reference code, not an upgrade path.
- OpenAPI routes/schemas, Lambda dispatch, and regenerated frontend types. No editor UI or quote-line persistence was added.

Primary implementation files are `AWS/api/taxonomy.mjs`, `AWS/api/taxonomy-content.mjs`, `AWS/api/shared.mjs`, `AWS/api/index.mjs`, `AWS/api/database.mjs`, `AWS/openapi.yaml`, and `app/app/types/api.generated.ts`. Shared identity helpers retain existing behavior; existing identity/quote retries remain enabled.

## Verification

- API: `npm test` — 34 tests passed, including existing identity/quote regressions and new taxonomy normalization, limits, authorization, snapshots, rollback, runtime permissions, HTTP routes, and single-attempt conflict handling.
- Lambda: `npm run build` — passed.
- Database: `PGLITE_MODULE=/Users/mileswatson/projects/quotes/AWS/api/node_modules/@electric-sql/pglite/dist/index.js npm test` — 12 tests passed, including the legacy suite's 36 schema checks and the new JSON schema suite.
- Frontend: `npm run generate:api`, `npm run typecheck`, and `npm run build` — passed.
- Fixed a timing-sensitive existing identity test fixture by assigning equal explicit creation/archive timestamps. No production identity schema behavior changed.

Local PGlite checks translate DSQL asynchronous index/constraint syntax to PostgreSQL. They do not establish live DSQL concurrency behavior. Tests cover stale saves, rollback, and injected transaction failures; simultaneous DSQL races remain a release gate.

## Read-only development inventory

The development cluster in us-west-2 was ACTIVE. A read-only transaction inspecting public metadata found no application identity, quote, or taxonomy tables. This supports the documented first-install path; inventory must be repeated immediately before installation. The reusable metadata-only command is `AWS/api/scripts/inventory-taxonomy.mjs`.

The connection check exposed DSQL rejecting the PostgreSQL `statement_timeout` startup parameter. The pool now uses the client's `query_timeout`. A timeout destroys the uncertain connection rather than returning an in-flight transaction to the pool; a regression test verifies this. No query results containing user data or authentication tokens were logged.

## Remaining release gates

Follow the [installation and recovery procedure](../../database/versions/0002/taxonomy/README.md):

1. Recheck installed objects. Install identity/quote prerequisites, then the JSON taxonomy schema one statement per transaction. Stop if legacy taxonomy objects exist; populated legacy environments require a separate preservation conversion.
2. Wait for asynchronous index/constraint validation and verify dedicated API/operator roles, IAM mappings, sequence access, and immutable historical permissions. Reconnect after grants.
3. Exercise create/save/no-op/archive and maximum documents against DSQL. Test simultaneous same-version saves, save/archive, and membership/account revocation races through independent connections.
4. Deploy the Lambda and explicit OpenAPI routes only after schema readiness; smoke-test Cognito authentication and organization boundaries.

If release verification fails, disable/revert the new routes while preserving all saved data. This record confirms local code completion, not production readiness or deployment.

API package relocation (October 2026): historical paths above used `AWS/api/`; current source, tests, scripts, and build commands use [server/](../../server/README.md).
