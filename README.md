# Quotes

The repository contains the complete Quotes workspace:

- [app](app/README.md): Nuxt frontend, identity UI, and quote catalog.
- [AWS](AWS/README.md): Terraform, OpenAPI contract, and Lambda API.
- [database](database/README.md): versioned schemas, grants, and database tests.
- [design](design/taxonomy/specification.md): product and API specifications.
- [tasks](tasks/3000/implementation.md): implementation records and validation.

See [database deployment status](database/DEPLOYMENTS.md) for the versions applied to development, staging, and production.

## Development

Run frontend commands from `app/`, API commands from `AWS/api/`, and database tests from `database/`. Each Node project has its own package manifest and lockfile. Generate frontend API types with `npm --prefix app run generate:api`.

Pushes to `development` trigger the Amplify frontend build configured in the root `amplify.yml`, with `app/` as its application root. A Git push does not deploy the Lambda API, apply Terraform, or run database migrations; those are separate releases.

Credentials, local environment files, Terraform state/plans, dependencies, and build outputs are excluded from Git. Environment examples, dependency locks, schema sources, and deployment evidence are tracked.
