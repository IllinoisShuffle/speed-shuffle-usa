import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStandings, type Cell } from '../netlify/lib/standings.ts';
import { spreadsheetId } from '../netlify/lib/sheets.ts';
import { createHandler } from '../netlify/functions/leaderboard-data.ts';

const headers = ['registration_id', 'first_name', 'last_name', 'club', 'attempt_status', 'total_score', 'hide_publicly', 'email'];
const fixture = (): Cell[][] => [headers,
  ['a', 'Alex', 'Quinn', 'chicago', 'completed', 80, false, 'private@example.invalid'],
  ['b', 'Casey', 'Rivera', 'brooklyn', 'completed', 74, false],
  ['c', 'Drew', 'Sato', 'st-pete', 'completed', 74, false],
  ['d', 'Hidden', 'Torres', 'tampa', 'completed', 90, true],
  ['e', 'Pending', 'Underwood', 'chicago', 'registered', '', false],
  ['f', 'Cancelled', 'Vance', 'chicago', 'cancelled', '', true]];

test('sorts and ranks all completed players, shows a placeholder for opt-outs, suppresses private fields', () => {
  const result = parseStandings(fixture(), false);
  assert.deepEqual(result.players.map(player => player.rank), [1, 2, 3, 3]);
  assert.equal(result.stats[0].registered, 2);
  assert.equal(result.stats[0].completed, 1);
  assert.equal(result.players.length, 4);
  const hiddenPlayer = result.players.find(player => player.hidden);
  assert.equal(hiddenPlayer?.rank, 1);
  assert.equal(hiddenPlayer?.displayName, 'Name withheld');
  for (const player of result.players) {
    const expectedKeys = player.hidden
      ? ['clubId', 'completed', 'displayName', 'hidden', 'id', 'rank']
      : ['clubId', 'completed', 'displayName', 'id', 'rank'];
    assert.deepEqual(Object.keys(player).sort(), expectedKeys);
  }
  assert.ok(!JSON.stringify(result).includes('private@example.invalid'));
  assert.ok(!JSON.stringify(result).includes('Hidden'));
  assert.ok(!JSON.stringify(result).includes('Torres'));
});
test('reveal mode includes scores for everyone, including a hidden winner; zero and negative scores are valid', () => {
  const rows = fixture(); rows[1][5] = 0; rows[2][5] = -10;
  assert.deepEqual(parseStandings(rows, true).players.map(player => player.score), [90, 74, 0, -10]);
});
test('headers only is a valid empty sheet, absent headers is not', () => {
  assert.deepEqual(parseStandings([headers], false).players, []);
  assert.throws(() => parseStandings([], false));
});
test('rejects duplicate IDs, unknown clubs and malformed totals instead of false standings', () => {
  for (const [column, value] of [[0, 'b'], [3, 'unknown'], [5, ''], [5, '#VALUE!'], [6, 'yes']] as const) {
    const rows = fixture(); rows[1][column] = value;
    assert.throws(() => parseStandings(rows, false));
  }
});
test('blank hide_publicly defaults to visible (opt-out) and a zero completed total is not missing', () => {
  const rows = fixture(); rows[1][6] = ''; rows[2][5] = 0;
  const result = parseStandings(rows, false);
  assert.ok(result.players.some(player => player.id === 'a'));
  assert.ok(result.players.some(player => player.id === 'b'));
});
test('function never leaks upstream errors or silently returns mock data', async () => {
  const handler = createHandler(async () => { throw new Error('secret key and private payload'); });
  const result = await handler({ httpMethod: 'GET' });
  assert.equal(result.statusCode, 503);
  assert.equal(result.headers['Cache-Control'], 'no-store');
  assert.ok(!result.body.includes('secret'));
  assert.equal((await handler({ httpMethod: 'POST' })).statusCode, 405);
});
test('accepts sheet IDs or official URLs but rejects arbitrary remote addresses', () => {
  assert.equal(spreadsheetId('abc_123-xyz'), 'abc_123-xyz');
  assert.equal(spreadsheetId('https://docs.google.com/spreadsheets/d/abc_123-xyz/edit?gid=0'), 'abc_123-xyz');
  assert.throws(() => spreadsheetId('https://evil.example/sheet'));
});
