# Development deployment — 2026-10-10

Account `415221799122` (`quotes-development`), region `us-west-2`.

| Component | Deployed resource |
| --- | --- |
| Nuxt frontend | https://development.d8i1ve5prnr7w.amplifyapp.com |
| Amplify app | `d8i1ve5prnr7w`, `WEB_COMPUTE`, Node 22, branch `development` |
| Source | `https://github.com/milescwatson/quotes` |
| API | https://um0ix9fu4i.execute-api.us-west-2.amazonaws.com |
| Lambda | `quotes-development-api`, alias `development` |
| DSQL | `3zuetvjhixkp3qeuzxxosvlssq`, active, encrypted, deletion-protected |
| Cognito pool | `us-west-2_VLGgWojkS` |
| Backup plan/vault | `quotes-development`, daily, seven-day retention |
| Terraform state | `quotes-development-tfstate-415221799122-us-west-2` |
| Budget | $25/month, actual-cost alert above 80% ($20) |
| Notification recipient | `mc.watson415@gmail.com` |

## Verified

- Terraform validation passed; the final development plan reported no changes.
- Nuxt built locally using the Amplify preset and Node 22 deployment manifest.
- Amplify's initial build/deploy/verification job succeeded; the public frontend returned HTTP 200 and rendered the Nuxt welcome page.
- The initial `main` deployment was replaced with the existing `development` branch at the user’s request. Git push `05b761f2a187ac27d93aec37a0922896e5e9d5bf` triggered development branch job 1 automatically; build/deploy/verification succeeded and the new frontend URL returned HTTP 200. Only the frontend is rebuilt by pushes. The old Amplify `main` branch was removed; the Git branch was preserved.
- API `/health` returned 200; unauthenticated `/v1/session` returned 401; an unknown route returned 404.
- Browser CORS preflight returned 204 with the configured frontend origin; an unconfigured origin received no CORS permission.
- A read-only SQL query over certificate-validated TLS and temporary IAM authentication returned `connection_ok = 1` from DSQL's `postgres` database.
- AWS Backup's DSQL regional opt-in was already enabled. The first on-demand backup completed successfully with seven-day retention (job `f9735be7-84a2-41f2-ab5a-d62899debbec`). A restore drill remains outstanding.

## Scope and follow-up

This deploys the existing Nuxt starter, not a completed quoting product. Product API routes, taxonomy/quote migrations, restricted SQL role mappings, and the sign-in/editor UI remain to be implemented. The health endpoint checks the API process, not database readiness. Cognito authentication rejection was tested; an interactive user sign-in has not been tested because no users/sign-in UI have been created.

Database restore recovery targets have not yet been demonstrated. The daily backup configuration alone does not establish a tested disaster-recovery process. The email SNS subscription is confirmed (`PendingConfirmation=false`); AWS Budget emails are separate.

Infrastructure stays in the sibling `AWS/` folder and is not included in the current application Git repository. Apply it manually using the instructions in `README.md`. Staging and production have no deployments.

## Database baseline — October 10, 2026

The development identity, quotes, and JSON taxonomy schemas and restricted grants are now applied. The Lambda IAM role maps to `quotes_api`, and live database smoke checks passed through that role. See [database deployment status](../database/DEPLOYMENTS.md) for per-module development/staging/production status and evidence. This database deployment did not release application code or routes.

## Repository consolidation — October 10, 2026

The development branch now tracks the full workspace, preserving the existing Git history. Amplify uses the root `amplify.yml` and `AMPLIFY_MONOREPO_APP_ROOT=app` on development. The existing public environment variables were preserved. Git pushes rebuild only the frontend; this change does not release the API or run schema migrations.

## Sign-in repair — October 10, 2026

The first full-workspace frontend release exposed missing deployed configuration: Amplify lacked `NUXT_PUBLIC_COGNITO_DOMAIN`, and Lambda/API Gateway still ran the starter API. Applied the existing Terraform sign-in settings, enabled the intended Cognito self-signup flow, deployed the implemented Lambda with restricted DSQL connectivity, and imported the product API routes. API Gateway rejected YAML aliases during the first import; the contract now expands those aliases explicitly. Generated client types are unchanged and all 34 API tests pass. The Amplify frontend must rebuild after the environment change. User credential entry and a real authenticated account bootstrap still require user verification.

The first configuration-only rebuild still served empty public runtime settings: Amplify build variables are not automatically present in the SSR compute process. Nuxt now captures the four public API/Cognito values as build-time defaults, while retaining runtime overrides. No secrets are embedded.

## Non-versioned API release — October 12, 2026

The frontend's removal of `/v1` initially reached Amplify while API Gateway and Lambda still used versioned routes, causing `POST /me/bootstrap` to return 404. Built and deployed the current API through Terraform: API Gateway, Lambda, and the development alias were updated in place, with no resources added or destroyed. The alias now points to Lambda version 3. All 34 local API tests passed. Live unauthenticated `POST /me/bootstrap` now returns the expected 401, and `GET /health` returns 200. An authenticated account bootstrap still requires user verification.

## Configuration Editor API release — October 12, 2026

Deployed the current API after development database migration 0003. Terraform updated API Gateway, the Lambda bundle, and its development alias in place: zero resources added, three changed, zero destroyed. The development alias now points to Lambda version 4.

All 44 local API tests passed and the API bundle built successfully. Live checks returned HTTP 200 for health and HTTP 401 for unauthenticated principal list/create and taxonomy list requests. Both principal routes use the JWT authorizer. The preceding database verification passed through the actual runtime IAM role, including principal uniqueness, reassignment/history, filtering, and restricted grants; see the database ledger. A real signed-in browser end-to-end check remains outstanding.

This release targets development only. Git pushes to development trigger Amplify for the frontend; Terraform remains the API deployment mechanism. Staging and production were not modified.

## Fastify API release — October 12, 2026

Merged the completed Fastify refactor `529c201934f331a8743dc310fdd54cfa6cb344d1` into development by fast-forward from `570c9f3`, then pushed development. The package now lives in `server/`, with named service operations and explicit Fastify routes. OpenAPI and generated frontend types are unchanged.

A fresh, reviewed Terraform plan applied successfully: zero resources added, three updated in place, zero destroyed or replaced. Updates were the Lambda artifact, its development alias, and the pre-existing Gateway description/default-tag difference. No route/auth/CORS/environment/schema changes were introduced. The development alias points to Lambda version **5**, `Active` / `Successful`, with code SHA-256 `HfXz7ju/nGarOxjQauKPyYBwZ0buTZoYF8OoiwTu14I=` matching the Terraform archive. The post-apply plan reported **no changes**. Runtime remains Node 22 / ARM64 and handler remains `index.handler`.

Amplify development job **9** for `529c201` completed BUILD, DEPLOY, and VERIFY successfully at 15:53:37 PDT. The released frontend root and login page returned HTTP 200. API health returned 200 with no-store; unauthenticated session/bootstrap/principal requests returned 401; the removed `/v1/me` route returned 404. All **23 live Gateway routes** exactly match OpenAPI; health is public and every other route uses JWT authorization. Configured-origin CORS preflight returned 204 with permission; an unconfigured origin received no permission.

Live verification used a dedicated Cognito account with email delivery suppressed. Actual hosted-login PKCE exchange, access-token scope, and Cognito userInfo verification succeeded. Authenticated requests through Gateway and Lambda verified idempotent bootstrap, profile read/update, organization and member reads, last-admin protection, quote pagination and owner reassignment, shared principal create/list/uniqueness, taxonomy create/read/filter/preview, no-op and changed saves, stale-version conflict, and archive behavior. A fresh token for the same account with unverified email was rejected with `403 EMAIL_UNVERIFIED`. These checks exercised the actual deployed runtime IAM/DSQL connection, rather than injected claims or mocked services.

All dedicated database records (including audit, quote, taxonomy/version, principal, organization/membership, and user records) and the Cognito account were deleted; absence was verified. Existing user data was preserved. No database migrations were run. Structured evidence is [2026-10-12-fastify-verification.json](deployments/2026-10-12-fastify-verification.json), with timestamps and Gateway request IDs but no credentials or tokens. The 53 API, 12 database, 22 browser regressions and type checks from the implementation record remain passed. Staging and production were not modified.

The previous published Lambda version **4** remains available for rollback; a rollback would require deliberate alias/state reconciliation. No rollback was needed.

## Admin settings and read authorization release — October 12, 2026

Waited for the settings subpage and taxonomy editor layout tasks to finish, then
committed and pushed their combined changes with the read authorization fix as
`3ad2d2a94fb8d95bcc38e6f77f157577fc5f91e2` on development. Settings now have
separate General Information, Product Configurations, and Principals pages.
The editor uses the available width, visible field borders, and US currency
display. Page reads check access once within their transaction snapshot without
updating user/organization authorization guards. Mutations retain guard writes
and taxonomy version checks; the interim read retry workaround was removed.

Validation passed: **69 server tests**, **31 frontend tests**, frontend type
checking, server build, and bundled Lambda verification. The reviewed Terraform
plan updated only the API Lambda and its development alias: **0 added, 2 changed,
0 destroyed**. The alias now targets version **6**, `Active` / `Successful`, with
code SHA-256 `mm0m1363WEyCszwXGsQ6CyLNXr9975SM4wT3yc3jrX4=` matching the archive.
The post-apply Terraform plan reported **no changes**.

Amplify development job **10**, for the same source commit, completed BUILD,
DEPLOY, and VERIFY successfully at **16:17:51 PDT**. The frontend root and login
page returned HTTP 200. Live API health returned 200; unauthenticated taxonomy
and principal lists returned 401. This release
did not perform a new authenticated live browser check. No database migrations
were required. Staging and production were not modified. Published Lambda
version **5** remains available for a deliberate alias/state rollback.

## Quotes editor release — October 12, 2026

Database migration 0004 is applied and verified in development. Quote writes were paused by temporarily reserving zero Lambda concurrency and draining existing invocations, then the original unreserved setting was restored. No existing quote rows needed backfill. Live quote verification through a dedicated temporary Lambda using the runtime IAM/SQL role passed eleven checks, and all fixtures/the temporary function were removed. See the database ledger.

The reviewed release plan changed only the API bundle, development alias and Gateway (0 added, 3 changed, 0 destroyed). The first Gateway import rejected YAML aliases; Lambda/alias reached version 8, then an expanded contract and fresh Gateway-only plan completed the route/CORS release. All 26 live routes match OpenAPI and use JWT except health. Health returned 200, anonymous quote detail/create/update returned 401, and the configured-origin PUT preflight returned 204 with PUT allowed. Version 8 is Active/Successful with SHA-256 `U1uyPcNomdnoFhjtHB2XzNgN7Y6GvfCNNkfQhsx4jrc=`. Amplify job 12 for source commit `9cb92df3db7c2bfde0b80706a26d3423ffa5be4e` passed BUILD, DEPLOY and VERIFY at 18:46:47 PDT. The live root, login and new-quote route returned 200; a released client asset contains the new quote editor. Gateway description/default tags reset by the import were reconciled with a reviewed metadata-only plan, and the final Terraform plan reported no changes. Staging and production are unchanged.

Quote release verification is recorded in [2026-10-12-quotes-verification.json](deployments/2026-10-12-quotes-verification.json). Local checks passed: 79 API tests, 12 database regressions, 41 full browser regressions, nine focused quote checks, three HTTP/OIDC browser regressions, typecheck and production builds. Live quote persistence was verified through the runtime IAM/SQL role; the signed-in browser flow was not repeated against a real user account in this release. Published Lambda version 7 remains available for rollback; retain the additive quote data column if rolling the application back.
