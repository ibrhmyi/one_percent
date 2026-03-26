import { engineState } from '@/engine/state';
import { startBrain } from '@/engine/brain';
import { isPriceFeedConnected } from '@/engine/price-feed';

export const dynamic = 'force-dynamic';

// Module-level tracking (singleton in Next.js server process)
let brainStartedAt = 0;
let cycleCount = 0;
let lastCycleAt = '';
const priceHistory = new Map<string, number[]>();

export async function GET() {
  startBrain();

  // Track uptime
  if (brainStartedAt === 0 && engineState.isRunning) {
    brainStartedAt = Date.now();
  }
  const uptimeSeconds = brainStartedAt ? Math.floor((Date.now() - brainStartedAt) / 1000) : 0;

  // Count cycles by tracking lastCycleAt changes
  if (engineState.lastCycleAt && engineState.lastCycleAt !== lastCycleAt) {
    cycleCount++;
    lastCycleAt = engineState.lastCycleAt;
  }

  // Track price history per market (last 120 data points)
  for (const m of engineState.watchedMarkets) {
    const hist = priceHistory.get(m.id) ?? [];
    hist.push(m.yesPrice);
    if (hist.length > 120) hist.shift();
    priceHistory.set(m.id, hist);
  }

  // Clean up stale entries
  const activeIds = new Set(engineState.watchedMarkets.map(m => m.id));
  for (const id of priceHistory.keys()) {
    if (!activeIds.has(id)) priceHistory.delete(id);
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
      ? 'live'
      : 'scheduled',
    startTime: m.gameStartTime ?? '',
    homeScore: m.gameData?.homeScore,
    awayScore: m.gameData?.awayScore,
    period: m.gameData?.period,
    clock: m.gameData?.clock,
    hasPolymarketMatch: true,
    yesPrice: m.yesPrice,
    noPrice: m.noPrice,
  }));

  // Scoring events from cycleLogs
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

  return Response.json({
    isRunning: engineState.isRunning,
    lastCycleAt: engineState.lastCycleAt,
    wsConnected: isPriceFeedConnected(),
    account: engineState.account,
    watchedMarkets: engineState.watchedMarkets.map(m => ({
      ...m,
      priceHistory: priceHistory.get(m.id) ?? [],
    })),
    trades: engineState.trades,
    messages: engineState.messages.slice(-50),
    skills: engineState.skills.map(s => ({
      id: s.id,
      name: s.name,
      icon: s.icon,
      description: s.description,
      category: s.category,
      status: s.status,
      pollIntervalMs: s.pollIntervalMs,
      stats: s.stats,
    })),
    cycleLogs: engineState.cycleLogs.slice(-200),
    // New fields
    cycleCount,
    uptimeSeconds,
    liveGames: liveMarkets.length,
    totalGames: engineState.watchedMarkets.length,
    scoringEvents,
    gameSchedule,
  });
}
