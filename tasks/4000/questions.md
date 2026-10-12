# Configuration Editor questions

Answered October 11, 2026. These questions record the decisions for task 4000. The approved [wireframe](wireframe.html), including removal of the overall segment/option count, is the visual baseline. The original questions and suggestions are retained below; the answers govern the updated plan, UX, and technical design.

## UX

### 1. How should users reach this editor?

Where should the user open a new taxonomy or an existing one, and where should the back arrow go? The current plan supports direct editor URLs but does not include a taxonomy list.

Suggested starting point: use direct URLs for this editor task and connect the entry/back links when the surrounding navigation is defined.

Answer: Yes, we will define this later.

Follow-up decision: Include a Product Configurations list in the organization’s admin section as part of this task. The list opens existing configurations and provides New configuration; the editor’s back link returns to the list. This supersedes the earlier deferral of entry navigation.

### 2. What should a new taxonomy contain initially?

Should it start with no segments, one empty segment, or one segment with a blank option? The F Series content in the wireframe is illustrative.

Suggested starting point: a blank product name and no segments, with Add segment visible. A new segment starts with no options and an editable blank placeholder.

Answer: It should be completely blank.

### 3. Which removals should require confirmation?

Should removing an individual option prompt every time, or should only removing a populated segment prompt?

Suggested starting point: confirm removal of a populated segment; remove individual options immediately from the local working copy. Neither change is persisted until Save. This would simplify the confirmation behavior currently proposed in the UX document.

Answer: Correct, no change is persisted until save. Save will always create a new copy of the configuration if there is a change.

### 4. How forgiving should price entry be?

Should users be able to enter `.50`, `1.`, or `$1.50`, or should inputs accept only plain decimal amounts such as `0.50` and `1.50`?

Suggested starting point: accept plain amounts plus `.50` and `1.`, then format valid values to two decimal places on blur. Reject currency symbols, commas, negative amounts, and more than two decimal places. The client converts accepted shorthand to the API's existing decimal-string format.

Answer: Accept anything, reformat on blur.

## Technical behavior

### 5. Is preserving fields outside this UI the right behavior?

The API also stores base price, currency, segment names, and defaults, which the approved wireframe does not expose. Should this editor preserve those values when opening an existing taxonomy?

Suggested starting point: preserve them. New taxonomies use USD and a zero base price; new segments have no name or default. If an option that was the default is removed, clear that default. No additional controls are needed.

Answer: Only expose the base price. No name or default.

### 6. What recovery is acceptable if creation succeeds but its response is lost?

The existing create API has no duplicate-request protection. The client may not know the new taxonomy ID after a connection failure, so repeating Save could create another taxonomy. The narrowed editor scope also has no catalog in which to find it.

Suggested starting point: keep the user's input, show that the save outcome is unknown, and stop automatic or blind repeat submission. For this initial scope, locating the created taxonomy would require support/developer assistance using the existing list/read API. Is that acceptable, or does creation need a user-facing recovery path before release?

Answer: This is a MVP, we do not need to handle these cases.

## Principal requirements added in voice

Confirmed: every configuration belongs to a principal while retaining the existing organization relationship. Principals are shared across all organizations. The admin section lists principals and lets an admin add one with a required name and web address. Name and website each independently prevent duplicates. Existing lost-response recovery remains outside the MVP.

### 7. What counts as the same website?

Should uniqueness use the domain, treating HTTP/HTTPS, a leading `www.`, and different page paths as the same principal website, or use the full normalized URL?

Recommendation: use the domain (normalize host casing and remove a leading `www.`); retain other subdomains as distinct. Keep the entered usable URL separately for display.

Answer: Use the top level domain. Implementation interpretation: the root/registrable domain, such as `example.com` or `example.co.uk`, treating its subdomains and page paths as the same website.

### 8. Can a saved configuration change principals?

Should the principal be fixed after creation, or can a later Save assign the configuration to a different principal? If changes are allowed, their version/history behavior must be specified alongside the existing immutable-save rule.

Answer: Allow setting the principal for each configuration. The editor includes principal assignment in Save; a changed principal creates a new version under the existing changed-save rule.

### 9. How should the configuration list filter?

Answer: Add a single filter to show configurations of a given principal. All principals is the initial selection; the results remain limited to the current organization.
