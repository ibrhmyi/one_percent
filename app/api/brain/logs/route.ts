import { engineState } from '@/engine/state';
import { startBrain } from '@/engine/brain';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  startBrain();
  const { searchParams } = new URL(req.url);
  const limit = Number(searchParams.get('limit') ?? 500);

  const logs = engineState.cycleLogs.slice(-limit);
  return Response.json({ logs, total: engineState.cycleLogs.length });
}
