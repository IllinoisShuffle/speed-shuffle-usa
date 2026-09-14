import type { ClubStats, PlayerStanding } from '../lib/types';

// Fictional example standings, not tournament results. Scores are build-time only.
export const mockLeaderboard: PlayerStanding[] = [
  { id: 'demo-01', displayName: 'Lauren S.', clubId: 'chicago', rank: 1, score: 96, completed: true },
  { id: 'demo-02', displayName: 'Nick H.', clubId: 'brooklyn', rank: 2, score: 92, completed: true },
  { id: 'demo-03', displayName: 'John A.', clubId: 'chicago', rank: 3, score: 86, completed: true },
  { id: 'demo-04', displayName: 'Rebecca M.', clubId: 'st-pete', rank: 4, score: 84, completed: true },
  { id: 'demo-05', displayName: 'Mike D.', clubId: 'tampa', rank: 5, score: 82, completed: true },
  { id: 'demo-06', displayName: 'Sean R.', clubId: 'brooklyn', rank: 6, score: 80, completed: true },
  { id: 'demo-07', displayName: 'Abby M.', clubId: 'chicago', rank: 7, score: 79, completed: true },
  { id: 'demo-08', displayName: 'Paul A.', clubId: 'st-pete', rank: 8, score: 77, completed: true },
  { id: 'demo-09', displayName: 'Erik W.', clubId: 'chicago', rank: 9, score: 75, completed: true },
  { id: 'demo-10', displayName: 'Fabiola C.', clubId: 'brooklyn', rank: 10, score: 73, completed: true },
  { id: 'demo-11', displayName: 'Kevin R.', clubId: 'tampa', rank: 11, score: 71, completed: true },
  { id: 'demo-12', displayName: 'Sammy W.', clubId: 'beachside', rank: 12, score: 69, completed: true },
];

// Independent summary fixtures; the twelve rows above are only a preview sample.
export const mockClubStats: ClubStats[] = [
  { clubId: 'chicago', registered: 42, completed: 19 },
  { clubId: 'brooklyn', registered: 31, completed: 12 },
  { clubId: 'st-pete', registered: 29, completed: 17 },
  { clubId: 'tampa', registered: 14, completed: 6 },
  { clubId: 'beachside', registered: 12, completed: 8 },
];
