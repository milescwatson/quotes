# Taxonomy MVP API specification

Status: implemented locally, October 10, 2026, using Aurora DSQL and one JSON document per version. See the [implementation record](../../tasks/3000/implementation.md) for verification and outstanding live deployment gates, and the [implementation plan](../../tasks/3000/plan.md) for scope.

Organizations define product families with ordered configuration segments and options. One explicit Save validates the complete taxonomy and, only when content has changed, makes a new immutable version current. Each version records who saved it and when.

The [product specification](specification.md) defines the matching MVP domain model. The [requirements and decisions](questions.md) record the consolidated answers and remaining sizing assumptions. Reuse the existing [identity roles and organization boundaries](../identity/specification.md).

## Selected MVP decisions

| Area | Behavior |
| --- | --- |
| Ownership and sharing | Each taxonomy belongs to one organization. Sharing and subscriptions are deferred. |
| Storage | Relational taxonomy/version metadata, with one complete JSONB content document per version. No segment/option tables. |
| Ordering | Segment array order defines part-number order. Option array order defines display order. |
| Save | One explicit complete save; no autosave or individual segment/option write endpoints. |
| Validity | Invalid and incomplete taxonomies cannot be saved, including on initial creation. Unsaved work remains in the editor. |
| Publication | A successful changed save becomes current immediately. No draft/published states. |
| Versioning | Creation produces version 1. Each changed save increments the version by one; unchanged content creates no version. |
| History | Retain immutable versions and attribution. History listing, browsing, and restoration are deferred. |
| Conflicts | Require `expectedVersionId` for updates. Reject stale saves; no automatic merge, mutation receipts, creation request IDs, or replay system. |
| Auditing | Version records provide content history. No separate taxonomy audit system. |
| Catalog | List the organization's active taxonomies with basic pagination. No sharing, status, or search filters. |

The API scope is list, create, read current, save, configuration preview, and archive. The editor UI and quote-line persistence remain separate tasks. Imports, nested choices, compatibility rules, reusable option libraries, ownership transfer, unarchival, and SKU catalogs are deferred.

## Domain rules and valid saves

A product family has one taxonomy. Product-family names need not be unique; the taxonomy ID distinguishes families. All segments are flat required choices with exactly one selected option per completed configuration. A fixed prefix is a segment with a single option. Single-option segments select automatically; other segments may have a default, but a default is not required to save.

A save is valid only when:

- The family has a valid name, currency, and base price, and at least one segment.
- Every segment has a valid placeholder and at least one valid option.
- Placeholders and nonblank segment names are each case-insensitively unique within the taxonomy.
- Option codes are case-insensitively unique within their segment. Codes preserve casing and leading zeros and cannot contain whitespace or `-`.
- Each default is null or belongs to its own segment. Retained IDs are valid and unique within their documented scope.
- All prices are nonnegative USD amounts with at most two decimal places, and all text/count/size limits pass.
- Base price plus the highest option price in each segment fits the supported unit-price range. With independent nonnegative choices, this ensures every permitted combination can be priced without overflow.

The API validates the entire replacement before saving anything. Validation failure leaves the current version and history unchanged. The future editor may show incomplete local work while editing, but Save must report errors and preserve that work for correction. No server-side draft is created.

## Authorization

All routes require the existing Cognito access token and verified account. Resolve the application user from trusted issuer/subject and check that the user is enabled, the URL organization is active, and its membership is active. Scope every taxonomy lookup to that organization.

| Action | Admin | Editor | Member |
| --- | --- | --- | --- |
| List and read current taxonomy | Yes | Yes | Yes |
| Preview a configuration | Yes | Yes | Yes |
| Create and save taxonomy | Yes | Yes | No |
| Archive taxonomy | Yes | No | No |

A role in another organization grants no access. Return `404 NOT_FOUND` for missing or inaccessible resources, and `403 FORBIDDEN` for an insufficient role after organization access is established. Preserve existing disabled/unverified-account errors. Every operation rechecks authorization; client permission flags are only display hints.

## HTTP contracts

Base path: `/v1/organizations/{orgId}`. Requests are JSON; reject unknown fields. Responses use `Cache-Control: no-store`. Taxonomy, version, organization, and user IDs remain positive bigint decimal strings; version numbers and array indexes are JSON integers. Segment/option IDs inside documents are opaque strings, as specified below. Timestamps are ISO 8601 UTC. Money is always a decimal string.

| Method and path | Input | Success |
| --- | --- | --- |
| `GET /taxonomies` | `page`, `pageSize` | `200` paginated active summaries |
| `POST /taxonomies` | `{content, changeSummary?}` | `201 {taxonomy, unchanged:false}` with version 1 |
| `GET /taxonomies/{taxonomyId}` | None | `200 {taxonomy}` with current content |
| `POST /taxonomies/{taxonomyId}/versions` | `{expectedVersionId, content, changeSummary?}` | `201 {taxonomy, unchanged:false}` or `200 {taxonomy, unchanged:true}` |
| `POST /taxonomies/{taxonomyId}/preview` | `{versionId, selections}` | `200 {configuration}` |
| `POST /taxonomies/{taxonomyId}/archive` | `{expectedVersionId}` | `200 {taxonomyId, archivedAt}` |

There are no history-read or subscription endpoints. Saving under `/versions` creates a version but does not make historical versions publicly addressable.

The catalog returns `{items, page, pageSize, totalItems, totalPages}`. Defaults are page 1 and page size 50; require positive safe integers, cap page size at 100, and reject unsafe offsets. Order by taxonomy `created_at DESC, id DESC`. Read count and rows in the same authorized transaction. Empty lists have zero total pages; out-of-range pages return empty items and accurate totals. Later requests may reflect newly added or archived records. No other query filters are accepted.

Archived taxonomies are omitted from the catalog. Members can still read the current version by its known ID, but cannot save or preview it. Archive is one-way, preserves all versions, and does not create a content version. Store `archived_at` and `archived_by_user_id` on the taxonomy. Require the current expected version even when repeating archive; return the original timestamp if already archived. No separate archival event table is needed.

## Ordered content document

Save input `content` requires `productFamilyName`, `currency`, `basePrice`, and `segments`. Segments require `id`, `placeholder`, `name`, `defaultOptionIndex`, and `options`. Options require `id`, `code`, `description`, and `price`. Optional text is explicitly null; `changeSummary` may be omitted or null. Clients initialize prices to `"0.00"` and currency to `"USD"`.

An illustrative create request contains all the main fields:

```json
{
  "content": {
    "productFamilyName": "F Series",
    "currency": "USD",
    "basePrice": "100.00",
    "segments": [
      {
        "id": null,
        "placeholder": "F",
        "name": "Series",
        "defaultOptionIndex": null,
        "options": [
          {"id": null, "code": "F", "description": "Fixed prefix", "price": "0.00"}
        ]
      },
      {
        "id": null,
        "placeholder": "XX",
        "name": "Size",
        "defaultOptionIndex": 0,
        "options": [
          {"id": null, "code": "12", "description": "Standard", "price": "20.00"},
          {"id": null, "code": "15", "description": "Large", "price": "30.00"}
        ]
      }
    ]
  },
  "changeSummary": "Initial family"
}
```

Array order is authoritative. There are no redundant `position` fields. Reordering segments changes future part-number order; reordering options changes only display order. Omitting an existing segment/option removes it from the new snapshot while preserving previous snapshots.

New entities use `id:null`; the server assigns UUID strings within the JSON document, without child tables or child-ID sequences. Retained IDs must occur in the expected current snapshot under the same parent. Require segment IDs to be unique in the document and option IDs unique within their segment. Reject fabricated retained IDs, moving an existing option to another segment, and resurrecting removed IDs. Initial creation requires null IDs throughout. Legacy IDs may remain opaque strings if a data conversion is needed.

`defaultOptionIndex` is null or a zero-based integer into the submitted option array. Resolve it after assigning new IDs and store `defaultOptionId` instead. This supports adding an option and making it default in one save. The client recalculates the input index from the selected default identity when reordering. A single option is automatically selected during configuration even if the explicit default is null.

The stored document contains a server-owned `schemaVersion:1`, `productFamilyName`, `currency`, `basePrice`, and the ordered `segments`. Stored/read segments use `{id, placeholder, name, defaultOptionId, options}`; options retain `{id, code, description, price}`. Normalize monetary strings before storing. JSON object-key order is not meaningful; array order is meaningful. `schemaVersion` describes the document format and is distinct from the user-visible taxonomy version number.

The `taxonomy` response contains:

| Field | Meaning |
| --- | --- |
| `id`, `ownerOrganizationId` | Stable family identity and owner |
| `createdAt`, `archivedAt` | Lifecycle metadata |
| `currentVersionId` | Current immutable version ID |
| `permissions` | `{canEdit, canArchive, canPreview}` for the current caller/state |
| `version` | `{id, versionNumber, createdAt, modifiedBy, changeSummary, content}` |

`modifiedBy` is `{id, name}`, using display name with email fallback. Historical attribution remains intact if the actor leaves or is disabled. The complete saved response supplies new entity IDs for the next edit. Archived state makes all three action flags false; repeating archive remains harmless for an authorized admin.

Catalog summaries contain `id`, `productFamilyName`, `currentVersionId`, `versionNumber`, `modifiedAt`, and `modifiedBy`; omit full content. Derive display metadata from the current version, rather than maintain duplicate mutable names/prices.

## Normalization and limits

Trim surrounding whitespace; turn blank optional text into null; reject control characters. Preserve the original casing of names and codes. Since nested uniqueness is now application validation, use the same locale-independent JavaScript `toLowerCase()` comparison throughout the validator, including non-ASCII test cases. Do not depend on database collation for JSON option uniqueness.

| Field | Limit |
| --- | --- |
| Product-family name | 1–120 Unicode code points |
| Segment placeholder | 1–32 code points |
| Segment name | Null or 1–120 code points |
| Option code | 1–64 code points, with no whitespace or `-` |
| Option description | Null or up to 1,000 code points |
| Change summary | Null or up to 500 code points |
| Segment count | 1–50 |
| Options | 1–500 per segment, up to 2,000 total |
| Request and stored document | Each at most 512 KiB of UTF-8 JSON; measure the normalized document after generated IDs are included |
| Money | Decimal strings from `0` through `999999999999.99`, at most two fractional digits |

Prices use ordinary decimal notation with no sign, exponent, commas, leading zeros except zero itself, or surrounding whitespace. Reject JSON numbers, fractional cents, NaN, and infinity. Canonicalize to two decimal places and use integer cents with BigInt or an exact decimal library. Validate the maximum possible configured total on save as well as the selected total on preview.

These initial count/text/size caps remain tuning assumptions for a real product example. A single JSONB column makes document size the main storage bound; the two count limits do not override the byte limit. DSQL has a separate column-size limit, so test maximum accepted documents against the actual target. [AWS database limits](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/CHAP_quotas.html).

For no-op detection compare normalized content, retained IDs, array order, and resolved default identities. Ignore object-key order, metadata timestamps, and change summary. Creating new IDs is a content change. A change only to `changeSummary` does not create a version. Check `expectedVersionId` first: a stale save still conflicts even if its content happens to equal the latest content.

## Save transactions and conflicts

A save uses a single transaction:

1. Validate request shape/size, then obtain the enabled actor and active organization/membership using existing authorization guards.
2. Load the organization-owned taxonomy and participate in DSQL conflict detection for that row. Reject archived taxonomies and compare `expectedVersionId` with the current pointer.
3. Validate the entire replacement, stable IDs, defaults, monetary totals, and final document size. Compare canonical content with the current snapshot.
4. For unchanged content, return the current snapshot without inserting or updating any content/version rows.
5. Otherwise insert one version with the next number, complete JSONB content, actor, timestamp, and optional summary. Conditionally advance the taxonomy pointer only if it still matches `expectedVersionId`; require one affected row.
6. Commit both changes together before returning success. Roll back the inserted version if pointer advancement or commit fails.

Creation validates a complete document, creates the taxonomy and version 1 atomically, and never exposes an empty taxonomy. Reserve the first version ID from the database identity sequence when needed for the deferred current-version relationship. Generate only nested UUIDs in application code. Taxonomy/version database IDs may have gaps after failed transactions.

Retain existing user/organization guard participation so role removal or disabling cannot race a successful write. Use the taxonomy row for save/archive/preview conflict detection; this is necessary even when edits are rare. DSQL `FOR UPDATE` is optimistic conflict detection, not a blocking lock. [AWS concurrency semantics](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-concurrency-control.html).

There are no automatic retries for taxonomy operations in the API or future client. Preserve other services' existing retry behavior; use a single-attempt transaction path for taxonomy. A stale version returns `409 VERSION_CONFLICT` with the current version ID when available. A DSQL serialization conflict or a competing insert violating the taxonomy/version-number unique constraint returns `409 CONCURRENT_CHANGE`, instructing the caller to reload; serialization conflicts may involve authorization or archive state rather than content. Do not treat unrelated constraint failures as save races. Transient connection/service failures return `503 SERVICE_UNAVAILABLE`.

After a lost save response, fetch the current taxonomy and compare it with the user's edit. Do not resend or overwrite automatically. Creation has no idempotency guarantee: if its response is lost, inspect the catalog before creating again. Repeating a creation request can create another family; duplicate family names remain allowed. This is the explicit MVP tradeoff for omitting creation keys and replay infrastructure.

## Configuration preview

Require `{versionId, selections}`, with `selections` an array of `{segmentId, optionId}` referencing the current snapshot. Reject duplicate segment choices, unknown IDs, and an option from the wrong segment. The selected organization must own the taxonomy; it must be active and unarchived. A stale version returns `409 VERSION_CONFLICT`.

For each segment, take an explicit valid selection, otherwise its single option, otherwise its explicit default. If a multi-option segment still lacks a selection, return `422 SELECTION_REQUIRED`. This is an incomplete configuration, not an invalid saved taxonomy. Codes and prices always come from stored content, never from the client.

Return `configuration` with `sourceTaxonomyId`, `sourceVersionId`, `productFamilyName`, `partNumber`, `currency`, `basePrice`, `unitPrice`, and ordered `selections`. Each result selection contains `segmentId`, `placeholder`, `name`, `optionId`, `code`, `description`, and `price`. Join codes with `-` and sum the base plus selected prices using exact cents. The example above defaults to `F-12` at `120.00`.

Preview does not persist a quote or promise that the version will remain current. A later quote-line feature must reauthorize, recheck the expected version, calculate, and store the complete part-number/price/selection snapshot in its own atomic transaction. Existing quotes must never be silently regenerated or repriced after taxonomy changes.

## Minimal database model

| Table | Fields and constraints |
| --- | --- |
| `taxonomies` | Bigint identity `id`; `owner_organization_id`; `current_version_id`; `created_by_user_id`; `created_at`; nullable `archived_at` and `archived_by_user_id` together |
| `taxonomy_versions` | Bigint identity `id`; `taxonomy_id`; positive `version_number`; complete `content jsonb`; `created_by_user_id`; `created_at`; nullable `change_summary` |

Keep identity/organization foreign keys and unique `(taxonomy_id, version_number)`. Use a deferred composite current-version foreign key so the pointer always references a version of its own taxonomy. Require JSON content to be an object with supported format version; detailed nested validation belongs to the service. The version document contains the family name, base price, and currency; these are not duplicated in mutable aggregate columns.

Grant SELECT/INSERT on version rows and no UPDATE/DELETE/TRUNCATE. Restrict aggregate updates to its pointer and archival fields. Runtime credentials cannot change ownership, attribution, or schema objects. A complete snapshot is inserted as one row, so no child-append protection, position-count constraints, PL/pgSQL, triggers, money domain, or xid transaction markers are needed. Money inside JSON remains validated canonical decimal strings.

Create an organization-leading active-catalog index and the version uniqueness/relationship indexes. Use supported asynchronous index installation and verify completion before release. Historical rows remain retained even though no history API exists. Do not create subscriptions, mutation receipts, or taxonomy audit tables.

Place the new schema in the next available numbered migration. First inventory actual deployed objects: an absent taxonomy module needs a direct JSONB first-install path, not execution of the incompatible relational baseline. If old populated taxonomy data exists, preserve it and specify an explicit conversion to ordered JSON snapshots before changing tables. Do not run old taxonomy triggers/functions for the new model. Update installation instructions accordingly.

## Errors and acceptance checks

Retain `{code, message, requestId}` with optional `fieldErrors:[{path, code, message}]` and `currentVersionId`. Use JSON Pointer field paths such as `/content/segments/0/options/1/code`. Never expose SQL or inaccessible identifiers.

| Status | Meaning |
| --- | --- |
| `401`, `403`, `404` | Existing authentication rules, insufficient role, missing/inaccessible resource |
| `409` | `VERSION_CONFLICT`, `CONCURRENT_CHANGE`, `TAXONOMY_ARCHIVED` |
| `413` | `PAYLOAD_TOO_LARGE` |
| `422` | `INVALID_INPUT`, `TAXONOMY_LIMIT_EXCEEDED`, `SELECTION_REQUIRED`, `PRICE_OUT_OF_RANGE` |
| `503` | Existing dependency errors or `SERVICE_UNAVAILABLE` |

Acceptance checks cover:

- Ownership/roles and current account/membership status on every route; no sharing or history reads.
- Invalid creation/save rejected with no stored changes, including empty segments, invalid defaults, duplicate codes, and any possible configured price overflow.
- Ordered JSON round-trip preserves all fields, IDs, leading zeros, defaults, and exact prices.
- A changed save creates exactly one attributed version; normalized no-ops do not. History rows remain immutable.
- Two saves based on one version cannot both commit; a failed commit leaves no orphan version or advanced pointer. No automatic retry occurs.
- Lost-response handling requires reload and does not promise creation deduplication.
- Preview, minimal pagination, and one-way archive behave as documented; existing identity/quote tests still pass.
- Live DSQL checks validate the actual JSONB schema, runtime grants, maximum document size, and concurrent saves. Local PostgreSQL tests alone are not proof of deployment compatibility.
