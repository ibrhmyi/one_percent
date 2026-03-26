// ── The Odds API Response ──

export interface OddsAPIGame {
  id: string;
  sport_key: string;          // 'basketball_nba', 'basketball_ncaab', etc.
  sport_title: string;
  commence_time: string;       // ISO 8601 game start time
  home_team: string;
  away_team: string;
  bookmakers: OddsBookmaker[];
}

export interface OddsBookmaker {
  key: string;                 // 'draftkings', 'fanduel', 'pinnacle', etc.
  title: string;
  last_update: string;
  markets: Array<{
    key: string;               // 'h2h' = moneyline
    outcomes: Array<{
      name: string;            // Team name
      price: number;           // Decimal odds (e.g. 1.65)
    }>;
  }>;
}

// ── Consensus Result ──

export interface BookmakerProb {
  key: string;                 // 'draftkings'
  title: string;               // 'DraftKings'
  homeProb: number;            // Vig-removed probability
  awayProb: number;
}

export interface ConsensusResult {
  homeWinProb: number;         // Weighted average across all books
  awayWinProb: number;
  numBookmakers: number;
  confidence: 'high' | 'medium' | 'low';  // 5+ = high, 3-4 = medium, 1-2 = low
  bookmakers: BookmakerProb[]; // Individual book probabilities (for UI display)
  spread: number;              // Max prob - min prob (disagreement measure)
}

// ── Edge Detection ──

export interface PreGameEdge {
  // Game info
  oddsGameId: string;
  sportKey: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;

  // Sportsbook consensus
  consensus: ConsensusResult;

  // Polymarket market
  conditionId: string;
  yesTokenId: string;
  noTokenId: string;
  yesPrice: number;
  noPrice: number;
  polymarketSpread: number;

  // Computed edge
  side: 'YES' | 'NO';
  fairValue: number;
  marketPrice: number;
  edge: number;
  ev: number;

  // Order parameters
  targetPrice: number;
  kellySize: number;

  // Book depth
  availableLiquidity: number;
  estimatedSlippage: number;
}

// ── Order Tracking ──

export interface PreGameOrder {
  orderId: string;
  conditionId: string;
  tokenId: string;
  side: 'BUY';
  price: number;
  size: number;
  filledSize: number;
  avgFillPrice: number;
  status: 'resting' | 'partially_filled' | 'filled' | 'cancelled';
  strategy: 'pre-game-edge';
  sportKey: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  fairValue: number;
  edge: number;
  createdAt: string;
  updatedAt: string;
}

// ── Watchlist Entry (Amendment 12) ──

export interface WatchlistEntry {
  oddsGameId: string;
  sportKey: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;

  homeFairValue: number;
  awayFairValue: number;
  consensus: ConsensusResult;

  polymarketMatched: boolean;
  polymarketUrl?: string;
  conditionId?: string;
  yesTokenId?: string;
  noTokenId?: string;
  currentYesPrice?: number;
  currentNoPrice?: number;
  homeIsYes?: boolean;

  bestSideEV: number;
  bestSide: 'YES' | 'NO';
  projectedEV: number;

  status: 'waiting_for_market' | 'active_opportunity' | 'position_held' | 'game_started';
}

// ── Allocation Decision (Amendment 12) ──

export interface AllocationDecision {
  action: 'HOLD' | 'ENTER' | 'EXIT' | 'SWITCH';
  reason: string;
  currentPosition?: {
    conditionId: string;
    game: string;
    entryPrice: number;
    currentPrice: number;
    remainingEV: number;
    unrealizedPnL: number;
    size: number;
  };
  targets?: Array<{
    conditionId: string;
    tokenId: string;
    game: string;
    side: 'YES' | 'NO';
    entryPrice: number;
    exitPrice?: number;
    fairValue: number;
    ev: number;
    kellySize: number;
    weight: number;
  }>;
  switchingCost?: number;
  netBenefit?: number;
}
