# New / Edit quote pages

Status: initial proposal for review, October 12, 2026. Questions in [questions.md](questions.md) are unresolved; recommendations below are planning assumptions, not approved requirements.

## User story

As an organization user preparing a customer quote, I want to choose existing product configurations, select their available options, and set quantities, so I can build and later edit an accurate quote without manually assembling part numbers or calculating prices.

As a user reopening a quote, I want to see the exact products, selections, and prices that were saved, so changes to the configuration catalog do not change a quote I already prepared.

## Starting point and visual reference

Use the [supplied screenshot](Screenshot%202026-10-12%20at%205.53.45%E2%80%AFPM.png) as the layout reference: quote details above stacked line cards, completed lines with option breakdowns, inline configuration of a new line, and a total at the bottom right. The [interactive wireframe](wireframe.html) illustrates both New and Edit modes, a blank quote, completed lines, and an incomplete line. All example data and saves in the wireframe are local demonstrations.

Static previews: [desktop](wireframe-desktop.png) and [mobile](wireframe-mobile.png). Browser verification covered example totals, quantity changes, staged line edits, Done, required-field validation, adding/configuring a new line, sequential Tab/Shift+Tab navigation, active-segment expansion, option selection, clickable part-number navigation, case-insensitive direct code entry, invalid-code handling, and automatic horizontal scrolling on mobile with the full-number preview remaining stationary and no page overflow. These checks verify the planning prototype, not an implemented quote feature. The prototype includes a searchable product combobox with name/model/principal matching, selected-item checks, keyboard navigation, dismissal, and no-results feedback. It follows the [Headless UI Vue Combobox pattern](https://headlessui.com/v1/vue/combobox) with styling matching the app’s Tailwind conventions. The standalone HTML demonstrates the interaction without loading Vue or installing a component package; the application implementation should use the Headless UI component styled with Tailwind utilities. Live catalog pagination/search, historical-version refresh, and server persistence remain proposed application behavior.

The app already has an organization Quotes list and a New Quote placeholder. It stores customer name, project name, optional customer ID, owner, and modification metadata. Quote title is derived as `Customer - Project`; there is no independently stored quote name. The existing quote PATCH only changes the owner. Quote detail reads, full creation/editing, and persisted line items still need implementation.

Existing product configurations are organization-owned taxonomies, linked to shared principals. Their versioned content includes product name/description, base price, ordered segments, separators, option codes/descriptions/prices, and optional defaults. Product configuration editing stays in the existing admin workflow; this feature consumes saved configurations.

## Entry and quote details

1. **New Quote** on the current organization's Quotes list opens the new page. Start with empty customer/project fields, the current user as the proposed owner, and no line items. Show **Add line** and a zero total.
2. Selecting a quote title opens **Edit quote**, with its metadata and saved line items loaded. Proposed routes are `/organizations/[orgId]/quotes/new` and `/organizations/[orgId]/quotes/[quoteId]`, using existing organization route helpers.
3. Keep the application shell, a **Quotes** back link, a clear heading, an unsaved/saved indicator, and one **Save** action. Show last modified by/time when editing.
4. The proposal retains required **Customer** and **Project** fields and displays the derived title, rather than introducing an independent quote name. Include **Owner**, using eligible active team members and an Unassigned option. This deliberately differs from the optional Quote name/Customer fields in the screenshot; resolve question 1 before implementation.
5. Customer ID remains hidden until a customer directory workflow is defined. All edits are local until Save. Warn before navigating away with unsaved changes.

## Add and configure a line

**Add line** appends an inline editor and focuses its product selector. Choose an active saved configuration belonging to the current organization. Show product name and principal in the picker to distinguish similar names. Search matches product name, model code, and principal, ignoring case. Show product name and principal/model on separate lines in each result, with a check on the selected item. Arrow keys browse, Enter selects, and Escape closes/restores the current product. Tab and clicking outside close the list without applying an unselected search. An empty search shows available configurations; no matches explain how to try another query. Retain confirmation before switching a configured product. Use Headless UI’s Vue Combobox with Tailwind styling for application implementation; loading, retry, and no-configurations states must be usable. If empty, explain that an administrator must create a product configuration first.

After product selection, show its description and one horizontal row of part-number segments. Each column places its code directly above its label and dropdown, so the selection is visibly attached to its position in the product number. Use the full available page width and let segment columns grow to fill the row, giving the focused segment extra width for option descriptions and prices. Preserve comfortable minimum widths and scroll the row when the columns cannot fit. Keep stored separators between adjacent columns. Single-option segments remain visible as fixed positions but do not add a Tab stop. The product picker sits above this row; quantity sits below it. Each option presents its code, description, and price addition. Use a segment's name when present, otherwise its placeholder; existing editors do not require human-readable segment names. Use the placeholder/code as the fallback when descriptions are absent. Codes are text and retain leading zeroes. Respect stored separators, including blank separators; do not hard-code hyphens or derive a prefix from the product name.

Preselect single-option segments and saved defaults, matching the existing preview behavior. Other segments require an explicit choice. Display the part number as selections fill in, with placeholders for missing segments. Tab and Shift+Tab move through editable segments in number order. A compact full-number preview sits above and outside the scrolling row, wrapping on narrow screens so all positions remain visible. Clicking an editable code in this preview or a completed card opens/focuses its corresponding segment. Fixed codes stay visible but are not editable. The preview supports keyboard navigation with arrow keys and Enter. Focus highlights the corresponding code in both the preview and the row and expands that segment to reveal full option descriptions and price additions; other segments stay compact. Each editable segment uses a code-entry combobox. Typing filters options by code prefix, ignoring case and preserving the stored code spelling and leading zeroes. Arrow keys browse matches; Enter applies the highlighted option. Tab accepts an exact code before moving to the next segment, without accepting an ambiguous prefix. Escape restores the previous selection. Unknown or incomplete codes retain their text and prevent line completion until resolved; typing does not silently select an option. Selecting an option keeps focus in the current segment, and Tab advances when the user is ready. The expanded option list also supports pointer selection without adding extra Tab stops. Focus reveals options without silently selecting a value. Missing choices use pale amber backgrounds and borders with a “Choose an option” label; completed editable segments stay neutral with a green check and “Complete.” The active segment and its preview code use blue, while retaining the completion label. Invalid codes use red with a specific error message and exclamation marker, omitting a redundant “Invalid code” status label; uncommitted matching text is labeled “Choice pending.” Mirror these states in the full-number preview. Fixed segments remain muted gray. Color always accompanies text or a marker rather than being the only indication. Keep the focused segment in view by scrolling only the segment workspace, and show the segment position and completion count. Use quantity 1 initially, with a labeled numeric field and increment/decrement controls.

Once all segments are selected and quantity is valid, **Done** collapses the editor into a completed card. It is a local action, not a server save. The card shows the generated part number, product/principal, quantity, unit price, line total, and the selected option breakdown. The option breakdown includes the base price so the unit price is fully explained.

## Edit and remove lines

**Edit line** reopens its selections and quantity in place. Proposed behavior: stage changes in the line editor; **Done** applies them to the local quote and **Cancel** restores the previous completed line. While an existing line is being edited, retain its previous committed amount in the quote total and label that behavior. New incomplete lines contribute nothing. The wireframe demonstrates this distinction.

Changing the product resets selections to the new product's defaults/single options and requires completing that line again. Confirm switching a product if it would discard manually selected options. Quantity changes on completed cards update totals immediately in the local quote. Restrict quantities to positive whole numbers for the proposed MVP.

Keep insertion order and number cards sequentially. Allow multiple lines from the same configuration, with different selections or quantities. Removing a completed/populated line asks for confirmation; an untouched new line can be removed immediately. Return focus to an adjacent line or Add line. Reordering and duplication are deferred unless requested.

## Prices and configuration changes

For each completed line, calculate `unit price = base price + selected option prices`, `line total = unit price × quantity`, and `quote total = sum of completed line totals`. Use USD with two decimals and exact cents arithmetic. Prices are read-only in this proposal. Discount, tax, shipping, and manual-price adjustments are outside the proposed MVP.

The existing configuration API requires quote persistence to store a complete snapshot: source taxonomy/version, product data, selected segment/option identities and labels, part number, currency, base price, option prices, and unit price. Preserve the associated principal identity/display information as well. The server reauthorizes and validates new/reconfigured lines and calculates their prices at save; browser totals are previews.

Reopening a saved quote uses its snapshots, including when its source configuration was changed or archived. Do not silently refresh or reprice it. Proposed handling: unchanged historical lines remain savable; quantity-only changes use the saved unit price. Reconfiguration against the current catalog is an explicit action that shows the revised price before applying it. If the source is archived, allow reading/removing the saved line and editing quantity, but block new selections from that source. Resolve question 3 before implementing this interaction.

If a configuration changes while adding/reconfiguring a line, preserve the user's work and require reviewing the latest configuration before saving that line. An outdated preview must not bypass the current-version check.

## Save, feedback, and access

Proposed save requirements: valid customer/project names, an eligible owner or Unassigned, at least one completed line, valid quantities, and no open incomplete/edited lines. Save metadata and all lines together. Focus the first invalid field; preserve entered values after errors. Disable repeated Save while pending. Successful creation opens Edit quote for the new ID; successful editing stays on the page, adopts the server response, and shows Saved. The Quotes list reflects updated metadata when revisited.

Show a loading state when opening an existing quote, retry for ordinary request failures, and a clear unavailable/access-lost state. Handle concurrent edits, including owner changes from the list: preserve local input on conflict and ask the user to reload/reconcile, never silently overwrite. A quote concurrency token and full-write contract still need design.

Use current organization authorization for quotes, owners, and every source configuration. Proposed writers are admins/editors, consistent with the existing owner-write authorization; all members can read. Role policy is an open question. Shared principals do not grant access to another organization's configurations. Permission/session loss stops writes and clears inaccessible server data using existing app conventions.

## Mobile and accessibility

On narrow screens, stack metadata and move quantity/prices below the product heading. Keep configuration segments in a single horizontal scrolling row so their relationship to the part number stays intact; do not wrap the segment selectors into a grid. Automatically scroll the active segment into view on keyboard focus. Completed part numbers can wrap within their cards. Keep all selected option details readable without page-wide horizontal scrolling. Place the total below the lines. Use visible labels, semantic headings, descriptive line-action names, visible focus, and accessible status/error announcements. Restore focus after Done, Cancel, and removal.

## Acceptance scenarios for implementation

- A user creates a quote from two organization configurations with different quantities; stored part numbers, option breakdowns, and total match server-calculated values.
- Single choices/defaults prefill correctly; a missing required segment keeps the new line incomplete and prevents Save. Leading zeroes and blank separators are preserved.
- A user reopens the quote, edits metadata/quantity/selections, adds and removes lines, and saves a consistent result visible in the Quotes list.
- A later catalog change leaves saved lines and prices intact; an explicit refresh surfaces changed or removed options before accepting new selections.
- Empty catalog, loading failure, invalid metadata/quantity, stale configuration, quote conflict, and revoked access have actionable feedback without silent data loss or overwrite.
- Unauthorized users cannot create/edit quotes or reference configurations/owners outside the organization. Keyboard-only and mobile users can complete the workflow.

## Planning boundary

This task currently produces planning artifacts only. Implementation will need quote detail/create/full-update API contracts, line/snapshot storage, atomic server validation/calculation, concurrency protection, fixtures, and list-title navigation. Existing taxonomy list/read/preview and quote-owner APIs can support the workflow but do not persist a quote.

Proposed exclusions: customer directory, send/export/PDF, approval/status lifecycle, quote deletion, discounts/taxes/shipping, manual products/prices, quote history, and automatic catalog refresh. In-page “unsaved” is an editing indicator, not a proposed database Draft status. See [questions.md](questions.md) for scope decisions.
