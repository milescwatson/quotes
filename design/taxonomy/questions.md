# Taxonomy requirements and decisions

Updated October 10, 2026. These are consolidated answers from the initial requirements discussion and the user's later MVP decisions, rather than a verbatim transcript. The [product specification](specification.md), [API specification](api-specification.md), and [implementation plan](../../tasks/3000/plan.md) define the current design.

## Product requirements

| Question | Current decision |
| --- | --- |
| What owns a taxonomy? | One organization owns a taxonomy for one product family. A family can produce many configurations. |
| Can organizations share taxonomies? | Deferred. MVP access is limited to the owning organization; subscriptions can be added later. |
| Are choices nested or independent? | Flat, independent, ordered segments. No compatibility rules in the MVP. |
| How many choices per segment? | Exactly one option per completed configuration. |
| Are defaults supported? | Yes. Automatically select a single option; a multi-option segment may have an explicit default. |
| What describes a segment? | An editable placeholder and optional name, with unique labels within the taxonomy. |
| What describes an option? | A code, optional description, and price. Codes are unique case-insensitively within the segment. |
| How is price calculated? | Base price, initially zero, plus selected option prices. No manual-price options. USD only. |
| Can segment or option lists be reused? | No shared option/segment libraries in the MVP. |
| What happens to existing quotes? | Their stored part numbers and prices remain unchanged after taxonomy changes, including for quote drafts. |
| Who can edit? | Existing organization roles: admins and editors save content; all members read/configure; admins archive. |
| Are integrations required? | No imports or external synchronization requirements have been identified. |

## Selected MVP workflow and storage

| Question | Current decision |
| --- | --- |
| Which database? | Keep Aurora DSQL. |
| How is content stored? | One ordered JSONB document per version, with relational taxonomy/version metadata. No relational segment/option tables. |
| How does saving work? | One explicit Save submits the complete taxonomy. No autosave or separate writes while editing. |
| Can incomplete or invalid content be saved? | No. Initial creation and later saves must pass full validation. Incomplete work stays locally in the editor. |
| Is there a publish step? | No. A successful changed save becomes current immediately. |
| When does the version increment? | Once per successful save with content changes. Normalized no-op saves retain the current version. |
| What history is retained? | Immutable full versions, including who modified the taxonomy and when. History browsing/restoration is deferred. |
| How are stale saves handled? | Require `expectedVersionId` and reject outdated saves. No automatic retries, merge, mutation receipts, or creation deduplication keys. |
| Is a separate audit system needed? | No. Version records provide content history; archive actor/time live on the taxonomy. |
| What does the catalog include? | Owned active taxonomies with basic pagination. Search, sharing, and archived browsing are deferred. |

## Documented implementation assumptions

The following details make the contract concrete; they are implementation assumptions rather than verbatim user answers. Full rules and initial limits are in the API specification.

- Preserve leading zeros and entered code casing; join codes with configured separators (default `-`). Codes may contain `-`; selections are stored by segment rather than parsed from the assembled part number. Reject whitespace inside option codes.
- Use nonnegative exact USD amounts with at most two decimals. Validate that all possible configurations fit the supported total range.
- Require at least one segment and one option per segment; a default is optional when the segment has multiple options.
- Remove segments/options only from the next snapshot; retain prior snapshots. Archive entire taxonomies without deleting history or adding an unarchive workflow.
- Keep stable nested IDs and array order in JSON. The server assigns new nested UUIDs and resolves submitted default indexes to stable option IDs.
- Do not create a catalog SKU for each configuration. Future quote lines retain independent configuration snapshots.
- Allow duplicate family names; no creation replay/deduplication guarantee is promised.

## Remaining sizing inputs

Provide a typical segment/option count and one real complete configuration with prices when available. The current examples are illustrative. The API specification proposes initial size/count limits; adjust them only if representative data requires it.

The selected backend decisions are implemented locally; see the [implementation record](../../tasks/3000/implementation.md). Deployment validation, the editor UI, and quote-line persistence remain separate steps.
