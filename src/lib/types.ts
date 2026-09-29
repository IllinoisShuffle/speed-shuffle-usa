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
  /** The club's own website. */
  website: string;
}

export interface PlayerStanding {
  id: string;
  /** The real name, or a placeholder like "Name withheld" when hidden is true. */
  displayName: string;
  clubId: ClubId;
  rank: number;
  score?: number;
  completed: boolean;
  /** True when this player opted out of being named — still occupies its rank and prize position. */
  hidden?: boolean;
}

export interface ClubStats {
  clubId: ClubId;
  registered: number;
  completed: number;
}
