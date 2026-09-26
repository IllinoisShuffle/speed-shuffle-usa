import type { ClubId } from '../lib/types';

export interface ClubContact {
  name: string;
  email: string;
}

// Pending content (HANDOFF.md §9, §12): a name + email per club, supplied by
// the clubs before launch.
export const clubContacts: Partial<Record<ClubId, ClubContact>> = {};
