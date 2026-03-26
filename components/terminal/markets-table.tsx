'use client';
import { useState, useRef, useEffect } from 'react';
import { Sparkline } from './sparkline';

interface WatchedMarket {
  id: string;
  title: string;
  yesPrice: number;
  noPrice: number;
  spread: number | null;
  edge: number | null;
  aiEstimate: number | null;
  status: string;
  volume: number;
  homeTeam?: string;
  awayTeam?: string;
  gameStartTime: string | null;
  gameData: {
    homeTeam: string; awayTeam: string;
    homeScore: number; awayScore: number;
    period: string; clock: string;
  } | null;
  priceHistory: number[];
}
interface Props { markets: WatchedMarket[]; }

function useFlash(value: number) {
  const prev = useRef(value);
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (value !== prev.current) {
      setFlash(value > prev.current ? 'up' : 'down');
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setFlash(null), 300);
      prev.current = value;
    }
  }, [value]);
  return flash;
}

function PriceCell({ price, side }: { price: number; side: 'yes' | 'no' }) {
  const flash = useFlash(price);
  return (
    <span className={flash === 'up' ? 'flash-green' : flash === 'down' ? 'flash-red' : ''} style={{
      color: side === 'yes' ? 'var(--green)' : 'var(--red)',
      fontWeight: 700, fontFamily: 'var(--font-mono)',
    }}>
      {(price * 100).toFixed(1)}¢
    </span>
  );
}

function formatVol(v: number) {
  if (v >= 1e6) return `$${(v/1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v/1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

function formatDuration(ms: number): string {
  if (ms <= 0) return '00:00:00';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function Countdown({ targetTime }: { targetTime: string }) {
  const [remaining, setRemaining] = useState(() => new Date(targetTime).getTime() - Date.now());

  useEffect(() => {
    const id = setInterval(() => {
      setRemaining(new Date(targetTime).getTime() - Date.now());
    }, 1000);
    return () => clearInterval(id);
  }, [targetTime]);

  return (
    <span style={{ color: 'var(--cyan)', fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '1.4rem', letterSpacing: '0.04em' }}>
      {formatDuration(remaining)}
    </span>
  );
}

export function MarketsTable({ markets }: Props) {
  const active = markets.filter(m =>
    m.status === 'live' || m.status === 'edge_detected' || m.status === 'position_open'
  );

  // No live markets — show countdown to next game
  if (active.length === 0) {
    const upcoming = markets
      .filter(m => m.gameStartTime && new Date(m.gameStartTime).getTime() > Date.now())
      .sort((a, b) => new Date(a.gameStartTime!).getTime() - new Date(b.gameStartTime!).getTime());

    const next = upcoming[0];

    return (
      <div className="panel" style={{ textAlign: 'center', padding: '20px 16px' }}>
        <div className="panel-header" style={{ textAlign: 'left' }}>Watched Markets</div>
        {next ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '16px 0 8px' }}>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              Next game starts in
            </div>
            <Countdown targetTime={next.gameStartTime!} />
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
              {next.awayTeam ?? 'Away'} @ {next.homeTeam ?? 'Home'}
            </div>
            <div style={{ fontSize: '0.6rem', color: 'var(--text-dim)' }}>
              {new Date(next.gameStartTime!).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true })}
            </div>
            {upcoming.length > 1 && (
              <div style={{ fontSize: '0.6rem', color: 'var(--text-dim)', marginTop: 4 }}>
                {(() => {
                  const nextDate = new Date(next.gameStartTime!);
                  const today = new Date();
                  const diffDays = Math.round((nextDate.setHours(0,0,0,0) - today.setHours(0,0,0,0)) / 86400000);
                  const label = diffDays === 0 ? 'today' : diffDays === 1 ? 'tomorrow' : `in ${diffDays} days`;
                  return `+${upcoming.length - 1} more game${upcoming.length > 2 ? 's' : ''} ${label}`;
                })()}
              </div>
            )}
          </div>
        ) : (
          <div style={{ padding: '20px 0', color: 'var(--text-dim)', fontSize: '0.75rem' }}>
            No upcoming games scheduled
          </div>
        )}
      </div>
    );
  }

  // Sort: position_open → edge_detected → live
  const sorted = [...active].sort((a, b) => {
    const pri: Record<string, number> = { position_open: 3, edge_detected: 2, live: 1 };
    return (pri[b.status] ?? 0) - (pri[a.status] ?? 0);
  });

  return (
    <div className="panel" style={{ overflow: 'hidden' }}>
      <div className="panel-header">
        Watched Markets <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>({active.length} live)</span>
      </div>
      <div style={{ overflowY: 'auto', maxHeight: '340px' }}>
        {/* Header row */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '2fr 72px 72px 56px 64px 100px',
          gap: 4, padding: '4px 6px',
          fontSize: '0.6rem', color: 'var(--text-dim)',
          textTransform: 'uppercase', letterSpacing: '0.08em',
          borderBottom: '1px solid var(--border-default)', marginBottom: 4,
          position: 'sticky', top: 0, background: 'var(--bg-card)',
        }}>
          <span>Market</span>
          <span>YES</span>
          <span>NO</span>
          <span>SPRD</span>
          <span>VOL</span>
          <span>SPARK</span>
        </div>

        {sorted.map(m => {
          const shortTitle = m.title.length > 30 ? m.title.slice(0, 28) + '…' : m.title;
          const rowBg = m.status === 'position_open' ? 'rgba(6,182,212,0.05)' :
                        m.status === 'edge_detected'  ? 'rgba(245,158,11,0.05)' : 'transparent';
          const accentColor = m.status === 'position_open' ? 'var(--cyan)' :
                              m.status === 'edge_detected'  ? 'var(--amber)' : 'transparent';

          return (
            <div key={m.id} style={{
              display: 'grid',
              gridTemplateColumns: '2fr 72px 72px 56px 64px 100px',
              gap: 4, padding: '6px 6px',
              borderBottom: '1px solid var(--border-default)',
              borderLeft: m.status !== 'live' ? `2px solid ${accentColor}` : '2px solid transparent',
              alignItems: 'center',
              background: rowBg,
            }}>
              <div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-primary)', fontWeight: 500, marginBottom: 2 }}>{shortTitle}</div>
                {m.gameData && (
                  <div style={{ fontSize: '0.6rem', color: 'var(--text-dim)' }}>
                    {m.gameData.awayTeam} {m.gameData.awayScore}–{m.gameData.homeScore} {m.gameData.homeTeam} · {m.gameData.period} {m.gameData.clock}
                  </div>
                )}
              </div>
              <PriceCell price={m.yesPrice} side="yes" />
              <PriceCell price={m.noPrice} side="no" />
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.7rem' }}>
                {m.spread != null ? `${m.spread.toFixed(1)}¢` : '—'}
              </span>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.65rem' }}>
                {formatVol(m.volume)}
              </span>
              <Sparkline data={m.priceHistory} width={90} height={22} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
