# Quotes UI

Nuxt application for account sign-in, organization switching, profiles, direct team membership.

## Local preview

```sh
npm ci
cp .env.example .env
npm run dev
```

Open `http://localhost:3000` and choose **Open demo workspace**. The demo menu offers admin, member, and no-organization scenarios. Demo data persists only in this tab's session storage; resetting the scenario resets it. These screens do not create real memberships .

Fixtures require both development mode and `NUXT_PUBLIC_IDENTITY_FIXTURES=true`. Production builds exclude the fixture module even if that flag is accidentally set. An HTTP failure never enables fixtures.

## Cognito and API integration

Set fixtures to false and supply:

- `NUXT_PUBLIC_API_BASE`: API Gateway origin, without `/v1`.
- `NUXT_PUBLIC_COGNITO_USER_POOL_ID`: environment-specific user pool ID.
- `NUXT_PUBLIC_COGNITO_CLIENT_ID`: public app client ID.
- `NUXT_PUBLIC_COGNITO_DOMAIN`: full HTTPS Cognito domain origin.

The client uses `oidc-client-ts` for authorization code + PKCE. Tokens stay in memory; session storage holds only the temporary OAuth interaction state. On a full browser reload, return through hosted sign-in to obtain fresh tokens; Cognito's own login session can avoid another password prompt. While the app stays open, the client uses its in-memory refresh token when available. Logout attempts revocation, clears local account data, and visits Cognito logout. Register `/auth/callback` and the frontend origin as callback/logout destinations.

Authenticated API data loads only in the browser; it is never serialized into SSR HTML. Role-dependent navigation is presentation only. The API checks membership on every request. Route changes abort page requests, and session changes reject stale results.

## Checks

```sh
npm run typecheck
npm run build
npx playwright install chromium
npm run test:e2e
npm run test:auth
```

The first browser suite uses explicit demo fixtures. The second exercises the real OIDC and HTTP adapters with mocked authorization/token/API endpoints, checks PKCE and callback state, and verifies that tokens are not persisted. Neither suite contacts a live Cognito account or DSQL cluster.

Response types are generated from the sibling API contract and committed:

```sh
npm run generate:api
```

This command needs the full workspace with `../AWS/openapi.yaml`; ordinary frontend builds use the committed generated file.

## Development release

Pushes to `development` rebuild only the Amplify frontend. The API and Terraform live in the sibling `AWS/` folder in this repository. The root `amplify.yml` sets the frontend application root to `app/`. Coordinate the backend/schema/Cognito deployment before pushing a UI that depends on it. See `../tasks/1000/implementation.md` and `../AWS/api/README.md` in the full workspace.

Admins add an existing account by email and role from Members. Users must sign in once to initialize their account. Membership is immediately available through the API; the organization chooser refreshes on focus and every 30 seconds while visible. No acceptance or email delivery is required.

This change does not deploy resources, run database migrations, or create organizations. Deploy the matching API contract and bundle with the frontend.
