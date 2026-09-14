# Speed Shuffling Across the USA

Live Google Sheets-backed leaderboard for the October 2026 tournament.
**Technical lead: Nick. Assisting contributor: John Allen.**

## Open in Cursor and run

Open the `speed-shuffle-usa` repository folder itself, not the parent ChatGPT project.
Node 22.23.2 is pinned in `.nvmrc`.

```sh
npm install
npm run dev
```

Open **http://localhost:4321**. This runs Netlify Functions and proxies Astro with
hot reload. The internal Astro port is 4322; do not use it directly because it does
not serve the function endpoint. Stop the terminal with Ctrl+C. No Netlify account
or site link is needed locally; `--offline` disables Netlify account lookups, not
outbound Google requests.

```sh
npm test
npm run build
```

The production build checks TypeScript then emits a static site to `dist`. The
Google read function is deployed separately by Netlify. `npm run preview` serves
only built static files, not the function; use `npm run dev` to test the full app.

## Choose or replace the master sheet

Copy `.env.example` to `.env` if you do not already have a local `.env`.
The provided test sheet is configured locally; sheet IDs are not hardcoded into
application source. Google settings and credentials stay outside the browser.

For a link-accessible sheet containing **test data only**:

```dotenv
SHEETS_ACCESS=public
SHEETS_SPREADSHEET_ID=PASTE_GOOGLE_SHEETS_LINK_OR_ID
SHEETS_GID=0
```

`SHEETS_GID` is the tab identifier after `gid=` in the URL. Public mode reads that
whole tab as CSV, without Google credentials. It does not make a private sheet
public or change sharing. Publicly readable sheets expose their raw contents to
people with the link, including scores: use synthetic test data only in this mode.

To swap sheets, change these values in `.env`, stop the server, and run `npm run dev`
again. The new sheet must use the same headers. Copy the master sheet as a template
for another test source. Switching deployed sheets means changing the corresponding
Netlify environment variables and applying a new deploy; no code rewrite is needed.

For a **private** sheet:

```dotenv
SHEETS_ACCESS=private
SHEETS_SPREADSHEET_ID=PASTE_GOOGLE_SHEETS_LINK_OR_ID
SHEETS_RANGE="Players!A1:Z"
GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/service-account.json
```

Enable the Google Sheets API in the service account's Google Cloud project and
share the selected sheet with its `client_email` as Viewer. Keep the JSON key outside
this repository. For Netlify, set `GOOGLE_SERVICE_ACCOUNT_EMAIL` and `GOOGLE_PRIVATE_KEY`
as server-side environment variables instead of the local key-file path. Never add
keys to source files, public assets, or variables prefixed `PUBLIC_`. A Google browser
login does not grant the server access. Public mode never silently falls back to private
credentials, and private mode never falls back to public exports.

## Master sheet layout

The `Players` tab has one header row. Column order may change; headers must remain
unique. Required column names:

- `registration_id`: unique stable text ID per player/attempt.
- `first_name`: only the first word is displayed publicly.
- `last_initial`: one letter (an optional trailing period is accepted).
- `club`: `chicago`, `brooklyn`, `st-pete`, `tampa`, or `beachside`.
- `attempt_status`: `registered`, `completed`, or `cancelled`.
- `total_score`: numeric whole-number total; required when completed. Zero and
  negative totals are valid; blanks and formula errors are not.
- `public_display`: TRUE/checked to display a completed player. FALSE/unchecked or
  blank hides that player. Opted-out participants still count toward club participation
  and overall ranks; ranks may therefore have gaps.

Additional layout columns: `registered_at`, `end_1_score`, `end_2_score`,
`end_3_score`, and `end_4_score`. The website never returns individual end scores.

In the prepared test sheet, columns G:J hold the four ends. K2 contains one
ARRAYFORMULA calculating totals for all rows once all four ends are populated.
**Do not type in column K or delete its K2 formula.** Add or replace input values in
A:J and L. A player with `registered` status does not appear in individual standings;
set `completed` after entering all four ends. Mark a cancellation with `cancelled`.
Copy an existing public-display checkbox into new rows, or enter TRUE/FALSE.

The sheet currently contains six explicitly synthetic players, five completed and
one registered. These are Google Sheet records, not bundled frontend mock arrays.

## Runtime behavior and privacy

Google Sheets is the intended operational/admin source of truth. The project
intentionally does not use a standalone database.

```text
Master Google Sheet -> leaderboard-data Netlify Function -> static Astro page
```

The browser reads `/.netlify/functions/leaderboard-data` on load, every 30 seconds
while visible, and when Refresh is clicked. It also refreshes on returning to the tab.
No build is required after editing scores. Data has a last-update timestamp. Errors
show explicitly and clear old standings instead of falling back to fake results.
The endpoint returns a no-store response, public display fields, rank and club counts.
It rejects invalid headers, duplicate IDs, unknown clubs, invalid statuses and missing
completed totals rather than publishing misleading partial results.

Totals are ranked descending with competition ties (1, 2, 2, 4). This is a documented
initial rule; Nick/Lauren must finalize tied payouts before launch. Club standings
show completion counts, not cumulative/average scores.

`src/lib/config.ts` is the single score-reveal configuration, default `showScores: false`.
The function omits exact score fields when false; hiding is enforced server-side,
not merely CSS. Changes to this policy require deployment alongside the frontend.
Names/data are inserted with textContent, never interpreted as HTML.

## Deployment and remaining work

`netlify.toml` uses `npm run build`, `dist`, Node 22.23.2,
`netlify/functions`, and esbuild. Astro remains static; no SSR adapter is required.
Nick can deploy his fork on his paid Netlify account when ready. Set the chosen
Google environment variables in that site's function environment. Nothing has been
pushed, linked, or deployed by this implementation.

Tito is not implemented. Lauren can create her own test sheets using the same
layout; the application is not dependent on her sheet setup. Club-sheet-to-master
aggregation, production Google permissions, final tie/payout rules, and the later
Tito webhook remain separate work. Proctors still record on paper and enter four
end scores in their own Google Sheet afterward.

## Verification

`npm test` covers ties, registration/completion/cancellation counts, opt-outs,
score reveal, zero/negative totals, duplicate IDs, malformed rows, safe errors, and
sheet-link validation. The Google connection was also tested against the configured
shared test sheet. Browser verification changed a test end score, observed rankings
update, and restored the original value. Production build includes TypeScript checks.

## Existing repository patterns inspected

Inspected September 12, 2026:

- [Main ILSA site](https://github.com/IllinoisShuffle/illinoisshuffleboard.org/tree/2cb117ff29340b4440d7383bfce6b9437c601fd4):
  `netlify.toml` runs `hugo`, publishes `public/`, pins Hugo, and declares short-link
  redirects. `.github/workflows/netlify.yml` invokes a scheduled Netlify build hook.
  Reused declarative repository build settings and the visual language. Hugo,
  unrelated redirects, and scheduled rebuilds are unnecessary here.
- [Nationals bracket](https://github.com/IllinoisShuffle/2026-national-tournament-bracket/tree/0e21d073361633cabe440542e79e2b7303b043c8):
  `netlify.toml` publishes the repository root and declares `netlify/functions` with
  `esbuild`. `results.js` and `_shared/sheetsClient.js` read Sheets server-side;
  `live-data.js` polls the results endpoint. Its current code also includes React
  JSX pages, authentication, and live-score/Blobs features. Reused only the relevant
  functions layout and future Sheets read boundary; these extra features are out of scope.
- [Starting Speed Shuffle commit](https://github.com/IllinoisShuffle/speed-shuffle-usa/tree/5daabbe):
  only a two-line README; no existing application or Netlify configuration to preserve.

Astro is appropriate because the repos share a static-deployment pattern, not a
required frontend framework. Publishing `dist` instead of `.` also keeps source
files outside the published site. No build-hook workflow is needed for mock data,
and future result refreshes should not consume a site rebuild for every update.

