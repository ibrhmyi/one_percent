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
  const diffMs = d.getTime() - Date.now();
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

const DIM = 'rgba(255,255,255,0.4)';
const LABEL: React.CSSProperties = { fontSize: '0.55rem', color: DIM, textTransform: 'uppercase', letterSpacing: '0.05em' };

export function OddsRanker({ watchlist, summary }: Props) {
  if (watchlist.length === 0 && !summary) {
    return (
      <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div className="panel-header">Odds Ranker</div>
        <div style={{ color: DIM, fontSize: '0.65rem', padding: '8px 0', flex: 1 }}>
          Waiting for odds data...
        </div>
      </div>
    );
  }

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header">
        Odds Ranker
        <span style={{ color: DIM, fontWeight: 400, marginLeft: 6 }}>
          {watchlist.length} games
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 2 }}>
        {watchlist.map((entry, i) => {
          const isMatched = entry.polymarketMatched;
          const isPositive = entry.bestSideEV > 0;
          const isHeld = entry.status === 'position_held';

          const sportLabel = entry.sportKey.includes('ncaab') ? 'NCAA' :
            entry.sportKey.includes('wnba') ? 'WNBA' :
            entry.sportKey.includes('euroleague') ? 'EUR' : 'NBA';

          // Determine which team the best side corresponds to
          const buyingTeam = isMatched && isPositive
            ? (entry.bestSide === 'YES'
              ? (entry.homeIsYes ? entry.homeTeam : entry.awayTeam)
              : (entry.homeIsYes ? entry.awayTeam : entry.homeTeam))
            : null;
          const betMeaning = isMatched && isPositive && buyingTeam
            ? `${buyingTeam} ${entry.bestSide === 'YES' ? 'wins' : 'loses'}`
            : null;

          const borderColor = isHeld ? 'var(--green)' :
            isMatched && isPositive ? 'var(--cyan)' : 'transparent';

          const entryPrice = isMatched
            ? ((entry.bestSide === 'YES' ? entry.currentYesPrice : entry.currentNoPrice) ?? 0)
            : 0;
          const fairPrice = isMatched
            ? (entry.bestSide === 'YES'
              ? (entry.homeIsYes ? entry.consensus.homeWinProb : entry.consensus.awayWinProb)
              : (entry.homeIsYes ? entry.consensus.awayWinProb : entry.consensus.homeWinProb))
            : 0;

          const edgeVal = entry.bestSideEV * 100;
          const edgeClass = edgeVal >= 6 ? 'edge-high' : edgeVal >= 3 ? 'edge-medium' : 'edge-low';

          const cardContent = (
            <div className="card-interactive" style={{
              border: '1px solid var(--border-default)',
              borderLeft: `3px solid ${borderColor}`,
              borderRadius: 6,
              padding: '10px 12px',
            }}>
              {/* Row 1: League + Countdown */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: '0.5rem', color: DIM, padding: '1px 4px', borderRadius: 2, border: '1px solid var(--border-default)' }}>{sportLabel}</span>
                  <span style={{ fontSize: '0.55rem', color: 'var(--cyan)' }}><Countdown target={entry.commenceTime} /></span>
                </div>
                {entry.polymarketUrl && <span style={{ fontSize: '0.5rem', color: DIM }}>↗</span>}
              </div>

              {/* Teams */}
              <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.9)', fontWeight: 600, marginBottom: 6 }}>
                {entry.awayTeam} @ {entry.homeTeam}
              </div>

              {isMatched ? (
                <>
                  <div style={{ fontSize: '0.65rem', fontFamily: 'var(--font-mono)', marginBottom: 4 }}>
                    <span style={{ color: 'var(--green)' }}>YES {((entry.currentYesPrice ?? 0) * 100).toFixed(0)}¢</span>
                    <span style={{ color: DIM, margin: '0 8px' }}>·</span>
                    <span style={{ color: 'var(--red)' }}>NO {((entry.currentNoPrice ?? 0) * 100).toFixed(0)}¢</span>
                  </div>
                  <div style={{ fontSize: '0.55rem', color: DIM, marginBottom: 4 }}>
                    Fair: {entry.homeTeam.split(' ').pop()} {(entry.consensus.homeWinProb * 100).toFixed(0)}% · {entry.awayTeam.split(' ').pop()} {(entry.consensus.awayWinProb * 100).toFixed(0)}%
                    <span style={{ marginLeft: 6 }}>{entry.consensus.numBookmakers} books</span>
                  </div>
                  {isPositive && (
                    <div style={{ fontSize: '0.6rem', color: 'var(--cyan)', fontWeight: 600 }}>
                      BUY {entry.bestSide} {betMeaning ? `(${betMeaning})` : ''} @ {(entryPrice * 100).toFixed(0)}¢
                      <span className={edgeClass} style={{ marginLeft: 8, fontWeight: 700 }}>+{(entry.bestSideEV * 100).toFixed(1)}%</span>
                    </div>
                  )}
                  {!isPositive && (
                    <div style={{ fontSize: '0.55rem', color: DIM }}>No edge</div>
                  )}
                </>
              ) : (
                <>
                  <div style={{ fontSize: '0.55rem', color: DIM, marginBottom: 4 }}>
                    Fair: {entry.homeTeam.split(' ').pop()} {(entry.consensus.homeWinProb * 100).toFixed(0)}% · {entry.awayTeam.split(' ').pop()} {(entry.consensus.awayWinProb * 100).toFixed(0)}%
                    <span style={{ marginLeft: 6 }}>{entry.consensus.numBookmakers} books</span>
                  </div>
                  <div style={{ fontSize: '0.55rem', color: DIM }}>No market</div>
                </>
              )}
            </div>
          );

          if (entry.polymarketUrl) {
            return (
              <a key={entry.oddsGameId} href={entry.polymarketUrl} target="_blank" rel="noopener noreferrer"
                style={{ textDecoration: 'none', color: 'inherit' }} className="schedule-row-link">
                {cardContent}
              </a>
            );
          }
          return <div key={entry.oddsGameId}>{cardContent}</div>;
        })}
      </div>
    </div>
  );
}
