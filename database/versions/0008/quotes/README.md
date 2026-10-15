# Owner quote archiving (0008)

This additive migration adds `archived_at` and grants the runtime API role permission to update that field. The API checks active organization access and requires the authenticated user to match `owner_user_id`; unassigned quotes cannot be archived or restored. Existing quotes remain active and retain their data.

Run `node server/scripts/deploy-quote-archive-database.mjs` from the workspace to apply this checkpointed development migration. It verifies the fixed AWS account/cluster, pauses and drains API traffic, journals each SQL statement, checks the runtime grant, confirms existing quote fields are unchanged, and leaves API concurrency paused for the coordinated release. After release verification, restore the prior concurrency setting. Verify the runtime role can archive and restore a quote through the API as its owner and cannot change another user's or an unassigned quote. Keep application authorization in place.
