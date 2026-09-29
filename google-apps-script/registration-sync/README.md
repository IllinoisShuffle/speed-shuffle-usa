# Registration sync (Google Apps Script)

This is a mirror of the container-bound Apps Script project attached to the
**`ADMIN - Speed Shuffle Score Tracker`** Google Sheet (the master sheet, in the
`Score Tracking` Drive folder). It lives in Google Drive/Apps Script, not in Netlify
— it is not deployed by this repo's build or CI. The `.gs` files here are kept as
the source of truth for review and history; **edits must still be made in the
Apps Script editor** (Sheet → Extensions → Apps Script) and copied back here,
since Apps Script has no native git integration in this setup (see "Should we
use clasp?" below for a way to close that gap).

The project is split into several files, purely for readability — Apps Script
merges every file in a project into one shared global scope at runtime, so
this has no effect on behavior, locking, or Script Properties:

| File | Responsibility |
| --- | --- |
| `Config.gs` | Every top-level constant: sheet/menu names, the canonical header list, the five club workbook IDs. |
| `Columns.gs` | Header-name column resolution (`resolveColumns_`) — shared by every other file. |
| `Repair.gs` | Sheet formatting/protection setup — the "Repair All Sheets" menu item. |
| `Sync.gs` | Club → Master sync and its 1-minute time trigger. |
| `Ingest.gs` | The Tito webhook (`doPost`) and registration upsert. |
| `ErrorLog.gs` | The `System Errors` sheet and optional email alert, shared by `Sync.gs` and `Ingest.gs`. |
| `Admin.gs` | The custom menu, `onEdit`, the one-time `public_display` migration, and the manual `TEST_*`/`verifySystem` helpers. |

When mirroring a change from the live editor back into this repo (or vice
versa), copy **all** files that changed — a partial copy across this many
files is the main new risk this split introduces; see "Should we use clasp?"
for how to avoid that risk entirely.

This supersedes the "Tito is not implemented" / "`tito-webhook` is still future
work" notes elsewhere in this repo's docs — the Tito webhook exists, just outside
this codebase. If those files are edited independently, please keep them
consistent with this one.

## What it does

Three responsibilities live in this one Apps Script project (across the
files listed above):

1. **Sheet prep/repair** (`prepareAllSheets`, `applyProtections_`) — lays down
   data validation, the `total_score` formula, and range protections across the
   MASTER sheet and all five club sheets, so club admins can only edit `E:I`
   and the identity/total/registration columns stay locked.
2. **Club → Master sync** (`syncFromClubsNow`, installed on a 1-minute
   time trigger via `installOneMinuteSyncTrigger`) — matches club sheet rows to
   MASTER rows by `registration_id`, copies `attempt_status` and the four end
   scores, and auto-checks `public_display` the first time a row transitions to
   `completed`. It never copies `public_display` from a club sheet, so a manual
   uncheck by Lauren on MASTER sticks.
3. **Tito registration ingest** (`doPost`, `mapTitoPayloadToRegistration_`,
   `addRegistration`) — the actual Tito integration. A Tito webhook posts ticket
   events to this script's deployed Web App URL; the handler verifies a shared
   token, maps the Tito ticket JSON to this project's registration shape, and
   upserts one row into both the MASTER sheet and the matching club sheet,
   keyed on `registration_id`.

## Column resolution

Every read/write in the sync and ingest paths looks up each of the 12 required
column headers (`first_name`, `last_initial`, `club`, `registered_at`,
`attempt_status`, `end_1_score`…`end_4_score`, `total_score`, `public_display`,
`registration_id`) **by name**, via `resolveColumns_(sheet)`, instead of
assuming fixed letters. This was the fix for a real fragility: previously every
function referenced hardcoded column numbers, so a club admin inserting,
deleting, or reordering a column on their own sheet would silently misalign
every downstream read/write with no error — wrong data landing in the wrong
field, both on that club's sheet and (once synced) on MASTER.

As a result:

- **Reordering columns, or adding extra ones anywhere, is safe.** A club can
  add a "team name" column, or have their 12 required headers in a different
  order than MASTER, and ingest/sync still find the right column each time.
- **Renaming, deleting, or duplicating a required header is not silently
  tolerated — it fails loudly instead.** `resolveColumns_` throws a specific
  "missing header X" / "duplicate header X" error naming the sheet, which
  flows into the same failure path described below (logged to `System Errors`,
  optionally emailed) rather than writing to the wrong column.
- **`prepareAllSheets` (the repair tool) is stricter on purpose**: it requires
  the canonical A:L order exactly (`assertCanonicalColumnOrder_`) and refuses
  to touch a sheet that's missing a header or already out of canonical order,
  rather than guessing how to reformat it. It also bootstraps the canonical
  header row on a sheet whose row 1 is completely blank (new sheet setup), but
  never overwrites an existing row 1.

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
  processing an *authenticated* request (bad club mapping, broken headers,
  sheet full, etc.) is appended to a `System Errors` sheet tab in the ADMIN
  workbook (timestamp, source, error, raw payload) via `logSystemError_`, and
  optionally emailed via `notifySystemFailure_` if `INGEST_ALERT_EMAIL` is
  set. The same sheet and helpers are also used by `syncFromClubsNow` (see
  below), distinguished by the `source` column (`tito_ingest` vs
  `club_sync`/`club_sync:<club id>`). A failed registration must be noticed
  and replayed by hand (e.g. re-running `addRegistration` with the logged
  payload, or asking Tito to resend the event) — nothing retries it
  automatically. Unauthorized requests (bad/missing token) are neither logged
  nor emailed, to avoid filling the error sheet with scanner noise from the
  public webhook URL.
- **A broken club doesn't take down the others.** If one club sheet's headers
  are broken, `syncFromClubsNow` logs it (`club_sync:<club id>`) and skips
  just that club, continuing the sync for the remaining four. If MASTER's own
  headers are broken, the whole sync aborts and logs once (`club_sync`) —
  there's nothing useful it can do without a working MASTER sheet.

## Required Script Properties

| Property | Purpose |
| --- | --- |
| `REGISTRATION_INGEST_TOKEN` | Shared secret the Tito webhook must send as `?token=` on the POST URL. Rotate by changing this and updating Tito's configured webhook URL together. |
| `INGEST_ALERT_EMAIL` | Optional. If set, a failed *authenticated* ingest or club sync sends an email here in addition to the `System Errors` sheet row. Leave unset to rely on the sheet alone. |

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
   a row to the `System Errors` sheet tab in the ADMIN workbook (create it
   first if this is the first failure ever recorded; `source` should read
   `tito_ingest`), and, if `INGEST_ALERT_EMAIL` is set, that the email
   arrived. This is what you're actually relying on in place of Tito-level
   retries — worth confirming it works before the tournament, not after a
   registration goes missing.
6. **Column drift** — on a *test copy* of a club sheet (never a live one),
   reorder a couple of columns (e.g. swap `total_score` and `public_display`)
   and confirm `TEST_titoBrooklynTicket`-style ingest still lands in the right
   fields (check by header, not by letter). Then rename or delete one required
   header (e.g. `attempt_status` → `status`) and confirm the next ingest/sync
   attempt fails with a clear "missing required header" error in `System
   Errors`, rather than writing anything. Restore the header name afterward —
   this step is about confirming the *failure mode*, not leaving the test copy
   broken.
7. **Cleanup** — delete the test row(s) from MASTER and the affected club
   sheet (or clear their `registration_id` cell) so test data doesn't linger
   in the scoring system. `FIX_uncheckAllClubPublicDisplay` and
   `normalizeMasterPublicDisplay` are one-time fixups, not part of routine
   cleanup — don't run them just to remove test rows.
8. **Regression check** — run `verifySystem` afterward to confirm headers on
   MASTER and all five club sheets are still intact and exactly one
   `syncFromClubsNow` trigger is installed (test runs don't touch triggers, but
   it's a cheap sanity check after poking at the sheets by hand).

`syncFromClubsNow` is a separate concern from the Tito ingest path (it syncs
existing rows' scores between club and MASTER sheets; it does not create
rows) — testing it means editing `E:I` on a club sheet and confirming MASTER
picks it up within a minute (or run `syncFromClubsNow` manually from the
editor to skip the wait).

## Outstanding risks

Locking, error-logging, and header-name column resolution (this revision)
close the worst correctness and silent-failure gaps, but the underlying
architecture still has real limits worth knowing about rather than
discovering during the tournament:

- **No true webhook retry.** As above: Apps Script Web Apps can't return a
  non-200 status, so Tito can never know an ingest failed and cannot retry it
  for us. The `System Errors` sheet and `INGEST_ALERT_EMAIL` turn "silently
  lost" into "visible, but still requires a human to replay it by hand."
- **Column reordering/renaming is handled; a genuinely malformed sheet still
  needs a human.** `resolveColumns_` makes ingest/sync tolerant of columns
  being reordered or extra columns being added, and turns a missing/duplicate
  required header into a loud, logged failure instead of silent data
  corruption. It does not — and can't — guess what a renamed or deleted header
  was supposed to be; that still requires someone to notice the `System
  Errors` entry and fix the sheet by hand.
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
- **Docs/code drift.** The `.gs` files in this repo are a manually maintained
  mirror of what's actually deployed in the Apps Script editor. Nothing
  enforces that future edits made live in the editor get copied back here —
  treat these files as documentation of the last-known state, and diff them
  against the live project before trusting them fully. Splitting into
  multiple files (this revision) makes this a little easier to get partially
  wrong, since a change can touch several files at once — see "Should we use
  clasp?" below for the actual fix.
- **No automated tests.** The `TEST_*` functions are manual, run-by-hand
  checks in the Apps Script editor; there's no CI coverage for this script,
  unlike the rest of the repo's `npm test` suite.

## Should we use clasp?

[`clasp`](https://github.com/google/clasp) ("Command Line Apps Script
Projects") is Google's official CLI for Apps Script. Instead of copy-pasting
between this repo and the browser editor, it lets you:

- `clasp clone <scriptId>` — pull the live project's actual files down locally.
- `clasp push` — push local files up, overwriting the project's current
  (HEAD) source.
- `clasp pull` — pull the live project down again, to capture anything
  someone edited directly in the browser.
- `clasp deploy` — create a new Web App/API executable **version** (this is
  the step that would move the Tito webhook off "Version 1" onto whatever's
  newer — a deliberate action, never automatic).
- `clasp open` — opens the project in the browser editor.

**We should use it.** It directly closes the docs/code drift risk above,
which this multi-file split made slightly worse: with clasp, git *is* the
source of truth (`clasp push`/`clasp pull` against the real project ID)
instead of a manually maintained mirror, and a sync is one command instead of
copy-pasting N files and hoping none were missed.

A few things worth knowing before adopting it:

- **The first step is a real, one-time reconciliation, not automation.**
  `clasp clone` against the actual live script ID will pull down whatever's
  *really* deployed right now — which may not match this repo's mirror,
  especially since none of this session's fixes have been copied into the
  live editor yet. That diff needs a careful manual look once, before anyone
  ever runs `clasp push` for real.
- **Script Properties (`REGISTRATION_INGEST_TOKEN`, `INGEST_ALERT_EMAIL`) are
  not part of the pushed/pulled files** — they're a separate per-project
  key/value store, so clasp syncing source code can't accidentally leak or
  overwrite them.
- **`clasp push` updates HEAD, not the pinned Web App version.** That's
  actually a good fit for what's already set up: HEAD is what every
  time-driven and simple trigger always runs anyway (see the earlier
  discussion of the Executions log), so auto-pushing keeps `Sync.gs`/`Repair.gs`/`Admin.gs`
  current automatically without touching the live Tito webhook, which stays
  pinned to Version 1 until someone deliberately runs `clasp deploy`.

**Can this run in GitHub Actions?** Yes — this is a common, well-documented
pattern:

1. One person runs `clasp login` once, from a real browser, with a Google
   account that has edit access to this Apps Script project. This produces a
   local credentials file (`~/.clasprc.json`) — **this step needs a human;
   it's an interactive OAuth consent flow, not something that can be scripted
   or done on someone's behalf.**
2. That file's contents get stored as a GitHub Actions secret (e.g.
   `CLASP_CREDENTIALS`).
3. A workflow (triggered on push to this branch/path, or manually) recreates
   `~/.clasprc.json` from the secret and runs `clasp push` from
   `google-apps-script/registration-sync/`.
4. Optionally, a separate manually-triggered (`workflow_dispatch`) job runs
   `clasp deploy` to cut a new Web App version — kept manual on purpose, so
   the Tito webhook only changes when someone deliberately decides it should.

I can write that workflow file once the initial `clasp clone`/reconciliation
and the one-time `clasp login` have happened — those two steps need to come
first and need a human with access to the live Google account.
