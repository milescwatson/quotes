# Quote location and author (0010)

Run `node server/scripts/deploy-quote-details-database.mjs` for development.
It applies schema.sql then permissions.sql after 0009, one statement per transaction,
substituting the runtime role for `:"api_role"`, before releasing the matching API. Wait for asynchronous foreign-key validation.
Existing locations read as blank. Existing authors remain unknown because the
last editor and owner cannot establish the original author. New quotes record
the authenticated creator; subsequent saves and owner changes preserve it.
The runtime role can update location but cannot update created_by_user_id.
Applied and verified in development on October 15, 2026. The migration journal
is `database/deployments/development-0010.json`. Existing quote fields and tokens
were preserved. Staging and production remain unchanged.
