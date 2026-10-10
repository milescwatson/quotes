# Basic quotes schema and list implementation

Implemented locally on October 10, 2026. Database application and live deployment remain pending.

## Delivered

- [Quote schema](../../database/versions/0001/quotes/schema.sql), [permissions](../../database/versions/0001/quotes/permissions.sql), and a [development seed](../../database/seeds/quotes.sql). Quotes use database-generated numeric IDs and the existing bigint organization/user references; Customer ID is a nullable integer. Names are required and constrained, and titles are derived from customer and project names.
- An authenticated `GET /v1/organizations/{orgId}/quotes` endpoint in the existing Lambda service and OpenAPI-backed Gateway definition. It checks active membership for every role and scopes both rows and totals to the organization. Page-number pagination uses `page` and `pageSize`, defaults to 50 rows, and returns totals ordered by last modification and quote ID.
- A [Quotes page](../../app/app/pages/organizations/[orgId]/quotes/index.vue) and organization navigation entry with title, customer, project, modifier, and modification time. Previous/Next controls show page and quote totals. Loading, empty, retry, session-expiry, revoked-access, organization changes, and shrinking page counts are handled.
- Typed API responses and development fixtures for populated, multi-page, and empty organizations, including numeric/null Customer IDs and long project names. No quote mutation or detail UI was introduced.
- Isolated Nuxt build-directory and browser-test port overrides so tests can run alongside an existing dev server. Added Node type declarations for environment configuration and tightened the existing Organizations heading test selectors.

The current identity schema already uses bigint IDs; the implementation follows that schema and the plan has been aligned with it. Bigint IDs travel as strings in JSON to retain precision; the nullable integer Customer ID travels as a number.

## Validation

- API tests: 20 passing Node test-runner results, including parent suites. Covers constraints, numeric IDs beyond JavaScript's safe integer range, page offsets/totals, input errors, title/date serialization, all member roles, organization isolation, historical attribution, revoked access, runtime grants, and development seed behavior.
- Browser tests: 17 workspace checks, including seven quote scenarios for pagination, retry, role access, empty states, stale requests, access loss, mobile scrolling, keyboard controls, and screenshots.
- Three OIDC/HTTP-adapter browser checks, including the Quotes endpoint's initial failure/retry, last-page recovery, and revocation behavior. These use mocked identity/API servers, not live Cognito.
- Frontend type checking, normal production build, AWS Amplify production build, and Lambda bundle build.
- Desktop and mobile screenshots were inspected: [desktop](screenshots/quotes-desktop.png), [pagination](screenshots/quotes-pagination.png), and [mobile](screenshots/quotes-mobile.png).

Run the workspace and authentication browser suites sequentially; their default Playwright output directory is shared. See the [quote specification](../../design/quotes/specification.md) for commands and development preview instructions.

## Release steps

Apply the schema and grants to the development DSQL database using the existing checkpointed DDL process, verify the asynchronous index, and seed through an operator connection if needed. Then deploy the built Lambda/OpenAPI and frontend through the existing release workflow and verify real authentication, runtime privileges, and organization isolation.

No cloud schema changes, seed writes, infrastructure applies, or deployment pushes were performed. Local PGlite checks validate relational behavior but do not prove DSQL concurrency or deployment compatibility. Full rollout and seed instructions are in the [specification](../../design/quotes/specification.md).


## Follow-up: filters and editable owners

Added a reusable Tailwind filter panel for customer name, project name, and team member owner, including combined filters, active counts, clear/reset, and a distinct no-results state. Filtering is performed before pagination in both the API and demo fixtures.

Added nullable ownership distinct from modification attribution, a restricted owner-choice endpoint, and an organization-authorized owner-update endpoint. Inline owner selects save immediately, retain the prior value on failure, and refresh the list after success. Existing demo sessions are upgraded without losing their saved data.

The current schema and grants include ownership; existing databases use the additive [owner migration](../../database/legacy/quotes/2001-owner.sql). No cloud schema or grants were applied. The [specification](../../design/quotes/specification.md) documents role behavior, API contracts, and rollout.

Validation includes 23 API test-runner results, 19 workspace browser checks, frontend type checking, and API/Amplify builds. The additive migration is also tested against a populated pre-owner schema. New checks cover combined filtering, literal substring matching, pagination reset, invalid/cross-organization/disabled/removed owners, server attribution, persistence, unassignment, and failed saves.

## Follow-up: creation placeholder and filter layout

Added a primary New Quote link to `/organizations/{orgId}/quotes/new`, with an organization-authorized placeholder and Back to quotes navigation. The list moved to `quotes/index.vue` so the creation page is a sibling route rather than nested list content. No creation form or write endpoint was added.

Apply filters is now a text-width, 40px-high secondary button. All responsive grid layouts align items to the bottom, preventing the button from stretching to fill the label-plus-input row at tablet widths. New Quote is the primary page action.

Validated with frontend type checking and the relevant existing browser checks for navigation, filtering, desktop, and mobile layouts.


## Follow-up: compact filter toolbar

Replaced the boxed form with a compact toolbar above the table. Customer and project filters open focused search popovers; active values appear in the buttons and can be removed individually. Owner selection applies immediately, text searches apply after a 300ms typing pause or Enter, and Clear filters appears only when needed. Escape restores trigger focus, and outside clicks/tabbing dismiss the popover. Removed the Apply button.

Frontend type checking and all nine Quotes browser checks passed. Desktop and mobile screenshots were refreshed, and the desktop layout was visually reviewed.


## Follow-up: Quotes landing page and admin navigation

Quotes is the default authenticated landing page (the first accessible organization when opening the app or signing in without a return destination). Organization cards and the header switcher open Quotes directly. Legacy organization root URLs redirect to Quotes while preserving query strings and hashes. Users without organizations continue to the organization empty state. Explicit sign-in return destinations remain supported.

Removed Overview and the sidebar Settings link. Administrators of the current organization get Admin settings in the top navigation, with an accessible compact icon on mobile. Members retain profile access through the bottom-left account link.

Validated frontend type checking, the 19 existing workspace browser checks (with the corrected readiness assertion rerun), all three authentication browser checks (including default sign-in landing), and desktop/mobile visual review.
