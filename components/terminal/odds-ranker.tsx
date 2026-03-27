'use client';
import { useState, useEffect } from 'react';

interface WatchlistEntry {
  oddsGameId: string;
  sportKey: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  homeFairValue: number;
  awayFairValue: number;
  consensus: {
    homeWinProb: number;
    awayWinProb: number;
    numBookmakers: number;
    confidence: 'high' | 'medium' | 'low';
    spread: number;
  };
  polymarketMatched: boolean;
  polymarketUrl?: string;
  conditionId?: string;
  currentYesPrice?: number;
  currentNoPrice?: number;
  homeIsYes?: boolean;
  bestSideEV: number;
  bestSide: 'YES' | 'NO';
  projectedEV: number;
  status: string;
}

interface Props {
  watchlist: WatchlistEntry[];
  summary: {
    cachedGames: number;
    apiRequestsUsed: number;
    apiRequestsBudget: number;
    lastScanAt: string | null;
  } | null;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  if (diffMs < 0) return 'Started';
  const h = Math.floor(diffMs / 3600000);
  const m = Math.floor((diffMs % 3600000) / 60000);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function Countdown({ target }: { target: string }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60000);
    return () => clearInterval(id);
  }, []);
  return <>{formatTime(target)}</>;
}


export function OddsRanker({ watchlist, summary }: Props) {
  if (watchlist.length === 0 && !summary) {
    return (
      <div className="panel">
        <div className="panel-header">Odds Ranker</div>
        <div style={{ color: 'var(--text-dim)', fontSize: '0.65rem', padding: '8px 0' }}>
          Waiting for odds data...
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panel-header">
        Odds Ranker
        <span style={{ color: 'var(--text-dim)', fontWeight: 400, marginLeft: 6 }}>
          {watchlist.length} games
          {summary && ` · ${summary.apiRequestsUsed}/${summary.apiRequestsBudget} API`}
        </span>
      </div>
      <div>
        {watchlist.map((entry, i) => {
          const ev = entry.polymarketMatched ? entry.bestSideEV : entry.projectedEV;
          const evPct = (ev * 100).toFixed(1);
          const isPositive = ev > 0;
          const isMatched = entry.polymarketMatched;
          const isHeld = entry.status === 'position_held';

          const borderColor = isHeld ? 'var(--green)' :
            isMatched && isPositive ? 'var(--amber)' :
            'transparent';

          const bgColor = isHeld ? 'rgba(34,197,94,0.04)' :
            isMatched && isPositive ? 'rgba(245,158,11,0.03)' :
            'transparent';

          const sportLabel = entry.sportKey.includes('ncaab') ? 'NCAA' :
            entry.sportKey.includes('wnba') ? 'WNBA' :
            entry.sportKey.includes('euroleague') ? 'EUR' : 'NBA';

          return (
            <div key={entry.oddsGameId} style={{
              padding: '6px 4px',
              borderBottom: '1px solid var(--border-default)',
              borderLeft: `2px solid ${borderColor}`,
              background: bgColor,
            }}>
              {/* Row 1: Rank + Game + Time */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  <span style={{
                    fontSize: '0.55rem', fontFamily: 'var(--font-mono)', color: 'var(--text-dim)',
                    width: 16, textAlign: 'right', flexShrink: 0,
                  }}>#{i + 1}</span>
                  <span style={{
                    fontSize: '0.5rem', padding: '1px 4px', borderRadius: 2,
                    background: 'rgba(100,116,139,0.15)', color: 'var(--text-dim)',
                    border: '1px solid var(--border-default)', flexShrink: 0,
                  }}>{sportLabel}</span>
                  {entry.polymarketUrl ? (
                    <a href={entry.polymarketUrl} target="_blank" rel="noopener noreferrer" style={{
                      fontSize: '0.68rem', color: 'var(--text-primary)', fontWeight: 500,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      textDecoration: 'none',
                    }} className="schedule-row-link">
                      {entry.awayTeam} @ {entry.homeTeam}
                      <span style={{ fontSize: '0.5rem', color: 'var(--text-dim)', marginLeft: 4 }}>↗</span>
                    </a>
                  ) : (
                    <span style={{
                      fontSize: '0.68rem', color: 'var(--text-primary)', fontWeight: 500,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {entry.awayTeam} @ {entry.homeTeam}
                    </span>
                  )}
                </div>
                <span style={{ fontSize: '0.6rem', color: 'var(--text-dim)', flexShrink: 0 }}>
                  <Countdown target={entry.commenceTime} />
                </span>
              </div>

              {/* Row 2: Consensus + Poly Price + EV + Status */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3, paddingLeft: 22 }}>
                <span style={{ fontSize: '0.6rem', color: 'var(--cyan)', fontFamily: 'var(--font-mono)' }}>
                  {(entry.consensus.homeWinProb * 100).toFixed(0)}%
                  <span style={{ color: 'var(--text-dim)', fontSize: '0.5rem', marginLeft: 2 }}>
                    ({entry.consensus.numBookmakers}b)
                  </span>
                </span>

                {isMatched ? (
                  <span style={{ fontSize: '0.6rem', fontFamily: 'var(--font-mono)' }}>
                    <span style={{ color: 'var(--text-dim)' }}>Poly </span>
                    <span style={{ color: 'var(--green)' }}>{((entry.currentYesPrice ?? 0) * 100).toFixed(0)}¢</span>
                    <span style={{ color: 'var(--text-dim)' }}>/</span>
                    <span style={{ color: 'var(--red)' }}>{((entry.currentNoPrice ?? 0) * 100).toFixed(0)}¢</span>
                  </span>
                ) : (
                  <span style={{ fontSize: '0.6rem', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                    no market
                  </span>
                )}

                <span style={{
                  fontSize: '0.6rem', fontFamily: 'var(--font-mono)', fontWeight: 700,
                  color: isMatched && isPositive ? 'var(--green)' : 'var(--text-dim)',
                }}>
                  {isMatched
                    ? `${isPositive ? '+' : ''}${evPct}%`
                    : `${(entry.consensus.homeWinProb * 100).toFixed(0)}/${(entry.consensus.awayWinProb * 100).toFixed(0)}`
                  }
                </span>

                {/* Status badge */}
                <span style={{
                  fontSize: '0.5rem', padding: '1px 5px', borderRadius: 2, marginLeft: 'auto',
                  background: isHeld ? 'rgba(34,197,94,0.15)' :
                    isMatched && isPositive ? 'rgba(245,158,11,0.12)' :
                    'rgba(100,116,139,0.1)',
                  color: isHeld ? 'var(--green)' :
                    isMatched && isPositive ? 'var(--amber)' :
                    'var(--text-dim)',
                  border: `1px solid ${isHeld ? 'rgba(34,197,94,0.3)' :
                    isMatched && isPositive ? 'rgba(245,158,11,0.25)' :
                    'var(--border-default)'}`,
                  fontWeight: 600,
                }}>
                  {isHeld ? 'HELD' :
                   isMatched && isPositive ? 'EDGE' :
                   isMatched ? 'FLAT' :
                   'WAITING'}
                </span>
              </div>

              {/* Row 3: Best side info */}
              {isMatched && isPositive && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2, paddingLeft: 22 }}>
                  <span style={{ fontSize: '0.5rem', color: 'var(--text-dim)' }}>
                    BUY {entry.bestSide} @ {(((entry.bestSide === 'YES' ? entry.currentYesPrice : entry.currentNoPrice) ?? 0) * 100).toFixed(0)}¢
                    → SELL @ {(((entry.bestSide === 'YES'
                      ? (entry.homeIsYes ? entry.consensus.homeWinProb : entry.consensus.awayWinProb)
                      : (entry.homeIsYes ? entry.consensus.awayWinProb : entry.consensus.homeWinProb)
                    ) * 100)).toFixed(0)}¢
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
