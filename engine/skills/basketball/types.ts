// Basketball skill types — shared across leagues

export interface ModelParams {
  K: number;         // logistic coefficient
  TIME_SCALE: number; // time scaling factor
  QUARTER_SECONDS: number; // seconds per regulation period
  TOTAL_PERIODS: number;   // regulation periods (4 for NBA/NCAA)
}

export interface LeagueConfig {
  id: string;           // e.g. 'nba', 'ncaab'
  name: string;         // e.g. 'NBA', 'NCAA Basketball'
  sportPath: string;    // ESPN API path: 'basketball/nba', 'basketball/mens-college-basketball'
  modelParams: ModelParams;
  teams: Record<string, string[]>; // canonical name -> aliases
  marketTag: string;    // Polymarket tag_slug: 'nba', 'ncaa-basketball'
  gameSlugPrefix: string; // e.g. 'nba-', 'ncaab-'
}

export interface ESPNPlay {
  id: string;
  type: string;        // e.g. 'Personal Foul', 'Flagrant Foul', 'Free Throw'
  description: string;
  teamId: string;
  period: number;
  clock: string;
  homeScore: number;
  awayScore: number;
}

export interface LeagueStats {
  league: string;
  liveGames: number;
  upcomingGames: number;
  matchedMarkets: number;
  lastScoringEvent: string | null;
}
