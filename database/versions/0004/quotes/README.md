# Quote editor migration

Apply after 0003 with quote writes paused. This upgrade preserves customer/project names, owner, attribution, and modification timestamps. Existing quotes open with no product lines.

1. Execute each statement in `schema.sql` separately. Aurora DSQL supports adding a nullable column then setting its default, rather than inline ADD COLUMN constraints.
2. Execute `backfill.sql` repeatedly in separate transactions until it updates zero rows. Confirm `SELECT count(*) FROM public.quotes WHERE lines IS NULL` returns zero. The 1,000-row batches avoid a single unbounded data migration transaction.
3. Execute `enforce.sql` one statement at a time. Record the asynchronous validation job and await successful completion before release.
4. Apply `permissions.sql` using the existing runtime role substitution. Check that it can insert/update quotes but cannot delete them. Keep taxonomy versions immutable.
5. Release the matching API, Gateway OpenAPI contract, and frontend, then verify authenticated create/read/update/owner-change conflicts in the target environment.

The API atomically validates and stores ordered product lines in one JSONB document. Each line contains a complete saved configuration, source/version identity, principal attribution, selections (including null), quantity, generated part number, and server-calculated USD amounts. Saved lines use that snapshot for future edits, even after source archive. Newly added or switched products require the current active organization configuration. Prices and aggregate totals are bounded to 999,999,999,999.99 USD; quantities to 1–1,000,000; quotes to 100 lines and 512 KiB of snapshots.

Full writes require the exact `token` returned by the detail API. It uses PostgreSQL's timestamp text including microseconds, rather than the millisecond display timestamp. Conditional writes and participant/organization transaction guards reject stale quote writes and competing authorization/catalog changes; list-owner changes update the same modification timestamp. No-op full saves preserve the token and attribution.

This migration is applied to development, with successful live constraint/grant verification recorded in [the deployment ledger](../../../DEPLOYMENTS.md). Staging and production are not deployed. Follow [Aurora DSQL ALTER TABLE documentation](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/alter-table-syntax-support.html) for constraint validation. Rollback disables the new API/UI while preserving the column and saved documents; do not drop quote data.

Development commands: `node server/scripts/deploy-quotes-database.mjs` performs the journaled upgrade and restores API concurrency; `node server/scripts/validate-quotes-database.mjs` validates quote persistence through a temporary Lambda using the runtime IAM role and cleans up its fixtures. Both commands are fixed to development and check the AWS account.
