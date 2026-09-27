# Netlify Functions

`leaderboard-data.ts` is a real GET endpoint that reads the configured master Google
Sheet. It validates and sanitizes rows, ranks completed attempts, and returns public
standings and club participation counts. It never returns private fields, raw Google
errors, or exact scores before the central reveal flag permits them. Failed reads
return 503, never mock data. Non-GET requests return 405.

The Google reader and row parser live in `netlify/lib/` so helper modules are not
mistaken for deployable functions. Public mode is for a link-accessible synthetic
test sheet; private mode uses a Google service account with read-only Sheets scope.
Configuration and sheet layout are documented in the root README and `.env.example`.

There is no `tito-webhook` Netlify function, and none is planned here: Tito
registration ingest is handled outside this repo by a Google Apps Script Web
App bound to the ADMIN master sheet, which verifies Tito events and
idempotently upserts rows by `registration_id`, preserving manually entered
scores. See `google-apps-script/registration-sync/` at the repo root for a
mirrored copy of that script and how to test it end-to-end.
