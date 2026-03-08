import { createSimulatedTrade, placeSimulatedExit } from "./execution";
import {
  logCycleError,
  logCycleStarted,
  logExitPlaced,
  logSignalsLoaded,
  logSignalSkipped,
  logTradeEntered,
} from "./logger";
import {
  ensureStoreFiles,
  readBotState,
  readSignals,
  readTrades,
  summarizeOpenPositions,
  writeBotState,
  writeTrades,
} from "./store";
import { evaluateSignalForEntry } from "./strategy";
import { BotState, Signal, Trade } from "./types";
import { upsertTradeToDatabase } from "./db";

function getDryRun(): boolean {
  return process.env.DRY_RUN !== "false";
}

function getPollIntervalMs(): number {
  const raw = Number(process.env.BOT_POLL_INTERVAL_MS ?? 2000);
  if (!Number.isFinite(raw) || raw < 250) {
    return 2000;
  }
  return raw;
}

function buildState(previous: BotState, trades: Trade[]): BotState {
  const summary = summarizeOpenPositions(trades);
  return {
    ...previous,
    last_run_at: new Date().toISOString(),
    open_positions: summary.openPositions,
    total_exposure: summary.exposure,
    dry_run: getDryRun(),
  };
}

async function processSignal(
  signal: Signal,
  state: BotState,
  trades: Trade[],
): Promise<{ state: BotState; trades: Trade[] }> {
  const decision = evaluateSignalForEntry(signal, state, trades);
  if (!decision.shouldEnter) {
    logSignalSkipped(signal, decision.reason);
    return { state, trades };
  }

  const entered = createSimulatedTrade(signal);
  logTradeEntered(entered);

  const exitPlaced = placeSimulatedExit(entered);
  logExitPlaced(exitPlaced);
  try {
    await upsertTradeToDatabase(exitPlaced);
  } catch (error) {
    console.error("[db] Failed to persist trade. Keeping local write.", error);
  }

  const updatedTrades = [...trades, exitPlaced];
  const updatedState = buildState(state, updatedTrades);
  return { state: updatedState, trades: updatedTrades };
}

async function runCycle(): Promise<void> {
  logCycleStarted();

  let trades = await readTrades();
  let state = await readBotState();
  const signals = await readSignals();

  logSignalsLoaded(signals.length);

  for (const signal of signals) {
    try {
      const result = await processSignal(signal, state, trades);
      state = result.state;
      trades = result.trades;
    } catch (error) {
      logSignalSkipped(signal, `failed to process signal: ${String(error)}`);
    }
  }

  state = buildState(state, trades);
  await writeTrades(trades);
  await writeBotState(state);
}

async function main(): Promise<void> {
  await ensureStoreFiles();

  const pollIntervalMs = getPollIntervalMs();
  let running = false;

  const execute = async (): Promise<void> => {
    if (running) {
      return;
    }
    running = true;
    try {
      await runCycle();
    } catch (error) {
      logCycleError(error);
    } finally {
      running = false;
    }
  };

  await execute();
  setInterval(() => {
    void execute();
  }, pollIntervalMs);
}

void main();
