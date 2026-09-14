import { mockClubStats, mockLeaderboard } from '../data/mockLeaderboard';
import { tournamentConfig } from './config';
import type { ClubStats, PlayerStanding } from './types';

// Called only from Astro frontmatter at build time. Future live data must be
// sanitized server-side before being sent to a browser; CSS hiding is not enough.
export async function getLeaderboard(): Promise<PlayerStanding[]> {
  return mockLeaderboard
    .filter(player => player.completed)
    .toSorted((a, b) => a.rank - b.rank)
    .map(player => ({
      id: player.id,
      displayName: player.displayName,
      clubId: player.clubId,
      rank: player.rank,
      completed: player.completed,
      ...(tournamentConfig.showScores ? { score: player.score } : {}),
    }));
}

export async function getClubStats(): Promise<ClubStats[]> {
  return mockClubStats.map(({ clubId, registered, completed }) => ({ clubId, registered, completed }));
}
