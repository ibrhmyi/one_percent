import "server-only";

import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { BotSignal, BotState, BotTrade } from "@/lib/bot-types";

const botSignalSchema = z.object({
  market_id: z.string(),
  title: z.string(),
  category: z.string().optional(),
  yes_price: z.number(),
  no_price: z.number(),
  spread: z.number(),
  volume: z.number(),
  tradeable: z.boolean(),
  confidence: z.string().optional(),
  resolution_window_min_minutes: z.number().optional(),
  resolution_window_max_minutes: z.number().optional(),
  reason: z.string().optional(),
  url: z.string().optional()
});

const botTradeSchema = z.object({
  id: z.string(),
  market_id: z.string(),
  title: z.string(),
  side: z.literal("NO"),
  entry_price: z.number(),
  target_exit_price: z.number(),
  size: z.number(),
  status: z.enum(["open", "filled", "exit_placed", "closed", "cancelled"]),
  entry_timestamp: z.string(),
  exit_timestamp: z.string().nullable(),
  pnl_percent: z.number(),
  reason: z.string()
});

const botStateSchema = z.object({
  last_run_at: z.string(),
  open_positions: z.number(),
  total_exposure: z.number(),
  dry_run: z.boolean()
});

const signalsSchema = z.array(botSignalSchema);
const tradesSchema = z.array(botTradeSchema);

function defaultState(): BotState {
  return {
    last_run_at: new Date(0).toISOString(),
    open_positions: 0,
    total_exposure: 0,
    dry_run: true
  };
}

function botDataDir() {
  return path.resolve(process.cwd(), "data");
}

function botPaths() {
  const dataDir = botDataDir();

  return {
    signalsPath: path.resolve(dataDir, "signals.json"),
    tradesPath: path.resolve(dataDir, "bot-trades.json"),
    statePath: path.resolve(dataDir, "bot-state.json")
  };
}

async function ensureFile(filePath: string, fallback: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, fallback, "utf8");
  }
}

async function readJsonOrFallback<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function ensureBotStoreFiles() {
  const { signalsPath, tradesPath, statePath } = botPaths();
  await Promise.all([
    ensureFile(signalsPath, "[]\n"),
    ensureFile(tradesPath, "[]\n"),
    ensureFile(statePath, `${JSON.stringify(defaultState(), null, 2)}\n`)
  ]);
}

export async function readBotSignals(): Promise<BotSignal[]> {
  const { signalsPath } = botPaths();
  await ensureFile(signalsPath, "[]\n");

  const parsed = await readJsonOrFallback<unknown>(signalsPath, []);
  const result = signalsSchema.safeParse(parsed);

  if (!result.success) {
    return [];
  }

  return result.data;
}

export async function readBotTrades(): Promise<BotTrade[]> {
  const { tradesPath } = botPaths();
  await ensureFile(tradesPath, "[]\n");

  const parsed = await readJsonOrFallback<unknown>(tradesPath, []);
  const result = tradesSchema.safeParse(parsed);

  if (!result.success) {
    return [];
  }

  return result.data;
}

export async function readBotState(): Promise<BotState> {
  const { statePath } = botPaths();
  const fallback = defaultState();
  await ensureFile(statePath, `${JSON.stringify(fallback, null, 2)}\n`);

  const parsed = await readJsonOrFallback<unknown>(statePath, fallback);
  const result = botStateSchema.safeParse(parsed);

  if (!result.success) {
    return fallback;
  }

  return result.data;
}
