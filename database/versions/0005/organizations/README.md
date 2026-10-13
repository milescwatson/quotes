# Organization roles, sharing, and enrollment migration

Apply after 0004 with API traffic paused. Use the fixed-development checkpoint runner:

```sh
node server/scripts/deploy-organizations-database.mjs
```

An optional first argument names a JSON file such as `{"example.com":"10"}` mapping known exact email domains to existing active organization IDs. The approved initial mapping is empty; do not infer ownership from current membership emails.

Order: `identity.sql`; repeat each statement in `backfill.sql` until no old/null values remain; `enforce.sql`; `sharing.sql`; `permissions.sql`. Execute each statement separately. Await every asynchronous validation/index job before dependent operations. Substitute the dedicated runtime/operator roles in permissions.

The runner records statement hashes, statuses, asynchronous job IDs, prior API concurrency, and verification results in `database/deployments/development-0005.json`. It intentionally leaves the API paused on success or failure. Release the matching API/Gateway/frontend, verify their compatibility, then restore the recorded concurrency. Set `-var=api_reserved_concurrent_executions=0` on the development Terraform plan/apply during that release, rather than allowing an intermediate API restart.

New memberships default to Sales. Super Administrator access is computed from the hardcoded email allowlist; it has no stored database field. Company contact fields are nullable. Existing configuration revisions may be null and are read as zero. Sharing does not modify ownership or copy versions. The runtime gets DELETE only for domain assignments and sharing links; existing user, company, membership, quote, version, and audit deletion restrictions remain.

[Task 6000 migration design](../../../../tasks/6000/database-design.md) describes contracts, email-based administrator access, verification, and rollback. SQL has been tested locally through PGlite; Aurora DSQL and authenticated public development checks require a renewed AWS session and release.
