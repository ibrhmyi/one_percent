import { engineState } from '@/engine/state';
import { getSkills } from '@/engine/skill-registry';
import { startBrain } from '@/engine/brain';

export const dynamic = 'force-dynamic';

export async function PATCH(req: Request) {
  startBrain();
  const { id, status } = await req.json() as { id: string; status: string };

  // Update BOTH the display copy AND the actual skill instance
  const displaySkill = engineState.skills.find(s => s.id === id);
  const actualSkill = getSkills().find(s => s.id === id);

  if (!displaySkill && !actualSkill) {
    return Response.json({ error: 'not found' }, { status: 404 });
  }

  const newStatus = status as 'active' | 'idle' | 'error' | 'paused';
  if (displaySkill) displaySkill.status = newStatus;
  if (actualSkill) actualSkill.status = newStatus;

  return Response.json({ ok: true, id, status: newStatus });
}
