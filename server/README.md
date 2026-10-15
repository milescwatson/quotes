# Quotes API

Fastify 5 on Node.js 22 Lambda for profile, organizations, quotes, taxonomies, and principals. The public contract remains `../AWS/openapi.yaml`.

```sh
npm ci
npm test
npm run build
npm run verify:bundle
```

`dist/index.mjs` bundles the handler, PostgreSQL driver, and DSQL IAM signer. Terraform packages this directory; build it before a Terraform plan/apply. Do not deploy only `index.mjs` without its imports/dependencies.

The API connects with short-lived IAM tokens, verified TLS, and the non-admin `quotes_api` database role. Configure `DSQL_ENDPOINT`, `DSQL_USER`, `COGNITO_ISSUER`, `COGNITO_CLIENT_ID`, and `COGNITO_DOMAIN`. The Lambda environment supplies `AWS_REGION` automatically. No database password is stored.

Only explicitly declared Gateway routes are handled. Every identity request checks trusted JWT authorizer claims and fetches current verified email from Cognito userInfo. Never expose this handler through an unauthenticated Function URL or use a caller-supplied claims object as authorization.

The service uses repeatable-read transactions, user/organization guard writes for mutations, bounded whole-transaction retries, and audit events. Page reads check enabled users, active organizations, and current memberships without writing authorization guards. Signup bootstrap is keyed by Cognito issuer/subject. Admins add existing accounts by email with immediate access. Duplicate additions cannot change an active member's role; missing, disabled, and ambiguous accounts are rejected. Accounts must have signed in once before being added.

## Local validation

Tests run against an in-memory PostgreSQL instance using the real identity schema, changing only `INDEX ASYNC` to `INDEX`. They cover transaction behavior, authorization, pagination, last-admin protection, direct addition, duplicate protection, reactivation, and disabled accounts, plus the Lambda authentication boundary. A separate retry test verifies retry/release behavior after an injected serialization failure.

These tests are not DSQL concurrency validation. Follow `../design/identity/validation.md` for cloud gates.

## Before live release

1. Apply and verify the identity schema and dedicated database grants from `../database/versions/0001/identity/`. Map the Lambda IAM role to the non-owner `quotes_api` role. Do not substitute admin credentials.
2. Provision the initial active organization and admin membership through the separate operator workflow. There is no public organization-create route.
3. Build this Lambda and apply the changed Terraform/OpenAPI, including Cognito public signup, the frontend Cognito-domain variable, and POST/PUT/PATCH/DELETE CORS support.
4. Publish the frontend with the matching public configuration, then verify real Cognito callbacks, DSQL permissions/conflicts, immediate membership access and member management.

Database migrations, an operator interface are not automatically executed or provisioned by this package. There are no new Nuxt business endpoints or direct browser database connections.

## Quotes list

`GET /organizations/{orgId}/quotes?page=1&pageSize=50` is available to all active organization members. It returns rows and page totals, ordered by most recently modified. Customer IDs are nullable integers; bigint quote/organization/user IDs are decimal strings. Apply the [quote schema and grants](../design/quotes/specification.md) before releasing this route. The API supports quote owner reassignment via PATCH and full quote creation/editing via POST/PUT. See the quote specification for filter and owner-choice contracts.

## Taxonomy MVP

The six routes in the [API specification](../design/taxonomy/api-specification.md)
are implemented locally: list, create, read current, save version, preview, and
archive. They use owner-only authorization and immutable, complete JSONB version
rows. Creation and changed saves return 201; normalized no-ops return 200. Invalid
or incomplete taxonomies never save. Ordered arrays preserve segments/options,
new nested IDs are server-generated UUIDs, and money uses exact integer cents.

Saves and archive require `expectedVersionId`. Taxonomy mutations make one
attempt; stale or database concurrency conflicts require reload, with no automatic
mutation retry, receipt table, sharing, or history-read route. Taxonomy lists,
reads, previews, and principal lists validate access within their transaction
snapshot using SELECTs, without authorization guard writes or automatic retries.
Parallel page reads therefore do not compete to update authorization rows.
A lost create response is not deduplicated. Identity/quote retry behavior is preserved.

Apply the [JSONB installation procedure](../database/versions/0002/taxonomy/README.md)
before releasing these routes. Do not install the legacy 0001 taxonomy schema.
The public development database was empty at the initial October 10 inventory.
The subsequent authorized database deployment is recorded in the ledger below.

The pool uses a client-side query timeout because the development DSQL endpoint
rejects the PostgreSQL `statement_timeout` startup parameter. Both API and
operator inventory connections retain verified TLS and short-lived IAM tokens.

Development database schemas and grants are now installed and tested through the actual Lambda IAM role. See [database deployment status](../database/DEPLOYMENTS.md). This does not imply the locally implemented API has been deployed.

## Configuration Editor and principals

Task 4000 adds authenticated principal GET/POST routes and requires `principalId` on taxonomy creation/version saves. Taxonomy lists accept the single optional `principalId` filter. Principals are shared globally, but creating one requires admin membership in the selected active organization. See [principal semantics](../design/principals/specification.md) and [0003 migration instructions](../database/versions/0003/principals/README.md). Deploy schema/backfill/enforcement/grants before this API. The smoke handler now also requires the principal schema. No migration or public API deployment is performed by building/testing locally.

## Fastify application

Run `npm ci`, `npm test`, and `npm run build` from `server/` with Node.js 22. The bundle is `server/dist/index.mjs`; Terraform keeps the `index.handler` entry point. `createApp` in `app.mjs` takes named services, configuration, and an identity lookup dependency, and opens no socket. Route registrations are grouped in `routes/`. The Lambda adapter is created once and awaits application initialization.

`AWS/openapi.yaml` remains the public contract and Gateway configuration. The parity test compares every registered method/path with that file; no handlers, schemas, or Swagger output are generated from it. Trusted authorizer claims come only from `request.awsLambda.event`, and business routes verify email through Cognito userInfo. JSON parsing, no-store responses, errors, and sanitized logging are shared in the application factory. Taxonomy/principal requests and quote POST/PUT writes have a 512 KiB body limit; other routes have no added Fastify body limit.

## Refactor verification — October 12, 2026

The isolated worktree was fast-forwarded from `98145d1` to the clean primary checkout's committed baseline `570c9f3` before incorporating principals and schema 0003. The primary checkout was inspected read-only. Fastify `5.12.5` and the official Lambda adapter `6.4.2` are pinned; existing dependency versions were retained.

On Node `22.23.2`: 53 API tests and 12 database tests passed, including exact parity for all 23 OpenAPI routes, every named operation mapping, permissions, memberships, ownership, principal constraints, taxonomy conflicts, retries, and realistic Gateway requests. The bundled handler passed local health, trusted session, unauthenticated business-route, and unknown-route invocations. Frontend type generation was unchanged; type checking, 3 auth regressions, and 19 quote/identity browser regressions passed.

The development Terraform plan (`AWS/environments/development/fastify-server.tfplan`, ignored by Git) proposes 0 additions, 3 in-place changes, and 0 deletions or replacements: the Lambda code, its alias version, and an existing Gateway description/default-tag difference. Terraform's only source change is the archive source directory. No infrastructure was applied and no live database migrations or smoke writes were run. Live Cognito/DSQL verification and rollback remain a separate release step.

The subsequent authorized development release and live Cognito/DSQL verification are recorded in [AWS deployment evidence](../AWS/DEPLOYMENT.md#fastify-api-release--october-12-2026).

## Quote editor (0004)

GET quote detail returns saved product snapshots and an exact concurrency token. POST creates a quote; PUT replaces metadata and ordered lines using `expectedToken`. All active organization members can write; owner/source organization authorization and exact USD calculations run atomically. Existing lines remain editable using their saved version after catalog change/archive. Empty quotes and blank selections are allowed; invalid choices/quantities and stale saves are rejected. Apply [0004](../database/versions/0004/quotes/README.md) before this release. See [task 5000](../tasks/5000/implementation.md) for scope and verification.

### Quote PDFs

`GET /organizations/{orgId}/quotes/{quoteId}/pdf` requires `expectedToken` and accepts `disposition=inline|attachment` (default `inline`). It uses the same authorization as quote detail, including access to archived quotes, and returns `409 QUOTE_CONFLICT` for a stale token. The response is `application/pdf`, `no-store`, with a `quote-{id}.pdf` filename. This endpoint remains the on-demand blob fallback.

`GET /organizations/{orgId}/quotes/{quoteId}/pdf-url` accepts the same token and disposition and returns `{url: string | null}`. Quotes modified less than five minutes ago return null. Older quotes receive a 60-second signed URL only when the versioned S3 object matches their saved token; missing, outdated, or unavailable objects return null so the client can request the blob endpoint. URLs pin the inspected object version and include the requested preview/download disposition.

Changed quote saves, owner changes, and archive/restore operations enqueue generation after commit. A FIFO SQS queue invokes the separate `quote-pdf-worker.handler`, which reads current saved data through a read-only database role and writes `organizations/{orgId}/quotes/{quoteId}.pdf`. Queue sends have three total SDK attempts; failed sends do not fail committed saves. Worker processing gets three attempts before dead-lettering. See [AWS deployment instructions](../AWS/README.md#asynchronous-quote-pdfs) for packaging, permissions, and rollout order.

`quote-pdf-data.mjs` prepares saved snapshots and pricing independently of `quote-pdf-layout.mjs`, which renders a simple multipage US Letter document with PDFKit. Main line totals preserve existing quantity/multiple rounding. Selected option additions are after the multiple, per unit, and explanatory rather than additional charges. Empty/incomplete quotes are marked draft/estimated. PDFs use organization contact details and logos at rendering time. Stored PDFs regenerate on quote changes; the application does not expose historical documents.

DejaVu Sans regular/bold fonts and their license are tracked under `assets/fonts/` and copied into `dist/assets/` by the build. Keep those assets with the Lambda bundle. `verify:bundle` renders a PDF from an isolated copy of the actual deployment artifact to check font packaging. Binary PDFs are base64-encoded by the Lambda adapter; output is bounded at 4 MiB to allow for the synchronous response envelope. Benchmark worst-case quotes and cold starts on deployed ARM64 Lambda before release. Deploy the API/Gateway before the dependent frontend; a frontend push alone does not install this route.

## Organization roles, sharing, and enrollment (0005)

Current membership roles are `sales` and `administrator`; Super Administrator is a read-only global privilege derived from the exact verified email allowlist in `shared/super-administrators.json` (`mc.watson415@gmail.com`, `miles@baysideio.com`, `miles@milescwatson.com`). Sales can manage owned configurations and add existing Sales accounts. Shared configurations are read-only in recipient organizations and usable in quotes. Reconfigured lines require current active source access, while unchanged snapshots/quantity edits retain saved prices. Company PATCH includes optional address/website/email/phone, Team PATCH supports shared display-name updates, and Super Administrators manage enrollment domains and configuration recipients. Global privilege grant/revoke endpoints, UI controls, and seed commands are not available.

Verified bootstrap enrolls exact work domains, preserving active roles and restoring removed memberships as Sales. Personal-provider domains are excluded through the version-controlled list in `organization-domains.mjs`. Background UI refresh uses profile reads, not bootstrap. [Task 6000](../tasks/6000/implementation.md) and the [0005 release procedure](../tasks/6000/database-design.md) supersede the older role/sharing restrictions described above. Apply 0005 before releasing the API; do not resume the old API after role migration.

## Organization logos

`GET|PUT|DELETE /organizations/{orgId}/logo` reads, uploads/replaces, or removes the
current organization logo. Reads require organization access; mutations require
administrator access. PUT accepts `{imageBase64}` JSON, bounded to 3 MiB, with a
PNG/JPEG decoded size up to 2 MiB and at most 16 megapixels. Images are normalized
to PNG within 1024 × 1024 pixels, below 1 MiB, preserving transparency. SVG and
animated images are rejected. Organization responses include nullable
`logoVersion`; GET returns authenticated, noncached PNG bytes or 404 when absent.

`ORGANIZATION_LOGO_BUCKET` configures private storage. PDF downloads use the
current logo; storage failure for an associated logo returns 503. See the
[0009 migration guide](../database/versions/0009/organizations/README.md) for
ARM64 packaging and orphan cleanup.
