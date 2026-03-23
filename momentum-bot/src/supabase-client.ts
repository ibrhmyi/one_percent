import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { MomentumSignal, OrderResult } from './types.js';

let client: SupabaseClient | null = null;

function getClient(): SupabaseClient | null {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    return null;
  }

  client = createClient(url, key);
  return client;
}

export interface PersistedSignal {
  poly_condition_id: string;
  poly_token_id: string;
  title: string;
  yes_bid: number;
  yes_ask: number;
  velocity: number;
  confidence: 'low' | 'medium' | 'high';
  dry_run: boolean;
  kalshi_ticker?: string | null;
  order_placed: boolean;
  order_id?: string | null;
  order_error?: string | null;
  fired_at: string;
}

export async function persistSignal(
  signal: MomentumSignal,
  dryRun: boolean,
  result?: OrderResult,
): Promise<void> {
  const supabase = getClient();
  if (!supabase) {
    return; // Supabase not configured — silently skip
  }

  const record: PersistedSignal = {
    poly_condition_id: signal.polyConditionId,
    poly_token_id: signal.polyTokenId,
    title: signal.title,
    yes_bid: signal.yesBid,
    yes_ask: signal.yesAsk,
    velocity: signal.velocity,
    confidence: signal.confidence,
    dry_run: dryRun,
    kalshi_ticker: result?.kalshiTicker ?? null,
    order_placed: result?.success ?? false,
    order_id: result?.orderId ?? null,
    order_error: result?.errorMessage ?? null,
    fired_at: new Date(signal.timestamp).toISOString(),
  };

  const { error } = await supabase.from('momentum_signals').insert(record);

  if (error) {
    console.error('[supabase] Failed to persist signal:', error.message);
  }
}
