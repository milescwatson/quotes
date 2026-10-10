# UI design specification

## Goal

Build a modern, functional interface that makes configuring products and creating quotes fast and straightforward. Keep the initial design simple and consistent.

## Styling

- Use basic Tailwind CSS utilities and its default theme. No component library or custom design system for now.
- Use a system sans-serif font, neutral backgrounds, white panels, and dark, readable text.
- Use one accent color, such as blue, for primary actions and focus indicators. Reserve red for errors and destructive actions.
- Use consistent spacing, subtle borders, small rounded corners, and minimal shadows. Avoid decorative effects and unnecessary animation.

## Layout and controls

- Give each page a clear title, a short description when needed, and an obvious primary action.
- Use simple buttons, labeled inputs, selects, and tables. Keep related fields together and secondary actions visually quieter.
- Make layouts responsive. In the taxonomy editor, display segments as ordered columns with options inside each column; allow horizontal scrolling on narrow screens.
- Make adding, editing, and reordering segments and options easy to discover. Provide move buttons so reordering does not depend on dragging.
- Display prices consistently in USD with two decimal places.

## Interaction and accessibility

- Use semantic HTML, visible field labels, keyboard-accessible controls, and clear focus styles. Maintain readable contrast.
- Show validation errors beside the relevant fields and preserve entered values when an operation fails.
- Provide simple loading, empty, error, and success states. Prevent duplicate submissions while saving.
- Clearly indicate unsaved changes and successful saves. Confirm destructive actions that remove populated content.

## Taxonomy MVP workflow

The future taxonomy editor follows the [product specification](taxonomy/specification.md) and [API contract](taxonomy/api-specification.md). This guidance defines behavior; the editor is not implemented by the API planning task.

- Use one explicit Save button for the entire taxonomy. Adding, editing, removing, or reordering content changes local state only; do not autosave.
- Allow incomplete work while editing, but reject Save until the family, segments, options, defaults, and prices are valid. Show field errors and preserve all entered content after failure.
- Save creates a version only when normalized content changes. Show the returned version after success; do not display a draft/published state or Publish action.
- Submit the loaded `expectedVersionId`. Preserve edits on a stale-save response, explain that the taxonomy changed, and require reload/reconciliation rather than silently merging or retrying. Do not automatically retry uncertain creates or saves.
- List only owned active taxonomies with basic pagination. Omit sharing controls, history browsing, and search/archive filters in the MVP.
- Keep segment/option order and default identity intact while reordering. Provide keyboard-accessible move actions alongside any drag behavior.

## Implementation

- Use the existing Nuxt and Vue stack with small, readable components and straightforward state management.
- Keep styling in Tailwind utilities; add custom CSS only when utilities cannot reasonably express the requirement.
- Extract shared components when patterns repeat. Avoid premature abstractions and unnecessary dependencies.
- Prioritize working behavior, accessibility, and maintainable code over visual polish. Product behavior follows the relevant feature specifications.
