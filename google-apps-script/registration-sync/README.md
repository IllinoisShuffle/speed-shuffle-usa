# Registration sync (Google Apps Script)

This is a mirror of the container-bound Apps Script project attached to the
**`ADMIN - Speed Shuffle Score Tracker`** Google Sheet (the master sheet, in the
`Score Tracking` Drive folder). It lives in Google Drive/Apps Script, not in Netlify
— it is not deployed by this repo's build or CI. `Code.gs` here is kept as the
source of truth for review and history; **edits must still be made in the Apps
Script editor** (Sheet → Extensions → Apps Script) and copied back here, since
Apps Script has no native git integration in this setup.

This supersedes the "Tito is not implemented" / "`tito-webhook` is still future
work" notes elsewhere in this repo's docs — the Tito webhook exists, just outside
this codebase. If those files are edited independently, please keep them
consistent with this one.

## What it does

Three responsibilities live in one script:

1. **Sheet prep/repair** (`prepareAllSheets`, `applyProtections_`) — lays down
   data validation, the `total_score` formula, and range protections across the
   MASTER sheet and all five club sheets, so club admins can only edit `E:I`
   and the identity/total/registration columns stay locked.
2. **Club → Master sync** (`syncFromClubsNow`, installed on a 1-minute
   time trigger via `installOneMinuteSyncTrigger`) — matches club sheet rows to
   MASTER rows by `registration_id` (column L), copies `attempt_status` and the
   four end scores, and auto-checks `public_display` the first time a row
   transitions to `completed`. It never copies `public_display` from a club
   sheet, so a manual uncheck by Lauren on MASTER sticks.
3. **Tito registration ingest** (`doPost`, `mapTitoPayloadToRegistration_`,
   `addRegistration`) — the actual Tito integration. A Tito webhook posts ticket
   events to this script's deployed Web App URL; the handler verifies a shared
   token, maps the Tito ticket JSON to this project's registration shape, and
   upserts one row into both the MASTER sheet and the matching club sheet,
   keyed on `registration_id`.

`addRegistration` and `syncFromClubsNow` each hold `LockService.getScriptLock()`
for the duration of their read-modify-write work (find-or-create row, then
write), so a Tito webhook landing mid-sync (or two webhooks landing together)
can't interleave and corrupt a row. The lock is script-wide, not per-sheet, so
the two paths also serialize against each other — acceptable given tournament
registration volume, but see "Outstanding risks" below for what this doesn't
cover.

## The Tito webhook contract

- **Endpoint**: the Web App URL from this script's current deployment
  (Apps Script editor → Deploy → Manage deployments). Not recorded here since it
  can be redeployed; check the Apps Script project or ask Nick/John for the
  current URL.
- **Auth**: a shared secret passed as a `token` query-string parameter on the
  POST URL (`assertIngestToken_`). The expected value is stored in the script's
  **Script Properties** as `REGISTRATION_INGEST_TOKEN` — it is not in this file
  and must never be committed. Set it via Apps Script editor → Project Settings
  → Script Properties, or `PropertiesService.getScriptProperties().setProperty(...)`
  from the editor.
- **Payload**: a Tito ticket webhook body (`_type: "ticket"`, or a `data.object`/
  `ticket` wrapper). `mapTitoPayloadToRegistration_` reads `slug` as
  `registration_id`, `first_name`/`last_name` (falling back to splitting `name`),
  and derives the club from `release_slug`/`release_title` via
  `resolveClubFromRelease_` — the release slug or title must contain one of the
  club ids (`beachside`, `chicago`, `brooklyn`, `st-pete`, `tampa`) or a
  recognized alias (`new york`, `st pete`, `beach`, etc.). A ticket whose state
  or webhook event name indicates void/cancellation maps to `attempt_status:
  'cancelled'`; otherwise new tickets come in as `'registered'`.
- **Unrecognized payloads** (no ticket-shaped body) return `{ ok: true, skipped:
  true }` rather than erroring, so unrelated Tito events don't break the
  integration.
- **Idempotency**: `upsertRegistrationRow_` looks up the existing row by
  `registration_id` before writing, so replays/retries of the same ticket event
  update the same row instead of duplicating it. Re-running the same test twice
  is the expected way to confirm this.
- **Failure visibility**: Apps Script Web Apps always answer HTTP 200 to
  `doPost`, no matter what the handler returns — there is no way to make
  Tito's own webhook delivery retry on failure. Instead, any error while
  processing an *authenticated* request (bad club mapping, sheet full, etc.)
  is appended to an `Ingest Errors` sheet tab in the ADMIN workbook
  (timestamp, error, raw payload) via `logIngestError_`, and optionally
  emailed via `notifyIngestFailure_` if `INGEST_ALERT_EMAIL` is set. A failed
  registration must be noticed and replayed by hand (e.g. re-running
  `addRegistration` with the logged payload, or asking Tito to resend the
  event) — nothing retries it automatically. Unauthorized requests (bad/missing
  token) are neither logged nor emailed, to avoid filling the error sheet with
  scanner noise from the public webhook URL.

## Required Script Properties

| Property | Purpose |
| --- | --- |
| `REGISTRATION_INGEST_TOKEN` | Shared secret the Tito webhook must send as `?token=` on the POST URL. Rotate by changing this and updating Tito's configured webhook URL together. |
| `INGEST_ALERT_EMAIL` | Optional. If set, a failed *authenticated* ingest sends an email here in addition to the `Ingest Errors` sheet row. Leave unset to rely on the sheet alone. |

## End-to-end test

You need edit access to the ADMIN sheet's Apps Script project (Extensions →
Apps Script from the sheet) to run these. All of them are safe against
production data as long as you use a `test-` prefixed `registration_id`/`slug`
and clean up the row afterward.

1. **Mapper + ingest, no network** — run `TEST_titoBrooklynTicket` from the
   Apps Script editor (select the function, click Run). It builds an in-memory
   Tito ticket payload, runs it through `mapTitoPayloadToRegistration_`, and
   calls `addRegistration`. Confirm the alert shows a `master_row` and
   `club_row`, then check both the MASTER sheet and the Brooklyn club sheet for
   a `test-tito-brooklyn-001` row with `first_name: Tito`, `attempt_status:
   registered`, `public_display` unchecked.
2. **Idempotency** — run `TEST_titoBrooklynTicket` again unchanged. It must
   update the same two rows, not add new ones (same row numbers in the alert).
3. **Real webhook, over HTTP** — from Tito's event/webhook settings for this
   tournament, use "Send test webhook" (or send a real test-mode ticket event)
   pointed at the deployed Web App URL with the correct `?token=`. Then check
   the same two sheets for a row matching that ticket's `slug`. This is the
   step that actually proves Tito's real payload shape still matches what
   `mapTitoPayloadToRegistration_` expects — Tito's webhook payloads can differ
   from hand-built test JSON in field names/nesting, so don't skip it.
4. **Unknown club / cancellation paths** — repeat with a release slug that
   doesn't match any club (expect a thrown "Could not map Tito release to
   club" error surfaced as `{ ok: false, error: ... }` in the HTTP response) and
   with a voided/cancelled ticket state (expect `attempt_status: 'cancelled'`
   with no `public_display` change).
5. **Failure path** — confirm the unknown-club case from step 4 also appended
   a row to the `Ingest Errors` sheet tab in the ADMIN workbook (create it
   first if this is the first failure ever recorded), and, if
   `INGEST_ALERT_EMAIL` is set, that the email arrived. This is what you're
   actually relying on in place of Tito-level retries — worth confirming it
   works before the tournament, not after a registration goes missing.
6. **Cleanup** — delete the test row(s) from MASTER and the affected club
   sheet (or clear `L` on those rows) so test data doesn't linger in the
   scoring system. `FIX_uncheckAllClubPublicDisplay` and
   `normalizeMasterPublicDisplay` are one-time fixups, not part of routine
   cleanup — don't run them just to remove test rows.
7. **Regression check** — run `verifySystem` afterward to confirm headers on
   MASTER and all five club sheets are still intact and exactly one
   `syncFromClubsNow` trigger is installed (test runs don't touch triggers, but
   it's a cheap sanity check after poking at the sheets by hand).

`syncFromClubsNow` is a separate concern from the Tito ingest path (it syncs
existing rows' scores between club and MASTER sheets; it does not create
rows) — testing it means editing `E:I` on a club sheet and confirming MASTER
picks it up within a minute (or run `syncFromClubsNow` manually from the
editor to skip the wait).

## Outstanding risks

Locking and error-logging (this revision) close the worst correctness and
silent-failure gaps, but the underlying architecture still has real limits
worth knowing about rather than discovering during the tournament:

- **No true webhook retry.** As above: Apps Script Web Apps can't return a
  non-200 status, so Tito can never know an ingest failed and cannot retry it
  for us. The `Ingest Errors` sheet and `INGEST_ALERT_EMAIL` turn "silently
  lost" into "visible, but still requires a human to replay it by hand."
- **Lock timeouts fail closed, not gracefully.** `waitLock(30000)` throws if
  the lock isn't free within 30 seconds. Under sustained high concurrency
  (unlikely at this event's scale, but not impossible during a registration
  rush) a request could fail outright rather than queue — that failure is now
  at least logged/emailed, but it's still a dropped registration needing a
  manual retry.
- **Hard 999-row ceiling per sheet** (`LAST_DATA_ROW = 1000`). A tournament
  that grows past that in any one club sheet or MASTER will start failing
  registrations (now logged/emailed instead of silently lost, but the limit
  itself isn't removed). Worth revisiting if any club's roster approaches it.
- **Single-account bus factor.** Time-driven triggers execute as whichever
  Google account installed them, and the Web App deployment's execution
  identity is similarly tied to one account. If that account loses access, is
  suspended, or Apps Script's daily quotas are hit, the entire write path
  (both Tito ingest and club→master sync) stops with no external monitoring
  — only the in-sheet error log and (if configured) email alert, which
  themselves depend on the same account being able to run code at all.
- **Docs/code drift.** `Code.gs` in this repo is a manually maintained mirror
  of what's actually deployed in the Apps Script editor. Nothing enforces
  that future edits made live in the editor get copied back here — treat this
  file as documentation of the last-known state, and diff it against the live
  project before trusting it fully.
- **No automated tests.** The `TEST_*` functions are manual, run-by-hand
  checks in the Apps Script editor; there's no CI coverage for this script,
  unlike the rest of the repo's `npm test` suite.
