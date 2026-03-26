'use client';

import type { SkillInfo } from '@/lib/types';
import { SkillCard } from './skill-card';

interface Props {
  skills: SkillInfo[];
}

export function SkillsPanel({ skills }: Props) {
  if (skills.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-slate-600">
        <p className="text-sm font-mono">No skills registered yet...</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {skills.map(skill => (
        <SkillCard key={skill.id} skill={skill} />
      ))}
    </div>
  );
}
