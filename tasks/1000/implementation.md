# Identity and organization UI implementation

Implemented locally on October 10, 2026. Deployment and cloud acceptance remain pending.

## Delivered

- Responsive Nuxt application shell with organization switching, profile, incoming invitations, and role-aware navigation. Admin screens provide member roles/removal, invitations, and organization-name editing.
- Loading, empty, retry, expired-session, revoked-access, and invitation lifecycle states. Destructive member actions use keyboard-accessible confirmation dialogs. Organization navigation aborts old requests and clears scoped content.
- Cognito hosted authentication through authorization code with PKCE, callback validation, safe return destinations, token refresh, and logout. Cognito owns signup, email verification, and password recovery. Tokens stay in memory; a full page reload returns through hosted authentication rather than persisting tokens in browser storage.
- Explicitly enabled development fixtures with admin, member, and no-organization scenarios. Production excludes the fixture implementation even when its public flag is accidentally enabled.
- Typed HTTP client generated from the expanded OpenAPI contract. The Lambda implements bootstrap/profile, organizations, members, and invitation endpoints with current Cognito identity checks, database transactions, authorization, audit events, and atomic email-outbox insertion.
- Infrastructure source changes for public signup, mutation CORS, frontend Cognito configuration, and a bundled Lambda using the dedicated DSQL database role.

## Local validation

- Nuxt TypeScript checks and production builds, including the AWS Amplify preset.
- Ten Playwright workspace tests covering navigation, profile updates, invitation acceptance/replay, wrong recipient and expiry, admin operations, last-admin protection, no-organization states, request failures, lost access, mobile navigation, dialog focus, and stale responses.
- Two Playwright authentication tests using the real OIDC client and HTTP adapter against mocked endpoints: PKCE/callback/return-destination handling and rejection of unsolicited callbacks. These do not use live Cognito credentials.
- Thirteen API tests reported by Node's test runner, including the parent service suite. Tests use the actual schema in local PostgreSQL-compatible PGlite with asynchronous index syntax adapted for local execution, plus authentication-boundary and serialization-retry tests.
- Lambda bundle build and development Terraform validation. Local SQL checks do not establish DSQL compatibility or concurrent behavior on the live service.

## Run and review

From `app/`:

```sh
npm ci
NUXT_PUBLIC_IDENTITY_FIXTURES=true npm run dev
npm run typecheck
npm run test:e2e
npm run test:auth
NITRO_PRESET=aws-amplify npm run build
```

Open `/login` and choose **Open demo workspace**. The demo scenario selector is available in the sidebar. See [frontend instructions](../../app/README.md) for real authentication configuration.

Reviewed previews: [login](screenshots/login.png), [invitation](screenshots/invitation.png), [members](screenshots/members.png), and [mobile organizations](screenshots/mobile-organizations.png).

From `AWS/api/`, run `npm ci`, `npm test`, and `npm run build`. Terraform packages the resulting `dist/` directory, so the bundle must exist before planning or applying infrastructure. See [API instructions](../../AWS/api/README.md).

## Release dependencies

1. Apply the [identity schema and grants](../../database/versions/0001/identity/) with checkpointed DSQL DDL and completed asynchronous indexes. Map the Lambda IAM principal to `quotes_api`; verify access using that runtime role.
2. Provision an initial organization and admin invitation through the separate operator workflow. Organization creation and operator administration have no public UI in this task.
3. Apply the reviewed Terraform/OpenAPI changes and publish the frontend with matching Cognito/API configuration. No infrastructure was applied and no deployment-triggering push was made during this implementation.
4. Implement/configure the separate SES outbox worker before promising invitation delivery. This API queues email transactionally; it does not send it. The UI reports queued invitations accordingly.
5. Complete [live identity validation](../../design/identity/validation.md), particularly Cognito signup/verification/recovery, DSQL foreign keys and role grants, concurrent bootstrap/acceptance/final-admin mutations, transaction rollback, and SES retry/delivery.

The existing Git repository covers `app/` only. The API, infrastructure, and design/task documents are outside that repository and need their own release/version-control handling. Taxonomy storage and taxonomy/quote UI were not changed.
