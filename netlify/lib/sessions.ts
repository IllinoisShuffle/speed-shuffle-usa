import { clubs } from '../../src/lib/clubs.ts';
import type { ClubId, Session } from '../../src/lib/types.ts';
import { SheetError, type Cell } from './standings.ts';

export { SheetError, type Cell };
const required = ['club', 'date', 'start_time', 'end_time'];
const clubIds = new Set<string>(clubs.map(club => club.id));
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

function isRealDate(iso: string): boolean {
  const date = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso;
}

export function parseSessions(values: Cell[][]): { sessions: Session[]; updatedAt: string } {
  const headers = (values[0] ?? []).map(value => String(value).trim().toLowerCase());
  if (required.some(name => headers.filter(header => header === name).length !== 1)) {
    throw new SheetError('The sessions sheet needs one header row with the required column names.');
  }
  const sessions: Session[] = [];

  for (const [index, row] of values.slice(1).entries()) {
    const cell = (name: string) => String(row[headers.indexOf(name)] ?? '').trim();
    if (!cell('club')) continue;
    const invalid = () => new SheetError(`Check the required fields in sessions sheet row ${index + 2}.`);
    const clubId = cell('club') as ClubId;
    const date = cell('date');
    const startTime = cell('start_time');
    const endTime = cell('end_time');
    if (!clubIds.has(clubId) || !datePattern.test(date) || !isRealDate(date)) throw invalid();
    if (!timePattern.test(startTime) || !timePattern.test(endTime) || endTime <= startTime) throw invalid();
    const note = cell('note');
    sessions.push({ clubId, date, startTime, endTime, ...(note ? { note } : {}) });
  }

  sessions.sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
  return { sessions, updatedAt: new Date().toISOString() };
}
