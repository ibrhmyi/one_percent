/**
 * EXIT MANAGER — Monitors open trades and triggers exits based on rules.
 *
 * Two exit modes:
 *
 * 1. LIVE SCORE-REACTIVE trades (nba-live-edge):
 *    Adaptive exits based on game context. The model tells us fair value,
 *    so we exit when the market has absorbed the scoring event.
 *    - Fair value target: exit when price reaches model's fair price
 *    - Trailing stop: protect profits with a dynamic trail
 *    - Time decay: if price hasn't moved in the right direction, cut losses
 *    - Game context: wider stops in volatile crunch time, tighter in Q1-Q3
 *
 * 2. PRE-GAME trades (basketball-edge):
 *    Hold through resolution. Only exit early if edge evaporates.
 *
 * Common exits:
 *   - Settled: market resolves (price hits 99¢+ or 1¢-)
 *   - Orphaned: market removed from watchlist + >48h open
 *
 * Called from: brain.ts (setInterval every 2s)
 */

import type { Trade, WatchedMarket } from '@/lib/types';
import { engineState } from './state';
import { closePosition } from './trade-manager';
import { getFairValue } from './predictions/aggregator';
import { ROUND_TRIP_FEE } from './fees';

// ── Configurable defaults (overridable via env) ──
const EXIT_TIMEOUT_HOURS = Number(process.env.EXIT_TIMEOUT_HOURS) || 24;

// Track price history for stall/trail detection (in-memory)
const priceHistory = new Map<string, { price: number; timestamp: number }[]>();

// Track entry context for adaptive exits
const tradeContext = new Map<string, {
  fairValue: number;       // Model's predicted fair price at entry
  entrySecsRemaining: number;
  entryMargin: number;     // |homeScore - awayScore| at entry
  isCrunchTime: boolean;   // Q4, <5min, margin ≤8
}>();

/**
 * Store game context when a trade is entered (called from trade-manager or brain).
 */
export function setTradeContext(tradeId: string, ctx: {
  fairValue: number;
  secondsRemaining: number;
  margin: number;
}): void {
  tradeContext.set(tradeId, {
    fairValue: ctx.fairValue,
    entrySecsRemaining: ctx.secondsRemaining,
    entryMargin: ctx.margin,
    isCrunchTime: ctx.secondsRemaining <= 300 && ctx.margin <= 8,
  });
}

export async function checkExits(): Promise<void> {
  const openTrades = engineState.trades.filter(t => t.status === 'open');
  if (openTrades.length === 0) return;

  for (const trade of openTrades) {
    const market = engineState.watchedMarkets.find(m => m.id === trade.marketId);

    // ── Auto-close trades on settled/ended markets ──
    if (market) {
      const yesPrice = market.yesPrice;
      if (yesPrice >= 0.99 || yesPrice <= 0.01) {
        const settledPrice = trade.side === 'yes' ? yesPrice : (1 - yesPrice);
        await closePosition(trade, settledPrice, 'settled');
        priceHistory.delete(trade.id);
        tradeContext.delete(trade.id);
        continue;
      }
      // Game finished — wait for settlement
      if ((market as any).gameFinished) {
        trade.currentPrice = trade.side === 'yes' ? market.yesPrice : market.noPrice;
        continue;
      }
    } else {
      // Market no longer in watchedMarkets — hold for resolution
      const enteredAt = new Date(trade.enteredAt).getTime();
      const hoursOpen = (Date.now() - enteredAt) / (1000 * 60 * 60);
      if (hoursOpen > 48) {
        const lastPrice = (trade.currentPrice && trade.currentPrice > 0)
          ? trade.currentPrice
          : trade.entryPrice;
        await closePosition(trade, lastPrice, 'timeout');
        priceHistory.delete(trade.id);
        tradeContext.delete(trade.id);
      }
      continue;
    }

    const currentPrice = getCurrentPrice(trade, market);
    if (currentPrice === null) continue;

    // Update peak price
    if (currentPrice > trade.peakPrice) {
      trade.peakPrice = currentPrice;
    }

    // Track price history
    const history = priceHistory.get(trade.id) ?? [];
    history.push({ price: currentPrice, timestamp: Date.now() });
    const cutoff = Date.now() - 10 * 60 * 1000;
    const trimmed = history.filter(h => h.timestamp > cutoff);
    priceHistory.set(trade.id, trimmed);

    // ── Pre-game trades (basketball-edge): hold through resolution ──
    if (trade.skillId === 'basketball-edge') {
      const titleParts = trade.marketTitle.split(' vs ');
      const homeTeam = titleParts[0]?.trim() || '';
      const awayTeam = titleParts[1]?.trim() || '';
      if (homeTeam && awayTeam) {
        const prediction = getFairValue(homeTeam, awayTeam);
        if (prediction) {
          const fairValue = trade.side === 'yes'
            ? prediction.fairHomeWinProb
            : prediction.fairAwayWinProb;
          const edgeNow = fairValue - currentPrice - ROUND_TRIP_FEE;
          if (edgeNow < -0.02) {
            await closePosition(trade, currentPrice, 'edge_gone' as Trade['exitReason']);
            priceHistory.delete(trade.id);
            tradeContext.delete(trade.id);
          }
        }
      }
      continue;
    }

    // ── Live score-reactive trades: adaptive exit ──
    const exitReason = checkLiveExitConditions(trade, currentPrice, market);
    if (exitReason) {
      await closePosition(trade, currentPrice, exitReason);
      priceHistory.delete(trade.id);
      tradeContext.delete(trade.id);
    }
  }
}

/**
 * Adaptive exit logic for live score-reactive trades.
 *
 * Strategy: we entered because a scoring event should push price to fairValue.
 * Exit when:
 *   1. TARGET: price reaches or exceeds fair value (edge captured)
 *   2. TRAILING STOP: price moved in our favor then reversed
 *   3. STALL: price hasn't moved meaningfully — market didn't react as expected
 *   4. STOP LOSS: price moved against us beyond tolerance
 *   5. TIMEOUT: position open too long
 */
function checkLiveExitConditions(trade: Trade, currentPrice: number, market: WatchedMarket): Trade['exitReason'] | null {
  const ctx = tradeContext.get(trade.id);
  const secsOpen = (Date.now() - new Date(trade.enteredAt).getTime()) / 1000;
  const pnlPct = (currentPrice - trade.entryPrice) / trade.entryPrice;

  // ── Dynamic parameters based on game context ──
  const isCrunch = ctx?.isCrunchTime ?? false;

  // Trailing stop: tighter in calm periods, wider in crunch time
  // Crunch time has larger swings, so give more room
  const trailCents = isCrunch ? 0.05 : 0.03;  // 5¢ vs 3¢

  // Stall timeout: how long to wait for price to move
  // Scoring events should be reflected within 30-60s
  const stallTimeoutSecs = isCrunch ? 90 : 45;

  // Stop loss: max drawdown before cutting
  const stopLossCents = isCrunch ? 0.08 : 0.05; // 8¢ vs 5¢

  // Max hold time for a score-reactive trade
  const maxHoldSecs = isCrunch ? 300 : 120; // 5min vs 2min

  // ── 1. TARGET: fair value reached ──
  if (ctx) {
    // If price has reached at least 80% of the way to fair value, take profit
    const targetPrice = trade.entryPrice + (ctx.fairValue - trade.entryPrice) * 0.8;
    if (currentPrice >= targetPrice && currentPrice > trade.entryPrice) {
      return 'target';
    }
  }

  // ── 2. TRAILING STOP: protect profits ──
  // Only activate after price has moved at least 2¢ in our favor
  if (trade.peakPrice > trade.entryPrice + 0.02) {
    const drawdown = trade.peakPrice - currentPrice;
    if (drawdown >= trailCents) {
      return 'reversal';
    }
  }

  // ── 3. STALL: no meaningful movement ──
  if (secsOpen > stallTimeoutSecs) {
    const history = priceHistory.get(trade.id) ?? [];
    const recentCutoff = Date.now() - stallTimeoutSecs * 1000;
    const recentHistory = history.filter(h => h.timestamp > recentCutoff);
    if (recentHistory.length >= 5) {
      const oldestRecent = recentHistory[0].price;
      const movement = Math.abs(currentPrice - oldestRecent);
      // If price moved less than 1¢ in the stall window, exit
      if (movement < 0.01) {
        return 'stall';
      }
    }
  }

  // ── 4. STOP LOSS: price moved against us ──
  const loss = trade.entryPrice - currentPrice;
  if (loss >= stopLossCents) {
    return 'reversal'; // Using reversal as the exit reason for stop loss
  }

  // ── 5. TIMEOUT: max hold time exceeded ──
  if (secsOpen >= maxHoldSecs) {
    return 'timeout';
  }

  // ── 6. Hard timeout for any trade ──
  const hoursOpen = secsOpen / 3600;
  if (hoursOpen >= EXIT_TIMEOUT_HOURS) {
    return 'timeout';
  }

  return null;
}

function getCurrentPrice(trade: Trade, market: WatchedMarket | undefined): number | null {
  if (!market) return trade.entryPrice;
  return trade.side === 'yes' ? market.yesPrice : market.noPrice;
}
