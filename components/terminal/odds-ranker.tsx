'use client';
import { useState, useEffect } from 'react';

interface Prediction {
  gameKey: string;
  homeTeam: string;
  awayTeam: string;
  fairHomeWinProb: number;
  fairAwayWinProb: number;
  bpiPrediction: { homeWinProb: number; awayWinProb: number; lastModified: string } | null;
  torvikPrediction: { homeWinProb: number; awayWinProb: number } | null;
  booksPrediction: { homeWinProb: number; awayWinProb: number; numBooks: number; confidence: string } | null;
  sourcesAvailable: string[];
  lastUpdated: string;
  league: 'NBA' | 'NCAAB' | 'WNBA';
  polymarketMatched?: boolean;
  polymarketUrl?: string;
  yesPrice?: number;
  noPrice?: number;
  volume?: number;
  spread?: number;
  homeIsYes?: boolean;
  yesEdge?: number;
  noEdge?: number;
  bestEdge?: number;
  bestSide?: 'YES' | 'NO' | null;
  slug?: string;
  gameStartTime?: string | null;
}

interface Props {
  predictions: Prediction[];
}

function formatCountdown(iso: string | null | undefined): string {
  if (!iso) return '';
  const diff = Math.floor((new Date(iso).getTime() - Date.now()) / 1000);
  if (diff <= 0) return 'LIVE';
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  if (h >= 24) {
    const d = Math.floor(h / 24);
    return `${d}d ${h % 24}h ${m}m`;
  }
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function Countdown({ target }: { target: string | null | undefined }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  if (!target) return null;
  const text = formatCountdown(target);
  if (text === 'LIVE') {
    return (
      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span className="pulse-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', display: 'inline-block' }} />
        <span style={{ color: 'var(--green)', fontWeight: 700, fontSize: '0.62rem' }}>LIVE</span>
      </span>
    );
  }
  return (
    <span style={{ color: 'var(--text-dim)', fontSize: '0.65rem', fontFamily: 'var(--font-mono)' }}>
      {text}
    </span>
  );
}

function formatVol(v?: number) {
  if (!v || v === 0) return '$0';
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

export function OddsRanker({ predictions }: Props) {
  const matched = predictions
    .filter(p => p.polymarketMatched)
    .sort((a, b) => (b.bestEdge ?? 0) - (a.bestEdge ?? 0));

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header">
        Pre-Game Odds <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>{matched.length} games</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {matched.length === 0 && (
          <div style={{ color: 'var(--text-dim)', fontSize: '0.7rem', padding: 12 }}>
            Loading predictions...
          </div>
        )}

        {matched.map((pred) => {
          const edgeVal = (pred.bestEdge ?? 0) * 100;
          const leagueLabel = pred.league === 'NCAAB' ? 'NCAA' : pred.league;
          const sources = pred.sourcesAvailable ?? [];

          const awayFair = pred.fairAwayWinProb;
          const homeFair = pred.fairHomeWinProb;
          const awayLast = pred.awayTeam.split(' ').pop() ?? pred.awayTeam;
          const homeLast = pred.homeTeam.split(' ').pop() ?? pred.homeTeam;

          const polyUrl = pred.polymarketUrl;

          const inner = (
            <div className={polyUrl ? 'schedule-row-link' : ''} style={{
              padding: '8px 6px',
              borderBottom: '1px solid var(--border-default)',
              borderLeft: '2px solid transparent',
              cursor: polyUrl ? 'pointer' : 'default',
              transition: 'background 0.15s',
            }}>
              {/* Row 1: Badges (top left) + Countdown (top right) */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: '0.45rem', color: 'var(--text-dim)', padding: '1px 3px', borderRadius: 2, border: '1px solid var(--border-default)' }}>{leagueLabel}</span>
                  {sources.map(s => {
                    const label = s.startsWith('Books') ? 'Pinnacle' : s;
                    const isBooks = s.startsWith('Books') || s === 'Pinnacle';
                    const isBPI = s === 'BPI';
                    return (
                      <span key={s} style={{
                        fontSize: '0.4rem',
                        color: isBooks ? 'var(--green)' : isBPI ? 'var(--cyan)' : 'rgba(255,200,100,0.7)',
                        padding: '0px 3px',
                        borderRadius: 2,
                        border: `1px solid ${isBooks ? 'rgba(34,197,94,0.2)' : isBPI ? 'rgba(8,145,178,0.2)' : 'rgba(255,200,100,0.15)'}`,
                      }}>{label}</span>
                    );
                  })}
                </div>
                <Countdown target={pred.gameStartTime} />
              </div>

              {/* Row 2: Team names — flows as one line, wraps naturally */}
              <div style={{ fontSize: '0.73rem', fontWeight: 600, marginBottom: 4 }}>
                <span style={{ color: 'rgba(255,255,255,0.9)' }}>{pred.awayTeam}</span>
                <span style={{ color: 'var(--text-dim)', margin: '0 4px' }}>vs</span>
                <span style={{ color: 'rgba(255,255,255,0.9)' }}>{pred.homeTeam}</span>
              </div>

              {/* Row 3: YES / NO / SPRD / VOL — exact same style as Game Schedule */}
              <div style={{ display: 'flex', gap: 10, fontSize: '0.62rem', marginBottom: 3 }}>
                <span>
                  <span style={{ color: 'var(--text-dim)' }}>YES </span>
                  <span style={{ color: 'var(--green)', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                    {((pred.yesPrice ?? 0) * 100).toFixed(1)}¢
                  </span>
                </span>
                <span>
                  <span style={{ color: 'var(--text-dim)' }}>NO </span>
                  <span style={{ color: 'var(--red)', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                    {((pred.noPrice ?? 0) * 100).toFixed(1)}¢
                  </span>
                </span>
                <span>
                  <span style={{ color: 'var(--text-dim)' }}>SPRD </span>
                  <span style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                    {(pred.spread ?? 0).toFixed(1)}¢
                  </span>
                </span>
                <span style={{ marginLeft: 'auto' }}>
                  <span style={{ color: 'var(--text-dim)' }}>VOL </span>
                  <span style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                    {formatVol(pred.volume)}
                  </span>
                </span>
              </div>

              {/* Row 4: Fair + Edge on same line */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.62rem' }}>
                <span style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                  Fair: {awayLast} {(awayFair * 100).toFixed(0)}% · {homeLast} {(homeFair * 100).toFixed(0)}%
                </span>
                {edgeVal > 0.5 ? (
                  <span style={{ color: 'var(--cyan)', fontWeight: 600, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                    Edge +{edgeVal.toFixed(1)}%
                  </span>
                ) : (
                  <span style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>—</span>
                )}
              </div>
            </div>
          );

          return polyUrl ? (
            <a key={pred.gameKey} href={polyUrl} target="_blank" rel="noopener noreferrer"
              style={{ textDecoration: 'none', display: 'block' }}>
              {inner}
            </a>
          ) : (
            <div key={pred.gameKey}>{inner}</div>
          );
        })}
      </div>
    </div>
  );
}
