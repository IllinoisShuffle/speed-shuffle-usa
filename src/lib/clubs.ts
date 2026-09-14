import type { Club, ClubId } from './types';

export const clubs = [
  { id: 'chicago', name: 'Palms / Chicago', shortName: 'Chicago', location: 'Illinois', color: '#4F46E5' },
  { id: 'brooklyn', name: 'Brooklyn', shortName: 'Brooklyn', location: 'New York', color: '#EC4899' },
  { id: 'st-pete', name: 'St. Pete', shortName: 'St. Pete', location: 'Florida', color: '#10B981' },
  { id: 'tampa', name: 'Tampa', shortName: 'Tampa', location: 'Florida', color: '#F59E0B' },
  { id: 'beachside', name: 'Beachside Social', shortName: 'Beachside Social', location: 'Virginia Beach', color: '#06B6D4' },
] as const satisfies readonly Club[];

export const clubsById = Object.fromEntries(clubs.map(club => [club.id, club])) as Record<ClubId, Club>;
