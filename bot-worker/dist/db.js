"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.upsertTradeToDatabase = upsertTradeToDatabase;
function getSupabaseConfig() {
    const supabaseUrl = process.env.SUPABASE_URL ?? "";
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY ?? "";
    if (!supabaseUrl || !supabaseAnonKey) {
        return null;
    }
    return { supabaseUrl, supabaseAnonKey };
}
function tradePnlUsd(trade) {
    return Number((trade.size * (trade.pnl_percent / 100)).toFixed(4));
}
async function upsertTradeToDatabase(trade) {
    const config = getSupabaseConfig();
    if (!config) {
        return;
    }
    const url = `${config.supabaseUrl.replace(/\/$/, "")}/rest/v1/bot_trades?on_conflict=external_trade_id`;
    const payload = {
        external_trade_id: trade.id,
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
        pnl_usd: tradePnlUsd(trade),
        reason: trade.reason,
        updated_at: new Date().toISOString()
    };
    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            apikey: config.supabaseAnonKey,
            Authorization: `Bearer ${config.supabaseAnonKey}`,
            Prefer: "resolution=merge-duplicates,return=minimal"
        },
        body: JSON.stringify(payload)
    });
    if (!response.ok) {
        const message = await response.text();
        throw new Error(`Supabase trade upsert failed (${response.status}): ${message}`);
    }
}
