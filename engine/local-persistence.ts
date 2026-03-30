/**
 * LOCAL PERSISTENCE — Saves and restores engine state to disk (data/ directory).
 *
 * On startup (loadState): reads bot-state.json to recover bankroll, trades,
 *   and P&L from the last session. Also restores pre-game orders.
 * On each brain cycle (saveState): writes bot-state.json every 30 seconds
 *   and appends new trades to bot-trades.json as a permanent log.
 *
 * Depends on: state, skill-registry
 * Called from: brain.ts (loadState at boot, saveState in cycle)
 */

import fs from 'fs';
import path from 'path';
import { engineState } from './state';
import { getSkill } from './skill-registry';
import type { Trade } from '@/lib/types';

const DATA_DIR = path.join(process.cwd(), 'data');
const STATE_FILE = path.join(DATA_DIR, 'bot-state.json');
const TRADES_FILE = path.join(DATA_DIR, 'bot-trades.json');

let lastSaveAt = 0;
const SAVE_INTERVAL_MS = 30_000; // Save every 30 seconds
let lastTradeCount = 0;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * Load saved state on startup — recovers bankroll, trades, P&L across restarts
 */
export function loadState(): void {
  try {
    ensureDataDir();
    if (!fs.existsSync(STATE_FILE)) return;

    const raw = fs.readFileSync(STATE_FILE, 'utf-8');
    const saved = JSON.parse(raw);

    if (saved.bankroll && saved.bankroll > 0) {
      engineState.account.bankroll = saved.bankroll;
      engineState.account.pnlTotal = saved.pnlTotal ?? 0;
      engineState.account.pnlToday = saved.pnlToday ?? 0;
      console.log(`[Persistence] Restored bankroll: $${saved.bankroll.toLocaleString()}, P&L: $${saved.pnlTotal?.toFixed(2) ?? '0.00'}`);
    }

    if (saved.trades && Array.isArray(saved.trades)) {
      engineState.trades = saved.trades;
      lastTradeCount = saved.trades.length;
      console.log(`[Persistence] Restored ${saved.trades.length} trades`);
    }

    // Restore pre-game orders into the skill
    if (saved.preGameOrders && Array.isArray(saved.preGameOrders)) {
      // These will be loaded by the skill on startup
      (globalThis as any).__savedPreGameOrders = saved.preGameOrders;
      console.log(`[Persistence] Saved ${saved.preGameOrders.length} pre-game orders for skill restore`);
    }
  } catch (err) {
    console.error('[Persistence] Failed to load state:', err);
  }
}

/**
 * Save state periodically — called from brain cycle
 */
export function saveState(): void {
  const now = Date.now();
  if (now - lastSaveAt < SAVE_INTERVAL_MS) return;
  lastSaveAt = now;

  try {
    ensureDataDir();

    const edgeSkill = getSkill('basketball-edge') as any;
    const preGameInfo = edgeSkill?.getInfo?.()?.preGame ?? null;

    const state = {
      bankroll: engineState.account.bankroll,
      pnlTotal: engineState.account.pnlTotal,
      pnlToday: engineState.account.pnlToday,
      trades: engineState.trades,
      preGameOrders: preGameInfo?.orders ?? [],
      savedAt: new Date().toISOString(),
    };

    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

    // Append new trades to the permanent trade log
    if (engineState.trades.length > lastTradeCount) {
      appendNewTrades(engineState.trades.slice(lastTradeCount));
      lastTradeCount = engineState.trades.length;
    }
  } catch (err) {
    console.error('[Persistence] Failed to save state:', err);
  }
}

/**
 * Append closed/new trades to the permanent log file
 */
function appendNewTrades(newTrades: Trade[]): void {
  try {
    let existing: any[] = [];
    if (fs.existsSync(TRADES_FILE)) {
      const raw = fs.readFileSync(TRADES_FILE, 'utf-8');
      existing = JSON.parse(raw);
      if (!Array.isArray(existing)) existing = [];
    }

    for (const t of newTrades) {
      existing.push({
        id: t.id,
        marketTitle: t.marketTitle,
        side: t.side,
        entryPrice: t.entryPrice,
        exitPrice: t.exitPrice,
        entryAmount: t.entryAmount,
        exitAmount: t.exitAmount,
        tokens: t.tokens,
        pnl: t.pnl,
        status: t.status,
        skillId: t.skillId,
        enteredAt: t.enteredAt,
        exitedAt: t.exitedAt,
        exitReason: t.exitReason,
        isDryRun: t.isDryRun,
      });
    }

    fs.writeFileSync(TRADES_FILE, JSON.stringify(existing, null, 2));
  } catch (err) {
    console.error('[Persistence] Failed to append trades:', err);
  }
}
