// ============================================================
// OnePercent V1 — Core TypeScript Interfaces
// ============================================================

export interface BrainMessage {
  id: string;
  text: string;
  type: 'info' | 'warning' | 'action' | 'success' | 'idle';
  timestamp: string;
}

export interface AccountState {
  bankroll: number;
  pnlToday: number;
  pnlTotal: number;
  openPositions: number;
  mode: 'dry_run' | 'live';
  polymarketId: string;
}

export interface GameData {
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  period: string;
  clock: string;
  league: string;
}

export interface WatchedMarket {
  id: string;
  conditionId: string;
  title: string;
  homeTeam: string;
  awayTeam: string;
  slug: string;
  yesPrice: number;
  noPrice: number;
  volume: number;
  category: string;
  url: string;
  yesTokenId: string;
  noTokenId: string;
  status: 'upcoming' | 'live' | 'edge_detected' | 'trading' | 'position_open';
  edge: number | null;
  aiEstimate: number | null;
  spread: number | null;           // bid-ask spread in cents from CLOB
  gameData: (GameData & { secondsRemaining?: number }) | null;
  gameStartTime: string | null;    // ISO — actual scheduled game start
  marketEndTime: string | null;    // ISO — market close time from Polymarket
  lastUpdated: string;
}

export interface Opportunity {
  marketId: string;
  tokenId: string;
  title: string;
  side: 'yes' | 'no';
  modelProbability: number;
  marketPrice: number;
  edge: number;
  ev: number;
  fee: number;
  confidence: number;
  skillId: string;
  gameData: GameData & {
    secondsRemaining: number;
  };
}

export interface Trade {
  id: string;
  marketId: string;
  marketTitle: string;
  side: 'yes' | 'no';
  entryPrice: number;
  entryAmount: number;
  exitPrice: number | null;
  exitAmount: number | null;
  pnl: number | null;
  tokens: number;
  skillId: string;
  skillIcon: string;
  enteredAt: string;
  exitedAt: string | null;
  exitReason: 'target' | 'reversal' | 'stall' | 'timeout' | 'game_over' | 'rejected' | null;
  status: 'open' | 'closed';
  peakPrice: number;
  yesTokenId: string;
  noTokenId: string;
  isDryRun: boolean;
}

export interface SkillStats {
  trades: number;
  wins: number;
  losses: number;
  totalPnl: number;
}

export interface SkillInfo {
  id: string;
  name: string;
  icon: string;
  description: string;
  detailedDescription?: string; // Full strategy explanation, shown when expanded
  category: string;
  status: 'active' | 'idle' | 'error' | 'paused';
  pollIntervalMs: number;
  stats: SkillStats;
  dataSources?: string[]; // e.g. ['ESPN BPI', 'DraftKings', 'FanDuel', 'Torvik']
}

export interface Skill extends SkillInfo {
  detect(markets: WatchedMarket[]): Promise<Opportunity[]>;
}

export interface CycleLog {
  timestamp: string;
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  period: string;
  clock: string;
  secondsRemaining: number;
  modelProbability: number;
  marketPrice: number;
  edge: number;
  ev: number;
  fee: number;
  kellySize: number;
  action: 'skip' | 'enter' | 'hold' | 'exit';
  reason: string;
}

export interface EngineState {
  messages: BrainMessage[];
  watchedMarkets: WatchedMarket[];
  trades: Trade[];
  skills: Skill[];
  account: AccountState;
  isRunning: boolean;
  lastCycleAt: string | null;
  focusedMarketId: string | null;
  cycleLogs: CycleLog[];
}

// ESPN API types
export interface ESPNGame {
  id: string;
  name: string;
  homeTeam: string;
  awayTeam: string;
  homeAbbr: string;
  awayAbbr: string;
  homeScore: number;
  awayScore: number;
  period: number;
  clock: string;
  state: 'pre' | 'in' | 'post';
  secondsRemaining: number;
  scheduledStart: string;  // ISO — actual scheduled tip-off time
  league?: string;         // e.g. 'NBA', 'NCAA Basketball'
}
