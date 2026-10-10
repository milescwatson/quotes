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
