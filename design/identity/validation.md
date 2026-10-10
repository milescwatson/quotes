# Identity schema validation

## Run local database checks

From `database`, with Node.js 22:

```sh
npm ci --ignore-scripts
npm test
```

Dependencies and the lockfile are isolated from the Nuxt application. Alternatively set `PGLITE_MODULE` to an already installed PGlite `dist/index.js` absolute path and run `node --test tests/*.test.mjs`.

The suite creates an in-memory PostgreSQL database and never contacts AWS or sends email. It applies each schema statement separately, changing only `INDEX ASYNC` to `INDEX` because asynchronous index jobs are a DSQL feature. It also applies the permissions template to dedicated test roles, attempts forbidden writes as those roles, and loads the existing taxonomy SQL against actual identity tables instead of ID-only stubs.

Coverage includes Cognito identity uniqueness without email merging, independent organization roles, membership uniqueness, rollback of membership and audit changes, restrictive foreign keys, runtime audit immutability, and integration with the legacy relational taxonomy schema. A separate `taxonomy-json.test.mjs` suite now validates the selected [JSONB taxonomy MVP](../taxonomy/api-specification.md) locally, including current-version references, version uniqueness, and immutable runtime permissions. Its DSQL-only asynchronous constraint validation is translated to ordinary PostgreSQL for local tests. Live DSQL checks remain pending.

API tests in `../../AWS/api` cover immediate access after addition, normalized email matching, duplicate protection, removed-member restoration, missing/ambiguous/disabled accounts, admin authorization, pagination, last-admin protection, and transaction retry. Browser suites in `../../app` cover member management and the OIDC callback using mocked endpoints.

These are local PostgreSQL and browser checks, not live DSQL concurrency or Cognito validation. Before release, apply each DDL statement separately in a disposable DSQL namespace, wait for each asynchronous index, verify dedicated API/operator grants, and exercise simultaneous guard writes with independent connections. Confirm losing transactions retry and reread authorization. Never run local test fixtures against production identity tables.

For an existing deployment, first release the API without invitation routes and stop any old delivery worker. Retain legacy invitation/outbox data and audit events until retention policy permits their removal; do not convert outstanding offers into access automatically. Existing memberships remain valid. The fresh-install schema omits those obsolete tables. Provision initial organization/admin memberships through the operator workflow. No cloud migration or deployment is performed by these local checks.

## Auto-increment identifiers

Verify bigint identity columns with explicit `CACHE 1` against the target DSQL cluster, including inserts under the dedicated runtime roles and `RETURNING id`. Confirm decimal-string API IDs above 2^53 retain precision. The local schema files are fresh-install DDL; an existing UUID database needs a separate data migration that remaps every referencing key before release. No live database migration is performed by this change.
