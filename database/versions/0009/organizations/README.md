# Organization logos (0009)

Apply after 0008 using `node server/scripts/deploy-logo-database.mjs` with the
authorized development AWS profile. The script checks the account, adds the
nullable UUID reference, grants column update access, and records a checkpoint
journal. Each DDL statement runs separately. Existing organizations need no
backfill, and the additive migration does not require a traffic pause.

Deploy the private S3 bucket, restricted Lambda permissions, and logo API before
the frontend. The Lambda package must contain Sharp's Linux ARM64 native runtime.
For a deployment build, install the locked production dependencies into a
temporary directory using `npm ci --omit=dev --include=optional --ignore-scripts
--os=linux --cpu=arm64 --libc=glibc`, then run `npm --prefix server run build` with
`SHARP_RUNTIME_DIR` pointing to that directory's `node_modules`. Host builds use
the local native runtime for bundle verification.

Objects use immutable organization-scoped keys. Successful replacement/removal
performs best-effort cleanup; failed cleanup logs `LOGO_CLEANUP_FAILED`. Failed
database commits log `LOGO_COMMIT_FAILED` and retain the uploaded image because a
lost commit acknowledgement cannot safely distinguish success from rollback.
Reconcile these logged object identifiers against current database references
before deleting orphaned objects. Image contents are not logged.

Logos are current organization details, rather than historical quote snapshots.
Storage failure for an associated logo returns a retryable error. No logo keeps
the previous PDF layout.
