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

## Hyphenated option codes — October 12, 2026

Commit `cf4b0e8f8f70a6b7d004ab68db106de1c969597b` allows hyphens inside option codes while continuing to reject whitespace. The change is validation-only; no database migration or API contract route change was needed. The API bundle and development alias deployed through Terraform with **0 added, 2 changed, 0 destroyed**. Lambda version **10** is Active/Successful with code SHA-256 `KI7pu00WBwMVAUw0iqlUqRYN8ZqDmZPVGmcpQ6DqRGE=`; the post-apply Terraform plan reported no changes.

Amplify development job **14** for this commit passed BUILD, DEPLOY, and VERIFY. The development root, login, and new-quote routes returned HTTP 200. API verification returned HTTP 200 for health, HTTP 401 for anonymous quote reads/writes, and HTTP 204 for configured-origin PUT preflight. Staging and production were not modified.

## Administrator roles and sharing — October 13, 2026

Integration `31c8e4b` and pagination/auth regression fix `f68defd` are pushed to development. Migration 0005 completed with API traffic paused. The reviewed Terraform release updated Lambda, its development alias, and Gateway (0 added, 3 changed, 0 destroyed). Lambda version **11** is Active/Successful with archive-matching SHA-256 `n0KfrEivUQXs3WCtFDzg34uEhhG5mPQNrJEdFz4kV4k=`. All **30** routes match OpenAPI and require JWT except health. Gateway description/version/tags were reconciled after import.

Amplify development job **20** for `f68defd` passed BUILD, DEPLOY and VERIFY. The original unreserved API concurrency was restored through a reviewed concurrency-only plan after frontend verification. The final Terraform plan reports **no changes**. Live frontend/login and API health returned 200, anonymous business reads returned 401, and configured-origin PUT preflight returned 204.

Validation passed: 92 API tests, 12 database tests, all 52 browser cases (two artifact cleanup errors passed on isolated rerun), 10 quote-list regressions after the pagination fix, three HTTP/OIDC auth regressions, typecheck, production builds, and actual bundled Lambda invocation. Six live checks through the restricted runtime IAM/SQL role passed; all fixtures were rolled back and the temporary function removed. A real signed-in Cognito browser check was not run because no user session/token was available.

Evidence: [task 6000 release verification](../tasks/6000/development-verification.json), [0005 migration journal](../database/deployments/development-0005.json), and [restricted-role validation](../database/deployments/development-0005-validation.json). Staging and production are unchanged. Retain 0005 data and roles; version 10 is incompatible with the migrated membership-role constraint.

## Regular products and quote price multiples — October 14, 2026

Source commit `67e2da77910ff3d4bbc8abf5ed4588312ac8f239` is pushed to development. Migration 0006 completed with API traffic paused, including the regular-product catalog, quote multiple default, bounded backfill, validated constraints and runtime grants. The existing quote contents and modification token were preserved.

The reviewed Terraform release changed only the API bundle, development alias and Gateway: **0 added, 3 changed, 0 destroyed**. Lambda version **12** is Active/Successful with archive-matching SHA-256 `DgHLcERAGYs3AzVZn+5+7AlZ1cyFTwF1zma/p5a1Jao=`. Gateway metadata was reconciled with a reviewed metadata-only plan. All **33** routes match OpenAPI and use JWT except health.

Amplify development job **22** for the same source commit passed BUILD, DEPLOY and VERIFY at **18:46 PDT**. The released regular-product and quote-editor assets contain the new catalog, freeform part picker and compound pricing controls. After frontend verification, a reviewed concurrency-only plan restored the original unreserved API concurrency. The final Terraform plan reports **no changes**. Frontend/root/login/catalog/quote pages returned 200, API health returned 200, anonymous business requests returned 401, and configured-origin PUT preflight returned 204.

The corrected DSQL migration passed 99 server and 13 database regressions locally before release. The preceding implementation passed 15 quote-editor browser scenarios, typecheck and builds. At the user's request, no live test users or fixtures were created and functional product/pricing verification is left to the user. Staging and production are unchanged. Retain the additive schema; the older writer is incompatible with mixed regular/freeform quote lines.

Evidence: [release verification](deployments/2026-10-14-products-verification.json) and [migration journal](../database/deployments/development-0006.json).

## Principal selection for regular products — October 14, 2026

Source `bc6836e69716155f1465aa3c465c7cabaf25d58c` is released to development with migration 0007. Regular products independently select or clear a shared principal. Catalog and picker display/search include the principal, and newly added regular quote lines snapshot its ID/name. Existing quote snapshots remain fixed. Older clients omitting principalId preserve an existing assignment on update.

The reviewed release updated only Lambda, the development alias and Gateway (0 added, 3 changed, 0 destroyed). Lambda **13** is Active/Successful with archive-matching SHA-256 `Oq+jMZRhOLSIA0rS9oWI6R2TG9idhioxOm1Eui7h+Do=`. Amplify job **23** passed BUILD/DEPLOY/VERIFY for the same commit. Gateway metadata was reconciled and original unreserved concurrency restored after asset verification. All 33 routes retain expected authorization. Live health, anonymous auth, CORS and principal-selector assets passed; the final Terraform plan reports no changes.

Local validation passed 100 server tests, 13 database tests, 15 quote-editor browser tests, frontend typecheck/production build and backend build/bundle verification. Live functional testing remains deferred to the user; no live test users or fixtures were created. Staging and production were not modified.

Evidence: [release verification](deployments/2026-10-14-product-principals-verification.json) and [migration journal](../database/deployments/development-0007.json).

## Owner quote archive and restore — October 14, 2026

Source commit `6b85bb76b75b4da5d615b3995999f2f838727d54` is pushed to development. Migration 0008 added the nullable quote archive timestamp and restricted runtime column grants. The API was paused and drained for migration, then deployed and returned to its previous unreserved concurrency after the frontend release.

The reviewed Terraform release changed only the Lambda bundle, development alias, and API Gateway OpenAPI routes: **0 added, 3 changed, 0 destroyed**. Lambda version **14** is Active/Successful with archive-matching SHA-256 `dZLqQ137hUC4Tsg6kDVKS1gxPxHGzIUdS7ej3r9W+Mw=`. Both archive and restore routes use JWT authorization. Amplify development job **24** passed BUILD, DEPLOY, and VERIFY for the same commit. The hosted root and login page returned HTTP 200; API health returned 200; unauthenticated archive, restore, and archived-list requests returned 401. A final Terraform plan reports no changes.

Frontend typecheck and Amplify production build passed, as did the server build and bundled Lambda verification. Automated tests and authenticated live owner workflows were not run for this release. Staging and production were not modified.

Evidence: [release verification](deployments/2026-10-14-quote-archive-verification.json) and [migration journal](../database/deployments/development-0008.json).


## On-demand quote PDFs and quote editor updates — October 15, 2026

Source commit `58ad06f72d76e0a36e72684a9571f61ffb71cec9` is released to development. It includes the pending quote header/navigation updates, removal of line-level multiples in favor of the quote multiple, and working Preview PDF/Download PDF actions. PDFKit renders saved snapshots on demand in a simple multipage US Letter layout. Customer-visible option additions are after the quote multiple and per unit; main line totals retain the existing quantity-extension and rounding rules. No S3 PDF storage or database migration was introduced.

The reviewed Terraform release changed only the Lambda bundle, development alias, and Gateway contract (0 added, 3 changed, 0 destroyed). Lambda **15** is Active/Successful with archive-matching SHA-256 `9p9DG/2McY9eHk3ofX1iDSitDkqED4jv3+ML9v1HKYU=`. All **36** routes match OpenAPI and use JWT except health. The PDF route rejects anonymous requests with 401, and GET preflight passes for the hosted frontend and localhost. A metadata-only reconciliation restored Gateway description/version/tags after import; the final Terraform plan reports **no changes**.

Amplify development job **28** for the source commit passed BUILD, DEPLOY, and VERIFY. Hosted root/login return 200 and the released client asset includes the PDF actions. An existing saved quote was opened read-only in the local frontend using the deployed API: Preview opened in Chrome's PDF viewer, and Download saved a valid PDF whose total matched the saved quote. No live test users or quote mutations were created for verification. The original editor tab and its unsaved changes were preserved.

Local verification passed 105 API tests, 13 database tests, all 59 browser cases (three cases passed on focused reruns after stale/timing-dependent test interactions were corrected), three HTTP/OIDC regressions, frontend typecheck/build, server build, and isolated deployment-bundle PDF/font checks. Single-page and multipage PDF visual/text checks passed. Staging and production were not modified. Published Lambda version 14 remains available for a coordinated rollback; restoring its writer would require the matching frontend and compound-multiple behavior.

Evidence: [PDF release verification](deployments/2026-10-15-pdf-verification.json). Product-picker edits made locally after the source commit are outside this release.

## Organization logos — October 15, 2026

Organization logo settings are released to development. Administrators can upload,
replace, preview, and remove a PNG/JPEG independently of company details. The API
normalizes still images within 1024 × 1024 pixels, preserves transparency, and
rejects files over 2 MiB, images over 16 megapixels, APNG/other animated formats,
and normalized PNGs at or above 1 MiB. Newly generated PDFs use the current logo.

Migration **0009** added the nullable UUID reference and runtime column permission
without a traffic pause. Terraform created the five private bucket resources and
updated API/Lambda permissions and routes, with no deletions. A subsequent
validation release explicitly rejects APNG chunks because Sharp/libvips exposes
only their still frame. Lambda **18** is Active/Successful with archive-matching
SHA-256 `BS83Utp0tZ8bW7l909U226Qv/gnhE36pPxxjFr3AIXY=`. All **39** routes match
OpenAPI and require JWT except health. GET/PUT/DELETE logo routes reject anonymous
requests; frontend CORS preflights pass. Bucket public-access blocking, owner
enforcement, AES256 encryption, and TLS-only policy are verified. The final
Terraform plan reports **no changes**.

Amplify development job **29**, source
`ed53dc8a82a59ddb0e11de3459cdc6fd70527bff`, passed BUILD, DEPLOY, and VERIFY.
The hosted client contains the logo upload/removal controls. The server-only APNG
validation update does not require another frontend build.

Verification passed **118 server tests**, **13 database tests**, the eight
organization/logo browser cases (plus a focused rerun confirming unsaved company
details survive logo uploads), frontend typecheck, production builds including a
clean committed-source build, isolated host bundle checks, and Terraform validation.
Wide, tall, transparent, and multipage PDF samples were rendered and visually
checked. A temporary ARM64 Lambda ran the actual deployment archive with a
smoke-only synthetic identity lookup and the restricted production database role:
real S3 upload/read/replace/remove, anonymous S3 rejection, binary PNG transport,
logo PDF embedding, Sales permissions, and repeated removal all passed. Database
fixtures rolled back, uploaded objects were removed, and the temporary Lambda
was deleted. The production identity verifier was unchanged. Staging and
production were not modified. Existing local product-picker work remains outside
this release.

Evidence: [migration journal](../database/deployments/development-0009.json),
[release verification](deployments/2026-10-15-logo-verification.json), and
[Lambda runtime verification](deployments/2026-10-15-logo-runtime-verification.json).

## Queue-backed quote PDFs — October 15, 2026

Source commit `3d235f9f004de2c9c5ed77f3d7c4f710a6d6bf9f` is released to
**development**. The release also includes the pending expanded product browser
and quote location/author features. Additive migration **0010** and the separate
read-only worker database role were installed before updating the API. Existing
quote fields and tokens were preserved; no historical author was inferred.

The reviewed Terraform release created **15** resources and updated **3**, with
no deletions or replacements. It provisions the private, encrypted, TLS-only,
versioned PDF bucket, FIFO SQS queue/dead-letter queue, worker Lambda, event
source mapping, logs, and restricted IAM permissions. Lambda API version **19**
is Active/Successful. Both ARM64 functions match archive SHA-256
`qeAFq6zLu4vCmkgotOYLzdsbeml98iUDmQwz73XhQhs=`. All **40** Gateway routes
match OpenAPI and require JWT except health. Gateway metadata was reconciled
with a reviewed metadata-only plan; the final Terraform plan reports **no changes**.

Live runtime verification sent an existing quote through the real SQS event
source and read-only worker role. The worker generated a versioned PDF with
embedded fonts. Recent quotes returned the blob fallback; the five-minute
boundary returned version-pinned URLs with a 60-second TTL. Inline and attachment
S3 downloads returned valid PDFs, stale tokens were rejected, and unsigned S3
reads returned 403. No quote or user records were changed. The generated PDF was
retained for its existing quote, the temporary verification Lambda was deleted,
and the dead-letter queue is empty.

Amplify development job **30** passed BUILD, DEPLOY, and VERIFY for the same
source commit. Hosted root/login pages return 200, and the released quote-editor
asset contains the signed-URL export path and Job Location controls. API health,
anonymous PDF-route rejection, configured-origin CORS, bucket security, queue
retry/visibility settings, and enabled worker mapping all passed verification.

Local checks passed **130 server tests**, **13 database tests**, **22 relevant
browser scenarios**, frontend type checking/build, host deployment-bundle checks,
and actual Linux ARM64 runtime checks. Staging and production were not changed.
Lambda version 18 remains available; any rollback must coordinate the frontend
and API while retaining the additive schema and stored PDFs.

Evidence: [release verification](deployments/2026-10-15-queued-pdf-verification.json),
[runtime verification](deployments/2026-10-15-queued-pdf-runtime-verification.json),
and [0010 migration journal](../database/deployments/development-0010.json).
