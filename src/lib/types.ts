export type ClubId = 'chicago' | 'brooklyn' | 'st-pete' | 'tampa' | 'beachside';

export interface Club {
  id: ClubId;
  name: string;
  shortName: string;
  location: string;
  color: string;
}

export interface PlayerStanding {
  id: string;
  displayName: string;
  clubId: ClubId;
  rank: number;
  score?: number;
  completed: boolean;
}

export interface ClubStats {
  clubId: ClubId;
  registered: number;
  completed: number;
}
