# Database deployment status

This is the environment ledger for database schema and grants. Update it after every deployment, including failures or partial installations. Application/API releases are tracked separately.

| Database module | Development | Staging | Production |
| --- | --- | --- | --- |
| 0001 identity | Applied — 2026-10-10 | Not applied | Not applied |
| 0001 quotes | Applied — 2026-10-10 | Not applied | Not applied |
| 0002 JSON taxonomy | Applied — 2026-10-10 | Not applied | Not applied |
| 0003 shared principals | Not applied | Not applied | Not applied |
| 0001 legacy relational taxonomy | Excluded — never install on DSQL | Excluded | Excluded |

“Applied” means every schema statement and associated permission grant completed, asynchronous jobs succeeded, and catalog verification passed. “Partial” means some changes exist but the module is not ready. “Not applied” means no deployment has been performed by this project; it is not a claim that an independently managed database was inspected.

## Development

- Account: `415221799122`
- Region: `us-west-2`
- DSQL cluster: `3zuetvjhixkp3qeuzxxosvlssq`
- Database/schema: `postgres.public`
- Applied: October 10, 2026 at 21:35:24 UTC
- Schema verification: seven tables; all foreign keys/checks validated; all indexes valid.
- Restricted database roles: `quotes_api` and `quotes_operator`.
- Runtime IAM mapping: `arn:aws:iam::415221799122:role/quotes-development-api` → `quotes_api`. The operator role has SQL grants but no IAM principal mapping yet.
- Preflight: no public application tables, application database roles, or IAM/database role mappings.
- Statement-level evidence: [development.json](deployments/development.json), including SQL SHA-256 hashes, timestamps, job IDs, outcomes, and verification metadata. Contains no authentication tokens.
- Deployment command: `node AWS/api/scripts/deploy-database.mjs apply` from the repository workspace. This script deliberately accepts only the fixed development target, checks the AWS account, and stops on an unresolved or changed statement.

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

## Pending shared principals migration

Task 4000 adds [0003 principals](versions/0003/principals/README.md). Its local schema/API checks do not deploy it. Re-inventory existing configurations and provide explicit principal mappings before enforcement and API release. Existing historical snapshots retain their content and any absent pre-migration attribution.
