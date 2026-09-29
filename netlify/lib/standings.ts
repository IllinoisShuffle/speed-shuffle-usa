import { clubs } from '../../src/lib/clubs.ts';
import type { ClubId, ClubStats, PlayerStanding } from '../../src/lib/types.ts';

export class SheetError extends Error {}
export type Cell = string | number | boolean;
const required = ['registration_id', 'first_name', 'last_name', 'club', 'attempt_status', 'total_score', 'hide_publicly'];
const clubIds = new Set<string>(clubs.map(club => club.id));

export function parseStandings(values: Cell[][], showScores: boolean) {
  const headers = (values[0] ?? []).map(value => String(value).trim().toLowerCase());
  if (required.some(name => headers.filter(header => header === name).length !== 1)) {
    throw new SheetError('The master sheet needs one header row with the required column names.');
  }
  const stats: ClubStats[] = clubs.map(club => ({ clubId: club.id, registered: 0, completed: 0 }));
  const seen = new Set<string>();
  const completed: Array<PlayerStanding & { score: number; visible: boolean }> = [];

  for (const [index, row] of values.slice(1).entries()) {
    const cell = (name: string) => String(row[headers.indexOf(name)] ?? '').trim();
    if (!cell('registration_id')) continue;
    const invalid = () => new SheetError(`Check the required fields in master sheet row ${index + 2}.`);
    const id = cell('registration_id');
    const clubId = cell('club') as ClubId;
    const status = cell('attempt_status').toLowerCase();
    if (!id || seen.has(id) || !clubIds.has(clubId) || !['registered', 'completed', 'cancelled'].includes(status)) throw invalid();
    seen.add(id);
    if (status === 'cancelled') continue;
    const club = stats.find(item => item.clubId === clubId)!;
    club.registered++;
    if (status !== 'completed') continue;
    const firstName = cell('first_name');
    // The sheet holds the real last name for running the event; only the
    // initial is ever exposed to the public site, derived right here.
    const lastInitial = cell('last_name').charAt(0);
    const score = Number(cell('total_score'));
    // Opt-out: hidden only when explicitly checked. Blank/false is the
    // common case (visible) -- there is no separate "opt in" step.
    const hidden = cell('hide_publicly').toLowerCase();
    if (!firstName || !/^\p{L}$/u.test(lastInitial) || !cell('total_score') || !Number.isFinite(score) || !Number.isInteger(score) || !['', 'true', 'false'].includes(hidden)) throw invalid();
    club.completed++;
    completed.push({ id, clubId, displayName: `${firstName.split(/\s+/)[0]} ${lastInitial}.`, rank: 0, score, completed: true, visible: hidden !== 'true' });
  }

  completed.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  let rank = 0;
  const players: PlayerStanding[] = [];
  completed.forEach((player, index) => {
    if (index === 0 || player.score !== completed[index - 1].score) rank = index + 1;
    if (!player.visible) return;
    players.push({ id: player.id, displayName: player.displayName, clubId: player.clubId,
      rank, completed: true, ...(showScores ? { score: player.score } : {}) });
  });
  return { players, stats, showScores, updatedAt: new Date().toISOString() };
}
