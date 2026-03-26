'use client';
import { useState, useEffect } from 'react';

interface GameEntry {
  espnGameId: string;
  homeTeam: string;
  awayTeam: string;
  status: string;
  startTime: string;
  homeScore?: number;
  awayScore?: number;
  period?: string;
  clock?: string;
  hasPolymarketMatch: boolean;
}
interface Props { games: GameEntry[]; }

function useNow() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  return now;
}

function formatCountdown(startTime: string, now: number) {
  if (!startTime) return '—';
  const diff = Math.floor((new Date(startTime).getTime() - now) / 1000);
  if (diff <= 0) return 'Starting';
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2,'0')}s`;
  return `${s}s`;
}

export function GameSchedule({ games }: Props) {
  const now = useNow();
  return (
    <div className="panel">
      <div className="panel-header">Game Schedule</div>
      {games.length === 0 ? (
        <div style={{ color: 'var(--text-dim)', fontSize: '0.7rem' }}>No games found</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {games.map(g => {
            const isLive = g.status === 'live';
            return (
              <div key={g.espnGameId} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '4px 0',
                borderBottom: '1px solid var(--border-default)',
                fontSize: '0.7rem',
              }}>
                <div style={{ flex: 1 }}>
                  <span style={{ color: 'var(--text-secondary)' }}>{g.awayTeam}</span>
                  <span style={{ color: 'var(--text-dim)', margin: '0 4px' }}>@</span>
                  <span style={{ color: 'var(--text-secondary)' }}>{g.homeTeam}</span>
                  {isLive && g.awayScore !== undefined && (
                    <span style={{ color: 'var(--text-primary)', marginLeft: 6, fontWeight: 600 }}>
                      {g.awayScore}–{g.homeScore} <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>{g.period} {g.clock}</span>
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {g.hasPolymarketMatch && (
                    <span style={{ color: 'var(--cyan)', fontSize: '0.6rem' }}>PM</span>
                  )}
                  {isLive ? (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span className="pulse-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', display: 'inline-block' }} />
                      <span style={{ color: 'var(--green)', fontWeight: 600, fontSize: '0.65rem' }}>LIVE</span>
                    </span>
                  ) : (
                    <span style={{ color: 'var(--text-dim)', fontSize: '0.65rem' }}>
                      {formatCountdown(g.startTime, now)}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
