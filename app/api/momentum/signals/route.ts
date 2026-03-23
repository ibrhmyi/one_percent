import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export interface MomentumSignalRow {
  id: string;
  poly_condition_id: string;
  poly_token_id: string;
  title: string;
  yes_bid: number;
  yes_ask: number;
  velocity: number;
  confidence: "low" | "medium" | "high";
  dry_run: boolean;
  kalshi_ticker: string | null;
  order_placed: boolean;
  order_id: string | null;
  order_error: string | null;
  fired_at: string;
  created_at: string;
}

export interface MomentumSignalsResponse {
  signals: MomentumSignalRow[];
  total: number;
  generatedAt: string;
  supabaseConfigured: boolean;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(Number(searchParams.get("limit") ?? 50), 200);
  const confidence = searchParams.get("confidence"); // low | medium | high | null=all

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    const response: MomentumSignalsResponse = {
      signals: [],
      total: 0,
      generatedAt: new Date().toISOString(),
      supabaseConfigured: false,
    };
    return Response.json(response);
  }

  const supabase = createClient(url, key);

  let query = supabase
    .from("momentum_signals")
    .select("*", { count: "exact" })
    .order("fired_at", { ascending: false })
    .limit(limit);

  if (confidence && ["low", "medium", "high"].includes(confidence)) {
    query = query.eq("confidence", confidence);
  }

  const { data, error, count } = await query;

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const response: MomentumSignalsResponse = {
    signals: (data ?? []) as MomentumSignalRow[],
    total: count ?? 0,
    generatedAt: new Date().toISOString(),
    supabaseConfigured: true,
  };

  return Response.json(response);
}
