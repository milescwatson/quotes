# Configuration Editor implementation

Implemented locally on October 12, 2026. No database migration or cloud deployment was performed.

## Delivered

- **Configuration Editor**, headed **Product Configuration**, follows the original compact column layout. New configurations are blank. The removed overall segment/option summary remains absent.
- Explicit Save covers the name, principal, base price, pattern, segments, and options. Inline editing, mouse dragging, keyboard reordering, removal, field validation, and unsaved-change guards are included. Loaded hidden segment names and default-option identities are preserved.
- Prices accept common currency/grouping formats and shorthand, normalize on blur, and use exact cent rounding. Invalid text stays available for correction. Failed initial creates and subsequent saves retain entered data; conflicts require reload.
- Organization administration includes paginated Product Configurations and global Principals lists. Configuration rows open the editor; its back link returns to the list. One principal filter scopes both rows and totals to the current organization.
- Administrators can add a principal with a required name and website. Normalized names and ICANN registrable domains are independently unique. Website subdomains and page paths cannot bypass uniqueness. Principal selection loads the full directory, including later pages.
- Configuration create/save requires a principal. Changing only the principal creates an immutable version; unchanged saves do not. Old version assignments and organization access boundaries are preserved.
- API routes, OpenAPI, generated frontend types, local development fixtures, runtime grants, and an additive migration are included.

## Verification

| Check | Result |
| --- | --- |
| API tests | 44 passed |
| Database regression tests using local PGlite | 12 passed |
| Full Chromium browser suite | 30 passed |
| Final focused configuration browser/value suite after save-error fix | 11 passed |
| Frontend typecheck | Passed |
| API build | Passed |
| Frontend production build after final fix | Passed |

Coverage includes independent duplicate constraints, root-domain variants, authorization, organization isolation, legacy migration preservation, required principal assignments, principal-only versioning, no-op saves, stale saves, error retention, list pagination/retries, hidden defaults, dragging, keyboard ordering, and desktop/mobile layout. Browser tests use development fixtures; local PostgreSQL tests do not establish live Aurora DSQL behavior.

## Screenshots

- [Editor desktop](screenshots/editor-desktop.png)
- [Editor mobile](screenshots/editor-mobile.png)
- [Admin mobile](screenshots/admin-mobile.png)

## Release gate

Follow the [migration runbook](../../database/versions/0003/principals/README.md). Apply migration 0003 with writes paused, await asynchronous DSQL validation/index jobs, and verify runtime grants. If existing configurations are present, obtain their explicit mapping to real principals, append current snapshots with those assignments, and retain historical snapshots unchanged. Do not invent a default principal. Validate all current assignments before releasing the matching API and UI. Live DSQL validation and deployment remain outstanding.
