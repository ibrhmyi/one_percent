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

const DIM = 'rgba(255,255,255,0.3)';
const DIMMER = 'rgba(255,255,255,0.2)';
const MONO: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: '0.6rem' };

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
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
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
  return (
    <span style={{
      color: isLive ? 'var(--green)' : DIM,
      fontSize: '0.5rem',
      fontFamily: 'var(--font-mono)',
      letterSpacing: '0.02em',
    }}>
      {text}
    </span>
  );
}

export function OddsRanker({ predictions }: Props) {
  // Only show matched predictions, sorted by edge (highest first)
  const matched = predictions
    .filter(p => p.polymarketMatched)
    .sort((a, b) => (b.bestEdge ?? 0) - (a.bestEdge ?? 0));

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>
          Odds Ranker
          <span style={{ color: DIM, fontWeight: 400, marginLeft: 6, fontSize: '0.6rem' }}>
            {matched.length} games
          </span>
        </span>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 2 }}>
        {matched.length === 0 && (
          <div style={{ color: DIM, fontSize: '0.6rem', padding: '12px 0', textAlign: 'center' }}>
            Loading predictions...
          </div>
        )}

        {matched.map((pred) => {
          const edgeVal = (pred.bestEdge ?? 0) * 100;
          const leagueLabel = pred.league === 'NCAAB' ? 'NCAA' : pred.league;
          const sources = pred.sourcesAvailable ?? [];
          const spreadVal = pred.spread != null ? pred.spread : null;
          const volK = pred.volume != null ? pred.volume / 1000 : null;

          const content = (
            <div className="card-interactive" style={{
              border: '1px solid var(--border-default)',
              borderRadius: 6,
              padding: '8px 10px',
            }}>
              {/* Row 1: League + Sources (left) | Countdown (right) */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: '0.45rem', color: DIM, padding: '1px 3px', borderRadius: 2, border: '1px solid var(--border-default)' }}>{leagueLabel}</span>
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

              {/* Teams */}
              <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.9)', fontWeight: 600, marginBottom: 4 }}>
                {pred.awayTeam} @ {pred.homeTeam}
              </div>

              {/* Fair value */}
              <div style={{ ...MONO, color: DIM, marginBottom: 3 }}>
                Fair: {pred.homeTeam.split(' ').pop()} {(pred.fairHomeWinProb * 100).toFixed(0)}% · {pred.awayTeam.split(' ').pop()} {(pred.fairAwayWinProb * 100).toFixed(0)}%
              </div>

              {/* Market data: YES · NO · Spread · Vol */}
              <div style={{ ...MONO, display: 'flex', alignItems: 'center', gap: 0, marginBottom: 3, flexWrap: 'wrap' }}>
                <span style={{ color: 'var(--green)' }}>YES {((pred.yesPrice ?? 0) * 100).toFixed(0)}¢</span>
                <span style={{ color: DIMMER, margin: '0 5px' }}>·</span>
                <span style={{ color: 'var(--red)' }}>NO {((pred.noPrice ?? 0) * 100).toFixed(0)}¢</span>
                {spreadVal != null && (
                  <>
                    <span style={{ color: DIMMER, margin: '0 5px' }}>·</span>
                    <span style={{ color: DIM, fontSize: '0.5rem' }}>Spread {spreadVal.toFixed(0)}¢</span>
                  </>
                )}
                {volK != null && (
                  <>
                    <span style={{ color: DIMMER, margin: '0 5px' }}>·</span>
                    <span style={{ color: DIM, fontSize: '0.5rem' }}>Vol ${volK >= 1000 ? `${(volK/1000).toFixed(1)}M` : `${volK.toFixed(0)}k`}</span>
                  </>
                )}
              </div>

              {/* Edge — always show */}
              {edgeVal > 0.5 ? (
                <div style={{ fontSize: '0.6rem', fontWeight: 600 }}>
                  <span style={{ color: 'var(--cyan)' }}>BUY {pred.bestSide}</span>
                  <span style={{
                    marginLeft: 8,
                    fontWeight: 700,
                    color: edgeVal >= 5 ? 'var(--green)' : edgeVal >= 2 ? 'var(--cyan)' : DIM,
                  }}>+{edgeVal.toFixed(1)}%</span>
                </div>
              ) : (
                <div style={{ fontSize: '0.5rem', color: DIMMER }}>Fair ≈ market</div>
              )}
            </div>
          );

          if (pred.polymarketUrl) {
            return (
              <a key={pred.gameKey} href={pred.polymarketUrl} target="_blank" rel="noopener noreferrer"
                style={{ textDecoration: 'none', color: 'inherit' }} className="schedule-row-link">
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
