import { engineState } from '@/engine/state';

export const dynamic = 'force-dynamic';

export async function PATCH(req: Request) {
  const { id, status } = await req.json() as { id: string; status: string };
  const skill = engineState.skills.find(s => s.id === id);
  if (!skill) return Response.json({ error: 'not found' }, { status: 404 });
  skill.status = status as 'active' | 'idle' | 'error' | 'paused';
  return Response.json({ ok: true, id, status });
}
