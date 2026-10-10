# Quotes app and taxonomy MVP goals

Create a fast, simple application for quoting configurable products. Organizations define product families using ordered segments such as `F-XX-YY-ZZ`, with priced options for each segment. A configuration produces a full part number and an exact USD price. Saved quotes retain their original values after the taxonomy changes.

The eventual editor displays segments as ordered columns and options within each column. Users can add, edit, remove, and reorder both. One explicit Save validates the complete taxonomy and creates a new version only when content changes. Incomplete work may remain in the editor but cannot be saved. There is no separate publishing workflow.

For the MVP, each organization uses only its own taxonomies. Aurora DSQL stores one complete ordered JSONB document per immutable version, preserving fields, defaults, prices, and attribution. Keep version history without a browsing interface, reject stale saves with `expectedVersionId`, and use a minimal active-taxonomy catalog.

Sharing, history browsing/restoration, automatic retries, request replay infrastructure, and a separate taxonomy audit system are deferred. The API is implemented locally; deployment validation, the editor, and quote-line persistence remain separate steps. See the [implementation record](../../tasks/3000/implementation.md).

See the [product specification](specification.md), [API contract](api-specification.md), and [implementation plan](../../tasks/3000/plan.md).
