import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSessions, type Cell } from '../netlify/lib/sessions.ts';
import { createHandler } from '../netlify/functions/sessions-data.ts';

const headers = ['club', 'date', 'start_time', 'end_time', 'note'];
const fixture = (): Cell[][] => [headers,
  ['chicago', '2026-10-07', '18:00', '20:00', 'Bring your own broom'],
  ['brooklyn', '2026-10-09', '19:30', '21:00', ''],
  ['', '', '', '', '']];

test('parses valid rows, sorts by date/time, skips fully blank template rows', () => {
  const result = parseSessions(fixture());
  assert.equal(result.sessions.length, 2);
  assert.deepEqual(result.sessions.map(session => session.clubId), ['chicago', 'brooklyn']);
  assert.equal(result.sessions[0].note, 'Bring your own broom');
  assert.equal(result.sessions[1].note, undefined);
  assert.ok(result.updatedAt);
});

test('sorts sessions chronologically regardless of sheet row order', () => {
  const rows = fixture();
  [rows[1], rows[2]] = [rows[2], rows[1]];
  const result = parseSessions(rows);
  assert.deepEqual(result.sessions.map(session => session.clubId), ['chicago', 'brooklyn']);
});

test('headers only is a valid empty sheet, absent headers is not', () => {
  assert.deepEqual(parseSessions([headers]).sessions, []);
  assert.throws(() => parseSessions([]));
});

test('rejects unknown clubs, malformed dates and malformed times', () => {
  for (const [column, value] of [[0, 'unknown'], [1, '2026-13-40'], [1, 'not-a-date'], [2, '9am'], [3, '25:00']] as const) {
    const rows = fixture(); rows[1][column] = value;
    assert.throws(() => parseSessions(rows));
  }
});

test('rejects an end time at or before the start time', () => {
  const rows = fixture(); rows[1][2] = '20:00'; rows[1][3] = '20:00';
  assert.throws(() => parseSessions(rows));
});

test('function never leaks upstream errors or silently returns mock data', async () => {
  const handler = createHandler(async () => { throw new Error('secret key and private payload'); });
  const result = await handler({ httpMethod: 'GET' });
  assert.equal(result.statusCode, 503);
  assert.equal(result.headers['Cache-Control'], 'no-store');
  assert.ok(!result.body.includes('secret'));
  assert.equal((await handler({ httpMethod: 'POST' })).statusCode, 405);
});
