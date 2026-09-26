import type { PlayerStanding } from './types';

// Payout positions 1-10 (HANDOFF.md §8).
export const PRIZE_PERCENTAGES = [30, 20, 15, 12, 8, 5, 4, 3, 2, 1];

/** Standard competition ranking display: ties share "T{rank}", others plain. */
export function formatRank(rank: number, players: Pick<PlayerStanding, 'rank'>[]): string {
  const tied = players.filter(player => player.rank === rank).length > 1;
  return tied ? `T${rank}` : `${rank}`;
}

/**
 * Tied players split the combined prize for the places they occupy, e.g. two
 * players tied for 4th split (12 + 8) / 2 = 10% each. Returns null outside the
 * payout positions.
 */
export function prizePercentFor(rank: number, players: Pick<PlayerStanding, 'rank'>[]): number | null {
  if (rank > PRIZE_PERCENTAGES.length) return null;
  const groupSize = players.filter(player => player.rank === rank).length;
  const places = Array.from({ length: groupSize }, (_, index) => rank + index).filter(place => place <= PRIZE_PERCENTAGES.length);
  if (places.length === 0) return 0;
  const sum = places.reduce((total, place) => total + PRIZE_PERCENTAGES[place - 1], 0);
  return sum / groupSize;
}
