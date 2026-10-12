# Configuration Editor technical implementation

Use the existing Nuxt/Vue application and Tailwind utilities. Build the page around the [reference screenshot](../../design/taxonomy/taxonomy-editor-ui.png) and [user experience](user-experience.md).

## Frontend structure

Add `pages/organizations/[orgId]/taxonomies/new.vue` and `pages/organizations/[orgId]/taxonomies/[taxonomyId].vue`, sharing a `TaxonomyEditor.vue` component. A small `TaxonomySegment.vue` component renders a segment header and inline option rows. Keep loading/saving and the working document in a focused `useTaxonomyEditor` composable.

Use existing organization-ID resolution, `identity.request`, generated API types, confirmation dialogs, and loading/error conventions. The existing app shell hosts the editor. Add a Product Configurations section to `pages/organizations/[orgId]/settings.vue`, using a small list component/composable so organization settings and list loading have independent state. Its New configuration and product-name links open the new/detail editor routes. The editor back link returns to the settings page’s configuration section. Reuse the existing admin entry point in `AppShell.vue`; no new top-level navigation section is needed.

Render the list within the existing administrator-only settings view. This is UI placement, not a change to taxonomy API authorization: members still have the existing read permission, and admins/editors retain write permission. Respect the current server permissions on direct editor URLs.

Add a separate Principals section to the same admin page, with a shared directory list and a name/website creation form. The editor loads the global directory through the authorized principal-list route and requires a selection before creation. Keep list pagination available to the selector so principals beyond the first page remain selectable.

See [shared principals and database changes](database-design.md) for the additive schema, duplicate-name/website constraints, authorization, migration/backfill, and versioned principal reassignment.

## Required API operations

All paths are relative to `/organizations/{orgId}`. The four taxonomy operations already exist in `AWS/openapi.yaml` and `AWS/api/taxonomy.mjs`; principal routes and principal fields are additions.

| Method and route | Use |
| --- | --- |
| `GET /taxonomies?page=1&pageSize=50&principalId=…` | List active organization-owned configuration summaries; optional `principalId` is the only filter. |
| `POST /taxonomies` | Create with `{principalId, content}`; receive the created taxonomy and nested IDs. |
| `GET /taxonomies/{taxonomyId}` | Read current content and editing permissions. |
| `POST /taxonomies/{taxonomyId}/versions` | Save `{expectedVersionId, principalId, content}`; principal or content changes create a version. |
| `GET /principals?page=1&pageSize=50` | New route: read the global principal directory under organization authorization. |
| `POST /principals` | New route: an organization admin creates a shared principal with `{name, websiteUrl}`. |

Add the principal routes, table, uniqueness constraints, and required taxonomy principal relationship as detailed in the database design. Extend taxonomy list/current responses with principal ID/name. Preview and archive endpoints are not used by this task.

## Admin list

Use the existing summary response: `items`, `page`, `pageSize`, `totalItems`, and `totalPages`. Render `productFamilyName` as the editor link, the principal name as a column, and `modifiedAt` as a localized last-modified time; keep `id` as the row key and route identifier. Identical names still link to distinct IDs. Do not load full configuration documents for list rows.

Use a single Principal filter defaulting to All principals; omit `principalId` for that choice. Populate choices from the shared directory. Reset to page 1 on a filter change and cancel/discard any previous list request. Apply principal filtering server-side to both rows and totals while retaining organization authorization. Use Previous/Next with page size 50 and the API’s existing ordering. Refresh on returning from the editor so saved name changes appear. Keep loading, empty, and retry states local to the list. Cancel/discard stale requests and reset the list when the organization changes; clear it on loss of access. Retain same-organization rows on transient pagination failure and recover an out-of-range page from returned totals, following the Quotes list pattern.

## Working document and field mapping

Keep the saved snapshot and a separate local working document. Adding, removing, and reordering changes only the working copy until Save. Use stable local keys for unsaved rows; send `id:null` for new segments/options and preserve server IDs for retained content.

| Visible field | API field |
| --- | --- |
| Product name | `content.productFamilyName` |
| Principal | Top-level `principalId` on create/save; required foreign-key relationship and versioned assignment |
| Base price | `content.basePrice`, an exact decimal string |
| Segment header text | `segments[].placeholder` |
| Option code | `options[].code` |
| Optional description | `options[].description`, blank mapped to null |
| Price | `options[].price`, an exact decimal string |
| Segment/option order | Order of the corresponding arrays |

Derive the displayed pattern from ordered placeholders and each segment’s option count from its working options array. Do not create separate pattern/position fields.

The simplified UI still submits a complete valid document. Expose `basePrice` as an editable field. Preserve loaded `currency`, segment `name`, and default identity without adding controls for them. New configurations start with an empty name, no selected principal, empty segment array, and blank base-price input; an empty base-price input serializes as `"0.00"`. Currency is `"USD"`; newly added segments have an empty placeholder, no options, `name:null`, and no default. The optional change summary is omitted.

Map a loaded `defaultOptionId` to its option's stable local key, then derive `defaultOptionIndex` from the current order on save. Reordering therefore preserves the default. Removing that option clears the default; removing other options must not change it. Existing options cannot be moved between segments because the API binds retained IDs to their original parent.

Whitelist request fields rather than sending read-only metadata or local keys. After success, rebuild the saved/working copies from the server response. Store API IDs and monetary values as strings; never convert option codes to numbers.

## Interactions and validation

Implement dragging for the screenshot's reorder handles, with keyboard-accessible move actions from the same control. Preserve row identity and focus through moves. Confirm removal of populated segments; remove individual options and empty segments immediately from local state. Keep horizontal overflow inside the segment workspace.

Keep the raw price input separate from its canonical API value. Accept free-form text while typing. On blur, trim surrounding whitespace, recognize an optional USD/$ marker and valid USD grouping commas, and normalize shorthand decimals. Round excess fractional digits to cents using exact decimal arithmetic (half up), then format two places. For example, `.50` becomes `0.50`, `1.` becomes `1.00`, and `$1,234.567` becomes `1234.57`. Do not strip arbitrary letters or punctuation to manufacture a number. Preserve unparseable, negative, or out-of-range input with a field error. Normalize again before Save so submitting a focused field follows the same rules. Empty option prices remain incomplete; empty base price means zero. The API continues to receive validated decimal strings, so its contract does not change.

Allow incomplete local content. Validate on Save using the existing API contract: required name/placeholders/codes, at least one segment and option per segment, scoped uniqueness, nonnegative decimal prices, and count/text/size limits. Keep the server authoritative, including maximum possible configured price validation. Show field errors without discarding edits.

Extend `ApiError` and `services/http.ts` to retain optional `fieldErrors` and `currentVersionId`, which the adapter currently discards. Map JSON Pointer field paths to the submitted rows. Preserve existing constructor callers. Errors for hidden fields or whole-document limits appear in a concise form-level message rather than introducing new settings panels.

Use the loaded `expectedVersionId` when saving. Block duplicate submissions and freeze editing during the request. A change to content or principal creates a new immutable snapshot under the same taxonomy ID and returns that version; a normalized no-op returns the current one. Display a brief Saved status without a history/metadata panel.

On a version conflict, preserve local edits and show a reload-required error; never silently replace the expected version. A reload that discards edits requires confirmation. Other failed requests use ordinary error feedback and retain the form. Do not add an uncertain-response state machine, mutation deduplication, a recovery catalog, or developer-assisted recovery workflow for this MVP. There are no automatic write retries. Duplicate prevention after a lost create response is not guaranteed by the existing API.

Guard navigation with unsaved changes, discard stale async responses after route changes, and clear protected data when access is lost. Respect server `canEdit`; read-only access uses the same layout without editing actions. Loading failure must not look like an empty new taxonomy.

## Verification

Test the completely blank new-configuration state. Use development-only fixtures for the screenshot’s four segments and six options as an editing example, including its empty last segment. Cover list/create/read/save with existing fixture infrastructure. Add enough summaries for pagination and separate organization data.

Verify admin-list placement, new/open/back navigation, fresh names after save, empty/error/pagination states, organization isolation, and existing role permissions. Verify adding/editing/removing/reordering, pattern/count updates, keyboard controls, leading-zero codes, base-price editing, permissive price parsing/rounding, invalid text preservation, validation errors, returned IDs, no-op saves, and conflict behavior. Include preservation of hidden fields and defaults when options move or are removed. Check desktop and 390px layouts for contained horizontal scrolling.

Add database/API checks for principal uniqueness races, both duplicate fields, global directory visibility, administrator-only creation, root-domain normalization, principal-only versioned saves, principal-filtered pagination/counts, required foreign keys, and unchanged organization boundaries. Run frontend typecheck/build and focused browser tests when implementing. Shared HTTP changes also require the relevant identity/quote regression checks. See [implementation and verification](implementation.md) for delivered components and test results. Local tests do not establish live deployment readiness.
