import type { ClubId, PlayerStanding } from './types';

/** Mean completed score per club, rounded to one decimal. Clubs with no scored players are omitted. */
export function clubAverageScores(players: PlayerStanding[]): Map<ClubId, number> {
  const totals = new Map<ClubId, { sum: number; count: number }>();
  for (const player of players) {
    if (!player.completed || typeof player.score !== 'number') continue;
    const total = totals.get(player.clubId) ?? { sum: 0, count: 0 };
    total.sum += player.score;
    total.count += 1;
    totals.set(player.clubId, total);
  }
  return new Map([...totals].map(([clubId, { sum, count }]) => [clubId, Math.round((sum / count) * 10) / 10]));
}
