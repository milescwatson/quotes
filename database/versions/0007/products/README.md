# Regular-product principals (0007)

Apply after 0006 with the development API paused. Execute each statement separately and await the asynchronous foreign-key validation. Existing products remain unassigned; original product fields/tokens and quote snapshots are preserved. The existing table-level runtime SELECT/INSERT/UPDATE grants cover the new column.

Regular products can independently select a shared principal or clear it. Omitted principalId preserves an existing assignment on update and defaults to null on create, keeping older API clients compatible. Newly added quote lines snapshot the principal ID/name; existing lines retain their original snapshot after a catalog principal change.

Use `node server/scripts/deploy-product-principals-database.mjs` to apply the checkpointed development migration, leaving the API paused through the coordinated API/frontend release.
