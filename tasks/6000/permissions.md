# Permissions

| Action | Sales | Administrator | Super Administrator |
| --- | --- | --- | --- |
| Access organizations | Active memberships | Active memberships | All active organizations |
| Read Team and work with quotes | Yes | Yes | Yes |
| Add an existing account as Sales | Yes | Yes | Yes |
| Add/change Administrator membership | No | Yes | Yes |
| Edit teammate display name | No | Yes | Yes |
| Remove teammate | No | Yes | Yes |
| Edit company details; add principals | No | Yes | Yes |
| Create/edit/archive owned configuration | Yes | Yes | Yes |
| Edit/archive shared configuration in recipient context | No | No | No; switch to owner |
| Read/preview/use shared configurations | Yes | Yes | Yes |
| Change configuration recipients | No | No | In owner context only |
| Assign exact enrollment domains | No | No | Yes |
| Grant/revoke global privilege | Unavailable | Unavailable | Unavailable |

Membership roles are `sales` and `administrator`. `isSuperAdministrator` is a read-only value derived from the three allowlisted emails on profiles and Team rows. It is not accepted in membership requests. Server authorization rechecks current account, organization, membership, and configuration access; the browser consumes server permissions for configuration actions.

A last enabled Administrator cannot be demoted/removed. Newly enrolled organizations may initially have no Administrator. Global access is determined by the shared email allowlist; no database privilege flag or seed workflow is used. Authorization uses the current verified email, so a stale profile email or stored flag cannot retain access after an email change. Disabled accounts remain blocked. The platform guard serializes enrollment-domain changes.

Teammate name changes affect the shared profile in every organization. Emails and passwords remain managed by Cognito. Adding teammates requires exactly one active existing account in the actor's issuer; no pending invitation or email is sent.

Soft-archiving an owned configuration requires confirmation that it is removed from the entire organization catalog and every recipient catalog. It retains versions and existing quote snapshots. Revocation/archive blocks new/reconfigured quote lines; unchanged historical selections and quantity edits retain the saved price.

Team removal explains that users with assigned work domains regain Sales membership on their next sign-in. The periodic UI access refresh uses `GET /me`, rather than enrollment bootstrap.

Allowlisted addresses: `mc.watson415@gmail.com`, `miles@baysideio.com`, and `miles@milescwatson.com`. Matching ignores case and surrounding whitespace, but does not normalize Gmail dots or plus aliases.
