import { appendFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * DATA LOGGER — Appends score events, price snapshots, and trade records to JSONL files.
 *
 * JSONL (one JSON object per line) with appendFileSync — never reads back files.
 * This prevents the midnight crash caused by JSON.parse on a 34MB file.
 *
 * Files created per day in research/data/:
 *   YYYY-MM-DD_scores.jsonl        — every scoring event + market price at detection
 *   YYYY-MM-DD_reactions.jsonl     — price snapshots at +5/10/20/30/40s after events
 *   YYYY-MM-DD_fouls.jsonl         — foul and free throw events with prices
 *   YYYY-MM-DD_trades.jsonl        — trade entries and exits with P&L
 */

const DATA_DIR = join(process.cwd(), 'research', 'data');

export interface ScoreEvent {
  timestamp: string;
  gameId: string;
  game: string;
  scoringTeam: string;
  points: number;
  homeScore: number;
  awayScore: number;
  period: number;
  clock: string;
  secsLeft: number;
  scoringTeamPrice: number;
  yesPrice: number;
  noPrice: number;
  informationValue: number;
  fairPriceAfter: number;
  tradingCost: number;
  netProfit: number;
  tradeable: boolean;
  sizing: number;
  league?: string;
}

export interface PriceSnapshot {
  timestamp: string;
  gameId: string;
  game: string;
  yesPrice: number;
  noPrice: number;
  homeScore: number;
  awayScore: number;
  period: number;
  clock: string;
  secsLeft: number;
  trigger: 'score' | 'foul' | 'periodic';
  offsetMs: number; // 0 = at event time, 5000 = 5s after, etc.
}

export interface FoulEvent {
  timestamp: string;
  gameId: string;
  game: string;
  playId: string;
  type: string;
  description: string;
  teamId: string;
  period: number;
  clock: string;
  secsLeft: number;
  homeScore: number;
  awayScore: number;
  yesPrice: number;
  noPrice: number;
  isCrunchTime: boolean;
  league?: string;
}

export interface TradeRecord {
  timestamp: string;
  gameId: string;
  game: string;
  action: 'entry' | 'exit';
  side: 'yes' | 'no';
  team: string;
  price: number;
  size: number;
  informationValue: number;
  netProfitExpected: number;
  exitPrice: number | null;
  pnl: number | null;
  holdTimeMs: number | null;
}

function ensureDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function getDateStr(): string {
  return new Date().toISOString().substring(0, 10);
}

function appendLine(filename: string, record: unknown): void {
  ensureDir();
  appendFileSync(join(DATA_DIR, filename), JSON.stringify(record) + '\n');
}

export function logScoreEvent(event: ScoreEvent): void {
  appendLine(`${getDateStr()}_scores.jsonl`, event);
}

export function logPriceSnapshot(snapshot: PriceSnapshot): void {
  appendLine(`${getDateStr()}_reactions.jsonl`, snapshot);
}

export function logFoulEvent(event: FoulEvent): void {
  appendLine(`${getDateStr()}_fouls.jsonl`, event);
}

export function logTrade(record: TradeRecord): void {
  appendLine(`${getDateStr()}_trades.jsonl`, record);
}

/** No-op: all writes are synchronous (appendFileSync), nothing to flush. */
export function flush(): void {}

/**
 * Schedules price snapshots at +5s, +10s, +20s, +30s, +40s after a scoring or foul event.
 * getPrices() is called at each future time point — reads live market state via closure.
 */
export function scheduleReactionSnapshots(
  context: {
    gameId: string;
    game: string;
    trigger: 'score' | 'foul';
    period: number;
    clock: string;
    secsLeft: number;
    homeScore: number;
    awayScore: number;
  },
  getPrices: () => { yesPrice: number; noPrice: number }
): void {
  const offsets = [5000, 10000, 20000, 30000, 40000];
  for (const ms of offsets) {
    setTimeout(() => {
      try {
        const prices = getPrices();
        appendLine(`${getDateStr()}_reactions.jsonl`, {
          timestamp: new Date().toISOString(),
          gameId: context.gameId,
          game: context.game,
          trigger: context.trigger,
          offsetMs: ms,
          period: context.period,
          clock: context.clock,
          secsLeft: context.secsLeft,
          homeScore: context.homeScore,
          awayScore: context.awayScore,
          yesPrice: prices.yesPrice,
          noPrice: prices.noPrice
        });
      } catch {
        // ignore — best effort logging
      }
    }, ms);
  }
}
