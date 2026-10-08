import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRegistrationSync } from './apps-script-harness.ts';

const ALL_CLUBS = ['brooklyn', 'chicago', 'st-pete', 'tampa', 'beachside'];

test('resolveColumns_ finds every header by name regardless of order, ignores extra columns', () => {
  const { fns, seedMaster } = loadRegistrationSync();
  const sheet = seedMaster(['registration_id', 'team_name', 'hide_publicly', 'total_score', 'end_4_score', 'end_3_score', 'end_2_score', 'end_1_score', 'attempt_status', 'registered_at', 'club', 'last_name', 'first_name', 'email']);
  const cols = fns.resolveColumns_(sheet);
  assert.deepEqual({ REG_ID: cols.REG_ID, HIDE: cols.HIDE, E4: cols.E4, E1: cols.E1, FIRST: cols.FIRST, EMAIL: cols.EMAIL },
    { REG_ID: 1, HIDE: 3, E4: 5, E1: 8, FIRST: 13, EMAIL: 14 });
});

test('resolveColumns_ fails loudly on a missing or duplicated required header', () => {
  const { fns, seedMaster } = loadRegistrationSync();
  const missing = seedMaster(fns.HEADER_ORDER.filter((h) => h !== 'attempt_status'));
  assert.throws(() => fns.resolveColumns_(missing), /missing required header.*attempt_status/i);

  const dup = seedMaster([...fns.HEADER_ORDER, 'club']);
  assert.throws(() => fns.resolveColumns_(dup), /duplicate header.*club/i);
});

test('assertCanonicalColumnOrder_ accepts the canonical order and rejects a reordered-but-complete sheet', () => {
  const { fns, seedMaster } = loadRegistrationSync();
  assert.doesNotThrow(() => fns.assertCanonicalColumnOrder_(seedMaster()));
  const swapped = [...fns.HEADER_ORDER];
  [swapped[8], swapped[9]] = [swapped[9], swapped[8]];
  assert.throws(() => fns.assertCanonicalColumnOrder_(seedMaster(swapped)), /not in the canonical .+ order/);
});

test('mapTitoPayloadToRegistration_ maps a ticket, resolves club aliases, captures email, and flags voided tickets cancelled', () => {
  const { fns } = loadRegistrationSync();
  const ticket = fns.mapTitoPayloadToRegistration_({ _type: 'ticket', slug: 'tk-1', first_name: 'Nick', last_name: 'Haynes', email: 'nick@example.com', release_slug: 'chicago', updated_at: '2026-09-01T00:00:00Z' }, '');
  assert.deepEqual({ registration_id: ticket.registration_id, club: ticket.club, last_name: ticket.last_name, email: ticket.email, attempt_status: ticket.attempt_status },
    { registration_id: 'tk-1', club: 'chicago', last_name: 'Haynes', email: 'nick@example.com', attempt_status: 'registered' });

  // splitName_ joins every word after the first as the full last name,
  // not just its initial -- covers a multi-word last name too.
  const aliased = fns.mapTitoPayloadToRegistration_({ _type: 'ticket', slug: 'tk-2', name: 'Sunny Rae Jones', release_title: 'St Pete Club' }, '');
  assert.equal(aliased.club, 'st-pete');
  assert.deepEqual({ first_name: aliased.first_name, last_name: aliased.last_name, email: aliased.email }, { first_name: 'Sunny', last_name: 'Rae Jones', email: '' });

  const voided = fns.mapTitoPayloadToRegistration_({ _type: 'ticket', slug: 'tk-3', release_slug: 'tampa', state_name: 'voided' }, '');
  assert.equal(voided.attempt_status, 'cancelled');

  assert.throws(() => fns.mapTitoPayloadToRegistration_({ _type: 'ticket', slug: 'tk-4', release_slug: 'nowhere-club' }, ''), /Could not map Tito release to club/);
  assert.throws(() => fns.mapTitoPayloadToRegistration_({ _type: 'ticket', release_slug: 'chicago' }, ''), /missing slug/);
});

test('addRegistration writes each field (including email) to its resolved column on both sheets and is idempotent', () => {
  const { fns, seedMaster, seedClub, clubSheet } = loadRegistrationSync();
  // 'email' appended after the original 12 so the E1..E4 letters used below
  // (D, F, H, J) are unaffected by its addition to the schema.
  seedMaster(['first_name', 'registration_id', 'last_name', 'end_1_score', 'club', 'end_2_score', 'registered_at', 'end_3_score', 'attempt_status', 'end_4_score', 'total_score', 'hide_publicly', 'email']);
  seedClub('brooklyn', ['registration_id', 'club', 'first_name', 'last_name', 'registered_at', 'attempt_status', 'end_1_score', 'end_2_score', 'end_3_score', 'end_4_score', 'total_score', 'hide_publicly', 'email']);

  const registration = { registration_id: 't1', first_name: 'Jack', last_name: 'Brooks', email: 'jack@example.com', club: 'brooklyn', registered_at: '2026-09-01', attempt_status: 'registered' };
  const first = fns.addRegistration(registration);
  const second = fns.addRegistration(registration);
  assert.deepEqual(first, second);

  const master = fns.ensureMasterSheet_();
  assert.equal(master.getRange(first.master_row, 1).getValue(), 'Jack');
  assert.equal(master.getRange(first.master_row, 2).getValue(), 't1');
  assert.equal(master.getRange(first.master_row, 13).getValue(), 'jack@example.com');
  // end_1..end_4 landed at columns 4, 6, 8, 10 (D, F, H, J) on this deliberately
  // non-contiguous master layout -- the formula must reference exactly those cells.
  assert.equal(master.getRange(first.master_row, 11).getValue(), '=IF(COUNTA(D2,F2,H2,J2)=0,"",SUM(D2,F2,H2,J2))');

  const club = clubSheet('brooklyn');
  assert.equal(club.getRange(first.club_row, 3).getValue(), 'Jack');
  assert.equal(club.getRange(first.club_row, 13).getValue(), 'jack@example.com');
});

test('addRegistration preserves an existing Master hide_publicly but defaults new rows to unchecked (visible)', () => {
  const { fns, seedMaster, seedClub } = loadRegistrationSync();
  const master = seedMaster();
  seedClub('brooklyn');
  const cols = fns.resolveColumns_(master);

  const reg = { registration_id: 't2', first_name: 'Ann', last_name: 'Quinn', club: 'brooklyn', registered_at: '2026-09-01', attempt_status: 'completed' };
  const { master_row } = fns.addRegistration(reg);
  assert.equal(master.getRange(master_row, cols.HIDE).getValue(), false);

  master.getRange(master_row, cols.HIDE).setValue(true); // Lauren manually hides it
  fns.addRegistration(reg); // a replayed/duplicate webhook event for the same ticket
  assert.equal(master.getRange(master_row, cols.HIDE).getValue(), true);
});

test('syncFromClubsNow_ isolates one club with broken headers, still syncs the healthy ones', () => {
  const { fns, seedMaster, seedClub, clubSheet, failedWebhooks, logs } = loadRegistrationSync();
  ALL_CLUBS.forEach((id) => seedClub(id));
  const master = seedMaster();
  const cols = fns.resolveColumns_(master);
  master.getRange(2, cols.REG_ID).setValue('t-b');
  master.getRange(2, cols.STATUS).setValue('registered');
  master.getRange(3, cols.REG_ID).setValue('t-c');
  master.getRange(3, cols.STATUS).setValue('registered');

  const brooklyn = clubSheet('brooklyn');
  brooklyn.getRange(2, cols.REG_ID).setValue('t-b');
  brooklyn.getRange(2, cols.STATUS).setValue('completed');
  brooklyn.getRange(2, cols.E1).setValue(10);

  seedClub('chicago', fns.HEADER_ORDER.map((h) => (h === 'attempt_status' ? 'status_typo' : h)));
  clubSheet('chicago').getRange(2, cols.REG_ID).setValue('t-c');

  fns.syncFromClubsNow_();

  assert.equal(master.getRange(2, cols.STATUS).getValue(), 'completed');
  assert.equal(master.getRange(3, cols.STATUS).getValue(), 'registered'); // chicago skipped, untouched
  // club_sync* failures are Cloud Logging only -- no payload worth a sheet row
  assert.equal(failedWebhooks(), null);
  assert.match(logs.join('\n'), /\[club_sync:chicago\]/);
});

test('syncFromClubsNow_ surfaces a club row with no matching MASTER registration_id', () => {
  const { fns, seedMaster, seedClub, clubSheet, failedWebhooks, logs } = loadRegistrationSync();
  ALL_CLUBS.forEach((id) => seedClub(id));
  const master = seedMaster();
  const cols = fns.resolveColumns_(master);

  const brooklyn = clubSheet('brooklyn');
  brooklyn.getRange(2, cols.REG_ID).setValue('ghost-id');
  brooklyn.getRange(2, cols.STATUS).setValue('registered');

  fns.syncFromClubsNow_();
  // club_sync* failures are Cloud Logging only -- no payload worth a sheet row
  assert.equal(failedWebhooks(), null);
  const summary = logs.join('\n');
  assert.match(summary, /\[club_sync:unmatched_ids\]/);
  assert.match(summary, /ghost-id/);
});

test('syncFromClubsNow_ never reads or writes hide_publicly, in either direction', () => {
  const { fns, seedMaster, seedClub, clubSheet } = loadRegistrationSync();
  ALL_CLUBS.forEach((id) => seedClub(id));
  const master = seedMaster();
  const cols = fns.resolveColumns_(master);
  master.getRange(2, cols.REG_ID).setValue('t-b');
  master.getRange(2, cols.STATUS).setValue('registered');
  master.getRange(2, cols.HIDE).setValue(true); // Lauren already hid this player by hand

  const brooklyn = clubSheet('brooklyn');
  brooklyn.getRange(2, cols.REG_ID).setValue('t-b');
  brooklyn.getRange(2, cols.STATUS).setValue('completed');

  fns.syncFromClubsNow_();
  // hide_publicly is opt-out, not opt-in: attempt_status still syncs from the
  // club sheet as normal, but the sync never touches hide_publicly at all --
  // visibility for a *non*-hidden player comes from attempt_status alone, on
  // the public site's own query, not from anything this function writes.
  assert.equal(master.getRange(2, cols.STATUS).getValue(), 'completed');
  assert.equal(master.getRange(2, cols.HIDE).getValue(), true);
});

test('syncSessionsFromClubs_ rebuilds MASTER Sessions from every club, skipping blank template rows', () => {
  const { fns, seedMasterSessions, seedClubSessions, masterSessionsSheet } = loadRegistrationSync();
  const master = seedMasterSessions();
  const cols = fns.resolveColumnsFor_(master, fns.SESSIONS_HEADER_ORDER, fns.SESSIONS_HEADER_KEYS);
  ALL_CLUBS.forEach((id) => seedClubSessions(id)); // every club has an (empty) Sessions tab

  const brooklyn = seedClubSessions('brooklyn');
  brooklyn.getRange(2, cols.DATE).setValue('2026-10-09');
  brooklyn.getRange(2, cols.START).setValue('19:30');
  brooklyn.getRange(2, cols.END).setValue('21:00');
  brooklyn.getRange(3, cols.DATE).setValue(''); // blank template row -- must be skipped

  const chicago = seedClubSessions('chicago');
  chicago.getRange(2, cols.DATE).setValue('2026-10-07');
  chicago.getRange(2, cols.START).setValue('18:00');
  chicago.getRange(2, cols.END).setValue('20:00');
  chicago.getRange(2, cols.NOTE).setValue('Bring your own broom');

  const result = fns.syncSessionsFromClubs_();
  assert.equal(result.written, 2);
  assert.equal(result.skippedClubs.length, 0);

  const written = masterSessionsSheet()!.getRange(2, 1, 2, 5).getValues();
  assert.deepEqual(written.find((row) => row[0] === 'chicago'), ['chicago', '2026-10-07', '18:00', '20:00', 'Bring your own broom']);
  assert.deepEqual(written.find((row) => row[0] === 'brooklyn'), ['brooklyn', '2026-10-09', '19:30', '21:00', '']);
});

test('syncSessionsFromClubs_ forces MASTER date/start/end columns to Plain Text before writing, so Sheets never silently re-parses them back into real Date/time cells', () => {
  // getValues() returning "2026-10-07"/"18:00" (asserted above) isn't
  // enough proof on its own -- real Google Sheets re-parses a plain
  // string the same way typing it into the UI would the moment
  // setValues() lands on a column still left on "Automatic" format,
  // silently turning it into a real Date/time-of-day cell. The public
  // site then reads that cell with valueRenderOption: UNFORMATTED_VALUE
  // (netlify/lib/sheets.ts), getting back a raw serial number instead
  // of the string, and rejects it -- even though the sheet displays a
  // perfectly normal-looking date/time. Only forcing Plain Text on
  // these columns before every write actually prevents that.
  const { fns, seedMasterSessions, seedClubSessions, masterSessionsSheet } = loadRegistrationSync();
  seedMasterSessions();
  const cols = fns.resolveColumnsFor_(masterSessionsSheet()!, fns.SESSIONS_HEADER_ORDER, fns.SESSIONS_HEADER_KEYS);

  const chicago = seedClubSessions('chicago');
  chicago.getRange(2, cols.DATE).setValue('2026-10-07');
  chicago.getRange(2, cols.START).setValue('18:00');
  chicago.getRange(2, cols.END).setValue('20:00');

  fns.syncSessionsFromClubs_();
  const master = masterSessionsSheet()!;
  assert.equal(master.getRange(2, cols.DATE).getNumberFormat(), '@');
  assert.equal(master.getRange(2, cols.START).getNumberFormat(), '@');
  assert.equal(master.getRange(2, cols.END).getNumberFormat(), '@');
});

test('syncSessionsFromClubs_ skips a row with a date but no start/end time yet, instead of writing it half-finished to MASTER', () => {
  // A club filling out its Sessions tab typically enters the date first,
  // before nailing down start/end time -- a normal in-progress editing
  // state, not an error. The public site's parser rejects its *entire*
  // feed on any one malformed row (netlify/lib/sessions.ts), so writing
  // this half-finished row to MASTER would break every club's sessions
  // list, not just this one club's.
  const { fns, seedMasterSessions, seedClubSessions, masterSessionsSheet } = loadRegistrationSync();
  const master = seedMasterSessions();
  const cols = fns.resolveColumnsFor_(master, fns.SESSIONS_HEADER_ORDER, fns.SESSIONS_HEADER_KEYS);
  ALL_CLUBS.forEach((id) => seedClubSessions(id));

  const chicago = seedClubSessions('chicago');
  chicago.getRange(2, cols.DATE).setValue('2026-10-07');
  // start_time and end_time left blank.

  const brooklyn = seedClubSessions('brooklyn');
  brooklyn.getRange(2, cols.DATE).setValue('2026-10-09');
  brooklyn.getRange(2, cols.START).setValue('19:30');
  brooklyn.getRange(2, cols.END).setValue(''); // half-filled-in end time

  const result = fns.syncSessionsFromClubs_();
  assert.equal(result.written, 0);
  assert.equal(result.skippedClubs.length, 0); // not a header problem, just an incomplete row
  assert.deepEqual(masterSessionsSheet()!.getRange(2, 1, 1, 4).getValues()[0], ['', '', '', '']);
});

test("syncSessionsFromClubs_ always uses the club's own configured id, never trusting a club sheet's own club cell", () => {
  const { fns, seedMasterSessions, seedClubSessions, masterSessionsSheet } = loadRegistrationSync();
  seedMasterSessions();
  const cols = fns.resolveColumnsFor_(masterSessionsSheet()!, fns.SESSIONS_HEADER_ORDER, fns.SESSIONS_HEADER_KEYS);

  const brooklyn = seedClubSessions('brooklyn');
  brooklyn.getRange(2, cols.CLUB).setValue('chicago'); // spoofed/incorrect value
  brooklyn.getRange(2, cols.DATE).setValue('2026-10-09');
  brooklyn.getRange(2, cols.START).setValue('19:30');
  brooklyn.getRange(2, cols.END).setValue('21:00');

  fns.syncSessionsFromClubs_();
  assert.equal(masterSessionsSheet()!.getRange(2, cols.CLUB).getValue(), 'brooklyn');
});

test('syncSessionsFromClubs_ auto-creates a missing club or MASTER Sessions tab instead of failing', () => {
  const { fns, seedClubSessions, masterSessionsSheet, logs } = loadRegistrationSync();
  // Nothing seeded at all -- MASTER and every club's Sessions tab is missing.
  const brooklyn0 = seedClubSessions('brooklyn'); // one club already has a tab, to prove both paths coexist
  const cols = fns.resolveColumnsFor_(brooklyn0, fns.SESSIONS_HEADER_ORDER, fns.SESSIONS_HEADER_KEYS);
  brooklyn0.getRange(2, cols.DATE).setValue('2026-10-09');
  brooklyn0.getRange(2, cols.START).setValue('19:30');
  brooklyn0.getRange(2, cols.END).setValue('21:00');

  const result = fns.syncSessionsFromClubs_();
  assert.equal(result.written, 1); // only brooklyn had a real row; the rest auto-created empty
  assert.equal(result.skippedClubs.length, 0);
  assert.equal(logs.length, 0); // no errors -- auto-create is silent, not a failure path

  assert.deepEqual(masterSessionsSheet()!.getRange(1, 1, 1, 5).getValues()[0], [...fns.SESSIONS_HEADER_ORDER]);
});

test('syncSessionsFromClubs_ isolates a club with broken headers on an already-existing tab, still syncs the others', () => {
  const { fns, seedMasterSessions, seedClubSessions, masterSessionsSheet, logs } = loadRegistrationSync();
  seedMasterSessions();
  const cols = fns.resolveColumnsFor_(masterSessionsSheet()!, fns.SESSIONS_HEADER_ORDER, fns.SESSIONS_HEADER_KEYS);

  const brooklyn = seedClubSessions('brooklyn');
  brooklyn.getRange(2, cols.DATE).setValue('2026-10-09');
  brooklyn.getRange(2, cols.START).setValue('19:30');
  brooklyn.getRange(2, cols.END).setValue('21:00');

  seedClubSessions('chicago', fns.SESSIONS_HEADER_ORDER.map((h) => (h === 'date' ? 'date_typo' : h)));
  // beachside, st-pete, tampa: no Sessions tab yet -- auto-created, not skipped (see the test above)

  const result = fns.syncSessionsFromClubs_();
  assert.equal(result.written, 1);
  assert.equal(result.skippedClubs.length, 1);
  assert.match(logs.join('\n'), /\[session_sync:chicago\]/);
});

test('syncSessionsFromClubs_ throws on a MASTER Sessions tab that already exists with broken headers (real drift, not missing)', () => {
  const { fns, seedMasterSessions } = loadRegistrationSync();
  seedMasterSessions(fns.SESSIONS_HEADER_ORDER.map((h) => (h === 'date' ? 'date_typo' : h)));
  assert.throws(() => fns.syncSessionsFromClubs_(), /missing required header.*date/i);
});

test('formatSessionDateCell_/formatSessionTimeCell_ normalize a real Sheets Date value using the passed-in time zone, and pass plain text through unchanged', () => {
  const { fns, sheetDate } = loadRegistrationSync();
  // getValues() returns a native Date for any cell Sheets recognizes as a
  // date/time, regardless of what the club typed or the column's number
  // format -- 18:30 UTC is 11:30 America/Los_Angeles, same calendar date
  // either way. The caller decides which time zone that is (always the
  // SOURCE sheet's own workbook time zone, see syncSessionsFromClubs_ --
  // these two functions never assume Session.getScriptTimeZone()).
  const cell = sheetDate(Date.UTC(2026, 9, 7, 18, 30, 0));
  assert.equal(fns.formatSessionDateCell_(cell, 'America/Los_Angeles'), '2026-10-07');
  assert.equal(fns.formatSessionTimeCell_(cell, 'America/Los_Angeles'), '11:30');
  // Same instant, formatted for a different workbook time zone, lands on
  // a different wall-clock time -- this is the whole bug.
  assert.equal(fns.formatSessionTimeCell_(cell, 'America/New_York'), '14:30');

  // Already-plain-text cells (the documented, correct entry format) must
  // pass through unchanged regardless of time zone.
  assert.equal(fns.formatSessionDateCell_('2026-10-07', 'America/Los_Angeles'), '2026-10-07');
  assert.equal(fns.formatSessionTimeCell_('18:00', 'America/Los_Angeles'), '18:00');
  assert.equal(fns.formatSessionDateCell_('', 'America/Los_Angeles'), '');
});

test('syncSessionsFromClubs_ normalizes real Sheets Date/time cells instead of writing malformed values to MASTER', () => {
  const { fns, seedMasterSessions, seedClubSessions, masterSessionsSheet, sheetDate } = loadRegistrationSync();
  seedMasterSessions();
  const cols = fns.resolveColumnsFor_(masterSessionsSheet()!, fns.SESSIONS_HEADER_ORDER, fns.SESSIONS_HEADER_KEYS);

  const brooklyn = seedClubSessions('brooklyn');
  // Simulates a club typing a date into a cell Sheets auto-detected as a
  // real date/time value (the bug this guards against), not plain text.
  brooklyn.getRange(2, cols.DATE).setValue(sheetDate(Date.UTC(2026, 9, 7, 18, 30, 0)));
  brooklyn.getRange(2, cols.START).setValue(sheetDate(Date.UTC(2026, 9, 7, 18, 30, 0)));
  brooklyn.getRange(2, cols.END).setValue(sheetDate(Date.UTC(2026, 9, 7, 20, 30, 0)));

  fns.syncSessionsFromClubs_();
  const written = masterSessionsSheet()!.getRange(2, 1, 1, 4).getValues()[0];
  assert.deepEqual(written, ['brooklyn', '2026-10-07', '11:30', '13:30']);
});

test("syncSessionsFromClubs_ formats a club's Date/time cells using that CLUB WORKBOOK's own time zone, not the ADMIN-bound script's", () => {
  const { fns, seedMasterSessions, seedClubSessions, masterSessionsSheet, sheetDate } = loadRegistrationSync();
  seedMasterSessions();
  const cols = fns.resolveColumnsFor_(masterSessionsSheet()!, fns.SESSIONS_HEADER_ORDER, fns.SESSIONS_HEADER_KEYS);

  // Brooklyn's own workbook (Config.gs, CLUBS) is a spreadsheet file
  // entirely separate from ADMIN, with its own File > Settings time
  // zone -- here set to Eastern, distinct from the harness's mocked
  // Session.getScriptTimeZone() ('America/Los_Angeles'). Formatting with
  // the script's time zone instead of this workbook's own is exactly the
  // bug reported against the live Brooklyn sync: the written time is the
  // same absolute instant shifted onto the wrong wall clock.
  const brooklyn = seedClubSessions('brooklyn');
  brooklyn.getParent().setSpreadsheetTimeZone('America/New_York');
  brooklyn.getRange(2, cols.DATE).setValue(sheetDate(Date.UTC(2026, 9, 7, 18, 30, 0)));
  brooklyn.getRange(2, cols.START).setValue(sheetDate(Date.UTC(2026, 9, 7, 18, 30, 0)));
  brooklyn.getRange(2, cols.END).setValue(sheetDate(Date.UTC(2026, 9, 7, 20, 30, 0)));

  fns.syncSessionsFromClubs_();
  const written = masterSessionsSheet()!.getRange(2, 1, 1, 4).getValues()[0];
  assert.deepEqual(written, ['brooklyn', '2026-10-07', '14:30', '16:30']);
});

test('syncSessionsFromClubs_ fully rebuilds MASTER on every run -- a row removed from a club sheet disappears', () => {
  const { fns, seedMasterSessions, seedClubSessions, masterSessionsSheet } = loadRegistrationSync();
  seedMasterSessions();
  const cols = fns.resolveColumnsFor_(masterSessionsSheet()!, fns.SESSIONS_HEADER_ORDER, fns.SESSIONS_HEADER_KEYS);
  const brooklyn = seedClubSessions('brooklyn');
  brooklyn.getRange(2, cols.DATE).setValue('2026-10-09');
  brooklyn.getRange(2, cols.START).setValue('19:30');
  brooklyn.getRange(2, cols.END).setValue('21:00');

  assert.equal(fns.syncSessionsFromClubs_().written, 1);

  brooklyn.getRange(2, cols.DATE).setValue(''); // club deletes/clears their only session
  assert.equal(fns.syncSessionsFromClubs_().written, 0);
  assert.equal(masterSessionsSheet()!.getRange(2, cols.DATE).getValue(), ''); // no stale leftover row
});

test('syncFromClubsNow_ runs the Sessions sync too, auto-creating MASTER Sessions with no prior setup', () => {
  const { fns, seedMaster, seedClub, admin } = loadRegistrationSync();
  ALL_CLUBS.forEach((id) => seedClub(id));
  seedMaster();
  // No Sessions tab anywhere yet -- must not throw, must auto-create.

  assert.doesNotThrow(() => fns.syncFromClubsNow_());
  assert.ok(admin.getSheetByName(fns.SESSIONS_SHEET));
});

test('syncFromClubsNow_ isolates a MASTER Sessions tab that already exists with broken headers, without touching the score sync', () => {
  const { fns, seedMaster, seedClub, seedMasterSessions, logs } = loadRegistrationSync();
  ALL_CLUBS.forEach((id) => seedClub(id));
  const master = seedMaster();
  const cols = fns.resolveColumns_(master);
  master.getRange(2, cols.REG_ID).setValue('t-1');
  master.getRange(2, cols.STATUS).setValue('registered');
  seedMasterSessions(fns.SESSIONS_HEADER_ORDER.map((h) => (h === 'date' ? 'date_typo' : h)));

  assert.doesNotThrow(() => fns.syncFromClubsNow_());
  assert.equal(master.getRange(2, cols.STATUS).getValue(), 'registered'); // score sync unaffected
  assert.match(logs.join('\n'), /\[session_sync\].*missing required header/i);
});

test('doPost rejects a bad token without writing Failed Webhooks, accepts a valid ticket', () => {
  const { fns, properties, seedMaster, seedClub, failedWebhooks } = loadRegistrationSync();
  seedMaster();
  seedClub('chicago');
  properties.set('REGISTRATION_INGEST_TOKEN', 'secret');

  const bad = JSON.parse(fns.doPost({ parameter: { token: 'wrong' }, postData: { contents: '{}' } }).getContent());
  assert.equal(bad.error, 'Unauthorized');
  assert.equal(failedWebhooks(), null);

  const payload = { _type: 'ticket', slug: 'tito-1', first_name: 'Nick', last_name: 'H', release_slug: 'chicago', updated_at: '2026-09-01T00:00:00Z' };
  const good = JSON.parse(fns.doPost({ parameter: { token: 'secret' }, postData: { contents: JSON.stringify(payload) } }).getContent());
  assert.equal(good.ok, true);
  assert.equal(good.result.club, 'chicago');
});

test('doPost logs an authenticated failure to Failed Webhooks and to Cloud Logging via console.error', () => {
  const { fns, properties, seedMaster, seedClub, failedWebhooks, logs } = loadRegistrationSync();
  seedMaster();
  seedClub('chicago');
  properties.set('REGISTRATION_INGEST_TOKEN', 'secret');

  const payload = { _type: 'ticket', slug: 'tito-2', first_name: 'X', release_slug: 'not-a-real-club' };
  const res = JSON.parse(fns.doPost({ parameter: { token: 'secret' }, postData: { contents: JSON.stringify(payload) } }).getContent());
  assert.equal(res.ok, false);
  assert.match(res.error, /Could not map Tito release to club/);

  assert.equal(failedWebhooks()!.getRange(2, 2).getValue(), 'tito_ingest');
  assert.match(logs.join('\n'), /\[tito_ingest\].*Could not map Tito release to club/);
});

test('repeated failures of the same source each get their own Failed Webhooks row and console.error entry -- no in-script throttling', () => {
  const { fns, properties, seedMaster, seedClub, failedWebhooks, logs } = loadRegistrationSync();
  seedMaster();
  seedClub('chicago');
  properties.set('REGISTRATION_INGEST_TOKEN', 'secret');

  const payload = { _type: 'ticket', slug: 'tito-3', release_slug: 'not-a-real-club' };
  const req = { parameter: { token: 'secret' }, postData: { contents: JSON.stringify(payload) } };
  fns.doPost(req);
  fns.doPost(req); // same source ('tito_ingest') -- throttling now lives in the GCP alerting policy, not the script

  assert.equal(failedWebhooks()!.getLastRow(), 3); // header + two logged failures
  assert.equal(logs.filter((l) => l.includes('[tito_ingest]')).length, 2);
});

test('doPost logs a successful ingest at INFO so a healed Failed Webhooks row is traceable in Cloud Logging', () => {
  const { fns, properties, seedMaster, seedClub, consoleCalls } = loadRegistrationSync();
  seedMaster();
  seedClub('chicago');
  properties.set('REGISTRATION_INGEST_TOKEN', 'secret');

  const payload = { _type: 'ticket', slug: 'tito-4', first_name: 'Nick', last_name: 'H', release_slug: 'chicago' };
  fns.doPost({ parameter: { token: 'secret' }, postData: { contents: JSON.stringify(payload) } });

  assert.deepEqual(consoleCalls, [{ level: 'info', msg: '[tito_ingest] ok tito-4 (chicago)' }]);
});

test('doGet answers a browser/link-preview GET instead of Apps Script logging "Script function not found" at ERROR', () => {
  const { fns, consoleCalls } = loadRegistrationSync();
  assert.equal(JSON.parse(fns.doGet().getContent()).ok, true);
  assert.equal(consoleCalls.length, 0);
});

test('logSystemError_ downgrades transient sync failures to WARNING but keeps real ones, and every tito_ingest failure, at ERROR', () => {
  const { fns, consoleCalls } = loadRegistrationSync();
  const level = (source: string, message: string) => {
    consoleCalls.length = 0;
    fns.logSystemError_(source, '', new Error(message));
    return consoleCalls[0].level;
  };

  assert.equal(level('club_sync:tampa', 'Service Drive timed out while accessing document with id abc.'), 'warn');
  assert.equal(level('session_sync:chicago', 'Service Spreadsheets timed out while accessing document with id abc.'), 'warn');
  assert.equal(level('club_sync', "We're sorry, a server error occurred. Please wait a bit and try again."), 'warn');
  assert.equal(level('club_sync', 'Lock timeout: another process was holding the lock for too long.'), 'warn');

  assert.equal(level('club_sync:chicago', 'Missing required header: email'), 'error');
  assert.equal(level('tito_ingest', 'Lock timeout: another process was holding the lock for too long.'), 'error');
  assert.equal(level('tito_ingest', 'Service Drive timed out while accessing document with id abc.'), 'error');
});

test('pauseSyncTrigger removes any trigger owned by the current account; installSyncTrigger resumes it', () => {
  const { fns, triggers } = loadRegistrationSync();
  assert.equal(triggers.length, 0);

  fns.pauseSyncTrigger(); // nothing installed yet -- must not throw
  assert.equal(triggers.length, 0);

  fns.installSyncTrigger();
  assert.equal(triggers.length, 1);
  assert.equal(triggers[0].getHandlerFunction(), 'syncFromClubsNow');

  fns.pauseSyncTrigger();
  assert.equal(triggers.length, 0);

  fns.installSyncTrigger(); // resume
  assert.equal(triggers.length, 1);
});

test('pauseSyncTrigger stops syncFromClubsNow via a Script Property, even with no trigger visible to this account', () => {
  // Simulates the real failure: ScriptApp.getProjectTriggers() only
  // returns triggers owned by the executing user, so someone else's
  // installed trigger is invisible here -- `triggers` stays empty
  // throughout, proving the pause doesn't depend on seeing it.
  const { fns, seedMaster, seedClub, properties, triggers } = loadRegistrationSync();
  seedMaster();
  seedClub('brooklyn');
  fns.pauseSyncTrigger();
  assert.equal(triggers.length, 0);
  assert.equal(properties.get('syncPaused'), 'true');

  const cols = fns.resolveColumns_(fns.ensureMasterSheet_());
  fns.ensureMasterSheet_().getRange(2, cols.REG_ID).setValue('t-1');
  fns.ensureMasterSheet_().getRange(2, cols.STATUS).setValue('registered');

  fns.syncFromClubsNow(); // paused -- must no-op, not even attempt the sync
  assert.equal(fns.ensureMasterSheet_().getRange(2, cols.STATUS).getValue(), 'registered');

  fns.installSyncTrigger(); // resume
  assert.equal(properties.get('syncPaused'), undefined);
});

test('verifySystem logs via console.log instead of a blocking UI alert, and never throws', () => {
  const { fns, seedMaster, seedClub, logs } = loadRegistrationSync();
  seedMaster();
  ALL_CLUBS.forEach((id) => seedClub(id));
  fns.installSyncTrigger();

  assert.doesNotThrow(() => fns.verifySystem()); // would throw "no UI in tests" if it still called getUi()
  const summary = logs.join('\n');
  assert.match(summary, /MASTER headers OK/);
  assert.match(summary, /Beachside Social headers OK/);
  assert.match(summary, /Problems:\n• \(none\)/);
});

test('verifySystem reports a broken club sheet as a problem, not a thrown error', () => {
  const { fns, seedMaster, seedClub, logs } = loadRegistrationSync();
  seedMaster();
  ALL_CLUBS.filter((id) => id !== 'chicago').forEach((id) => seedClub(id));
  seedClub('chicago', fns.HEADER_ORDER.filter((h) => h !== 'email')); // seeded once, missing email from the start

  fns.verifySystem();
  const summary = logs.join('\n');
  assert.match(summary, /Chicago: .*missing required header.*email/i);
});
