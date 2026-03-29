import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || '';

const supabase = SUPABASE_URL && SUPABASE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_KEY)
  : null;

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

      // Match predictions with Polymarket markets for the Odds Ranker
      const predictions = data.predictions ?? [];
      const markets = data.watched_markets ?? [];
      const enrichedPredictions = enrichPredictionsWithMarkets(predictions, markets);

      return Response.json({
        isRunning: data.is_running,
        lastCycleAt: data.last_cycle_at,
        wsConnected: data.ws_connected,
        account: data.account ?? { bankroll: 10000, pnlToday: 0, pnlTotal: 0, openPositions: 0, mode: 'dry_run', polymarketId: '0x...' },
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
        predictions: enrichedPredictions,
        preGameWatchlist: data.pre_game_watchlist ?? [],
        preGameOrders: data.pre_game_orders ?? [],
        preGameSummary: data.pre_game_summary,
      });
    }
  }

  // Fallback: start local brain
  const { engineState, getPriceHistory } = await import('@/engine/state');
  const { startBrain, waitForInitialLoad } = await import('@/engine/brain');
  const { isPriceFeedConnected } = await import('@/engine/price-feed');
  const { getSkill } = await import('@/engine/skill-registry');
  const { getAllPredictions } = await import('@/engine/predictions/aggregator');

  await startBrain();
  await waitForInitialLoad();

  const edgeSkill = getSkill('basketball-edge') as any;
  const preGameInfo = edgeSkill?.getInfo?.()?.preGame ?? null;

  const predictions = getAllPredictions();
  const enrichedPredictions = enrichPredictionsWithMarkets(predictions, engineState.watchedMarkets);

  return Response.json({
    isRunning: engineState.isRunning,
    lastCycleAt: engineState.lastCycleAt,
    wsConnected: isPriceFeedConnected(),
    account: engineState.account,
    watchedMarkets: engineState.watchedMarkets.map(m => ({
      ...m,
      priceHistory: getPriceHistory(m.id),
    })),
    trades: engineState.trades,
    messages: engineState.messages.slice(-50),
    skills: engineState.skills.map(s => ({
      id: s.id, name: s.name, icon: s.icon, description: s.description,
      detailedDescription: (s as any).detailedDescription ?? undefined,
      dataSources: (s as any).dataSources ?? undefined,
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
    predictions: enrichedPredictions,
    preGameWatchlist: preGameInfo?.watchlist ?? [],
    preGameOrders: preGameInfo?.orders ?? [],
    preGameSummary: preGameInfo,
  });
}

/** Match predictions with Polymarket markets to show edge */
function enrichPredictionsWithMarkets(predictions: any[], markets: any[]): any[] {
  // Deduplicate predictions — keep the one with more sources
  const deduped: any[] = [];
  const seen = new Set<string>();
  // Sort so multi-source predictions come first
  const sorted = [...predictions].sort((a, b) =>
    (b.sourcesAvailable?.length ?? 0) - (a.sourcesAvailable?.length ?? 0)
  );
  for (const pred of sorted) {
    const teams = [normalize(pred.homeTeam || ''), normalize(pred.awayTeam || '')].sort().join('::');
    const dateKey = pred.gameDate || '';
    const key = `${teams}::${dateKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(pred);
  }

  return deduped.map(pred => {
    // Try to find a matching Polymarket market
    // MUST match: both teams AND same game date (within 1 day tolerance)
    const predDate = pred.gameStartTime ? new Date(pred.gameStartTime).toISOString().slice(0, 10) : '';

    const market = markets.find((m: any) => {
      const mHome = normalize(m.homeTeam || '');
      const mAway = normalize(m.awayTeam || '');
      const pHome = normalize(pred.homeTeam || '');
      const pAway = normalize(pred.awayTeam || '');

      // Check date proximity (must be within 1 day)
      if (predDate && m.gameStartTime) {
        const mDate = new Date(m.gameStartTime).toISOString().slice(0, 10);
        if (predDate !== mDate) {
          // Allow 1 day tolerance for timezone differences
          const predTime = new Date(pred.gameStartTime).getTime();
          const mTime = new Date(m.gameStartTime).getTime();
          if (Math.abs(predTime - mTime) > 36 * 60 * 60 * 1000) return false; // >36h apart = different game
        }
      }

      // Both teams must match (not just one)
      const directMatch = fuzzyMatch(mHome, pHome) && fuzzyMatch(mAway, pAway);
      const reversedMatch = fuzzyMatch(mHome, pAway) && fuzzyMatch(mAway, pHome);
      return directMatch || reversedMatch;
    });

    if (market) {
      // Determine which side is home (YES token = first team in Polymarket title)
      // Polymarket title format: "Team1 vs. Team2" where Team1 = YES
      // We need to determine if pred.homeTeam matches the YES team (first in title)
      const mHome = normalize(market.homeTeam || '');  // Polymarket's "home" = first team = YES
      const pHome = normalize(pred.homeTeam || '');
      // Check if prediction's home team matches Polymarket's YES team
      const homeIsYes = fuzzyMatch(mHome, pHome);

      const yesFair = homeIsYes ? pred.fairHomeWinProb : pred.fairAwayWinProb;
      const noFair = homeIsYes ? pred.fairAwayWinProb : pred.fairHomeWinProb;
      // Skip edge calculation for settled markets or LIVE games
      // Pre-game predictions are meaningless once the game starts
      const isSettled = (market.yesPrice >= 0.95 || market.yesPrice <= 0.05);
      const gameStartTime = market.gameStartTime || market.marketEndTime;
      const isLive = gameStartTime ? new Date(gameStartTime).getTime() < Date.now() : false;
      const skipEdge = isSettled || isLive;
      const yesEdge = skipEdge ? 0 : yesFair - (market.yesPrice || 0.5);
      const noEdge = skipEdge ? 0 : noFair - (market.noPrice || 0.5);

      return {
        ...pred,
        polymarketMatched: true,
        polymarketUrl: market.url || `https://polymarket.com/event/${market.slug}`,
        yesPrice: market.yesPrice,
        noPrice: market.noPrice,
        volume: market.volume,
        spread: market.spread,
        homeIsYes,
        yesEdge,
        noEdge,
        bestEdge: Math.max(yesEdge, noEdge),
        bestSide: yesEdge >= noEdge ? 'YES' : 'NO',
        slug: market.slug,
        gameStartTime: market.gameStartTime || market.marketEndTime || null,
      };
    }

    return {
      ...pred,
      polymarketMatched: false,
      bestEdge: 0,
      bestSide: null,
      gameStartTime: null,
    };
  });
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function lastWord(s: string): string | null {
  const parts = s.split(' ');
  const last = parts[parts.length - 1];
  return last && last.length >= 3 ? last : null;
}

function fuzzyMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  const lastA = lastWord(a);
  const lastB = lastWord(b);
  if (lastA && lastB && lastA.length >= 4 && lastA === lastB) return true;
  return false;
}
