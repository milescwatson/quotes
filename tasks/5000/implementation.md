# Quotes implementation

Implemented locally on October 12, 2026. The feature, API contract, and database migration are ready for review. Migration 0004 and Lambda version 8 with the matching Gateway routes/CORS are deployed to development. The frontend release passed Amplify job 12 for commit `9cb92df`, and the live site serves the new Quotes editor asset. Staging and production remain unchanged.

## Delivered behavior

New Quote opens a blank customer/project form with the current user as owner. Quote titles on the list open Edit quote. Customer and Project remain required and determine the title; Customer ID stays hidden. Every active organization member can create/edit, regardless of ownership. Owners must be active members of the same organization, or Unassigned.

Users choose active organization products through Headless UI's searchable Vue combobox, matching product, model/pattern, and principal. All catalog pages load, with loading, retry, no-results and empty-catalog feedback. Choosing a product preselects fixed positions and defaults. Each option selector accepts case-insensitive code entry, preserving stored spelling and leading zeroes. Exact codes commit on Tab; ambiguous prefixes and unknown codes remain for correction; Escape restores the previous choice. Arrow/Enter and pointer selection are supported. Segment labels use names or placeholders, option descriptions fall back to codes, and stored separators—including blank separators—are retained.

Segments stay in a horizontally scrolling row; the active segment expands and scrolls into view. The full number preview remains outside that workspace and its editable codes focus the corresponding selector. Missing, pending, invalid, complete, and fixed states have textual markers. Completed cards also offer direct code navigation and a base/option price breakdown.

Lines support Add, Edit, Done, Cancel and Remove, retain insertion order, and allow repeated products. Done commits locally; Save also commits valid open editors. Cancel restores the completed line. A populated line/product switch asks before discarding data. Existing line amounts remain in the quote total until staged changes are applied. Blank selections and quotes with zero lines are savable; an added line must have a product. Invalid typed codes cannot be persisted. Quantities are positive whole numbers. Partial selections are visibly incomplete, with amounts labeled as estimates.

The user clarified during implementation that quantities and dollar totals are included. Prices are read-only USD, calculated with exact cents on the server as base plus selected additions, multiplied by quantity. Missing option additions are omitted from estimates. Discounts, tax, shipping, migration to newer versions, export, and quote lifecycle features remain outside scope. Limits are 100 lines, quantity 1–1,000,000, total up to 999,999,999,999.99 USD, and 512 KiB of saved snapshots.

Saved lines include their complete configuration content, version/source identities, principal identity/display name, choices, part number, quantities and prices. Editing a historical line continues using that snapshot, including after catalog changes or archive. New/switched products must use the current active organization configuration; stale catalog previews are rejected. Browser amounts are previews; the server derives and validates persisted amounts.

GET detail, POST create, and PUT full-update routes save metadata and lines atomically. Gateway CORS includes PUT for full quote updates. Full writes require the exact detail concurrency token, retaining PostgreSQL's microsecond timestamp precision. Concurrent full saves and owner changes from the list invalidate stale tokens. No-op saves retain modification metadata. Errors preserve input; conflicts require explicit reload; access/session loss clears inaccessible data and stops writes. Unsaved navigation/sign-out guards, accessible labels/status/error feedback, focus restoration and mobile containment are included.

## Verification

- API suite: 79 tests passed, including nine quote persistence/schema cases covering historical editing, organization isolation, no-op saves, owner conflicts, runtime grants, invalid options/owners/quantities, empty selections and atomic rollback. Additional stale-catalog and monetary-overflow assertions passed.
- Database regression suite: 12 tests passed using local PGlite.
- Full Chromium regression suite: 41 tests passed, including eight quote editor workflows. A separate desktop/mobile screenshot check passed.
- Final focused quote suite: all nine checks passed, including desktop/mobile visual review and active-segment visibility.
- HTTP/OIDC browser regression suite: three tests passed with mocked external endpoints.
- Frontend typecheck and production build passed.
- API build and bundled Lambda verification passed.

Browser checks use development fixtures. Live development runtime-role verification passed eleven quote checks; dedicated fixtures and the temporary Lambda were removed. The recorded database migration is complete. Other environments require applying [migration 0004](../../database/versions/0004/quotes/README.md), verifying target grants/constraints, and deploying the Gateway contract, API and frontend together. The [deployment ledger](../../database/DEPLOYMENTS.md) records 0004 as applied in development.

## Screenshots

- [Desktop editor](screenshots/editor-desktop.png)
- [Mobile editor](screenshots/editor-mobile.png)

## Development release

The database schema/grants, API Lambda version 8, all 26 Gateway routes, PUT CORS and Amplify frontend job 12 are verified in development. The final Terraform plan reports no changes. Gateway initially rejected YAML aliases in the generated additions; those were expanded and protected by a regression check before the successful Gateway-only retry. Live runtime evidence is in `database/deployments/development-0004-validation.json`; API/Gateway evidence is in `AWS/deployments/2026-10-12-quotes-verification.json`.
