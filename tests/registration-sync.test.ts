import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRegistrationSync } from './apps-script-harness.ts';

const ALL_CLUBS = ['brooklyn', 'chicago', 'st-pete', 'tampa', 'beachside'];

test('resolveColumns_ finds every header by name regardless of order, ignores extra columns', () => {
  const { fns, seedMaster } = loadRegistrationSync();
  const sheet = seedMaster(['registration_id', 'team_name', 'public_display', 'total_score', 'end_4_score', 'end_3_score', 'end_2_score', 'end_1_score', 'attempt_status', 'registered_at', 'club', 'last_initial', 'first_name']);
  const cols = fns.resolveColumns_(sheet);
  assert.deepEqual({ REG_ID: cols.REG_ID, PUBLIC: cols.PUBLIC, E4: cols.E4, E1: cols.E1, FIRST: cols.FIRST },
    { REG_ID: 1, PUBLIC: 3, E4: 5, E1: 8, FIRST: 13 });
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
  assert.throws(() => fns.assertCanonicalColumnOrder_(seedMaster(swapped)), /not in the canonical A:L order/);
});

test('mapTitoPayloadToRegistration_ maps a ticket, resolves club aliases, and flags voided tickets cancelled', () => {
  const { fns } = loadRegistrationSync();
  const ticket = fns.mapTitoPayloadToRegistration_({ _type: 'ticket', slug: 'tk-1', first_name: 'Nick', last_name: 'Haynes', release_slug: 'chicago', updated_at: '2026-09-01T00:00:00Z' }, '');
  assert.deepEqual({ registration_id: ticket.registration_id, club: ticket.club, last_initial: ticket.last_initial, attempt_status: ticket.attempt_status },
    { registration_id: 'tk-1', club: 'chicago', last_initial: 'H', attempt_status: 'registered' });

  const aliased = fns.mapTitoPayloadToRegistration_({ _type: 'ticket', slug: 'tk-2', name: 'Sunny Rae', release_title: 'St Pete Club' }, '');
  assert.equal(aliased.club, 'st-pete');
  assert.deepEqual({ first_name: aliased.first_name, last_initial: aliased.last_initial }, { first_name: 'Sunny', last_initial: 'R' });

  const voided = fns.mapTitoPayloadToRegistration_({ _type: 'ticket', slug: 'tk-3', release_slug: 'tampa', state_name: 'voided' }, '');
  assert.equal(voided.attempt_status, 'cancelled');

  assert.throws(() => fns.mapTitoPayloadToRegistration_({ _type: 'ticket', slug: 'tk-4', release_slug: 'nowhere-club' }, ''), /Could not map Tito release to club/);
  assert.throws(() => fns.mapTitoPayloadToRegistration_({ _type: 'ticket', release_slug: 'chicago' }, ''), /missing slug/);
});

test('addRegistration writes each field to its resolved column on both sheets and is idempotent', () => {
  const { fns, seedMaster, seedClub, clubSheet } = loadRegistrationSync();
  seedMaster(['first_name', 'registration_id', 'last_initial', 'end_1_score', 'club', 'end_2_score', 'registered_at', 'end_3_score', 'attempt_status', 'end_4_score', 'total_score', 'public_display']);
  seedClub('brooklyn', ['registration_id', 'club', 'first_name', 'last_initial', 'registered_at', 'attempt_status', 'end_1_score', 'end_2_score', 'end_3_score', 'end_4_score', 'total_score', 'public_display']);

  const registration = { registration_id: 't1', first_name: 'Jack', last_initial: 'B', club: 'brooklyn', registered_at: '2026-09-01', attempt_status: 'registered' };
  const first = fns.addRegistration(registration);
  const second = fns.addRegistration(registration);
  assert.deepEqual(first, second);

  const master = fns.ensureMasterSheet_();
  assert.equal(master.getRange(first.master_row, 1).getValue(), 'Jack');
  assert.equal(master.getRange(first.master_row, 2).getValue(), 't1');
  // end_1..end_4 landed at columns 4, 6, 8, 10 (D, F, H, J) on this deliberately
  // non-contiguous master layout -- the formula must reference exactly those cells.
  assert.equal(master.getRange(first.master_row, 11).getValue(), '=IF(COUNTA(D2,F2,H2,J2)=0,"",SUM(D2,F2,H2,J2))');

  const club = clubSheet('brooklyn');
  assert.equal(club.getRange(first.club_row, 3).getValue(), 'Jack');
});

test('addRegistration preserves an existing Master public_display but defaults new rows to unchecked', () => {
  const { fns, seedMaster, seedClub } = loadRegistrationSync();
  const master = seedMaster();
  seedClub('brooklyn');
  const cols = fns.resolveColumns_(master);

  const reg = { registration_id: 't2', first_name: 'Ann', last_initial: 'Q', club: 'brooklyn', registered_at: '2026-09-01', attempt_status: 'completed' };
  const { master_row } = fns.addRegistration(reg);
  assert.equal(master.getRange(master_row, cols.PUBLIC).getValue(), false);

  master.getRange(master_row, cols.PUBLIC).setValue(true); // Lauren manually publishes it
  fns.addRegistration(reg); // a replayed/duplicate webhook event for the same ticket
  assert.equal(master.getRange(master_row, cols.PUBLIC).getValue(), true);
});

test('syncFromClubsNow_ isolates one club with broken headers, still syncs the healthy ones', () => {
  const { fns, seedMaster, seedClub, clubSheet, systemErrors } = loadRegistrationSync();
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
  assert.equal(master.getRange(2, cols.PUBLIC).getValue(), true);
  assert.equal(master.getRange(3, cols.STATUS).getValue(), 'registered'); // chicago skipped, untouched
  assert.equal(systemErrors()!.getRange(2, 2).getValue(), 'club_sync:chicago');
});

test('syncFromClubsNow_ surfaces a club row with no matching MASTER registration_id', () => {
  const { fns, seedMaster, seedClub, clubSheet, systemErrors } = loadRegistrationSync();
  ALL_CLUBS.forEach((id) => seedClub(id));
  const master = seedMaster();
  const cols = fns.resolveColumns_(master);

  const brooklyn = clubSheet('brooklyn');
  brooklyn.getRange(2, cols.REG_ID).setValue('ghost-id');
  brooklyn.getRange(2, cols.STATUS).setValue('registered');

  fns.syncFromClubsNow_();
  assert.equal(systemErrors()!.getRange(2, 2).getValue(), 'club_sync:unmatched_ids');
  assert.match(String(systemErrors()!.getRange(2, 3).getValue()), /ghost-id/);
});

test('syncFromClubsNow_ auto-publishes only on the first transition to completed', () => {
  const { fns, seedMaster, seedClub, clubSheet } = loadRegistrationSync();
  ALL_CLUBS.forEach((id) => seedClub(id));
  const master = seedMaster();
  const cols = fns.resolveColumns_(master);
  master.getRange(2, cols.REG_ID).setValue('t-b');
  master.getRange(2, cols.STATUS).setValue('registered');

  const brooklyn = clubSheet('brooklyn');
  brooklyn.getRange(2, cols.REG_ID).setValue('t-b');
  brooklyn.getRange(2, cols.STATUS).setValue('completed');

  fns.syncFromClubsNow_();
  assert.equal(master.getRange(2, cols.PUBLIC).getValue(), true);

  master.getRange(2, cols.PUBLIC).setValue(false); // Lauren manually hides it
  fns.syncFromClubsNow_(); // still completed -> completed: must not re-check it
  assert.equal(master.getRange(2, cols.PUBLIC).getValue(), false);
});

test('doPost rejects a bad token without writing System Errors, accepts a valid ticket', () => {
  const { fns, properties, seedMaster, seedClub, systemErrors } = loadRegistrationSync();
  seedMaster();
  seedClub('chicago');
  properties.set('REGISTRATION_INGEST_TOKEN', 'secret');

  const bad = JSON.parse(fns.doPost({ parameter: { token: 'wrong' }, postData: { contents: '{}' } }).getContent());
  assert.equal(bad.error, 'Unauthorized');
  assert.equal(systemErrors(), null);

  const payload = { _type: 'ticket', slug: 'tito-1', first_name: 'Nick', last_name: 'H', release_slug: 'chicago', updated_at: '2026-09-01T00:00:00Z' };
  const good = JSON.parse(fns.doPost({ parameter: { token: 'secret' }, postData: { contents: JSON.stringify(payload) } }).getContent());
  assert.equal(good.ok, true);
  assert.equal(good.result.club, 'chicago');
});

test('doPost logs an authenticated failure to System Errors and emails if INGEST_ALERT_EMAIL is set', () => {
  const { fns, properties, seedMaster, seedClub, systemErrors, mail } = loadRegistrationSync();
  seedMaster();
  seedClub('chicago');
  properties.set('REGISTRATION_INGEST_TOKEN', 'secret');
  properties.set('INGEST_ALERT_EMAIL', 'ops@example.invalid');

  const payload = { _type: 'ticket', slug: 'tito-2', first_name: 'X', release_slug: 'not-a-real-club' };
  const res = JSON.parse(fns.doPost({ parameter: { token: 'secret' }, postData: { contents: JSON.stringify(payload) } }).getContent());
  assert.equal(res.ok, false);
  assert.match(res.error, /Could not map Tito release to club/);

  assert.equal(systemErrors()!.getRange(2, 2).getValue(), 'tito_ingest');
  assert.equal(mail.length, 1);
  assert.equal(mail[0].to, 'ops@example.invalid');
});
