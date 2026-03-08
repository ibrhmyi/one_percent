import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { BotState, Signal, Trade, TradeStatus } from "./types";

const SIGNALS_FILE = "signals.json";
const TRADES_FILE = "bot-trades.json";
const STATE_FILE = "bot-state.json";

const ACTIVE_STATUSES: TradeStatus[] = ["open", "filled", "exit_placed"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function resolveDataDir(): string {
  const cwd = process.cwd();
  const localData = path.resolve(cwd, "data");
  if (existsSync(localData)) {
    return localData;
  }
  return path.resolve(cwd, "..", "data");
}

async function ensureFile(filePath: string, fallback: string): Promise<void> {
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  if (!existsSync(filePath)) {
    await writeFile(filePath, fallback, "utf8");
  }
}

async function safeReadJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    console.error(
      `[store] Failed to read/parse ${filePath}. Using fallback.`,
      error,
    );
    return fallback;
  }
}

function sanitizeSignal(value: unknown): Signal | null {
  if (!isRecord(value)) {
    return null;
  }
  const marketId = value.market_id;
  const title = value.title;
  const yesPrice = toNumber(value.yes_price);
  const noPrice = toNumber(value.no_price);
  const spread = toNumber(value.spread);
  const volume = toNumber(value.volume);
  const tradeable = value.tradeable;

  if (
    typeof marketId !== "string" ||
    typeof title !== "string" ||
    yesPrice === null ||
    noPrice === null ||
    spread === null ||
    volume === null ||
    typeof tradeable !== "boolean"
  ) {
    return null;
  }

  return {
    market_id: marketId,
    title,
    category: typeof value.category === "string" ? value.category : undefined,
    yes_price: yesPrice,
    no_price: noPrice,
    spread,
    volume,
    tradeable,
    confidence: typeof value.confidence === "string" ? value.confidence : undefined,
    resolution_window_min_minutes: toNumber(value.resolution_window_min_minutes) ?? undefined,
    resolution_window_max_minutes: toNumber(value.resolution_window_max_minutes) ?? undefined,
    reason: typeof value.reason === "string" ? value.reason : undefined,
    url: typeof value.url === "string" ? value.url : undefined,
  };
}

function isTradeStatus(value: unknown): value is TradeStatus {
  return (
    value === "open" ||
    value === "filled" ||
    value === "exit_placed" ||
    value === "closed" ||
    value === "cancelled"
  );
}

function sanitizeTrade(value: unknown): Trade | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.id !== "string" ||
    typeof value.market_id !== "string" ||
    typeof value.title !== "string" ||
    value.side !== "NO" ||
    toNumber(value.entry_price) === null ||
    toNumber(value.target_exit_price) === null ||
    toNumber(value.size) === null ||
    !isTradeStatus(value.status) ||
    typeof value.entry_timestamp !== "string" ||
    !(
      typeof value.exit_timestamp === "string" || value.exit_timestamp === null
    ) ||
    toNumber(value.pnl_percent) === null ||
    typeof value.reason !== "string"
  ) {
    return null;
  }

  return {
    id: value.id,
    market_id: value.market_id,
    title: value.title,
    side: "NO",
    entry_price: toNumber(value.entry_price) ?? 0,
    target_exit_price: toNumber(value.target_exit_price) ?? 0,
    size: toNumber(value.size) ?? 0,
    status: value.status,
    entry_timestamp: value.entry_timestamp,
    exit_timestamp: value.exit_timestamp,
    pnl_percent: toNumber(value.pnl_percent) ?? 0,
    reason: value.reason,
  };
}

function defaultBotState(): BotState {
  return {
    last_run_at: new Date(0).toISOString(),
    open_positions: 0,
    total_exposure: 0,
    dry_run: process.env.DRY_RUN !== "false",
  };
}

export function getDataPaths(): {
  dataDir: string;
  signalsPath: string;
  tradesPath: string;
  statePath: string;
} {
  const dataDir = resolveDataDir();
  return {
    dataDir,
    signalsPath: path.resolve(dataDir, SIGNALS_FILE),
    tradesPath: path.resolve(dataDir, TRADES_FILE),
    statePath: path.resolve(dataDir, STATE_FILE),
  };
}

export async function ensureStoreFiles(): Promise<void> {
  const paths = getDataPaths();
  await ensureFile(paths.signalsPath, "[]\n");
  await ensureFile(paths.tradesPath, "[]\n");
  await ensureFile(paths.statePath, `${JSON.stringify(defaultBotState(), null, 2)}\n`);
}

export async function readSignals(): Promise<Signal[]> {
  const { signalsPath } = getDataPaths();
  await ensureFile(signalsPath, "[]\n");
  const parsed = await safeReadJson<unknown>(signalsPath, []);
  if (!Array.isArray(parsed)) {
    return [];
  }

  const signals: Signal[] = [];
  for (const item of parsed) {
    const signal = sanitizeSignal(item);
    if (signal) {
      signals.push(signal);
    }
  }
  return signals;
}

export async function readTrades(): Promise<Trade[]> {
  const { tradesPath } = getDataPaths();
  await ensureFile(tradesPath, "[]\n");
  const parsed = await safeReadJson<unknown>(tradesPath, []);
  if (!Array.isArray(parsed)) {
    return [];
  }

  const trades: Trade[] = [];
  for (const item of parsed) {
    const trade = sanitizeTrade(item);
    if (trade) {
      trades.push(trade);
    }
  }
  return trades;
}

export async function writeTrades(trades: Trade[]): Promise<void> {
  const { tradesPath } = getDataPaths();
  await ensureFile(tradesPath, "[]\n");
  await writeFile(tradesPath, `${JSON.stringify(trades, null, 2)}\n`, "utf8");
}

export async function readBotState(): Promise<BotState> {
  const { statePath } = getDataPaths();
  const fallback = defaultBotState();
  await ensureFile(statePath, `${JSON.stringify(fallback, null, 2)}\n`);
  const parsed = await safeReadJson<unknown>(statePath, fallback);
  if (!isRecord(parsed)) {
    return fallback;
  }

  return {
    last_run_at:
      typeof parsed.last_run_at === "string" ? parsed.last_run_at : fallback.last_run_at,
    open_positions:
      toNumber(parsed.open_positions) ?? fallback.open_positions,
    total_exposure:
      toNumber(parsed.total_exposure) ?? fallback.total_exposure,
    dry_run:
      typeof parsed.dry_run === "boolean" ? parsed.dry_run : fallback.dry_run,
  };
}

export async function writeBotState(state: BotState): Promise<void> {
  const { statePath } = getDataPaths();
  await ensureFile(statePath, `${JSON.stringify(defaultBotState(), null, 2)}\n`);
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function summarizeOpenPositions(trades: Trade[]): {
  openPositions: number;
  exposure: number;
} {
  const activeTrades = trades.filter((trade) => ACTIVE_STATUSES.includes(trade.status));
  return {
    openPositions: activeTrades.length,
    exposure: activeTrades.reduce((sum, trade) => sum + trade.size, 0),
  };
}
