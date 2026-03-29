'use client';
import { useState, useRef } from 'react';

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
  // Track local overrides so toggle is instant and doesn't flicker on poll
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const pendingRef = useRef<Set<string>>(new Set());

  function getStatus(skill: Skill): string {
    return overrides[skill.id] ?? skill.status;
  }

  async function toggle(skill: Skill) {
    const current = getStatus(skill);
    const next = current === 'paused' ? 'active' : 'paused';

    // Instant local update
    setOverrides(prev => ({ ...prev, [skill.id]: next }));
    pendingRef.current.add(skill.id);

    try {
      await fetch('/api/brain/skills', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: skill.id, status: next }),
      });
    } finally {
      // Keep the override until the server catches up (next poll will match)
      pendingRef.current.delete(skill.id);
      // Clear override after 3 seconds (server should have caught up by then)
      setTimeout(() => {
        setOverrides(prev => {
          const copy = { ...prev };
          delete copy[skill.id];
          return copy;
        });
      }, 3000);
    }
  }

  return (
    <div className="panel">
      <div className="panel-header">Skills</div>
      {skills.length === 0 ? (
        <div style={{ color: 'var(--text-dim)', fontSize: '0.7rem' }}>No skills loaded</div>
      ) : skills.map(skill => {
        const effectiveStatus = getStatus(skill);
        const isOn = effectiveStatus !== 'paused';
        const winRate = skill.stats.trades > 0
          ? ((skill.stats.wins / skill.stats.trades) * 100).toFixed(0)
          : null;

        return (
          <div key={skill.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border-default)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 5 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                {skill.icon && <span style={{ fontSize: '0.9rem', flexShrink: 0 }}>{skill.icon}</span>}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {skill.name}
                  </div>
                  <div style={{ fontSize: '0.6rem', color: 'var(--text-dim)' }}>
                    {skill.category} · {skill.pollIntervalMs >= 1000 ? `${skill.pollIntervalMs / 1000}s` : `${skill.pollIntervalMs}ms`}
                  </div>
                </div>
              </div>

              <button
                onClick={() => toggle(skill)}
                title={isOn ? 'Click to disable' : 'Click to enable'}
                style={{
                  flexShrink: 0,
                  position: 'relative',
                  width: 72,
                  height: 24,
                  borderRadius: 3,
                  border: `1px solid ${isOn ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.35)'}`,
                  background: isOn ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
                  cursor: 'pointer',
                  overflow: 'hidden',
                  padding: 0,
                  transition: 'border-color 0.2s, background 0.2s',
                }}
              >
                <span style={{
                  position: 'absolute',
                  top: 2, bottom: 2,
                  width: '50%',
                  borderRadius: 2,
                  background: isOn ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.22)',
                  left: isOn ? 'calc(50% - 2px)' : '2px',
                  transition: 'left 0.22s cubic-bezier(.4,0,.2,1), background 0.2s',
                }} />
                <span style={{
                  position: 'absolute', inset: 0,
                  display: 'flex', alignItems: 'center',
                  fontFamily: 'var(--font-mono)', fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.06em',
                }}>
                  <span style={{
                    flex: 1, textAlign: 'center',
                    color: !isOn ? '#f87171' : 'var(--text-dim)',
                    transition: 'color 0.2s',
                  }}>OFF</span>
                  <span style={{
                    flex: 1, textAlign: 'center',
                    color: isOn ? 'var(--green)' : 'var(--text-dim)',
                    transition: 'color 0.2s',
                  }}>LIVE</span>
                </span>
              </button>
            </div>

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
