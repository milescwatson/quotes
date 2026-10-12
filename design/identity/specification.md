# Identity and organization specification

Status: schema and application contract only. The API and UI live in the sibling server and app packages. This schema package does not deploy cloud migrations. See [schema.sql](../../database/versions/0001/identity/schema.sql), [permissions.sql](../../database/versions/0001/identity/permissions.sql), and [validation.md](validation.md).

## Decisions

- Cognito provides public email/password signup, verified email, password recovery, token issuance, renewal, and logout. The application stores no passwords or authentication tokens.
- Aurora DSQL stores profiles, organizations, memberships, and audit events.
- Users can belong to multiple organizations, with one independent role per membership. Signup grants no organization membership.
- Only a platform operator creates or archives organizations and disables application users. An operator is an authenticated, separately authorized AWS principal, not a special organization role or browser-supplied flag.
- Organization administrators add existing accounts by email; membership takes effect immediately.
- Taxonomy access is limited to the owning organization in the MVP. Sharing and subscriptions are deferred.

## Data model

The SQL is the field-level source of truth. IDs are database-generated bigint identity values (CACHE 1). Inserts omit the ID and use RETURNING; retries rely on business uniqueness constraints. IDs are decimal strings in API payloads to preserve 64-bit precision. Sequence values may have gaps after rollbacks. Timestamps use `timestamptz`; the service explicitly maintains `updated_at`. No update triggers are assumed. Historical references use restrictive foreign keys, with no cascading deletes.

| Table | Identity and lifecycle |
| --- | --- |
| `users` | Stable application ID and unique `(cognito_issuer, cognito_subject)`. Email is mutable profile data, never an account-linking key. `disabled_at` blocks business access. `auth_revision` is a transaction conflict guard. |
| `organizations` | ID, nonunique display name, `pending`/`active`/`archived`, timestamps, and transaction guard `auth_revision`. Archive retains every related record. |
| `organization_memberships` | ID and unique organization/user pair. Role is `admin`, `editor`, or `member`. Removal sets `removed_at`; rejoining retains the ID and original `joined_at`, clears removal, and sets the assigned role. The audit log records each membership period. |
| `identity_audit_events` | Append-only records for user/operator/system actions. A polymorphic entity ID identifies the affected record; organization and user actor references have real foreign keys. |

Audit actors are user IDs or authenticated operator/system principals. Store request IDs for correlation, never tokens, passwords, complete Cognito responses, or raw provider errors.

Normalize email by trimming surrounding whitespace and lowercasing the entire address. Do not strip `+` suffixes or dots. V1 accepts ASCII email addresses, with normal email validation in the service; SQL enforces canonical storage but is not an email parser. Multiple Cognito identities may have the same email in historical application data, so email has no unique constraint. Cognito issuer/subject is immutable and must come from a validated, allowlisted user pool. Email equality never merges identities or restores a previous identity's memberships.

`display_name` is optional; trim input and store blank as null. Organization names are trimmed and required. Clients cannot set actor IDs, Cognito mapping, statuses, timestamps, or revision counters through generic object updates.

## Authorization

| Capability | Admin | Editor | Member |
| --- | --- | --- | --- |
| Read owned taxonomies; configure products; create quotes | Yes | Yes | Yes |
| Edit the organization's owned taxonomy content | Yes | Yes | No |
| Archive owned taxonomies | Yes | No | No |
| Manage members and organization name | Yes | No | No |
| Create/archive organizations; disable accounts | Operator only | Operator only | Operator only |

Quote ownership/editing rules follow the quote specification. These roles do not grant access to another organization's quotes or taxonomies. Subscription administration and history browsing are outside the taxonomy MVP.

Every organization operation receives an explicit organization ID. The backend verifies the user is enabled, the organization is active, and membership is present and not removed, then evaluates the action's role. Pending organizations allow only operator bootstrap actions. An archived organization allows no member business access. A client-side organization selection is only navigation state, not authorization.

No memberships means the user can access their own profile, organization list (empty). A disabled user cannot gain membership or bootstrap themselves back into enabled status. Organization member listings are admin-only in V1; no public user/email search is provided.

## Transaction contracts

### First login and profile

1. Validate Cognito access-token issuer, client, expiry, token use, and required API scope before business handling. Obtain trusted attributes server-side from Cognito's userInfo endpoint with `openid email profile` scopes; verify the returned subject equals the authenticated subject and `email_verified` is true. Fail closed if this lookup fails. Never use an unvalidated client ID token or form email as identity evidence.
2. Read or insert the user by issuer/subject. On simultaneous first requests, the unique key chooses one ID; the loser retries and returns that existing user. Do not merge on email.
3. Reject a disabled user before syncing profile fields. Sync the current verified email and normalized value; do not reset `disabled_at` or memberships. Display name is application-editable after initial creation.
4. Record `user.created` once in the same transaction as the initial insert. Subsequent bootstrap requests return the same ID without additional creation events.

Profile email is a cache of the verified address at the last bootstrap. Direct addition resolves exactly one enabled user with the normalized address in the actor's Cognito issuer. Missing or ambiguous matches fail without granting access. Emails never link identities; the membership binds the resolved immutable user ID. Users must sign in once before administrators can add them.

### Conflict detection and authorization changes

Identity/organization operations use bounded retry of the **entire** transaction on SQLSTATE `40001`: at most five attempts, exponential jitter starting at 50 ms and capped at 1 second, within the request deadline. Each attempt rereads identity, membership, and organization status. Return `503 RETRY_LATER` if exhausted; return `409` for a real business conflict. A unique-key race retries only when it can resolve an idempotent identity result, not for unrelated validation errors. The taxonomy MVP reuses authorization guards but explicitly uses a single attempt with reload-required conflict responses, as defined in its API specification.

Read operations validate the enabled actor, active organization, and current membership once within a repeatable-read transaction snapshot using SELECTs. They do not increment authorization revisions. A read already in flight may finish using the access visible when its snapshot began; subsequent requests see committed revocations. Mutations retain conflict guards so revoked access cannot race a successful write.

For an identity/organization mutation, increment the acting user's `auth_revision` and the organization's `auth_revision` inside the transaction before checking authorization. These writes make concurrent disabling, role changes, archival, and member addition conflict. When a target user differs, guard that user too. Acquire user guards in numeric ID order, then organization guards in numeric ID order, and recompute the required set after retries. No timestamp-only or no-op guard updates.

Disabling an account guards the target user and every active organization where it is an active admin, then verifies another enabled active admin remains in each. Membership changes and additions also guard the target user, preventing a new admin membership from racing account disabling. Reject operations exceeding DSQL transaction limits rather than splitting away the invariant. Archival guards the organization. Business operations added later must participate in these guards or equivalent DSQL conflict reads to prevent revoked authorization from committing unnoticed.

### Organization bootstrap

The trusted operator workflow creates an active organization and its initial admin membership in one guarded transaction, using an existing enabled user ID. Append organization and membership audit events atomically. Never activate an organization without an enabled administrator. Public APIs have no organization-create operation.

### Direct member addition

`POST /organizations/{orgId}/members` accepts only `{email, role}`. Resolve exactly one enabled account in the actor's issuer by trimmed, lowercased email. Guard both users in numeric ID order, then the organization; verify the actor is an admin of that active organization before returning account availability errors or granting access.

Reject active members with `409 ALREADY_MEMBER` without changing their role. For a removed member, clear `removed_at` and assign the requested role while preserving membership ID and original join time. Otherwise create a membership. Append `membership.added` in the same transaction. The new member's organization list and organization authorization immediately include it; no acceptance step or email delivery is involved. The UI refreshes organization choices on focus and periodically while visible.

A repeated add of an active member returns a conflict and does not create another membership or audit event. A later explicit admin add can restore removed access. Missing, ambiguous, or disabled accounts return `422 ACCOUNT_UNAVAILABLE`; users who have not signed in must do so first.

### Membership and account changes

Admin role changes/removals guard the organization and affected user and count remaining **enabled**, nonremoved admins in active organizations. Reject any change that leaves zero. An admin can remove or demote themselves only if another enabled admin remains. No separate leave endpoint in V1. Removing an already removed membership is idempotent; a later admin addition can reactivate it.

Operator account disabling and organization archival preserve all rows and attribution. Archive sets status and `archived_at`; it does not bulk-update historical memberships or snapshots. Their future use is blocked by organization status. Reactivation/unarchival is outside V1; it must not emerge accidentally from generic updates.

Role changes and membership periods are captured in audit event details, with before/after values. Event examples: `organization.created`, `organization.archived`, `membership.added`, `membership.role_changed`, `membership.removed`, and `user.disabled`. Authorization failures belong in sanitized operational logs, not successful-mutation audit transactions.

## HTTP contracts

These routes are now implemented in `server/` and declared in `AWS/openapi.yaml` as part of [task 1000](../../tasks/1000/implementation.md); live deployment has not been performed by that task. All require validated Cognito access tokens and return private/no-store responses. Organization IDs are explicit path parameters. Lists use opaque cursor pagination, default 50 and maximum 100 items, ordered by creation/join time plus ID. Responses never expose Cognito subjects, AWS actor principals, or internal errors to ordinary members.

| Operation | Contract |
| --- | --- |
| `POST /me/bootstrap` | No caller identity fields. Return `{user: {id,email,displayName}}`; 200 for both initial creation and idempotent repeats. |
| `GET /me` / `PATCH /me` | Read profile; patch only `{displayName}`. Email changes go through Cognito. |
| `GET /me/organizations` | Return active organizations with the caller's role; no automatic default organization. |
| `GET /organizations/{orgId}` | Read name, ID, and caller role for an active membership. |
| `PATCH /organizations/{orgId}` | Admin-only `{name}`. No status or owner fields. |
| `GET /organizations/{orgId}/members` | Admin-only membership list with user ID, name/email, role, and membership ID. |
| `POST /organizations/{orgId}/members` | Admin-only `{email,role}`; return `{member}` with immediate access. |
| `PATCH /organizations/{orgId}/members/{membershipId}` | Admin-only `{role}`; validate membership belongs to path organization. |
| `DELETE /organizations/{orgId}/members/{membershipId}` | Admin-only soft removal; preserve history. |

Use `{code,message,requestId}` errors: 401 for invalid authentication, 403 for disabled/unverified accounts or insufficient role within an accessible organization, 404 for inaccessible organizations, 409 for last-admin/role/idempotency/state conflicts, 422 for invalid input, and 503 for exhausted transient retries.

## Permissions, DSQL deployment, and taxonomy compatibility

[permissions.sql](../../database/versions/0001/identity/permissions.sql) is a parameterized grant template for separate API and operator database roles. They must be non-owner roles without inherited broad grants; use new connections when checking DSQL privilege changes. Only the operator reads audit records; the API may insert but cannot modify/delete them. The template is not row-level authorization: the service must enforce organization boundaries and immutable attribution. Grants restrict account disabling/organization creation to the operator role. Runtime roles receive no deletion rights.

The concrete tables remain in `public` to satisfy the existing `public.users(id)` and `public.organizations(id)` references. This is an explicit exception to the AWS specification's proposed application namespace. DSQL admin/bootstrap must create public objects and grant non-admin runtime access; do not give the API admin connectivity. A future coordinated namespace migration must move taxonomy and identity together, not introduce two sets of user tables. See [DSQL considerations](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/considerations.html).

Run one DDL statement per transaction, checkpoint each step, and keep DML separate. For each `CREATE INDEX ASYNC`, save `job_id`, poll `sys.jobs`, and require `completed` plus a valid index before releasing dependent writes. On failure, stop; inspect/drop the failed invalid index before a deliberate retry. Do not run the SQL as one multi-statement request or wrap it in a migration-wide transaction. See [DSQL migration differences](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-postgresql-compatibility-migration-guide.html) and [asynchronous indexes](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-create-index-async.html).

Use supported [foreign keys](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-foreign-key-constraints.html); creation order is users, organizations, memberships, audit. No PL/pgSQL, triggers, custom domains, extension-dependent types, or database session tables are introduced. Cross-row rules rely on [DSQL optimistic concurrency](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-concurrency-control.html).

The existing taxonomy SQL is still a local PostgreSQL design; its triggers, transaction-ID snapshot guards, and DDL packaging are not the MVP DSQL implementation. Local tests prove references resolve against the identity tables, not that the entire taxonomy schema runs on DSQL. On October 10, 2026 the user selected the [JSONB taxonomy MVP](../taxonomy/api-specification.md): one ordered document per immutable version, valid-only saves, and deferred sharing/history browsing/separate taxonomy audits. The legacy SQL remains as reference; the new JSONB module lives in `database/versions/0002/taxonomy/`, with the API implemented locally. See the [implementation record](../../tasks/3000/implementation.md); no live schema changes were applied. Existing identity/organization permissions remain unchanged; the taxonomy role matrix above reflects the selected MVP scope.

Task 1000 changes Terraform to `allow_admin_create_user_only = false` and implements the UI/API source. The schema package itself does not apply Terraform, provision SES, or execute cloud migrations. No deployed enrollment or delivery behavior is claimed to have changed.
