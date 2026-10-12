# Shared principals migration

See the [environment ledger](../../../DEPLOYMENTS.md) for deployment status. Apply after 0001 identity/quotes and 0002 JSON taxonomy. Do not edit/reapply the installed 0002 schema.

1. Stop taxonomy writes during migration and inspect existing rows. Run `schema.sql` one statement per transaction. Record and await each asynchronous validation/index job.
2. Empty database: proceed to enforcement. Populated database: obtain an explicit taxonomy-to-principal mapping. Create real principals through the same name/website normalization used by the API. With the operator performing the migration, append a new snapshot for each taxonomy using its current content and selected principal, then atomically advance its principal/current-version pointer. Keep original historical rows unchanged. Include archived taxonomies. No placeholder principal or automatic organization-name mapping is provided.
3. Confirm every taxonomy has a principal and its current version has the same principal. Run `enforce.sql` and await validation. Abort release if any mapping is missing.
4. Apply `permissions.sql` with the existing role substitutions after prior identity/taxonomy grants. Verify history updates/deletes remain forbidden. Deploy the new API and UI together only after database readiness.

`taxonomy_versions_principal_required` is intentionally NOT VALID for pre-migration snapshots, which have no recorded principal. It rejects new null assignments while retaining those historical rows. On an empty installation it may be validated. The aggregate required-principal check must always be validated before release.

Principal names use trimmed, collapsed whitespace, NFC, and lowercase keys. Website keys use the ICANN registrable domain from tldts (including multi-label suffixes), not merely the final DNS label. Private suffix rules are excluded so subdomains of one root cannot bypass uniqueness. The API owns canonicalization; independent database unique constraints arbitrate concurrent inserts. The runtime role cannot update principal entries.

DSQL's supported [ALTER TABLE syntax](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/alter-table-syntax-support.html) requires added CHECK/foreign-key constraints to be NOT VALID and validated asynchronously. The nullable-column then required CHECK approach avoids unsupported inline ADD COLUMN constraints. Local PostgreSQL tests do not establish live DSQL behavior. Verify duplicate inserts and competing saves on the target before release. Rollback disables the new API/UI while preserving data; do not drop principal relationships or history.

## Development deployment command

Run `node server/scripts/deploy-database.mjs apply-principals` from the repository root. This mode is fixed to development, verifies the AWS account and applied baseline, requires empty taxonomy/version tables on first execution, and journals each statement in `database/deployments/development-0003.json`. It also validates the historical required-principal check because the development tables are empty. Use `verify-principals` for catalog verification. The original `apply` mode remains the baseline installer, not an upgrade command.

Run `node server/scripts/validate-database.mjs` for runtime IAM/grant and rollback-only service checks. Its current output is `database/deployments/development-0003-validation.json`; the baseline validation record is retained. Staging and production require their own explicit deployment authorization.
