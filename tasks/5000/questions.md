# Task 5000 questions

Open as of October 12, 2026. The [user story](user-story.md) and [wireframe](wireframe.html) use the recommendations below as provisional assumptions. They do not record user approval.

## Decisions needed before implementation

### 1. Which quote details should be stored and required?

The screenshot has optional **Quote name** and **Customer**. Existing storage requires customer and project names and derives the title as `Customer - Project`. Should we keep this model or introduce an independent quote name and optional metadata? If details can be blank, what should the list display as the title?

Recommendation: retain required Customer/Project and derived title for this MVP, include Owner, and keep Customer ID hidden. The wireframe follows this recommendation.

### 2. Who may create and edit quotes, and what is the initial owner?

Should admins/editors be able to edit all organization quotes? Should members be able to create or edit their own quotes, or any quote? Does quote ownership affect authorization? Should a new quote default to its creator or Unassigned?

Recommendation: admins/editors write all organization quotes, members read; ownership is attribution rather than access control. Default owner to the creator and allow Unassigned, with the existing active-team-member picker. This follows current owner-write permissions but needs confirmation for full quote editing.

Answer: Everyone can create and edit quotes.

### 3. How should existing lines behave after their configuration changes?

Snapshot preservation is already required by the [taxonomy API specification](../../design/taxonomy/api-specification.md): saved quotes must never be silently regenerated or repriced. On an existing line, should editing options use its saved version, require moving to the latest version, or offer both? Can quantity change at the historical price? What happens if the source is archived, or selected options no longer exist?

Recommendation: preserve historical lines; quantity-only edits keep the saved price. Offer an explicit current-configuration refresh for option edits, showing new prices and requiring replacement of missing choices. Archived sources remain readable and support quantity/removal, but cannot supply new selections. This requires more than the current latest-version-only preview endpoint; the wireframe's local Edit control illustrates layout, not the migration workflow.

Answer: Lets just have it continue using whatever version of the configuration used when the quote was created. Later, we can add migration to newer versions if required.

### 4. Can Save persist incomplete or empty quotes?

The screenshot excludes a line still being configured from totals. Should users be able to save that incomplete work, metadata without lines, or a quote with no customer/project yet? Is Draft a persisted quote status or simply a page indicator?

Recommendation: require valid metadata and at least one completed line, with no pending line editors. No persistent draft/status model in the MVP. New incomplete lines are excluded from the total; an edited existing line retains its previous amount until Done. If drafts are required, specify how list totals, draft selections, and resume behave.

Answer: It can persist empty options.

### 5. What pricing and quantity rules are needed?

Is the quote price just base price plus option additions, multiplied by quantity? Are discounts, markup, overrides, tax, freight, or fractional quantities needed now? Is USD sufficient? What maximum quantity and quote total should be accepted?

Recommendation: read-only configuration prices, USD, positive integer quantities, and no additional charges/discounts. Define quantity and aggregate monetary limits when designing the write contract; validate multiplication and sums for overflow on the server.

Answer: Skip this for now.

### 6. How should products be found and segment choices presented?

Is a searchable product selector showing principal/product name enough, or should users first filter by principal? The reference uses descriptive segment labels, but saved configurations may have only placeholders and optional descriptions. Should these fallbacks suffice, or should task 4000 gain a field for customer-facing segment labels? Should defaults be preselected?

Recommendation: one searchable organization product picker with principal labels; use name or placeholder for segment labels and description or code for options. Honor existing single-option/default selection rules. Consider a principal filter when catalog size warrants it.

UI direction from review: show segment dropdowns horizontally in part-number order, scroll when necessary, and expand/highlight the focused segment as the user tabs through it. The revised wireframe demonstrates this behavior. Follow-up direction adds clickable codes, a full-number preview outside the scrolling row, and direct code typing with matching options. These interactions are implemented in the prototype; product discovery and label fallbacks remain open decisions.

Answer: Just use a searchable picker for now.

## Workflow and scope decisions

### 7. Should selecting a quote title open Edit directly?

Is an editable page the intended destination, or should there also be a separate read-only quote details page? What should members who can only read see?

Recommendation: one shared page, editable for authorized writers and read-only for readers. Save stays on Edit; Back returns to Quotes. Link the title from the list. No separate details screen for this task.

Answer: For now, no read only is needed.

### 8. Which line actions belong in the MVP?

Are Add, Edit, quantity change, and Remove sufficient, or do users need duplicate, reorder, free-form products, or entry of an existing full part number? Should repeated configurations merge automatically?

Recommendation: keep independent lines in insertion order, including repeated configurations; support Add/Edit/Remove and quantities only. A full-part-number parser and manual lines would be separate features.

Answer: None of this is needed for now.

### 9. What should happen when someone else edits the quote?

Should a stale Save be rejected for review, offer a comparison, or automatically merge unrelated changes? Owner changes can already happen from the Quotes list and should participate in this rule.

Recommendation: reject stale full saves using a server concurrency token, retain local input, and require reload/reconciliation. No automatic merge or history browser in the MVP. Unchanged saves should not update modification metadata.

Answer: Just reject stale, and alert the user.

### 10. Is saving the quote the endpoint for this task?

Do we need quote numbering, customer-facing output, PDF/download, email, status/approval, expiration date, notes, or deletion as part of New/Edit?

Recommendation: end at a saved organization quote visible in the list. Defer these additions until their workflow and required output are defined.

Answer: Saving is endpoint for now.
