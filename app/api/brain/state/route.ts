import { engineState } from '@/engine/state';
import { startBrain } from '@/engine/brain';

export const dynamic = 'force-dynamic';

export async function GET() {
  // Boot engine on first call (singleton guard inside startBrain)
  startBrain();

  return Response.json({
    messages: engineState.messages.slice(-20),
    watchedMarkets: engineState.watchedMarkets,
    trades: engineState.trades,
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
    account: engineState.account,
    isRunning: engineState.isRunning,
    lastCycleAt: engineState.lastCycleAt,
    focusedMarketId: engineState.focusedMarketId,
  });
}
