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

function formatCountdown(ms: number): string {
  if (ms <= 0) return 'LIVE';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function MarketsTable({ markets }: Props) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60000);
    return () => clearInterval(id);
  }, []);

  if (markets.length === 0) {
    return (
      <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div className="panel-header">Watched Markets</div>
        <div style={{ padding: '20px 0', color: 'var(--text-dim)', fontSize: '0.75rem', textAlign: 'center', flex: 1 }}>
          No markets found
        </div>
      </div>
    );
  }

  // Sort: live games first (position_open > edge_detected > live), then upcoming by start time
  const sorted = [...markets].sort((a, b) => {
    const pri: Record<string, number> = { position_open: 4, edge_detected: 3, live: 2, upcoming: 1 };
    const pa = pri[a.status] ?? 0;
    const pb = pri[b.status] ?? 0;
    if (pa !== pb) return pb - pa;
    // Within same status, sort by start time
    const ta = a.gameStartTime ? new Date(a.gameStartTime).getTime() : Infinity;
    const tb = b.gameStartTime ? new Date(b.gameStartTime).getTime() : Infinity;
    return ta - tb;
  });

  const liveCount = markets.filter(m =>
    m.status === 'live' || m.status === 'edge_detected' || m.status === 'position_open'
  ).length;

  return (
    <div className="panel" style={{ overflow: 'hidden', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header">
        Watched Markets <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>
          ({markets.length} markets{liveCount > 0 ? ` · ${liveCount} live` : ''})
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
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
          const isLive = m.status === 'live' || m.status === 'edge_detected' || m.status === 'position_open';
          const rowBg = m.status === 'position_open' ? 'rgba(6,182,212,0.05)' :
                        m.status === 'edge_detected'  ? 'rgba(6,182,212,0.03)' : 'transparent';
          const accentColor = m.status === 'position_open' ? 'var(--cyan)' :
                              m.status === 'edge_detected'  ? 'var(--green)' : 'transparent';
          const countdown = m.gameStartTime ? new Date(m.gameStartTime).getTime() - Date.now() : 0;

          return (
            <div key={m.id} style={{
              display: 'grid',
              gridTemplateColumns: '2fr 72px 72px 56px 64px 100px',
              gap: 4, padding: '6px 6px',
              borderBottom: '1px solid var(--border-default)',
              borderLeft: isLive ? `2px solid ${accentColor}` : '2px solid transparent',
              alignItems: 'center',
              background: rowBg,
            }}>
              <div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-primary)', fontWeight: 500, marginBottom: 2 }}>
                  {m.awayTeam && m.homeTeam ? `${m.awayTeam} @ ${m.homeTeam}` : m.title}
                </div>
                {m.gameData ? (
                  <div style={{ fontSize: '0.6rem', color: 'var(--green)', fontWeight: 600 }}>
                    {m.gameData.awayTeam} {m.gameData.awayScore}–{m.gameData.homeScore} {m.gameData.homeTeam} · {m.gameData.period} {m.gameData.clock}
                  </div>
                ) : (
                  <div style={{ fontSize: '0.55rem', color: 'var(--text-dim)' }}>
                    {countdown > 0 ? formatCountdown(countdown) : 'Starting soon'}
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
