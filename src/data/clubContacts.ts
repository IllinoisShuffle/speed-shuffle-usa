import type { ClubId } from '../lib/types';

export interface ClubContact {
  name: string;
  email: string;
}

// Pending content (HANDOFF.md §9, §12): a name + email per club, supplied by
// the clubs before launch. Chicago and Brooklyn are organized directly by
// ILSA/NYSA respectively (see organizedBy in lib/clubs.ts), so those two
// route to the organizer's own contact rather than a club-specific one;
// St. Pete, Tampa, and Beachside are still pending.
export const clubContacts: Partial<Record<ClubId, ClubContact>> = {
  chicago: { name: 'Contact ILSA', email: 'USAspeed@illinoisshuffleboard.org' },
  brooklyn: { name: 'Contact NYSA', email: 'anna@newyorkshuffleboard.org' },
};
