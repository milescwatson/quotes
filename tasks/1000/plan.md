# Identity and organization UI implementation plan

Status: implemented locally, with live deployment and cloud acceptance pending. See [implementation notes](implementation.md) for delivered code, validation, and release dependencies.

## Context and scope

The frontend is currently a Nuxt starter, and the API provides only health and session checks. Implement the login and organization UI first against development fixtures, then connect it to the identity API as those handlers become available.

References:

- [Identity specification](../../design/identity/specification.md)
- [Identity schema](../../database/versions/0001/identity/schema.sql)
- [Identity validation requirements](../../design/identity/validation.md)
- [Taxonomy editor visual reference](../../design/taxonomy/taxonomy-editor-ui.png)
- [AWS specification](../../AWS/specification.md)

Taxonomy editing and quote creation are separate UI work. Platform-operator tools, organization creation, account disabling, and organization archival are outside this UI phase.

## 1. Build the application shell

Follow the taxonomy example's visual style: white panels, light gray backgrounds, restrained borders, and blue actions.

Add responsive navigation with an organization switcher, Invitations, and Profile. Within an organization, admins also see Members and Settings. Use shared form controls, dialogs, notifications, loading states, and error panels.

## 2. Implement authentication and onboarding

| Route | Purpose |
| --- | --- |
| `/login` | Sign-in and create-account entry points. |
| `/auth/callback` | Complete authentication, bootstrap the application user, and load memberships. |
| `/organizations` | Organization selection and the no-organizations-yet state. |
| `/profile` | Edit display name, display email, and sign out. |

Use Cognito's hosted authentication pages for signup, verification, login, and password recovery, following the existing authorization-code/PKCE architecture. See [Cognito documentation](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-managed-login.html).

Preserve invitation destinations through login. After authentication, prioritize that destination; otherwise open the user's sole organization or show the organization chooser. Users without memberships see pending invitations and guidance to contact an administrator.

## 3. Implement invitations and organization administration

| Screen | Behavior |
| --- | --- |
| Invitations | List incoming invitations with organization, offered role, expiry, and explicit acceptance. |
| Invitation detail | Handle sign-in, acceptance, wrong account, expiration, revocation, and previously accepted offers. |
| Organization members | Admin-only member list, role changes, and removal confirmations. |
| Organization invitations | Admin-only invitation creation, status list, resend, and revoke actions. |
| Organization settings | Admin-only organization-name editing. |

Show server-confirmed results for membership and permission changes. Explain last-admin conflicts inline. An invitation creation response means the invitation was queued, not that email delivery succeeded.

## 4. Connect the UI to explicit API contracts

Create a typed identity client with interchangeable development-fixture and HTTP implementations. Fixtures must be explicitly enabled for development; production must never fall back to them.

Add a recipient-authorized invitation-detail contract so `/invitations/{id}` can resolve its organization and status without searching a paginated list.

Keep organization IDs explicit in routes and requests. On organization changes, clear scoped data and discard late responses from the previous organization. Treat frontend role checks as presentation; the backend remains authoritative.

Before live integration, implement the identity endpoints, enable public Cognito signup, and expand API CORS beyond its current GET-only configuration.

## 5. Validate and release

Add browser tests covering:

- Login return paths, logout, session expiry, and users without organizations.
- Multiple organizations with different roles.
- Invitation acceptance, replay, wrong account, expiration, and revocation.
- Member removal, role changes, and last-admin conflicts.
- Access revoked while a screen is open.
- Keyboard navigation, dialog focus, mobile layouts, and loading/error states.

Deliver in three reviewable stages:

1. Shell and fixture-driven screens.
2. Cognito integration.
3. Live identity API integration.

Fixture-based validation does not establish that authentication, API authorization, or email delivery works in the deployed application. Verify those integrations as their corresponding stages are completed.
