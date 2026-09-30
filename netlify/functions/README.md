# Netlify Functions

`leaderboard-data.ts` is a real GET endpoint that reads the configured master Google
Sheet. It validates and sanitizes rows, ranks completed attempts, and returns public
standings and club participation counts. It never returns private fields, raw Google
errors, or exact scores before the central reveal flag permits them. Failed reads
return 503, never mock data. Non-GET requests return 405.

`sessions-data.ts` is a real GET endpoint that reads a separate `Sessions` tab in
the same spreadsheet, where each club maintains its own upcoming session dates. It
validates club IDs, dates, and times, and returns them sorted chronologically.
Failed reads return 503, never mock or stale data. Non-GET requests return 405.

The Google reader and row parsers live in `netlify/lib/` so helper modules are not
mistaken for deployable functions. Public mode is for a link-accessible synthetic
test sheet; private mode uses a Google service account with read-only Sheets scope.
Configuration and sheet layout are documented in the root README and `.env.example`.

`tito-webhook.ts` is a POST-only proxy in front of the Apps Script Tito-ingest
Web App (see `google-apps-script/registration-sync/` at the repo root for that
script — it still owns auth, mapping, and the sheet writes). It exists only
because Apps Script Web Apps always answer with a 302 to a second, GET-only
content URL before the real response is delivered, and Tito's webhook sender
doesn't complete that hop — it sees the bare 302 as a delivery failure and
retries the same event for hours, risking Tito disabling the webhook, even
though the registration already landed (Apps Script runs `doPost` to
completion before issuing the redirect). This function forwards Tito's POST
(body, and query string including the shared `token`) to
`APPS_SCRIPT_INGEST_URL`, lets `fetch` complete the redirect the way a
browser would, and returns the real upstream status/body to Tito. Non-POST
requests return 405; a missing target URL returns 500; a failure reaching the
Apps Script URL returns 502 without leaking the URL (it carries the shared
ingest token).
