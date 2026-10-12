# Configuration Editor plan

Status: revised October 11, 2026 to use the [original screenshot](../../design/taxonomy/taxonomy-editor-ui.png) as the starting point. Implemented locally. See [implementation and verification](implementation.md) for delivered changes and deployment gates.

## Deliverables

- [User experience](user-experience.md)
- [Wireframe](wireframe.html), with [desktop](wireframe-desktop.png) and [mobile](wireframe-mobile.png) images
- [Technical implementation](technical-design.md)
- [Questions and decisions](questions.md)
- [Shared principals and database changes](database-design.md)

## Page scope

Build the editor shown in the screenshot, titled **Product Configuration**:

- Product name, required principal selection, base price, and part-number pattern at the top.
- Ordered segment columns with an editable placeholder, option count, reorder handle, and remove control.
- Inline option rows containing code, optional description, price, reorder handle, and remove control.
- Add option within each column and Add segment after the last column.
- A simple Save action for the complete taxonomy, as required by the existing save contract.

Keep the light header, gray workspace, compact white cards, and horizontal arrangement. Preserve the screenshot's density and ample unused workspace. The screenshot's surrounding design-tool controls are not application features.

Configuration calculation, archival, version-history displays, change summaries, segment-name controls, and default-option controls are outside this page's initial scope. Preserve existing values for fields the page does not expose. New configurations start completely blank, with no sample name, segments, or options. The organization’s admin section includes a Product Configurations list that opens this editor and provides a New configuration action. The editor’s back link returns to that list.

## Product Configurations list

Add a simple list to the existing organization admin/settings page. Show active configurations for that organization with product name, principal, and last modified time. Each name opens the Configuration Editor; New configuration opens a completely blank editor. Use the existing list endpoint and Previous/Next pagination, with loading, empty, and error states. Add one Principal filter with All principals as the default; choosing a principal shows only that organization’s configurations assigned to it. Keep search, archive actions, and history browsing outside this task. The admin section retains its existing administrator-only visibility; existing API permissions remain unchanged.

## Shared Principals list

Add a Principals list to the organization admin section, showing the same shared directory in every organization. Administrators can add a principal with a required name and web address. Reject a duplicate name or a duplicate website globally, including concurrent additions. Each configuration must reference a principal while keeping its existing organization owner. See the database design for the additive schema, API routes, and root-domain uniqueness and versioned principal-assignment behavior.

The editor includes a compact principal selector with no preselected value for new configurations. Implementation screenshots are linked in the delivery record.

## Implementation sequence

1. Implement principal name/root-domain uniqueness and the additive migration and principal API, preserving existing schema/data.
2. Add the shared Principals list and admin creation form.
3. Add the Product Configurations list to the admin section and connect new/open/back navigation.
4. Build the editor layout and required principal selector and versioned reassignment, blank initial state, base-price field, and local add/edit/remove/reorder interactions. The screenshot’s sample content illustrates an editing state only.
5. Connect current-taxonomy loading and complete-document create/save to the existing API.
6. Add field errors, unsaved-change feedback, duplicate-submit protection, and simple conflict handling.
7. Verify principal constraints/authorization, then the list and editor layouts on desktop/mobile and test editing, ordering, payload preservation, and save behavior.

The task uses the existing taxonomy list/create/read/save routes, extends taxonomy payloads with a principal relationship, and adds principal list/create routes plus an additive database migration. See the technical document for payload mapping and validation.

## Acceptance

An administrator can view the global principal list and add a principal with a unique name and website. Every configuration references a principal; changing that selection creates a new version on Save. The list filters by principal while organization isolation remains intact. An administrator can list their organization’s product configurations, create one, and open an existing one from the admin section. The editor resembles the reference at first glance. A user can edit the product name and base price, change segment placeholders, manage priced options, reorder content, and save the complete taxonomy. Incomplete work remains visible for correction. Price fields accept free-form entry and format recognized amounts to two decimals on blur. Each changed Save creates a new immutable version of the configuration; unchanged content does not create a copy. Dedicated recovery for lost create/save responses is outside the MVP. Saving preserves retained IDs and fields not exposed by this editor. Keyboard users can perform the same actions; narrow screens scroll the segment area horizontally.
