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

const DIM = 'rgba(255,255,255,0.3)';

export function ScoreFeed({ events }: Props) {
  // Show last 30 minutes of events
  const thirtyMinAgo = Date.now() - 30 * 60 * 1000;
  const recent = events.filter(ev => new Date(ev.timestamp).getTime() > thirtyMinAgo);
  const reversed = [...recent].reverse().slice(0, 40);

  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div className="panel-header">Live Scores</div>
      {reversed.length === 0 ? (
        <div style={{ color: 'var(--text-dim)', fontSize: '0.7rem', padding: '8px 0' }}>
          Waiting for live games...
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, overflowY: 'auto', flex: 1, minHeight: 0 }}>
          {reversed.map((ev, i) => {
            const edgePct = (ev.edge * 100).toFixed(1);
            const isSignificant = Math.abs(ev.edge) > 0.015;
            const isPositive = ev.edge > 0;

            // Determine who scored — use scoringTeam if available, otherwise infer
            const scorer = ev.scoringTeam || '';
            const pts = ev.pointsScored || 0;

            // Display score in market order: title is "away vs home" on Polymarket
            // Show the YES team first (which is homeTeam in our data = first listed on market)
            // Actually: show in same order as the market listing
            const team1 = ev.homeTeam;
            const team2 = ev.awayTeam;
            const score1 = ev.homeScore;
            const score2 = ev.awayScore;

            return (
              <div key={i} className="fade-in" style={{
                background: 'var(--bg-secondary)',
                border: `1px solid ${isSignificant ? 'rgba(8,145,178,0.4)' : 'var(--border-default)'}`,
                borderRadius: 4,
                padding: '5px 8px',
                fontSize: '0.65rem',
              }}>
                {/* Time + Period + Score change */}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                  <span style={{ color: 'var(--text-dim)', fontSize: '0.55rem' }}>
                    {new Date(ev.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
                    <span style={{ marginLeft: 6 }}>{ev.period} {ev.clock}</span>
                  </span>
                  {scorer && pts > 0 && (
                    <span style={{ color: DIM, fontSize: '0.55rem', fontWeight: 600 }}>
                      {scorer} +{pts}
                    </span>
                  )}
                </div>

                {/* Score line — in market order */}
                <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>
                  {team1} {score1} — {score2} {team2}
                </div>

                {/* Model · Market · Edge */}
                <div style={{ display: 'flex', gap: 8, fontSize: '0.6rem', flexWrap: 'wrap' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Model {(ev.modelProb * 100).toFixed(1)}%</span>
                  <span style={{ color: 'var(--text-secondary)' }}>Market {(ev.marketPrice * 100).toFixed(0)}¢</span>
                  <span style={{
                    color: isSignificant ? 'var(--cyan)' : 'var(--text-dim)',
                    fontWeight: isSignificant ? 600 : 400,
                  }}>
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
