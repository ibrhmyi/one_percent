/**
 * SKILL REGISTRY — Stores and retrieves registered trading skills.
 *
 * Skills are strategy modules (e.g., basketball live-edge, pre-game edge)
 * that implement the Skill interface. The brain registers skills at boot
 * and queries them each cycle for edge detection.
 *
 * Depends on: state (keeps engineState.skills in sync), @/lib/types
 * Called from: brain.ts (register + query), trade-manager.ts (skill stats)
 */

import type { Skill } from '@/lib/types';
import { engineState } from './state';

const registry = new Map<string, Skill>();

export function registerSkill(skill: Skill) {
  registry.set(skill.id, skill);
  // Keep engineState.skills in sync
  const existing = engineState.skills.findIndex(s => s.id === skill.id);
  if (existing >= 0) {
    engineState.skills[existing] = skill;
  } else {
    engineState.skills.push(skill);
  }
}

export function getSkills(): Skill[] {
  return Array.from(registry.values());
}

export function getSkill(id: string): Skill | undefined {
  return registry.get(id);
}
