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

// ── Shared terminal text sizes (same as GameSchedule) ──
const TITLE_SIZE = '0.7rem';
const DATA_SIZE = '0.55rem';
const BADGE_SIZE = '0.45rem';
const DIM = 'rgba(255,255,255,0.3)';
const DIMMER = 'rgba(255,255,255,0.15)';

function formatCountdown(iso: string | null | undefined): string {
  if (!iso) return '';
  const diffMs = new Date(iso).getTime() - Date.now();
  if (diffMs < 0) return 'LIVE';
  const totalSec = Math.floor(diffMs / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function Countdown({ target }: { target: string | null | undefined }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  if (!target) return null;
  const text = formatCountdown(target);
  const isLive = text === 'LIVE';
  if (isLive) {
    return (
      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span className="pulse-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', display: 'inline-block' }} />
        <span style={{ color: 'var(--green)', fontWeight: 700, fontSize: DATA_SIZE }}>LIVE</span>
      </span>
    );
  }
  return (
    <span style={{ color: DIM, fontSize: DATA_SIZE, fontFamily: 'var(--font-mono)' }}>
      {text}
    </span>
  );
}

function formatVol(v: number | null | undefined): string {
  if (v == null || v === 0) return '$0';
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}k`;
  return `$${v.toFixed(0)}`;
}

export function OddsRanker({ predictions }: Props) {
  const matched = predictions
    .filter(p => p.polymarketMatched)
    .sort((a, b) => (b.bestEdge ?? 0) - (a.bestEdge ?? 0));

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header">
        Odds Ranker <span style={{ color: DIM, fontWeight: 400 }}>{matched.length} games</span>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
        {matched.length === 0 && (
          <div style={{ color: DIM, fontSize: DATA_SIZE, padding: 12 }}>
            Loading predictions...
          </div>
        )}

        {matched.map((pred) => {
          const edgeVal = (pred.bestEdge ?? 0) * 100;
          const leagueLabel = pred.league === 'NCAAB' ? 'NCAA' : pred.league;
          const sources = pred.sourcesAvailable ?? [];
          const spreadVal = pred.spread != null ? pred.spread : 0;

          // Fair in game listing order: away vs home
          const awayFair = pred.fairAwayWinProb;
          const homeFair = pred.fairHomeWinProb;
          const awayName = pred.awayTeam.split(' ').pop() ?? pred.awayTeam;
          const homeName = pred.homeTeam.split(' ').pop() ?? pred.homeTeam;

          const content = (
            <div className="schedule-row-link" style={{
              padding: '8px 6px',
              borderBottom: '1px solid var(--border-default)',
              borderLeft: '2px solid transparent',
              transition: 'background 0.15s',
            }}>
              {/* Row 1: Teams (left) + Countdown (right) — same layout as Game Schedule */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: BADGE_SIZE, color: DIM, padding: '1px 3px', borderRadius: 2, border: '1px solid var(--border-default)' }}>{leagueLabel}</span>
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
                  <span style={{ fontSize: TITLE_SIZE, fontWeight: 600, color: 'rgba(255,255,255,0.9)', marginLeft: 2 }}>
                    {pred.awayTeam}
                  </span>
                  <span style={{ color: DIM, fontSize: DATA_SIZE }}>vs</span>
                  <span style={{ fontSize: TITLE_SIZE, fontWeight: 600, color: 'rgba(255,255,255,0.9)' }}>
                    {pred.homeTeam}
                  </span>
                </div>
                <Countdown target={pred.gameStartTime} />
              </div>

              {/* Row 2: YES · NO · SPRD · VOL — exact same style as Game Schedule */}
              <div style={{ display: 'flex', alignItems: 'center', fontSize: DATA_SIZE, fontFamily: 'var(--font-mono)', gap: 0, marginBottom: 4 }}>
                <span style={{ color: DIM }}>YES </span>
                <span style={{ color: 'var(--green)', fontWeight: 600 }}>{((pred.yesPrice ?? 0) * 100).toFixed(1)}¢</span>
                <span style={{ color: DIMMER, margin: '0 5px' }}>·</span>
                <span style={{ color: DIM }}>NO </span>
                <span style={{ color: 'var(--red)', fontWeight: 600 }}>{((pred.noPrice ?? 0) * 100).toFixed(1)}¢</span>
                <span style={{ color: DIMMER, margin: '0 5px' }}>·</span>
                <span style={{ color: DIM }}>SPRD </span>
                <span style={{ color: DIM }}>{spreadVal.toFixed(1)}¢</span>
                <span style={{ marginLeft: 'auto' }}>
                  <span style={{ color: DIM }}>VOL </span>
                  <span style={{ color: DIM }}>{formatVol(pred.volume)}</span>
                </span>
              </div>

              {/* Row 3: Fair probability (away first) + Edge */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: DATA_SIZE, fontFamily: 'var(--font-mono)' }}>
                <span style={{ color: DIM }}>
                  Fair: {awayName} {(awayFair * 100).toFixed(0)}% · {homeName} {(homeFair * 100).toFixed(0)}%
                </span>
                {edgeVal > 0.5 ? (
                  <span style={{ color: 'var(--cyan)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                    BUY {pred.bestSide} +{edgeVal.toFixed(1)}%
                  </span>
                ) : (
                  <span style={{ color: DIMMER }}>—</span>
                )}
              </div>
            </div>
          );

          if (pred.polymarketUrl) {
            return (
              <a key={pred.gameKey} href={pred.polymarketUrl} target="_blank" rel="noopener noreferrer"
                style={{ textDecoration: 'none', color: 'inherit' }}>
                {content}
              </a>
            );
          }
          return <div key={pred.gameKey}>{content}</div>;
        })}
      </div>
    </div>
  );
}
