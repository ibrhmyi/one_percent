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

// ── Shared terminal text sizes ──
const TITLE_SIZE = '0.7rem';
const DATA_SIZE = '0.55rem';
const BADGE_SIZE = '0.45rem';
const DIM = 'rgba(255,255,255,0.3)';

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
  const d = Math.floor(diff / 86400);
  const h = Math.floor((diff % 86400) / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function formatVol(v?: number) {
  if (!v) return '$0';
  if (v >= 1e6) return `$${(v/1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v/1e3).toFixed(0)}k`;
  return `$${v.toFixed(0)}`;
}

export function GameSchedule({ games }: Props) {
  const now = useNow();

  const H24 = 24 * 60 * 60 * 1000;
  const filtered = games.filter(g => {
    if (g.status === 'live') return true;
    if (!g.startTime) return false;
    const diff = new Date(g.startTime).getTime() - now;
    return diff > -4 * 60 * 60 * 1000 && diff < H24;
  }).sort((a, b) => {
    if (a.status === 'live' && b.status !== 'live') return -1;
    if (b.status === 'live' && a.status !== 'live') return 1;
    const aTime = a.startTime ? new Date(a.startTime).getTime() : Infinity;
    const bTime = b.startTime ? new Date(b.startTime).getTime() : Infinity;
    return aTime - bTime;
  });

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header">Today&apos;s Game Schedule <span style={{ color: DIM, fontWeight: 400 }}>{filtered.length} games</span></div>
      {filtered.length === 0 ? (
        <div style={{ color: DIM, fontSize: DATA_SIZE, flex: 1, padding: 12 }}>No games in next 24h</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1, minHeight: 0, overflowY: 'auto' }}>
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
                {/* Row 1: teams + countdown */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <div style={{ fontSize: TITLE_SIZE, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ color: 'rgba(255,255,255,0.9)' }}>{g.awayTeam}</span>
                    <span style={{ color: DIM, fontSize: DATA_SIZE }}>vs</span>
                    <span style={{ color: 'rgba(255,255,255,0.9)' }}>{g.homeTeam}</span>
                    {isLive && g.awayScore !== undefined && (
                      <span style={{ color: 'var(--text-primary)', marginLeft: 8, fontWeight: 700 }}>
                        {g.awayScore}–{g.homeScore}
                        <span style={{ color: DIM, fontWeight: 400, marginLeft: 5, fontSize: DATA_SIZE }}>
                          {g.period} {g.clock}
                        </span>
                      </span>
                    )}
                  </div>
                  <div>
                    {isLive ? (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span className="pulse-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', display: 'inline-block' }} />
                        <span style={{ color: 'var(--green)', fontWeight: 700, fontSize: DATA_SIZE }}>LIVE</span>
                      </span>
                    ) : (
                      <span style={{ color: DIM, fontSize: DATA_SIZE, fontFamily: 'var(--font-mono)' }}>
                        {formatCountdown(g.startTime, now)}
                      </span>
                    )}
                  </div>
                </div>

                {/* Row 2: YES · NO · SPRD · VOL */}
                <div style={{ display: 'flex', alignItems: 'center', fontSize: DATA_SIZE, fontFamily: 'var(--font-mono)', gap: 0 }}>
                  {g.yesPrice != null && (
                    <>
                      <span style={{ color: DIM }}>YES </span>
                      <span style={{ color: 'var(--green)', fontWeight: 600 }}>{(g.yesPrice * 100).toFixed(1)}¢</span>
                    </>
                  )}
                  {g.noPrice != null && (
                    <>
                      <span style={{ color: 'rgba(255,255,255,0.15)', margin: '0 5px' }}>·</span>
                      <span style={{ color: DIM }}>NO </span>
                      <span style={{ color: 'var(--red)', fontWeight: 600 }}>{(g.noPrice * 100).toFixed(1)}¢</span>
                    </>
                  )}
                  {g.spread != null && (
                    <>
                      <span style={{ color: 'rgba(255,255,255,0.15)', margin: '0 5px' }}>·</span>
                      <span style={{ color: DIM }}>SPRD </span>
                      <span style={{ color: DIM }}>{g.spread.toFixed(1)}¢</span>
                    </>
                  )}
                  <span style={{ marginLeft: 'auto' }}>
                    <span style={{ color: DIM }}>VOL </span>
                    <span style={{ color: DIM }}>{formatVol(g.volume)}</span>
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
