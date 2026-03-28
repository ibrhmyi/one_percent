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

const DIM = 'rgba(255,255,255,0.35)';
const MONO: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: '0.6rem' };

function formatCountdown(iso: string | null | undefined): string {
  if (!iso) return '';
  const diffMs = new Date(iso).getTime() - Date.now();
  if (diffMs < 0) return 'LIVE';
  const totalMin = Math.floor(diffMs / 60000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function Countdown({ target }: { target: string | null | undefined }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30000);
    return () => clearInterval(id);
  }, []);
  if (!target) return null;
  const text = formatCountdown(target);
  const isLive = text === 'LIVE';
  return <span style={{ color: isLive ? 'var(--green)' : 'var(--cyan)', fontSize: '0.5rem' }}>{text}</span>;
}

export function OddsRanker({ predictions }: Props) {
  const [filter, setFilter] = useState<'all' | 'matched' | 'edge'>('all');

  const filtered = predictions.filter(p => {
    if (filter === 'matched') return p.polymarketMatched;
    if (filter === 'edge') return p.polymarketMatched && (p.bestEdge ?? 0) > 0.02;
    return true;
  });

  // Sort: matched with edge first, then matched, then unmatched
  const sorted = [...filtered].sort((a, b) => {
    const aMatched = a.polymarketMatched ? 1 : 0;
    const bMatched = b.polymarketMatched ? 1 : 0;
    if (aMatched !== bMatched) return bMatched - aMatched;
    return (b.bestEdge ?? 0) - (a.bestEdge ?? 0);
  });

  const matchedCount = predictions.filter(p => p.polymarketMatched).length;
  const edgeCount = predictions.filter(p => p.polymarketMatched && (p.bestEdge ?? 0) > 0.02).length;

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>
          Odds Ranker
          <span style={{ color: DIM, fontWeight: 400, marginLeft: 6, fontSize: '0.6rem' }}>
            {predictions.length} games
          </span>
        </span>
        {/* Filter tabs */}
        <div style={{ display: 'flex', gap: 2 }}>
          {(['all', 'matched', 'edge'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              background: filter === f ? 'rgba(255,255,255,0.08)' : 'transparent',
              border: '1px solid ' + (filter === f ? 'rgba(255,255,255,0.15)' : 'transparent'),
              borderRadius: 3,
              padding: '1px 6px',
              fontSize: '0.5rem',
              color: filter === f ? 'rgba(255,255,255,0.8)' : DIM,
              cursor: 'pointer',
              textTransform: 'uppercase',
              letterSpacing: '0.03em',
            }}>
              {f === 'all' ? `All (${predictions.length})` :
               f === 'matched' ? `Matched (${matchedCount})` :
               `Edge (${edgeCount})`}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 2 }}>
        {sorted.length === 0 && (
          <div style={{ color: DIM, fontSize: '0.6rem', padding: '12px 0', textAlign: 'center' }}>
            {filter === 'edge' ? 'No positive-edge games found' :
             filter === 'matched' ? 'No Polymarket matches yet' :
             'Loading predictions...'}
          </div>
        )}

        {sorted.map((pred) => {
          const isMatched = pred.polymarketMatched;
          const hasEdge = isMatched && (pred.bestEdge ?? 0) > 0.02;
          const edgeVal = (pred.bestEdge ?? 0) * 100;

          const leagueLabel = pred.league === 'NCAAB' ? 'NCAA' : pred.league;

          // Source badges
          const sources = pred.sourcesAvailable ?? [];

          const borderColor = hasEdge ? 'var(--cyan)' : isMatched ? 'rgba(255,255,255,0.1)' : 'transparent';

          const content = (
            <div className="card-interactive" style={{
              border: '1px solid var(--border-default)',
              borderLeft: `3px solid ${borderColor}`,
              borderRadius: 6,
              padding: '8px 10px',
            }}>
              {/* Row 1: League + Countdown + Sources */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: '0.45rem', color: DIM, padding: '1px 3px', borderRadius: 2, border: '1px solid var(--border-default)' }}>{leagueLabel}</span>
                  <Countdown target={pred.gameStartTime} />
                  {sources.map(s => {
                    // Display "Pinnacle" instead of "Books(1)" for clarity
                    const label = s.startsWith('Books') ? 'Pinnacle' : s;
                    const isBooks = s.startsWith('Books');
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
                {isMatched && <span style={{ fontSize: '0.45rem', color: DIM }}>↗</span>}
              </div>

              {/* Teams */}
              <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.9)', fontWeight: 600, marginBottom: 4 }}>
                {pred.awayTeam} @ {pred.homeTeam}
              </div>

              {/* Fair value */}
              <div style={{ ...MONO, color: DIM, marginBottom: 3 }}>
                Fair: {pred.homeTeam.split(' ').pop()} {(pred.fairHomeWinProb * 100).toFixed(0)}% · {pred.awayTeam.split(' ').pop()} {(pred.fairAwayWinProb * 100).toFixed(0)}%
              </div>

              {/* Polymarket match */}
              {isMatched ? (
                <>
                  <div style={{ ...MONO, marginBottom: 3 }}>
                    <span style={{ color: 'var(--green)' }}>YES {((pred.yesPrice ?? 0) * 100).toFixed(0)}¢</span>
                    <span style={{ color: DIM, margin: '0 6px' }}>·</span>
                    <span style={{ color: 'var(--red)' }}>NO {((pred.noPrice ?? 0) * 100).toFixed(0)}¢</span>
                    {pred.volume != null && (
                      <span style={{ color: DIM, marginLeft: 8, fontSize: '0.5rem' }}>
                        Vol ${(pred.volume / 1000).toFixed(0)}k
                      </span>
                    )}
                  </div>

                  {hasEdge ? (
                    <div style={{ fontSize: '0.6rem', color: 'var(--cyan)', fontWeight: 600 }}>
                      BUY {pred.bestSide}
                      <span style={{
                        marginLeft: 8,
                        fontWeight: 700,
                        color: edgeVal >= 5 ? 'var(--green)' : 'var(--cyan)',
                      }}>+{edgeVal.toFixed(1)}%</span>
                    </div>
                  ) : (
                    <div style={{ fontSize: '0.5rem', color: DIM }}>No edge (fair ≈ market)</div>
                  )}
                </>
              ) : (
                <div style={{ fontSize: '0.5rem', color: DIM }}>Awaiting Polymarket</div>
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
