import { clubs } from '../../src/lib/clubs.ts';
import type { ClubId, ClubStats, PlayerStanding } from '../../src/lib/types.ts';

export class SheetError extends Error {}
export type Cell = string | number | boolean;
const required = ['registration_id', 'first_name', 'last_initial', 'club', 'attempt_status', 'total_score', 'public_display'];
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
    if (row.every(cell => String(cell).trim() === '')) continue;
    const cell = (name: string) => String(row[headers.indexOf(name)] ?? '').trim();
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
    const lastInitial = cell('last_initial').replace(/\.$/, '');
    const score = Number(cell('total_score'));
    const display = cell('public_display').toLowerCase();
    if (!firstName || !/^\p{L}$/u.test(lastInitial) || !cell('total_score') || !Number.isFinite(score) || !Number.isInteger(score) || !['', 'true', 'false'].includes(display)) throw invalid();
    club.completed++;
    completed.push({ id, clubId, displayName: `${firstName.split(/\s+/)[0]} ${lastInitial}.`, rank: 0, score, completed: true, visible: display === 'true' });
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
