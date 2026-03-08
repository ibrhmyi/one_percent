import { Signal, Trade } from "./types";

function stamp(): string {
  return new Date().toISOString();
}

export function logCycleStarted(): void {
  console.log(`[${stamp()}] cycle started`);
}

export function logSignalsLoaded(count: number): void {
  console.log(`[${stamp()}] signals loaded: ${count}`);
}

export function logTradeEntered(trade: Trade): void {
  console.log(
    `[${stamp()}] trade entered: ${trade.market_id} NO @ ${trade.entry_price.toFixed(3)} size=${trade.size}`,
  );
}

export function logExitPlaced(trade: Trade): void {
  console.log(
    `[${stamp()}] exit placed: ${trade.market_id} target @ ${trade.target_exit_price.toFixed(3)} (${trade.pnl_percent.toFixed(2)}%)`,
  );
}

export function logSignalSkipped(signal: Signal, reason: string): void {
  console.log(`[${stamp()}] skipped ${signal.market_id}: ${reason}`);
}

export function logCycleError(error: unknown): void {
  console.error(`[${stamp()}] cycle error`, error);
}
