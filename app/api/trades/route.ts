import { engineState } from '@/engine/state';
import { startBrain } from '@/engine/brain';

export const dynamic = 'force-dynamic';

export async function GET() {
  startBrain();
  return Response.json({ trades: engineState.trades });
}
