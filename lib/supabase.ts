import { createClient } from "@supabase/supabase-js";
import { appConfig } from "@/lib/config";

const supabaseUrl = appConfig.supabaseUrl;
const supabaseAnonKey = appConfig.supabaseAnonKey;

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

export interface Signal {
  id: string;
  market_id: string;
  title: string;
  yes_price: number | null;
  no_price: number | null;
  spread: number | null;
  volume: number | null;
  resolution_window_min_minutes: number | null;
  resolution_window_max_minutes: number | null;
  confidence: "low" | "medium" | "high" | null;
  tradeable: boolean | null;
  reason: string | null;
  created_at: string;
  updated_at: string;
}

export async function getCachedSignal(marketId: string): Promise<Signal | null> {
  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from("signals")
    .select("*")
    .eq("market_id", marketId)
    .single();

  if (error || !data) {
    return null;
  }

  return data as Signal;
}

export async function upsertSignal(signal: Omit<Signal, "id" | "created_at" | "updated_at">): Promise<Signal | null> {
  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from("signals")
    .upsert({
      market_id: signal.market_id,
      title: signal.title,
      yes_price: signal.yes_price,
      no_price: signal.no_price,
      spread: signal.spread,
      volume: signal.volume,
      resolution_window_min_minutes: signal.resolution_window_min_minutes,
      resolution_window_max_minutes: signal.resolution_window_max_minutes,
      confidence: signal.confidence,
      tradeable: signal.tradeable,
      reason: signal.reason,
      updated_at: new Date().toISOString()
    }, {
      onConflict: "market_id"
    })
    .select()
    .single();

  if (error || !data) {
    console.error("Failed to upsert signal:", error);
    return null;
  }

  return data as Signal;
}

export function isSignalStale(signal: Signal, cacheMinutes: number): boolean {
  const updatedAt = new Date(signal.updated_at).getTime();
  const now = Date.now();
  const cacheAgeMs = cacheMinutes * 60 * 1000;
  return now - updatedAt > cacheAgeMs;
}

export interface BotTradeRecord {
  id: string;
  external_trade_id: string;
  market_id: string;
  title: string;
  side: "NO";
  entry_price: number;
  target_exit_price: number;
  size: number;
  status: "open" | "filled" | "exit_placed" | "closed" | "cancelled";
  entry_timestamp: string;
  exit_timestamp: string | null;
  pnl_percent: number;
  pnl_usd: number;
  reason: string | null;
  source: string | null;
  created_at: string;
  updated_at: string;
}

export async function listBotTrades(limit = 200): Promise<BotTradeRecord[]> {
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from("bot_trades")
    .select("*")
    .order("entry_timestamp", { ascending: false })
    .limit(limit);

  if (error || !data) {
    console.error("Failed to list bot trades:", error);
    return [];
  }

  return data as BotTradeRecord[];
}

export async function upsertBotTrade(
  trade: Omit<BotTradeRecord, "id" | "created_at" | "updated_at">
): Promise<BotTradeRecord | null> {
  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from("bot_trades")
    .upsert(
      {
        external_trade_id: trade.external_trade_id,
        market_id: trade.market_id,
        title: trade.title,
        side: trade.side,
        entry_price: trade.entry_price,
        target_exit_price: trade.target_exit_price,
        size: trade.size,
        status: trade.status,
        entry_timestamp: trade.entry_timestamp,
        exit_timestamp: trade.exit_timestamp,
        pnl_percent: trade.pnl_percent,
        pnl_usd: trade.pnl_usd,
        reason: trade.reason,
        source: trade.source ?? "web-sync",
        updated_at: new Date().toISOString()
      },
      { onConflict: "external_trade_id" }
    )
    .select()
    .single();

  if (error || !data) {
    console.error("Failed to upsert bot trade:", error);
    return null;
  }

  return data as BotTradeRecord;
}
