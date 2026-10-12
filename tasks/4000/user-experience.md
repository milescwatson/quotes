# Configuration Editor user experience

The [original screenshot](../../design/taxonomy/taxonomy-editor-ui.png) defines the page's layout and visible controls. The [wireframe](wireframe.html) follows that arrangement.

## User story

As a product editor, I want to define the ordered parts of a product code and the available options for each part, including their prices, so I can maintain a product family's taxonomy in one place.

## Admin list and editor navigation

The existing organization admin section shows a **Product Configurations** list. Display product name, principal, and last modified time for each active configuration. Selecting a name opens the Configuration Editor; **New configuration** opens the blank editor. The editor’s back arrow returns to this list, with the existing unsaved-change warning when needed. Saving keeps the user in the editor; returning to the list fetches current names and modification times.

Provide one **Principal** filter, initially **All principals**. Selecting a principal resets to the first page and shows only the current organization’s configurations for that principal. Use Previous and Next for pagination. Show a simple loading state, a retry action if loading fails, and No product configurations yet with the New configuration action when empty. Keep this list in the existing administrator-only section.

## Shared Principals list

The admin section also shows **Principals**, shared across all organizations. Display each principal’s name and website. **Add principal** opens a small form requiring both fields. On a duplicate name or website, retain the entered values and show an error beside the conflicting field; an admin can select an existing principal instead of creating a duplicate. A newly added principal is available to every organization. Websites with the same root domain count as duplicates, even if their subdomains or page paths differ.

The Configuration Editor includes a required principal selector populated from this directory. New configurations have no selection. If the directory is empty, explain that an administrator must add a principal in the admin section before the configuration can be saved. Linking a principal does not share the configuration with other organizations. The selected principal can be changed; it remains a local edit until Save, which creates a new version for that change.

## Layout and editing

The editor label is **Configuration Editor**, and the page heading is **Product Configuration**. At the top, the user enters the product name, such as F Series, selects its principal, and enters the base price. Below it, the part-number pattern displays segment placeholders in order: `F - XX - YY - ZZ`.

A new configuration is completely blank: no product name, principal selection, segments, options, or pattern tokens. The base-price input is empty with a `0.00` hint; leaving it empty means a zero base price. Add segment is visible. New configurations are opened from the admin list, and the back link returns there. The populated wireframe is an example of work already entered.

Each segment is a compact column. Its header shows a reorder handle, position number, editable placeholder, option count, and remove control. The body has three columns: Code, Description, and Price. Values are edited directly in each row. Description is optional; new prices start at `0.00`. Codes remain text so values such as `01` retain their leading zero.

Add option inserts a blank row in that segment and focuses its code. Add segment appends a new column and focuses its placeholder. An empty segment displays No options yet and keeps Add option visible, matching the reference. The pattern and each segment’s option count update as the user edits.

The user reorders segments or options using their handles. The same handle exposes keyboard move actions so reordering does not depend on dragging. Removing a populated segment asks for confirmation. Individual options and empty segments are removed immediately from the local working copy. Focus returns to an adjacent item or the relevant Add control after removal.

## Save and feedback

One compact Save button in the header saves the complete taxonomy. This is the small addition needed to support the existing explicit-save behavior. Edits remain local until Save; a brief unsaved/saved status appears alongside it. Every save with a content change creates a new immutable copy (version) of the same configuration. An unchanged save creates no new copy.

Price inputs allow free-form typing and pasting. On blur, recognize common USD amounts, including currency symbols, grouping commas, and shorthand such as `.50` or `1.`, and format them to two decimal places. Round extra decimal places to cents. If text cannot be interpreted as a valid nonnegative USD amount, keep it visible with a field error rather than silently replacing it. The same behavior applies to base price and option prices.

Users may leave a segment or option incomplete while editing. When they save, show specific errors next to the relevant fields and focus the first problem. Preserve entered values after failure. Disable repeat submission while a save is pending and adopt the server's returned content after success.

If the saved taxonomy has changed elsewhere, preserve the user's input and show a concise reload-required message. Do not silently overwrite or automatically retry a write. Warn before leaving with unsaved changes. For ordinary request failures, show an error and preserve the input. Dedicated handling of lost responses, duplicate-create recovery, and comparison screens are outside the MVP.

## Small screens and accessibility

Keep the same columns on small screens, with horizontal scrolling contained to the segment workspace. The name, base price, pattern, and Save remain accessible above it. Use visible focus indicators and descriptive accessible names for compact icon controls. Input labels can come from the column headings and segment context without adding a label above every cell.

## Boundary

This page edits the structure shown in the screenshot. The accompanying configuration and principal lists provide admin navigation. This task does not add a configuration calculator, archive workflow, or metadata/settings panels. Base price is editable. Currency stays USD; segment names and defaults have no controls. Preserve existing hidden names/defaults when editing saved content. New taxonomies use the API's initial values described in the technical design.
