'use client';
import { useState } from 'react';

interface Skill {
  id: string;
  name: string;
  icon: string;
  description: string;
  category: string;
  status: string;
  pollIntervalMs: number;
  stats: { trades: number; wins: number; losses: number; totalPnl: number };
}
interface Props { skills: Skill[]; }

export function SkillsPanel({ skills }: Props) {
  const [pending, setPending] = useState<string | null>(null);

  async function toggle(skill: Skill) {
    const next = skill.status === 'paused' ? 'active' : 'paused';
    setPending(skill.id);
    try {
      await fetch('/api/brain/skills', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: skill.id, status: next }),
      });
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="panel">
      <div className="panel-header">Skills</div>
      {skills.length === 0 ? (
        <div style={{ color: 'var(--text-dim)', fontSize: '0.7rem' }}>No skills loaded</div>
      ) : skills.map(skill => {
        const isOn = skill.status !== 'paused';
        const winRate = skill.stats.trades > 0
          ? ((skill.stats.wins / skill.stats.trades) * 100).toFixed(0)
          : null;

        return (
          <div key={skill.id} style={{
            padding: '8px 0',
            borderBottom: '1px solid var(--border-default)',
          }}>
            {/* Top row: icon + name + toggle */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 5 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                <span style={{ fontSize: '0.9rem', flexShrink: 0 }}>{skill.icon}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {skill.name}
                  </div>
                  <div style={{ fontSize: '0.6rem', color: 'var(--text-dim)' }}>
                    {skill.category} · {skill.pollIntervalMs}ms
                  </div>
                </div>
              </div>

              {/* Rectangle LIVE / OFF toggle */}
              <button
                onClick={() => toggle(skill)}
                disabled={pending === skill.id}
                style={{
                  flexShrink: 0,
                  padding: '3px 10px',
                  borderRadius: 3,
                  border: 'none',
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 700,
                  fontSize: '0.65rem',
                  letterSpacing: '0.06em',
                  cursor: pending === skill.id ? 'default' : 'pointer',
                  opacity: pending === skill.id ? 0.6 : 1,
                  transition: 'background 0.15s, color 0.15s',
                  background: isOn ? 'rgba(34,197,94,0.18)' : 'rgba(239,68,68,0.15)',
                  color: isOn ? 'var(--green)' : '#f87171',
                  outline: `1px solid ${isOn ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.3)'}`,
                }}
                title={isOn ? 'Click to disable' : 'Click to enable'}
              >
                {pending === skill.id ? '…' : isOn ? 'LIVE' : 'OFF'}
              </button>
            </div>

            {/* Stats row */}
            <div style={{ display: 'flex', gap: 12, fontSize: '0.6rem', color: 'var(--text-dim)', paddingLeft: 2 }}>
              <span>Trades <span style={{ color: 'var(--text-secondary)' }}>{skill.stats.trades}</span></span>
              {winRate && <span>Win <span style={{ color: 'var(--green)' }}>{winRate}%</span></span>}
              <span>P&L <span style={{ color: skill.stats.totalPnl >= 0 ? 'var(--green)' : 'var(--red)' }}>
                {skill.stats.totalPnl >= 0 ? '+' : ''}${skill.stats.totalPnl.toFixed(2)}
              </span></span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
