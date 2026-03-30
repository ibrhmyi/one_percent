/**
 * EXIT MANAGER — Monitors open trades and triggers exits based on rules.
 *
 * Exit conditions (checked every 2s):
 *   - Target: price reaches EXIT_TARGET_PRICE (default 92c)
 *   - Reversal: price drops EXIT_REVERSAL_CENTS from peak
 *   - Stall: price moves < 2c over EXIT_STALL_MINUTES
 *   - Timeout: position open > EXIT_TIMEOUT_HOURS
 *   - Settled: market resolves (price hits 99c+ or 1c-)
 *
 * Pre-game trades (basketball-edge) are exempt from live exit rules since
 * they have their own order management. Orphaned trades are closed after 48h.
 *
 * Depends on: state, trade-manager
 * Called from: brain.ts (setInterval every 2s)
 */

import type { Trade, WatchedMarket } from '@/lib/types';
import { engineState } from './state';
import { closePosition } from './trade-manager';

const EXIT_TARGET_PRICE = Number(process.env.EXIT_TARGET_PRICE) || 0.92;
const EXIT_REVERSAL_CENTS = Number(process.env.EXIT_REVERSAL_CENTS) || 10;
const EXIT_STALL_MINUTES = Number(process.env.EXIT_STALL_MINUTES) || 5;
const EXIT_TIMEOUT_HOURS = Number(process.env.EXIT_TIMEOUT_HOURS) || 24;

// Track price history for stall detection (in-memory)
const priceHistory = new Map<string, { price: number; timestamp: number }[]>();

export async function checkExits(): Promise<void> {
  const openTrades = engineState.trades.filter(t => t.status === 'open');
  if (openTrades.length === 0) return;

  for (const trade of openTrades) {
    const market = engineState.watchedMarkets.find(m => m.id === trade.marketId);

    // ── Auto-close trades on settled/ended markets ──
    // Applies to ALL skills including basketball-edge
    if (market) {
      const yesPrice = market.yesPrice;
      // Market settled: price at 99c+ or 1c- means the outcome is decided
      if (yesPrice >= 0.99 || yesPrice <= 0.01) {
        const settledPrice = trade.side === 'yes' ? yesPrice : (1 - yesPrice);
        await closePosition(trade, settledPrice, 'settled');
        priceHistory.delete(trade.id);
        continue;
      }
      // Game finished — DON'T close immediately. Wait for market to settle (99¢+ or 1¢-).
      // Polymarket markets take a few minutes to hours after game end to fully resolve.
      // The settled check above (yesPrice >= 0.99 || <= 0.01) will catch it.
      // Just update the current price for P&L display.
      if ((market as any).gameFinished) {
        trade.currentPrice = trade.side === 'yes' ? market.yesPrice : market.noPrice;
        continue;
      }
    } else {
      // Market no longer in watchedMarkets — DON'T exit immediately.
      // Polymarket markets resolve to $1.00 (YES wins) or $0.00 (YES loses).
      // We should hold through resolution to capture the actual edge.
      // Only close if the trade has been orphaned for >48 hours (safety net).
      const enteredAt = new Date(trade.enteredAt).getTime();
      const hoursOpen = (Date.now() - enteredAt) / (1000 * 60 * 60);
      if (hoursOpen > 48) {
        // Orphaned trade — close at last known price
        const lastPrice = (trade.currentPrice && trade.currentPrice > 0)
          ? trade.currentPrice
          : trade.entryPrice;
        await closePosition(trade, lastPrice, 'timeout');
        priceHistory.delete(trade.id);
      }
      // Otherwise: keep holding — market will resolve to 0 or 1
      continue;
    }

    // Skip remaining exit logic for pre-game trades — they have their own exit timing
    // (the basketball-edge skill cancels orders before game start in detect())
    if (trade.skillId === 'basketball-edge') continue;

    const currentPrice = getCurrentPrice(trade, market);
    if (currentPrice === null) continue;

    // Update peak price
    if (currentPrice > trade.peakPrice) {
      trade.peakPrice = currentPrice;
    }

    // Track price history
    const history = priceHistory.get(trade.id) ?? [];
    history.push({ price: currentPrice, timestamp: Date.now() });
    // Keep last 10 minutes of history (at 2s poll = 300 entries)
    const cutoff = Date.now() - 10 * 60 * 1000;
    const trimmed = history.filter(h => h.timestamp > cutoff);
    priceHistory.set(trade.id, trimmed);

    // Game over — let market resolve (tokens pay $1 or $0)
    if (market?.gameData === null && isGameOver(trade)) {
      // Don't sell — hold for resolution
      continue;
    }

    // Check exit conditions
    const exitReason = checkExitConditions(trade, currentPrice);
    if (exitReason) {
      await closePosition(trade, currentPrice, exitReason);
      priceHistory.delete(trade.id);
    }
  }
}

function getCurrentPrice(trade: Trade, market: WatchedMarket | undefined): number | null {
  if (!market) return trade.entryPrice; // Fallback to entry price if market not found
  return trade.side === 'yes' ? market.yesPrice : market.noPrice;
}

function isGameOver(trade: Trade): boolean {
  const enteredAt = new Date(trade.enteredAt).getTime();
  const hours = (Date.now() - enteredAt) / (1000 * 60 * 60);
  return hours > EXIT_TIMEOUT_HOURS;
}

function checkExitConditions(trade: Trade, currentPrice: number): Trade['exitReason'] | null {
  // Target hit
  if (currentPrice >= EXIT_TARGET_PRICE) return 'target';

  // Reversal: price dropped EXIT_REVERSAL_CENTS from peak
  const reversalThreshold = trade.peakPrice - EXIT_REVERSAL_CENTS / 100;
  if (currentPrice <= reversalThreshold && trade.peakPrice > trade.entryPrice + 0.03) {
    return 'reversal';
  }

  // Stall: price moved < 2 cents in last EXIT_STALL_MINUTES
  const history = priceHistory.get(trade.id) ?? [];
  const stallCutoff = Date.now() - EXIT_STALL_MINUTES * 60 * 1000;
  const recentHistory = history.filter(h => h.timestamp > stallCutoff);
  if (recentHistory.length >= 10) {
    const oldest = recentHistory[0].price;
    const movement = Math.abs(currentPrice - oldest);
    if (movement < 0.02) return 'stall';
  }

  // Timeout
  const enteredAt = new Date(trade.enteredAt).getTime();
  const hoursOpen = (Date.now() - enteredAt) / (1000 * 60 * 60);
  if (hoursOpen >= EXIT_TIMEOUT_HOURS) return 'timeout';

  return null;
}
