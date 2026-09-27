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

## Required Script Properties

| Property | Purpose |
| --- | --- |
| `REGISTRATION_INGEST_TOKEN` | Shared secret the Tito webhook must send as `?token=` on the POST URL. Rotate by changing this and updating Tito's configured webhook URL together. |

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
5. **Cleanup** — delete the test row(s) from MASTER and the affected club
   sheet (or clear `L` on those rows) so test data doesn't linger in the
   scoring system. `FIX_uncheckAllClubPublicDisplay` and
   `normalizeMasterPublicDisplay` are one-time fixups, not part of routine
   cleanup — don't run them just to remove test rows.
6. **Regression check** — run `verifySystem` afterward to confirm headers on
   MASTER and all five club sheets are still intact and exactly one
   `syncFromClubsNow` trigger is installed (test runs don't touch triggers, but
   it's a cheap sanity check after poking at the sheets by hand).

`syncFromClubsNow` is a separate concern from the Tito ingest path (it syncs
existing rows' scores between club and MASTER sheets; it does not create
rows) — testing it means editing `E:I` on a club sheet and confirming MASTER
picks it up within a minute (or run `syncFromClubsNow` manually from the
editor to skip the wait).
