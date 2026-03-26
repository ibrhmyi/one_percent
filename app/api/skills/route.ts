import { engineState } from '@/engine/state';
import { startBrain } from '@/engine/brain';

export const dynamic = 'force-dynamic';

export async function GET() {
  startBrain();
  return Response.json({
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
  });
}
