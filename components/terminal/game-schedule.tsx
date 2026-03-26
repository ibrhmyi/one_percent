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
  yesPrice?: number;
  noPrice?: number;
  volume?: number;
  spread?: number | null;
  slug?: string;
}
interface Props { games: GameEntry[]; }

function useNow() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function formatCountdown(startTime: string, now: number) {
  if (!startTime) return '—';
  const diff = Math.floor((new Date(startTime).getTime() - now) / 1000);
  if (diff <= 0) return 'Starting';
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function formatVol(v?: number) {
  if (!v) return '—';
  if (v >= 1e6) return `$${(v/1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v/1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

export function GameSchedule({ games }: Props) {
  const now = useNow();

  // Only show games within 24 hours or currently live
  const H24 = 24 * 60 * 60 * 1000;
  const filtered = games.filter(g => {
    if (g.status === 'live') return true;
    if (!g.startTime) return false;
    const diff = new Date(g.startTime).getTime() - now;
    return diff > -4 * 60 * 60 * 1000 && diff < H24;
  });

  return (
    <div className="panel">
      <div className="panel-header">Game Schedule <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>({filtered.length})</span></div>
      {filtered.length === 0 ? (
        <div style={{ color: 'var(--text-dim)', fontSize: '0.7rem' }}>No games in next 24h</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {filtered.map(g => {
            const isLive = g.status === 'live';
            const polyUrl = g.slug ? `https://polymarket.com/event/${g.slug}` : undefined;

            const inner = (
              <div className={polyUrl ? 'schedule-row-link' : ''} style={{
                padding: '8px 6px',
                borderBottom: '1px solid var(--border-default)',
                borderLeft: isLive ? '2px solid var(--green)' : '2px solid transparent',
                background: isLive ? 'rgba(34,197,94,0.04)' : 'transparent',
                cursor: polyUrl ? 'pointer' : 'default',
                transition: 'background 0.15s',
              }}>
                {/* Row 1: teams + status */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <div style={{ fontSize: '0.73rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ color: 'var(--text-secondary)' }}>{g.awayTeam}</span>
                    <span style={{ color: 'var(--text-dim)', margin: '0 1px' }}>@</span>
                    <span style={{ color: 'var(--text-secondary)' }}>{g.homeTeam}</span>
                    {polyUrl && (
                      <span style={{ color: 'var(--text-dim)', fontSize: '0.6rem', opacity: 0.6 }}>↗</span>
                    )}
                    {isLive && g.awayScore !== undefined && (
                      <span style={{ color: 'var(--text-primary)', marginLeft: 8, fontWeight: 700 }}>
                        {g.awayScore}–{g.homeScore}
                        <span style={{ color: 'var(--text-dim)', fontWeight: 400, marginLeft: 5 }}>
                          {g.period} {g.clock}
                        </span>
                      </span>
                    )}
                  </div>
                  <div>
                    {isLive ? (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span className="pulse-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', display: 'inline-block' }} />
                        <span style={{ color: 'var(--green)', fontWeight: 700, fontSize: '0.62rem' }}>LIVE</span>
                      </span>
                    ) : (
                      <span style={{ color: 'var(--text-dim)', fontSize: '0.65rem', fontFamily: 'var(--font-mono)' }}>
                        {formatCountdown(g.startTime, now)}
                      </span>
                    )}
                  </div>
                </div>

                {/* Row 2: price / spread / volume */}
                <div style={{ display: 'flex', gap: 10, fontSize: '0.62rem' }}>
                  {g.yesPrice != null && (
                    <span>
                      <span style={{ color: 'var(--text-dim)' }}>YES </span>
                      <span style={{ color: 'var(--green)', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                        {(g.yesPrice * 100).toFixed(1)}¢
                      </span>
                    </span>
                  )}
                  {g.noPrice != null && (
                    <span>
                      <span style={{ color: 'var(--text-dim)' }}>NO </span>
                      <span style={{ color: 'var(--red)', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                        {(g.noPrice * 100).toFixed(1)}¢
                      </span>
                    </span>
                  )}
                  {g.spread != null && (
                    <span>
                      <span style={{ color: 'var(--text-dim)' }}>SPRD </span>
                      <span style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                        {g.spread.toFixed(1)}¢
                      </span>
                    </span>
                  )}
                  <span style={{ marginLeft: 'auto' }}>
                    <span style={{ color: 'var(--text-dim)' }}>VOL </span>
                    <span style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                      {formatVol(g.volume)}
                    </span>
                  </span>
                </div>
              </div>
            );

            return polyUrl ? (
              <a key={g.espnGameId} href={polyUrl} target="_blank" rel="noopener noreferrer"
                style={{ textDecoration: 'none', display: 'block' }}>
                {inner}
              </a>
            ) : (
              <div key={g.espnGameId}>{inner}</div>
            );
          })}
        </div>
      )}
    </div>
  );
}
