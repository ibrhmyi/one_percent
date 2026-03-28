'use client';
interface ScoringEvent {
  timestamp: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  period: string;
  clock: string;
  modelProb: number;
  marketPrice: number;
  edge: number;
  ev: number;
  action: string;
  reason: string;
  scoringTeam?: string;
  pointsScored?: number;
}
interface Props { events: ScoringEvent[]; }

export function ScoreFeed({ events }: Props) {
  const reversed = [...events].reverse().slice(0, 30);
  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div className="panel-header">Live Score Feed</div>
      {reversed.length === 0 ? (
        <div style={{ color: 'var(--text-dim)', fontSize: '0.7rem', padding: '8px 0' }}>
          Waiting for live games...
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, overflowY: 'auto', flex: 1, minHeight: 0 }}>
          {reversed.map((ev, i) => {
            const edgePct = (ev.edge * 100).toFixed(1);
            const isSignificant = Math.abs(ev.edge) > 0.015; // >1.5% = significant edge
            const isPositive = ev.edge > 0;

            // Determine who scored
            const scorer = ev.scoringTeam || '';
            const pts = ev.pointsScored || 0;
            const scoreLine = scorer && pts > 0
              ? `${scorer} +${pts}`
              : '';

            return (
              <div key={i} className="fade-in" style={{
                background: 'var(--bg-secondary)',
                border: `1px solid ${isSignificant ? 'rgba(34,197,94,0.3)' : 'var(--border-default)'}`,
                borderRadius: 4,
                padding: '5px 8px',
                fontSize: '0.65rem',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                  <span style={{ color: 'var(--text-dim)', fontSize: '0.55rem' }}>
                    {new Date(ev.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
                  </span>
                  <span style={{ color: 'var(--text-secondary)', fontSize: '0.55rem' }}>{ev.period} {ev.clock}</span>
                </div>
                {scoreLine && (
                  <div style={{ color: 'var(--cyan)', fontSize: '0.6rem', fontWeight: 600, marginBottom: 1 }}>
                    {scoreLine}
                  </div>
                )}
                <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>
                  {ev.awayTeam} {ev.awayScore} — {ev.homeScore} {ev.homeTeam}
                </div>
                <div style={{ display: 'flex', gap: 8, fontSize: '0.6rem', flexWrap: 'wrap' }}>
                  <span style={{ color: 'var(--cyan)' }}>Model {(ev.modelProb * 100).toFixed(1)}%</span>
                  <span style={{ color: 'var(--text-secondary)' }}>Market {(ev.marketPrice * 100).toFixed(0)}¢</span>
                  <span style={{ color: isSignificant ? (isPositive ? 'var(--green)' : 'var(--red)') : 'var(--text-dim)', fontWeight: isSignificant ? 600 : 400 }}>
                    Edge {isPositive ? '+' : ''}{edgePct}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
