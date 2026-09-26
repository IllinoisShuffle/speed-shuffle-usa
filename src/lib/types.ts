export type ClubId = 'chicago' | 'brooklyn' | 'st-pete' | 'tampa' | 'beachside';
export type OrganizerId = 'ILSA' | 'NYSA';
export type PanelPattern = 'vertical' | 'horizontal' | 'diagonal' | 'none';

export interface Club {
  id: ClubId;
  /** Official name — used in headings, cards and the directory. */
  name: string;
  /** Short name — tables, filters and standings only, shown in a colored pill. */
  shortName: string;
  /** Always "City, ST". */
  location: string;
  organizedBy: OrganizerId | null;
  logoPanelBg: string;
  panelPattern: PanelPattern;
  stripeColor: string;
  /** Pill/bar background (leaderboard, filters, standings, progress bars). */
  accentColor: string;
  /** Text color on top of accentColor. */
  labelTextColor: string;
  /** Filename under /club-logos/. */
  logoFile: string;
  logoHeightDesktop: number;
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
