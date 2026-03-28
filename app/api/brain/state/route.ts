import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || '';

const supabase = SUPABASE_URL && SUPABASE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_KEY)
  : null;

// On Vercel: read from Supabase (bot writes there from local machine)
// Locally: also read from Supabase (bot writes there too)
// Fallback: start local brain if no Supabase

export async function GET() {
  // Try Supabase first
  if (supabase) {
    const { data, error } = await supabase
      .from('engine_state')
      .select('*')
      .eq('id', 'singleton')
      .single();

    if (!error && data) {
      const uptimeSeconds = data.last_cycle_at
        ? Math.floor((Date.now() - new Date(data.updated_at).getTime()) / 1000)
        : 0;

      return Response.json({
        isRunning: data.is_running,
        lastCycleAt: data.last_cycle_at,
        wsConnected: data.ws_connected,
        account: data.account ?? { bankroll: 400, pnlToday: 0, pnlTotal: 0, openPositions: 0, mode: 'dry_run', polymarketId: '0x...' },
        watchedMarkets: (data.watched_markets ?? []).map((m: any) => ({ ...m, priceHistory: [] })),
        trades: data.trades ?? [],
        messages: data.messages ?? [],
        skills: data.skills ?? [],
        cycleLogs: [],
        cycleCount: data.cycle_count ?? 0,
        uptimeSeconds: uptimeSeconds > 0 ? uptimeSeconds : 0,
        liveGames: data.live_games ?? 0,
        totalGames: data.total_games ?? 0,
        scoringEvents: data.scoring_events ?? [],
        gameSchedule: data.game_schedule ?? [],
        latestMessage: data.latest_message,
        preGameWatchlist: data.pre_game_watchlist ?? [],
        preGameOrders: data.pre_game_orders ?? [],
        preGameSummary: data.pre_game_summary,
      });
    }
  }

  // Fallback: start local brain (for local dev without Supabase)
  const { engineState } = await import('@/engine/state');
  const { startBrain, waitForInitialLoad } = await import('@/engine/brain');
  const { isPriceFeedConnected } = await import('@/engine/price-feed');
  const { getSkill } = await import('@/engine/skill-registry');

  await startBrain();
  await waitForInitialLoad();

  const edgeSkill = getSkill('basketball-edge') as any;
  const preGameInfo = edgeSkill?.getInfo?.()?.preGame ?? null;

  return Response.json({
    isRunning: engineState.isRunning,
    lastCycleAt: engineState.lastCycleAt,
    wsConnected: isPriceFeedConnected(),
    account: engineState.account,
    watchedMarkets: engineState.watchedMarkets,
    trades: engineState.trades,
    messages: engineState.messages.slice(-50),
    skills: engineState.skills.map(s => ({
      id: s.id, name: s.name, icon: s.icon, description: s.description,
      category: s.category, status: s.status, pollIntervalMs: s.pollIntervalMs, stats: s.stats,
    })),
    cycleLogs: [],
    cycleCount: 0,
    uptimeSeconds: 0,
    liveGames: 0,
    totalGames: engineState.watchedMarkets.length,
    scoringEvents: [],
    gameSchedule: [],
    latestMessage: engineState.messages[engineState.messages.length - 1] ?? null,
    preGameWatchlist: preGameInfo?.watchlist ?? [],
    preGameOrders: preGameInfo?.orders ?? [],
    preGameSummary: preGameInfo,
  });
}
