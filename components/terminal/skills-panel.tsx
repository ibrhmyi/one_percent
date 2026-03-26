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
    // 'paused' = user turned off. Anything else = user turned on (set to 'active', skill self-manages idle/active)
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
        const operationalLabel = skill.status === 'active' ? 'LIVE' : skill.status === 'idle' ? 'WAITING' : null;
        const winRate = skill.stats.trades > 0
          ? ((skill.stats.wins / skill.stats.trades) * 100).toFixed(0)
          : null;

        return (
          <div key={skill.id} style={{
            display: 'flex', flexDirection: 'column', gap: 4,
            padding: '8px 0',
            borderBottom: '1px solid var(--border-default)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                <span style={{ fontSize: '0.9rem' }}>{skill.icon}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: 6 }}>
                    {skill.name}
                    {isOn && operationalLabel && (
                      <span style={{
                        fontSize: '0.55rem', padding: '1px 5px', borderRadius: 2,
                        background: operationalLabel === 'LIVE' ? 'rgba(34,197,94,0.15)' : 'rgba(100,116,139,0.15)',
                        color: operationalLabel === 'LIVE' ? 'var(--green)' : 'var(--text-dim)',
                        border: `1px solid ${operationalLabel === 'LIVE' ? 'rgba(34,197,94,0.3)' : 'var(--border-default)'}`,
                      }}>{operationalLabel}</span>
                    )}
                  </div>
                  <div style={{ fontSize: '0.6rem', color: 'var(--text-dim)' }}>{skill.category} · {skill.pollIntervalMs}ms</div>
                </div>
              </div>

              {/* ON/OFF toggle */}
              <button
                onClick={() => toggle(skill)}
                disabled={pending === skill.id}
                style={{
                  flexShrink: 0,
                  width: 42, height: 22,
                  borderRadius: 11,
                  border: `1px solid ${isOn ? 'rgba(34,197,94,0.5)' : 'var(--border-accent)'}`,
                  background: isOn ? 'rgba(34,197,94,0.15)' : 'var(--bg-hover)',
                  cursor: pending === skill.id ? 'default' : 'pointer',
                  opacity: pending === skill.id ? 0.5 : 1,
                  position: 'relative',
                  transition: 'all 0.2s',
                  padding: 0,
                }}
                title={isOn ? 'Click to pause skill' : 'Click to activate skill'}
              >
                {/* Track label */}
                <span style={{
                  position: 'absolute', top: '50%', transform: 'translateY(-50%)',
                  fontSize: '0.5rem', fontWeight: 700, letterSpacing: '0.04em',
                  color: isOn ? 'var(--green)' : 'var(--text-dim)',
                  left: isOn ? 4 : 'auto', right: isOn ? 'auto' : 4,
                  fontFamily: 'var(--font-mono)',
                }}>
                  {pending === skill.id ? '…' : isOn ? 'ON' : 'OFF'}
                </span>
                {/* Knob */}
                <span style={{
                  position: 'absolute', top: 2, width: 16, height: 16, borderRadius: '50%',
                  background: isOn ? 'var(--green)' : 'var(--text-dim)',
                  transition: 'left 0.2s, background 0.2s',
                  left: isOn ? 22 : 2,
                }} />
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
