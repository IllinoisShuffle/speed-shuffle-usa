import test from 'node:test';
import assert from 'node:assert/strict';
import { clubAverageScores } from '../src/lib/clubAverages.ts';
import type { PlayerStanding } from '../src/lib/types.ts';

const player = (id: string, clubId: PlayerStanding['clubId'], score?: number, completed = true): PlayerStanding =>
  ({ id, displayName: id, clubId, rank: 1, completed, ...(score === undefined ? {} : { score }) });

test('averages completed scores per club, including hidden players, rounded to one decimal', () => {
  const averages = clubAverageScores([
    player('a', 'chicago', 80), player('b', 'chicago', 75), player('c', 'chicago', 70),
    { ...player('d', 'brooklyn', 91), hidden: true }, player('e', 'brooklyn', 0),
    player('f', 'tampa', 10, false),
  ]);
  assert.equal(averages.get('chicago'), 75);
  assert.equal(averages.get('brooklyn'), 45.5);
  assert.equal(averages.has('tampa'), false);
});
test('no scores (scores hidden) yields no averages', () => {
  assert.equal(clubAverageScores([player('a', 'chicago'), player('b', 'st-pete')]).size, 0);
});
