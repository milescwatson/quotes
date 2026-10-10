# Quotes schema and list

The Quotes screen is scoped to an active organization. Admins, editors, and members can list quotes and assign their owners. Creation, other quote edits, deletion, customer management, and quote details remain future work.

## Storage and attribution

Apply [schema.sql](../../database/versions/0001/quotes/schema.sql) after the identity schema. Quote IDs use the existing database-generated bigint identity convention. Organization and modifier references are bigint foreign keys to the existing tables. The API encodes those bigint IDs as decimal strings to preserve precision. Customer ID is a nullable PostgreSQL integer, represented by a JSON number or null; no customer table or foreign key exists yet.

Customer Name and Project Name are independent required fields, trimmed and limited to 120 characters each. Duplicate names and titles are allowed. The service derives `title` as `customer_name + ' - ' + project_name` so there is no separately editable title to become stale.

`modified_by` is a required user reference, and `modified_when` defaults to database time on insertion. Future mutation endpoints must use the authenticated application user and set both values in the same transaction. No modification timestamp trigger is provided; the owner-update service maintains attribution transactionally. Disabled users and removed memberships retain their historical attribution; the current display name, or email when no display name exists, supplies `modifiedByName`.

## List contract

`GET /v1/organizations/{orgId}/quotes?page=1&pageSize=50` returns `{ items, page, pageSize, totalItems, totalPages }`. The [OpenAPI contract](../../AWS/openapi.yaml) defines item fields and errors. Defaults are page 1 and 50 items, with a maximum page size of 100. Invalid, nonpositive, fractional, or unsafe integer inputs return 422.

The API authorizes the current viewer before reading rows or totals, using the same user and organization transaction guards as the identity service. Count and list queries use the authorized organization ID in one transaction. Sorting is `modified_when DESC, id DESC`; pagination uses LIMIT/OFFSET. Empty organizations return zero total pages. Out-of-range pages return empty items with accurate totals. Each request reflects current data, so concurrent changes can move rows between separate page requests.

The frontend uses Previous/Next controls, retains the last successful page on a transient failure, and retries the requested page. It returns to the last available page if the requested page disappears. Organization changes reset to page 1, cancel old requests, and clear data; authorization failures clear rows as well. Browser organization aliases are resolved by the existing identity adapter before API calls.

## Local checks and preview

From `AWS/api`, run `npm test` and `npm run build`. The quote tests run the real schema and service against PGlite, including constraints, privileges, numeric ID precision, attribution, pagination, and authorization. The only DDL translation is `INDEX ASYNC` to `INDEX`; this is not a DSQL emulator.

From `app`, run `npm run generate:api`, `npm run typecheck`, `npm run test:e2e`, `npm run test:auth`, and `npm run build`. To run fixture browser tests alongside an existing dev server, set `PLAYWRIGHT_PORT=3200 NUXT_BUILD_DIR=node_modules/.cache/nuxt/quotes-e2e` for `npm run test:e2e`.

For manual review, run `NUXT_PUBLIC_IDENTITY_FIXTURES=true npm run dev`, open the demo workspace, choose an organization, and select Quotes. Fresh demo data includes Northstar (55 quotes), Forma (one quote), and Harbor (no quotes). Existing saved demo sessions retain their organizations; choosing a Demo scenario resets their data. Fixtures are unavailable in production.

## Database rollout and development seed

1. Verify the identity tables and runtime roles already exist with bigint identifiers. This task does not migrate an older UUID identity deployment.
2. Apply each statement in `schema.sql` separately with the deployment principal. Follow the existing DSQL checkpoint process; save the asynchronous index job ID and wait for success before releasing the API.
3. Apply [permissions.sql](../../database/versions/0001/quotes/permissions.sql) using the actual API and operator role names. API access includes SELECT and column-level UPDATE for owner_user_id, modified_by, and modified_when; the operator may insert development data. Quote grants supplement the existing identity grants needed for authorization guards.
4. In a development database only, apply [seed.sql](../../database/seeds/quotes.sql) with an existing active organization's `org_id` and an existing member's `actor_id`. Example: `psql "$DEVELOPMENT_DATABASE_URL" -v ON_ERROR_STOP=1 -v org_id=10 -v actor_id=1 -f database/seeds/quotes.sql`. The seed is one INSERT, generates new quote IDs, and adds rows on each execution. It does not provision identity records or modify existing quotes.
5. Build the Lambda bundle, deploy the OpenAPI-backed Gateway/Lambda and frontend through the existing release process, and verify authenticated list access and runtime grants on DSQL. Check isolation with a user lacking membership, numeric/null customer IDs, and multiple pages.

DSQL implementation references: [identity columns](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/sequences-identity-columns-overview.html), [foreign keys](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-foreign-key-constraints.html), and [asynchronous indexes](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-create-index-async.html). Local checks do not confirm cloud compatibility or live deployment.


## Filters and ownership

The list accepts optional `customer` and `project` parameters (up to 120 characters each), using trimmed, case-insensitive literal substring matches. SQL wildcard characters are treated literally. `ownerId` accepts a numeric user ID encoded as a string or `unassigned`. Filters combine with AND and affect both results and totals before pagination. Applying or clearing filters returns to page 1.

`owner_user_id` is a nullable bigint reference to users, separate from `modified_by`. Existing quotes stay unassigned rather than inferring ownership from their last editor. `ownerId` and `ownerName` are returned for each quote; historical ownership remains visible after a member leaves or is disabled.

`GET /v1/organizations/{orgId}/quote-owners` returns `{items: [{id, name}]}` for active, enabled team members. It is available to all active organization members and exposes only the identifiers and display labels needed for assignment, not the admin membership-management contract.

`PATCH /v1/organizations/{orgId}/quotes/{quoteId}` accepts only `{ownerId: string | null}` and returns `{success: true}`. Any active organization member may assign an enabled member of the same organization or clear the owner. Quote lookup is organization-scoped. The acting user and proposed owner are guarded before the organization, so concurrent disabling, removal, and ownership writes participate in the existing transaction conflict protocol. The same transaction writes the owner, acting user's ID, and database modification time. Concurrent successful edits use last-committed-write behavior.

The Tailwind filter toolbar uses compact customer/project buttons with focused search popovers, a team member dropdown, removable active values, and a conditional Clear filters action. Text filtering applies after a 300ms typing pause or Enter; owner changes apply immediately. Escape closes a popover and restores focus to its trigger; clicking or tabbing outside dismisses it. Pending text updates are canceled when the component unmounts. A labeled select in each row saves owner changes immediately and disables while saving. Failed saves restore the previous selection and display an inline error. The list refreshes after a successful save so filtering, order, counts, and attribution remain current.

For an existing database, apply [2001-owner.sql](../../database/legacy/quotes/2001-owner.sql) instead of recreating the quotes table, then reapply permissions.sql. Follow its statement checkpoints and wait for asynchronous constraint validation. Fresh databases use the updated schema.sql only. The migration follows the [DSQL ALTER TABLE process](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/alter-table-syntax-support.html). Neither migration nor grants were applied to a live database by this task.
