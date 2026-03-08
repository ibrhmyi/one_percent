import crypto from "node:crypto";
import { Signal, Trade } from "./types";

const ENTRY_PRICE = 0.97;
const TARGET_EXIT_PRICE = 0.9999;

function getPositionSize(): number {
  const maxPositionSize = Number(process.env.MAX_POSITION_SIZE ?? 50);
  return Math.max(1, Math.min(50, maxPositionSize));
}

export function calculatePnLPercent(entryPrice: number, exitPrice: number): number {
  if (entryPrice <= 0) {
    return 0;
  }
  return Number((((exitPrice - entryPrice) / entryPrice) * 100).toFixed(4));
}

export function createSimulatedTrade(signal: Signal): Trade {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    market_id: signal.market_id,
    title: signal.title,
    side: "NO",
    entry_price: ENTRY_PRICE,
    target_exit_price: TARGET_EXIT_PRICE,
    size: getPositionSize(),
    status: "filled",
    entry_timestamp: now,
    exit_timestamp: null,
    pnl_percent: calculatePnLPercent(ENTRY_PRICE, TARGET_EXIT_PRICE),
    reason: signal.reason ?? "near-resolution signal",
  };
}

export function placeSimulatedExit(trade: Trade): Trade {
  return {
    ...trade,
    status: "exit_placed",
    target_exit_price: TARGET_EXIT_PRICE,
    pnl_percent: calculatePnLPercent(trade.entry_price, TARGET_EXIT_PRICE),
  };
}
