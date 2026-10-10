# Quotes development infrastructure

Terraform is run locally. Only Amplify rebuilds automatically when `development` is pushed to `https://github.com/milescwatson/quotes`.

The Git repository begins at the parent workspace. It tracks `app/`, `AWS/`, `database/`, `design/`, and `tasks/` together. Local credentials, Terraform state, and build artifacts are excluded.

## Scope

This first deployment provisions Amplify Hosting, Aurora DSQL, Cognito, an OpenAPI HTTP API with Lambda, daily seven-day backups, and basic CloudWatch alarms. It hosts the existing Nuxt starter. Only `GET /health` and authenticated `GET /v1/session` are implemented; product endpoints, database schema/role bootstrap, user sign-in UI, and recovery drills remain application/operations work.

Development account: `415221799122`, name `quotes-development`, region `us-west-2`. Staging and production are not deployed.

## AWS access

```sh
aws sts get-caller-identity --profile quotes-development
```

On this machine, browser authentication uses the `quotes-development-login` profile. Its cache is in the user-owned `~/.cache/quotes-aws-login` directory because `~/.aws` is root-owned. The `quotes-development` profile uses a credential process so both Terraform and the CLI can consume refreshed credentials without saving static keys. To renew:

```sh
AWS_LOGIN_CACHE_DIRECTORY="$HOME/.cache/quotes-aws-login" aws login --profile quotes-development-login --region us-west-2
```

## Terraform

Run from the parent project directory. Review the plan before applying. Account allowlisting prevents applying this root to a different account.

```sh
export AWS_PROFILE=quotes-development
terraform -chdir=AWS/environments/development init -backend-config=backend.hcl
terraform -chdir=AWS/environments/development plan -out=development.tfplan
terraform -chdir=AWS/environments/development apply development.tfplan
terraform -chdir=AWS/environments/development output -json deployment
```

Local `development.auto.tfvars` and `backend.hcl` contain the selected deployment inputs and are ignored. Their shape is documented in `terraform.tfvars.example` and the bootstrap script. Commit provider lock files when this folder is placed under version control. Terraform state and native S3 lock files live in the versioned, encrypted, private `quotes-development-tfstate-415221799122-us-west-2` bucket. Bootstrap and application use separate state keys. Do not delete the state bucket or manually edit state.

`AWS/scripts/bootstrap.sh ACCOUNT_ID` creates the state bucket for a fresh deployment and migrates its initial local bootstrap state to S3. It must only be run with a verified development account ID; future environment bootstraps require their own names/configuration.

## Amplify

The one-time GitHub App repository connection is established through the AWS console and imported into Terraform, avoiding storing a GitHub access token in Terraform state. The connection is restricted to the Quotes repository. Terraform owns subsequent settings. The root `amplify.yml` uses Node 22, builds from `app/`, and deploys its `.amplify-hosting` output. The development branch sets `AMPLIFY_MONOREPO_APP_ROOT=app`.

Pushes to `development` rebuild only the frontend. Apply any backward-compatible infrastructure/API changes locally before pushing dependent frontend changes. Do not add Terraform or migrations to Amplify's build commands. A frontend push does not deploy local `AWS/` changes.

## Database and operations

The initial Lambda has `dsql:DbConnect` scoped to the cluster; the development schema and restricted SQL role mapping are now installed (see the [database deployment ledger](../database/DEPLOYMENTS.md)), and the health endpoint deliberately does not claim database readiness. Before business APIs ship, create dedicated application/migration roles with IAM mappings and validate the relevant schema and transaction behavior against DSQL. The [taxonomy MVP](../design/taxonomy/api-specification.md) implements ordered JSONB versions, valid-only explicit saves, and expected-version conflicts without automatic retries locally; its development schema is installed and smoke-tested; application release and concurrency validation remain pending. See the [implementation record](../tasks/3000/implementation.md). Do not grant the runtime `dsql:DbConnectAdmin`.

Database, Cognito, backup vault, and state have deletion protections. Backup schedules are not proof of a successful restore. Record a backup and restore drill before relying on the service for valuable data.

Set `notification_email` to provision an email alarm subscription and a $25 monthly account budget alert. Confirm the SNS subscription email. Until configured, the SNS topic has no email subscriber and the budget resource is not created; alarms alone do not notify a human. This alert does not impose a spending cap.

The new account currently has a total Lambda concurrency quota of 10. The API uses unreserved concurrency (`-1`) because AWS requires an unreserved pool when configuring reservations. Revisit an explicit reservation after a quota increase. API Gateway throttles are still configured.

Current notifications are configured for `mc.watson415@gmail.com`, and the SNS subscription is confirmed. The $25 monthly budget sends an actual-cost alert above 80% ($20); it is not a spending cap. Deployment verification is recorded in [DEPLOYMENT.md](DEPLOYMENT.md).
