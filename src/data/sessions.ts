import type { ClubId } from '../lib/types';

export interface Session {
  clubId: ClubId;
  /** ISO date, e.g. "2026-10-07". */
  date: string;
  /** 24h "HH:mm". */
  startTime: string;
  endTime: string;
  note?: string;
}

// Pending content (HANDOFF.md §9, §12): each club maintains its own session
// list in the shared spreadsheet. Empty until a club posts dates.
export const sessions: Session[] = [];
export const sessionsUpdatedAt: string | null = null;
