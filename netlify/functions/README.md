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

`tito-webhook` is still future work. It will verify Tito events and idempotently
update club sheets by a stable ticket/attendee ID, preserving manually entered
scores. No webhook handler or write credential exists in this implementation.
