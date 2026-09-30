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

test('syncSessionsFromClubs_ isolates a club with a missing tab or broken headers, still syncs the others', () => {
  const { fns, seedMasterSessions, seedClubSessions, masterSessionsSheet, logs } = loadRegistrationSync();
  seedMasterSessions();
  const cols = fns.resolveColumnsFor_(masterSessionsSheet()!, fns.SESSIONS_HEADER_ORDER, fns.SESSIONS_HEADER_KEYS);

  const brooklyn = seedClubSessions('brooklyn');
  brooklyn.getRange(2, cols.DATE).setValue('2026-10-09');
  brooklyn.getRange(2, cols.START).setValue('19:30');
  brooklyn.getRange(2, cols.END).setValue('21:00');

  seedClubSessions('chicago', fns.SESSIONS_HEADER_ORDER.map((h) => (h === 'date' ? 'date_typo' : h)));
  // beachside, st-pete, tampa: no Sessions tab created at all yet

  const result = fns.syncSessionsFromClubs_();
  assert.equal(result.written, 1);
  assert.equal(result.skippedClubs.length, 4);
  const summary = logs.join('\n');
  assert.match(summary, /\[session_sync:chicago\]/);
  assert.match(summary, /\[session_sync:beachside\]/);
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

test('syncFromClubsNow_ runs the Sessions sync too, isolated from a broken MASTER Sessions tab', () => {
  const { fns, seedMaster, seedClub, logs } = loadRegistrationSync();
  ALL_CLUBS.forEach((id) => seedClub(id));
  seedMaster();
  // No MASTER Sessions tab at all -- ensureMasterSessionsSheet_ throws.

  assert.doesNotThrow(() => fns.syncFromClubsNow_());
  assert.match(logs.join('\n'), /\[session_sync\] Sessions sheet not found in ADMIN workbook/);
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
