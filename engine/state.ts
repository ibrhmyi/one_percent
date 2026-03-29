import type { BrainMessage, WatchedMarket, Trade, Skill, AccountState, CycleLog, EngineState } from '@/lib/types';

// Singleton in-memory state — all engine components read/write here
export const engineState: EngineState = {
  messages: [],
  watchedMarkets: [],
  trades: [],
  skills: [],
  account: {
    bankroll: Number(process.env.BANKROLL) || 10000,
    pnlToday: 0,
    pnlTotal: 0,
    openPositions: 0,
    mode: process.env.DRY_RUN === 'false' ? 'live' : 'dry_run',
    polymarketId: process.env.POLYMARKET_ADDRESS || '0x...',
  },
  isRunning: false,
  lastCycleAt: null,
  focusedMarketId: null,
  cycleLogs: [],
};

let messageIdCounter = 0;

// Price history for sparklines — keyed by market ID, stores last 60 YES prices
const marketPriceHistory: Map<string, number[]> = new Map();
const MAX_PRICE_HISTORY = 60;

/** Record a price snapshot for sparkline display */
export function recordPrice(marketId: string, yesPrice: number) {
  const history = marketPriceHistory.get(marketId) ?? [];
  history.push(yesPrice);
  if (history.length > MAX_PRICE_HISTORY) history.shift();
  marketPriceHistory.set(marketId, history);
}

/** Get price history for a market */
export function getPriceHistory(marketId: string): number[] {
  return marketPriceHistory.get(marketId) ?? [];
}

export function addMessage(msg: Omit<BrainMessage, 'id' | 'timestamp'>) {
  const message: BrainMessage = {
    id: String(++messageIdCounter),
    timestamp: new Date().toISOString(),
    ...msg,
  };
  engineState.messages.push(message);
  // Keep last 100 messages
  if (engineState.messages.length > 100) {
    engineState.messages = engineState.messages.slice(-100);
  }
}

export function addCycleLog(log: CycleLog) {
  engineState.cycleLogs.push(log);
  // Keep last 500 logs in memory (sufficient for 30 min of Live Scores)
  if (engineState.cycleLogs.length > 500) {
    engineState.cycleLogs = engineState.cycleLogs.slice(-500);
  }
}

export function getOpenTrade(): Trade | undefined {
  return engineState.trades.find(t => t.status === 'open');
}

export function updateAccount() {
  const openTrades = engineState.trades.filter(t => t.status === 'open');
  engineState.account.openPositions = openTrades.length;

  const closedToday = engineState.trades.filter(t => {
    if (t.status !== 'closed' || !t.exitedAt) return false;
    const exitDate = new Date(t.exitedAt).toDateString();
    return exitDate === new Date().toDateString();
  });
  engineState.account.pnlToday = closedToday.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
  engineState.account.pnlTotal = engineState.trades
    .filter(t => t.status === 'closed')
    .reduce((sum, t) => sum + (t.pnl ?? 0), 0);
}
