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
}
interface Props { events: ScoringEvent[]; }

export function ScoreFeed({ events }: Props) {
  const reversed = [...events].reverse().slice(0, 20);
  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header">Live Score Feed</div>
      {reversed.length === 0 ? (
        <div style={{ color: 'var(--text-dim)', fontSize: '0.7rem', padding: '8px 0' }}>
          Waiting for live games...
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, overflowY: 'auto' }}>
          {reversed.map((ev, i) => {
            const edgePct = (ev.edge * 100).toFixed(1);
            const isPositive = ev.edge > 0;
            return (
              <div key={i} className="fade-in" style={{
                background: 'var(--bg-secondary)',
                border: `1px solid ${ev.action === 'enter' ? 'rgba(34,197,94,0.4)' : 'var(--border-default)'}`,
                borderRadius: 4,
                padding: '6px 8px',
                fontSize: '0.7rem',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                  <span style={{ color: 'var(--text-dim)', fontSize: '0.6rem' }}>
                    {new Date(ev.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
                  </span>
                  <span style={{ color: 'var(--text-secondary)' }}>{ev.period} {ev.clock}</span>
                </div>
                <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>
                  {ev.awayTeam} {ev.awayScore} — {ev.homeScore} {ev.homeTeam}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ color: 'var(--cyan)' }}>Model {(ev.modelProb * 100).toFixed(1)}%</span>
                  <span style={{ color: 'var(--text-secondary)' }}>Mkt {(ev.marketPrice * 100).toFixed(0)}¢</span>
                  <span style={{ color: isPositive ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
                    Edge {isPositive ? '+' : ''}{edgePct}%
                  </span>
                  {ev.action === 'enter' && (
                    <span className="badge" style={{ background: 'rgba(34,197,94,0.15)', color: 'var(--green)', border: '1px solid rgba(34,197,94,0.3)' }}>
                      TRADE
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
