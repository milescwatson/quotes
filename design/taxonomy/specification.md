# Product taxonomy MVP specification

Task 4000 extension: configurations now require a shared principal. Create/save requests include `principalId`, principal-only saves create a version, and the catalog supports a single principal filter. See the [principal specification](../principals/specification.md) and current [OpenAPI](../../AWS/openapi.yaml) for the extended contract. The original organization ownership and all other content rules remain in force. Migration 0003 is applied to development only; the API is also deployed to development; signed-in browser verification remains outstanding. See the [database ledger](../../database/DEPLOYMENTS.md).


Status: revised October 10, 2026 to reflect the selected MVP decisions. This is the current product and data-model specification. The [API specification](api-specification.md) defines exact payloads, validation, limits, and errors; the [implementation plan](../../tasks/3000/plan.md) defines delivery steps. The API and first-install SQL are implemented locally; see the [implementation record](../../tasks/3000/implementation.md). Live deployment remains pending.

## Purpose and scope

An organization defines a taxonomy for a product family, then uses it to generate configured part numbers and USD prices. The MVP includes an organization-owned catalog, current-taxonomy reads, creation, explicit saves, configuration preview, and archival.

Each family has one taxonomy. Segments are flat ordered choices, and each segment contains an ordered list of options. A completed configuration selects exactly one option per segment. Each option has a code, an optional description, and a price. A taxonomy also has a family name, base price, and currency.

Sharing and subscriptions, history browsing/restoration, publishing, autosave, imports, nested choices, compatibility rules, reusable option lists, and separate SKU records are deferred. The taxonomy editor UI and quote-line persistence are separate implementation tasks; the API contract supports them without implementing them now.

## Ownership and roles

Each taxonomy has one fixed owning organization. Only active members of that organization may access it; there is no shared or subscriber access in the MVP.

| Capability | Admin | Editor | Member |
| --- | --- | --- | --- |
| List/read current taxonomies and preview configurations | Yes | Yes | Yes |
| Create and save taxonomy content | Yes | Yes | No |
| Archive taxonomies | Yes | No | No |

Use the application's existing account, organization, membership, and role checks. Knowing an ID never grants access. Disabled accounts, removed memberships, and inactive organizations cannot use the taxonomy API.

## Explicit Save and versioning

The editor keeps work locally until the user clicks Save. Adding/removing/reordering segments or options does not write to the database on its own. Save submits the complete taxonomy in one request.

Creation requires a valid complete taxonomy and produces version 1. An update requires `expectedVersionId`. The server rejects a stale version, validates all content, and compares the normalized replacement with the current content. A changed save produces one new version and immediately makes it current. An unchanged save returns the existing version. No publishing step or draft/published state exists.

A valid taxonomy has a name, at least one segment, at least one option per segment, valid prices/codes, unique labels/codes within their scopes, valid defaults, and content within the API's limits. Every possible independent configuration must fit the supported price range. Incomplete local editing is allowed; saving it is not. Validation errors preserve the user's local edits and leave stored content unchanged.

Every version records its number, author, timestamp, and optional change summary. Changing only the summary does not create a version. Retain historical snapshots unchanged, including removed options and prior prices, but provide no history-read or restoration interface in the MVP. A separate audit system is deferred.

There are no automatic taxonomy retries, request-deduplication keys, receipts, or automatic merging. After a stale save or an uncertain response, reload and reconcile. An uncertain create may have succeeded; inspect the catalog before creating again. The MVP does not guarantee duplicate prevention for repeated create requests.

## JSON snapshot model

Use Aurora DSQL with two relational tables. Nested taxonomy content lives entirely in one JSONB document per version.

| Table | Responsibility |
| --- | --- |
| `taxonomies` | Stable family ID, owner organization, current-version pointer, creator/time, and optional archive actor/time |
| `taxonomy_versions` | Version ID, taxonomy ID, sequential version number, immutable JSONB content, editor/time, and optional change summary |

Taxonomy/version/organization/user IDs remain database-generated bigint values represented as decimal strings by the API. Nested segment/option IDs are stable opaque strings; new values are generated as UUIDs by the server. They are stored inside JSON, not separate tables.

The complete stored document contains:

| Level | Fields |
| --- | --- |
| Content | `schemaVersion`, `productFamilyName`, `currency`, `basePrice`, ordered `segments` |
| Segment | `id`, `placeholder`, optional `name`, nullable `defaultOptionId`, ordered `options` |
| Option | `id`, `code`, optional `description`, `price` |

`schemaVersion` identifies the document format; it is separate from the content's user-visible version number. Preserve every field in each snapshot. Money uses canonical decimal strings such as `"20.00"`. Optional text is null when absent.

Segment-array order determines part-number order. Option-array order determines display order. Do not maintain duplicate position columns. Preserve retained IDs through editing and reordering; deleting and later adding an option creates a new identity. Save requests use `defaultOptionIndex` so a newly added option can be selected as default before its ID exists. The server resolves that index to the stored `defaultOptionId` and returns all IDs after Save.

Detailed nested validation is an API responsibility. Database constraints retain version uniqueness and taxonomy/organization/user relationships. Restrict runtime access to SELECT/INSERT for version rows and narrow updates for the aggregate. One atomic transaction inserts a complete version and advances the pointer, preventing partially saved snapshots. No relational segment/option tables, child-insert guards, monetary domains, taxonomy triggers, subscriptions, mutation receipts, or taxonomy audit tables are required.

The existing [relational schema](../../database/versions/0001/taxonomy/schema.sql), [functions](../../database/functions/taxonomy.sql), and [trigger bindings](../../database/versions/0001/taxonomy/triggers.sql) are legacy reference code, not this model's implementation. The [JSONB first-install path](../../database/versions/0002/taxonomy/README.md) is implemented. Read-only development inventory found no installed application tables. Recheck before installation; existing relational data in another environment requires a preservation migration. Do not run the legacy files on DSQL.

## Defaults and configuration

A fixed prefix is a segment with one option. Automatically select a segment's only option. Otherwise use an explicit choice, then its saved default if no explicit choice exists. A multi-option segment does not require a default to be a valid taxonomy, but it requires a selection before a configuration is complete.

Placeholders and nonblank segment names are each case-insensitively unique within the taxonomy. Option codes are case-insensitively unique within their segment. Preserve entered casing and leading zeros; trim surrounding text whitespace and reject whitespace or hyphens inside codes. The API specification defines the exact normalization rules and bounds.

Generate the part number by joining selected codes in segment order with `-`. Calculate unit price as base price plus selected option prices, using exact decimal arithmetic. Base price defaults to zero in the editor; currency is USD. Negative adjustments, fractional cents, manual-price options, quantity breaks, and combination-specific prices are outside the MVP.

The following values are illustrative:

| Segment | Selected code | Price |
| --- | --- | --- |
| Series | `F` | `0.00` |
| Size | `12` | `20.00` |
| Finish | `AA` | `5.00` |
| Connection | `01` | `2.50` |

With base price `100.00`, this generates `F-12-AA-01` at `127.50`. Changing the finish price to `8.00` and saving creates a new version priced at `130.50` for that configuration.

## Catalog and archival

The catalog lists only active taxonomies owned by the selected organization with basic pagination. No sharing, search, or archive filters are included. Duplicate family names are allowed and distinguished by ID.

Admins may archive a taxonomy. Archival is one-way, records its actor/time on the aggregate, removes it from the catalog, and blocks saves and configuration previews. Members may still read its current content by a known ID. Preserve all versions; do not create a new content version or separate audit record for archival.

## Future quote integration

Configuration preview returns calculated values without creating a quote line. The eventual quote-write path must recheck ownership/access and the current version, recalculate using stored content, and save provenance plus the family name, part-number text, currency, base/unit prices, and ordered selected-option details together.

Existing quote drafts and finalized quotes retain those stored values after taxonomy renaming, reordering, repricing, removal, or archival. Quote reads must not regenerate or reprice from the latest taxonomy. Explicit edits to a quote are a separate user action.

## Acceptance criteria

1. Organization boundaries and roles are enforced on every request.
2. Invalid creation and saves produce field errors without changing persisted content.
3. Ordered JSON round-trips preserve IDs, metadata, defaults, codes, descriptions, and exact prices.
4. Each changed explicit save creates exactly one attributed immutable version; no-op saves do not.
5. Stale saves cannot overwrite newer content; failed transactions leave no partial version or advanced pointer.
6. History is retained but no history browsing, sharing, publishing, audit, or retry subsystem is added.
7. Current-version preview, simple pagination, and one-way archival follow the API contract.
8. Existing quote values stay independent of later taxonomy changes when quote-line persistence is implemented.

Initial limits and one realistic priced example remain useful inputs for implementation validation; they do not reopen the selected MVP scope.
