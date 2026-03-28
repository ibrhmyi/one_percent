import { createClient } from '@supabase/supabase-js';
import { engineState } from './state';
import { isPriceFeedConnected } from './price-feed';
import { getSkill } from './skill-registry';
import type { PreGameEdgeSkill } from './skills/basketball-edge/index';
import { getAllPredictions } from './predictions/aggregator';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';

const supabase = SUPABASE_URL && SUPABASE_SERVICE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  : null;

let cycleCount = 0;
let lastCycleAt = '';
let brainStartedAt = 0;
let lastSyncAt = 0;
const SYNC_INTERVAL_MS = 2000; // Sync every 2 seconds

/**
 * Push current engine state to Supabase.
 * Called from brain cycle. Throttled to every 2 seconds.
 */
export async function syncToSupabase(): Promise<void> {
  if (!supabase) return;

  const now = Date.now();
  if (now - lastSyncAt < SYNC_INTERVAL_MS) return;
  lastSyncAt = now;

  if (brainStartedAt === 0 && engineState.isRunning) {
    brainStartedAt = now;
  }
  const uptimeSeconds = brainStartedAt ? Math.floor((now - brainStartedAt) / 1000) : 0;

  if (engineState.lastCycleAt && engineState.lastCycleAt !== lastCycleAt) {
    cycleCount++;
    lastCycleAt = engineState.lastCycleAt;
  }

  const liveMarkets = engineState.watchedMarkets.filter(m =>
    m.status === 'live' || m.status === 'edge_detected' || m.status === 'position_open'
  );

  // Build game schedule from watched markets
  const gameSchedule = engineState.watchedMarkets.map(m => ({
    espnGameId: m.id,
    homeTeam: m.homeTeam,
    awayTeam: m.awayTeam,
    status: (m.status === 'live' || m.status === 'edge_detected' || m.status === 'position_open')
      ? 'live' : 'scheduled',
    startTime: m.gameStartTime ?? '',
    homeScore: m.gameData?.homeScore,
    awayScore: m.gameData?.awayScore,
    period: m.gameData?.period,
    clock: m.gameData?.clock,
    hasPolymarketMatch: true,
    yesPrice: m.yesPrice,
    noPrice: m.noPrice,
    volume: m.volume,
    spread: m.spread,
    slug: m.slug,
  }));

  const latestMessage = engineState.messages.length > 0
    ? engineState.messages[engineState.messages.length - 1]
    : null;

  const scoringEvents = engineState.cycleLogs.slice(-50).map(log => ({
    timestamp: log.timestamp,
    gameId: log.gameId,
    homeTeam: log.homeTeam,
    awayTeam: log.awayTeam,
    homeScore: log.homeScore,
    awayScore: log.awayScore,
    period: log.period,
    clock: log.clock,
    modelProb: log.modelProbability,
    marketPrice: log.marketPrice,
    edge: log.edge,
    ev: log.ev,
    kellySize: log.kellySize,
    action: log.action,
    reason: log.reason,
  }));

  // Extract pre-game data
  const edgeSkill = getSkill('basketball-edge') as PreGameEdgeSkill | undefined;
  const preGameInfo = edgeSkill && 'getInfo' in edgeSkill ? (edgeSkill.getInfo() as any).preGame : null;

  const account = {
    ...engineState.account,
    openPositions: (preGameInfo?.orders ?? []).filter(
      (o: any) => o.status === 'resting' || o.status === 'filled' || o.status === 'partially_filled'
    ).length + engineState.trades.filter(t => t.status === 'open').length,
  };

  try {
    const { error } = await supabase.from('engine_state').update({
      is_running: engineState.isRunning,
      last_cycle_at: engineState.lastCycleAt,
      cycle_count: cycleCount,
      account,
      watched_markets: engineState.watchedMarkets,
      game_schedule: gameSchedule,
      scoring_events: scoringEvents,
      predictions: getAllPredictions().map(p => ({
        gameKey: p.gameKey,
        homeTeam: p.homeTeam,
        awayTeam: p.awayTeam,
        fairHomeWinProb: p.fairHomeWinProb,
        fairAwayWinProb: p.fairAwayWinProb,
        bpiPrediction: p.bpiPrediction,
        torvikPrediction: p.torvikPrediction,
        booksPrediction: p.booksPrediction,
        weights: p.weights,
        sourcesAvailable: p.sourcesAvailable,
        lastUpdated: p.lastUpdated,
        league: p.league,
      })),
      pre_game_watchlist: preGameInfo?.watchlist ?? [],
      pre_game_orders: preGameInfo?.orders ?? [],
      pre_game_summary: preGameInfo ? {
        restingCount: preGameInfo.restingCount,
        filledCount: preGameInfo.filledCount,
        totalDeployed: preGameInfo.totalDeployed,
        apiRequestsUsed: preGameInfo.apiRequestsUsed,
        apiRequestsBudget: preGameInfo.apiRequestsBudget,
        lastScanAt: preGameInfo.lastScanAt,
        cachedGames: preGameInfo.cachedGames,
      } : null,
      trades: engineState.trades,
      skills: engineState.skills.map(s => ({
        id: s.id, name: s.name, icon: s.icon, description: s.description,
        category: s.category, status: s.status, pollIntervalMs: s.pollIntervalMs, stats: s.stats,
      })),
      messages: engineState.messages.slice(-50),
      latest_message: latestMessage,
      live_games: liveMarkets.length,
      total_games: Math.max(engineState.watchedMarkets.length, preGameInfo?.cachedGames ?? 0),
      ws_connected: isPriceFeedConnected(),
      updated_at: new Date().toISOString(),
    }).eq('id', 'singleton');

    if (error) {
      console.error('[SupabaseSync] Error:', error.message);
    }
  } catch (err) {
    console.error('[SupabaseSync] Failed:', err instanceof Error ? err.message : err);
  }
}

export function isSupabaseConfigured(): boolean {
  return supabase !== null;
}
