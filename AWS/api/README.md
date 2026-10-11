# Quotes API

Node.js Lambda for the identity, organization, and quote-list operations in `../openapi.yaml`.

```sh
npm ci
npm test
npm run build
```

`dist/index.mjs` bundles the handler, PostgreSQL driver, and DSQL IAM signer. Terraform packages this directory; build it before a Terraform plan/apply. Do not deploy only `index.mjs` without its imports/dependencies.

The API connects with short-lived IAM tokens, verified TLS, and the non-admin `quotes_api` database role. Configure `DSQL_ENDPOINT`, `DSQL_USER`, `COGNITO_ISSUER`, `COGNITO_CLIENT_ID`, and `COGNITO_DOMAIN`. The Lambda environment supplies `AWS_REGION` automatically. No database password is stored.

Only explicitly declared Gateway routes are handled. Every identity request checks trusted JWT authorizer claims and fetches current verified email from Cognito userInfo. Never expose this handler through an unauthenticated Function URL or use a caller-supplied claims object as authorization.

The service uses repeatable-read transactions, user/organization guard writes, bounded whole-transaction retries, and audit events. Signup bootstrap is keyed by Cognito issuer/subject. Admins add existing accounts by email with immediate access. Duplicate additions cannot change an active member's role; missing, disabled, and ambiguous accounts are rejected. Accounts must have signed in once before being added.

## Local validation

Tests run against an in-memory PostgreSQL instance using the real identity schema, changing only `INDEX ASYNC` to `INDEX`. They cover transaction behavior, authorization, pagination, last-admin protection, direct addition, duplicate protection, reactivation, and disabled accounts, plus the Lambda authentication boundary. A separate retry test verifies retry/release behavior after an injected serialization failure.

These tests are not DSQL concurrency validation. Follow `../../design/identity/validation.md` for cloud gates.

## Before live release

1. Apply and verify the identity schema and dedicated database grants from `../../database/versions/0001/identity/`. Map the Lambda IAM role to the non-owner `quotes_api` role. Do not substitute admin credentials.
2. Provision the initial active organization and admin membership through the separate operator workflow. There is no public organization-create route.
3. Build this Lambda and apply the changed Terraform/OpenAPI, including Cognito public signup, the frontend Cognito-domain variable, and POST/PATCH/DELETE CORS support.
4. Publish the frontend with the matching public configuration, then verify real Cognito callbacks, DSQL permissions/conflicts, immediate membership access and member management.

Database migrations, an operator interface are not automatically executed or provisioned by this package. There are no new Nuxt business endpoints or direct browser database connections.

## Quotes list

`GET /organizations/{orgId}/quotes?page=1&pageSize=50` is available to all active organization members. It returns rows and page totals, ordered by most recently modified. Customer IDs are nullable integers; bigint quote/organization/user IDs are decimal strings. Apply the [quote schema and grants](../../design/quotes/specification.md) before releasing this route. The API supports quote owner reassignment via PATCH; other quote writes remain out of scope. See the quote specification for filter and owner-choice contracts.

## Taxonomy MVP

The six routes in the [API specification](../../design/taxonomy/api-specification.md)
are implemented locally: list, create, read current, save version, preview, and
archive. They use owner-only authorization and immutable, complete JSONB version
rows. Creation and changed saves return 201; normalized no-ops return 200. Invalid
or incomplete taxonomies never save. Ordered arrays preserve segments/options,
new nested IDs are server-generated UUIDs, and money uses exact integer cents.

Saves and archive require `expectedVersionId`. Taxonomy transactions make one
attempt; stale or database concurrency conflicts require reload, with no automatic
retry, receipt table, sharing, or history-read route. A lost create response is
not deduplicated. Identity/quote retry behavior is preserved.

Apply the [JSONB installation procedure](../../database/versions/0002/taxonomy/README.md)
before releasing these routes. Do not install the legacy 0001 taxonomy schema.
The public development database was empty at the initial October 10 inventory.
The subsequent authorized database deployment is recorded in the ledger below.

The pool uses a client-side query timeout because the development DSQL endpoint
rejects the PostgreSQL `statement_timeout` startup parameter. Both API and
operator inventory connections retain verified TLS and short-lived IAM tokens.

Development database schemas and grants are now installed and tested through the actual Lambda IAM role. See [database deployment status](../../database/DEPLOYMENTS.md). This does not imply the locally implemented API has been deployed.
