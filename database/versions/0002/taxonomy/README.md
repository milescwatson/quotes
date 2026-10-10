# JSONB taxonomy installation

This is the first installation of the MVP taxonomy module, after the identity
and quote modules from version 0001. The version 0001 taxonomy SQL is a legacy
PostgreSQL reference and is **not** a prerequisite. This migration deliberately
uses CREATE TABLE without IF NOT EXISTS: an existing incompatible table must
stop installation rather than be silently accepted or overwritten.

## Observed development state

On October 10, 2026 a metadata-only read of development cluster
`3zuetvjhixkp3qeuzxxosvlssq` in `us-west-2` found none of the public users,
organizations, quotes, or taxonomy tables. No cloud schema or data was modified.
This environment needs identity and quote installation before this module.
The subsequent development installation completed on October 10, 2026. See the
[deployment ledger](../../../DEPLOYMENTS.md) for applied modules and live checks.
Repeat inventory before any future installation.

The read-only inventory script is `AWS/api/scripts/inventory-taxonomy.mjs`.
It requires `DSQL_ENDPOINT`, `AWS_PROFILE`, and `AWS_REGION`. It uses an operator
IAM token in memory, only queries table/column metadata, and prints no credentials.
The API always uses its restricted non-admin runtime role.

## Installation order

1. Verify the target account/cluster and inspect existing table/column metadata.
   Stop if either taxonomy table already exists. If it contains relational
   taxonomy data, a preservation/backfill migration must be prepared separately;
   this script must not replace that data.
2. Install `0001/identity/schema.sql` and `0001/quotes/schema.sql` where absent,
   with one DDL statement per transaction, checkpointing successful steps.
3. Execute each statement of this module's `schema.sql` separately. Do not wrap
   the whole file in a transaction and do not send it as a multi-statement query.
4. For `ALTER TABLE ASYNC ... VALIDATE CONSTRAINT` and `CREATE INDEX ASYNC`,
   record the returned job ID, wait for `sys.jobs` completion, and verify the
   constraint/index is valid before allowing traffic. The current-version FK is
   initially added NOT VALID to match DSQL's ALTER TABLE requirements.
5. Create/map dedicated non-owner `quotes_api` and operator roles as described
   in the existing identity deployment instructions. Apply identity, quote, and
   this module's permissions templates with the appropriate role substitutions.
   Check inherited privileges as well as direct grants. The API needs sequence
   USAGE, immutable version SELECT/INSERT, and only the named aggregate updates.
6. Reconnect with runtime credentials and verify creation, save/no-op, stale
   conflict, preview, list, archive, and prohibited historical writes. Run
   actual concurrent saves and authorization/archival races on a development
   fixture. Check near-limit JSON documents and Lambda execution time.
7. Build/release the Lambda and import the matching OpenAPI routes only after
   schema and grants pass validation. Frontend deployment alone does not deploy
   this API or run migrations.

No PL/pgSQL, triggers, custom monetary domain, relational child tables,
subscriptions, receipts, or taxonomy audit records are installed. Nested data
validation and exact cents arithmetic live in the API. PostgreSQL/PGlite tests
translate only asynchronous DDL syntax; they do not emulate DSQL conflicts.

## Recovery and release limits

Keep a checkpoint per successful DDL statement. On a partial installation,
inspect existing objects and resume only the uncompleted steps; do not rerun
CREATE statements blindly. On a runtime failure, roll back the Lambda/OpenAPI
release or disable the taxonomy routes. Preserve version data and do not
reverse a migration by dropping tables.

Development DDL, asynchronous jobs, restricted-role writes, and rollback smoke
checks passed; see the deployment ledger. Committed concurrency races and
authenticated route tests remain API release gates.
