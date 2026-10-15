# Database deployment status

This is the environment ledger for database schema and grants. Update it after every deployment, including failures or partial installations. Application/API releases are tracked separately.

| Database module | Development | Staging | Production |
| --- | --- | --- | --- |
| 0001 identity | Applied — 2026-10-10 | Not applied | Not applied |
| 0001 quotes | Applied — 2026-10-10 | Not applied | Not applied |
| 0002 JSON taxonomy | Applied — 2026-10-10 | Not applied | Not applied |
| 0003 shared principals | Applied — 2026-10-12 | Not applied | Not applied |
| 0004 quote editor | Applied — 2026-10-12 | Not applied | Not applied |
| 0005 organization roles and sharing | Applied — 2026-10-13 | Not applied | Not applied |
| 0008 quote archive | Applied — 2026-10-14 | Not applied | Not applied |
| 0001 legacy relational taxonomy | Excluded — never install on DSQL | Excluded | Excluded |

“Applied” means every schema statement and associated permission grant completed, asynchronous jobs succeeded, and catalog verification passed. “Partial” means some changes exist but the module is not ready. “Not applied” means no deployment has been performed by this project; it is not a claim that an independently managed database was inspected.

## Development

- Account: `415221799122`
- Region: `us-west-2`
- DSQL cluster: `3zuetvjhixkp3qeuzxxosvlssq`
- Database/schema: `postgres.public`
- Baseline applied: October 10, 2026 at 21:35:24 UTC
- Baseline schema verification: seven tables; all foreign keys/checks validated; all indexes valid.
- Restricted database roles: `quotes_api` and `quotes_operator`.
- Runtime IAM mapping: `arn:aws:iam::415221799122:role/quotes-development-api` → `quotes_api`. The operator role has SQL grants but no IAM principal mapping yet.
- Preflight: no public application tables, application database roles, or IAM/database role mappings.
- Statement-level evidence: [development.json](deployments/development.json), including SQL SHA-256 hashes, timestamps, job IDs, outcomes, and verification metadata. Contains no authentication tokens.
- Deployment command: `node server/scripts/deploy-database.mjs apply` from the repository workspace. This script deliberately accepts only the fixed development target, checks the AWS account, and stops on an unresolved or changed statement.

Do not treat all of directory `0001` as a deployable baseline: its legacy taxonomy module is excluded. The first DSQL baseline consists of `0001/identity`, `0001/quotes`, and `0002/taxonomy` together.

## Staging and production

No database versions have been deployed to these environments by this project. This deployment does not modify either environment. Before a future deployment, record the account, region, cluster, inventory, exact module versions, and verification results here.

## Updating and recovering

Never mark a version applied merely because its files exist or local tests pass. Record partial completion immediately after failure. Inspect the actual target before resuming; preserve the failed statement record and confirm whether it committed before any retry. Do not blindly rerun CREATE statements or drop tables to undo a release. Use a new numbered migration for changes to successfully applied schema.

## First-deployment compatibility corrections

The live DSQL installation exposed two unsupported statements. Neither failed statement created its requested object/grant; catalog inspection preceded resumption. The journal retains both failed attempts and their resolutions.

- Removed `DESC` from the quote index keys. Query `ORDER BY` remains unchanged.
- Removed explicit `GRANT USAGE ON SCHEMA public`: DSQL manages this system schema, and both database roles already have usage. Table/column/sequence grants remain restricted.

The failed quote index was corrected before it was applied. Future changes to the installed schema must use a new numbered migration.

## Development verification

DSQL does not support `SET ROLE`, so verification used actual runtime IAM authentication rather than switching an admin session. Live checks passed at 21:36:27 UTC using a temporary Lambda with the actual application IAM role and `quotes_api` connection. Evidence: [development-validation.json](deployments/development-validation.json).

- Identity insert with generated ID; taxonomy create, catalog/detail, preview, no-op save, changed save, stale-version rejection, and archive.
- Stored and read a 2,000-option document (404,104 UTF-8 bytes); explicitly validated deferred constraints.
- Confirmed runtime rejection of historical updates/deletes, ownership changes, and user deletion.
- Rolled back taxonomy test writes, deleted the isolated identity fixture, and deleted the temporary Lambda. All seven application tables contain zero rows after verification. Identity sequences have advanced; gaps are expected.
- Local regression checks: 34 API tests and 12 database tests (including 36 legacy schema assertions).

The application Lambda and public API routes were not released by this database deployment. Smoke tests used one rolled-back taxonomy transaction, so committed taxonomy concurrency races and end-to-end Cognito/API tests remain required before releasing taxonomy traffic. A dedicated operator IAM mapping also remains to be configured when an operator principal is selected. Staging and production remain untouched.

## Shared principals development deployment

Migration [0003 principals](versions/0003/principals/README.md) was applied to the same development target on October 12, 2026 at 22:08:29 UTC. Staging and production remain not applied.

- Command: `node AWS/api/scripts/deploy-database.mjs apply-principals`.
- Preflight confirmed zero taxonomies and zero historical versions; no mapping or backfill was required.
- All schema statements and runtime/operator grants completed. All asynchronous jobs succeeded; catalog verification confirmed eight tables, valid indexes, and validated constraints, including the historical principal-required check on the empty development tables.
- Statement-level evidence: [development-0003.json](deployments/development-0003.json). The original baseline journal and validation records are retained unchanged.
- Runtime IAM/service verification passed at 22:09:14 UTC: [development-0003-validation.json](deployments/development-0003-validation.json). Checks covered principal creation, independent name/root-domain duplicates, principal-only versioning with historical preservation, principal filtering, ordinary taxonomy flows, deferred constraints, and forbidden runtime writes.
- Test configuration/principal writes were rolled back, and the isolated identity fixture and temporary Lambda were deleted. Taxonomy, version, and principal tables remain empty; pre-existing identity data remains.
- Application/API deployment is separate. The API was subsequently released to development as version 4; see [API release record](../AWS/DEPLOYMENT.md).

The API package and deployment scripts moved from `AWS/api/` to `server/` in October 2026. Historical commands retain their original paths; current equivalents use `node server/scripts/deploy-database.mjs`.

## Quote editor (0004) — October 12, 2026

Migration 0004 was applied to development with API writes paused and in-flight requests drained, then concurrency restored. The lines column/default, validated array/100-line constraint, and insert/update/sequence grants are installed. Runtime DELETE remains denied. The database had zero quote rows; no data backfill was required, and the original metadata digest was preserved. Statement and async-job evidence is [development-0004.json](deployments/development-0004.json). Staging and production remain unchanged.

Live runtime-role quote verification passed all eleven checks (member writes, persistence, no-op token, partial options, owner conflict, stale catalog, archived snapshots, rollback, empty quotes, isolation and denied deletion). Dedicated fixtures and the temporary Lambda were removed. Evidence: [development-0004-validation.json](deployments/development-0004-validation.json).

## Organization roles and sharing (0005) — October 13, 2026

Migration 0005 is applied and verified in development. The existing admin membership became `administrator`; new memberships default to `sales`. Company contact fields, exact enrollment domains, configuration sharing, authorization guards/revisions, validated constraints/indexes, and restricted grants are installed. Initial enrollment-domain mappings are empty. The development API remained paused during migration and the coordinated API/frontend release, then its original unreserved concurrency was restored.

Statement hashes, asynchronous jobs, constraints, roles, and traffic-restoration evidence are in [development-0005.json](deployments/development-0005.json). Live restricted runtime-role validation passed all six checks; fixtures were rolled back and the temporary Lambda deleted: [development-0005-validation.json](deployments/development-0005-validation.json). Lambda version 11 and Amplify job 20 are released; see [task 6000 verification](../tasks/6000/development-verification.json). Real Cognito user browser verification remains unrun. Staging and production are unchanged.

## Regular products and quote multiples (0006) — October 14, 2026

Migration 0006 is applied and verified in development. API traffic stayed paused through the schema/API/frontend cutover, then the original unreserved concurrency was restored. The regular-product table, organization/parent foreign keys, organization-scoped part-number uniqueness, list-price checks, sequence permissions, and quote multiple default/range constraint are installed and validated. The asynchronous constraint validation job completed successfully. Runtime DELETE remains denied.

The one existing quote received multiple 1.0000 in a bounded backfill. Its IDs, customer/project, owner, lines/snapshots, modifier, and modification timestamp/token are unchanged; the before/after metadata digest matches. No quote JSON backfill was needed. The quote multiple column uses a validated non-null/range CHECK after DSQL's separate add/default/backfill steps.

The coordinated release uses source commit `67e2da77910ff3d4bbc8abf5ed4588312ac8f239`, Lambda version 12, and successful Amplify job 22. All 33 Gateway routes match OpenAPI and retain JWT authorization except health. Public health/auth/CORS and released asset checks passed; Terraform reports no changes. No live test users or fixtures were created. Product and pricing flow testing is deferred to the user at their request. Staging and production were not modified.

Evidence: [0006 migration journal](deployments/development-0006.json) and [release verification](../AWS/deployments/2026-10-14-products-verification.json).

## Regular-product principals (0007) — October 14, 2026

Migration 0007 is applied and verified in development. It adds optional principal assignment to regular products with a validated foreign key to shared principals. Existing runtime table-level grants cover principal read/insert/update. No backfill is required; existing products remain unassigned. The original product fields/tokens and complete existing quote documents are unchanged, with matching before/after digests.

The coordinated release uses source `bc6836e69716155f1465aa3c465c7cabaf25d58c`, Lambda version 13 and successful Amplify job 23. The API remained paused through cutover and its original unreserved concurrency is restored. Routes, code hash, principal-selector assets, health, anonymous authorization and CORS checks passed; Terraform reports no changes. No live test users or fixtures were created. Staging and production are unchanged.

Evidence: [migration journal](deployments/development-0007.json) and [release verification](../AWS/deployments/2026-10-14-product-principals-verification.json).

## Quote archive (0008) — October 14, 2026

Migration 0008 is applied and verified in development. It adds nullable `archived_at` to quotes and grants the runtime role update access only to the archive timestamp and existing modification metadata. The API was paused during the migration and its prior unreserved concurrency was restored after the coordinated release. The one pre-existing quote and its existing fields are unchanged, with matching before/after digests; no quotes were archived by the migration. Statement hashes, API pause details, traffic restoration, and catalog verification are recorded in [the migration journal](deployments/development-0008.json). Staging and production are unchanged.

## Organization logos (0009) — October 15, 2026

Migration 0009 is applied and verified in development. It adds nullable UUID
`organizations.logo_id` and grants the runtime role column update access. Existing
organizations start without a logo; no backfill or traffic pause was required.
Column type/nullability and runtime SELECT/UPDATE permissions passed verification.
Staging and production were not modified.

Evidence: [migration journal](deployments/development-0009.json),
[release verification](../AWS/deployments/2026-10-15-logo-verification.json), and
[rollback-only Lambda smoke checks](../AWS/deployments/2026-10-15-logo-runtime-verification.json).
