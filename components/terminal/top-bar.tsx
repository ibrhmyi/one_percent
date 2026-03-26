'use client';
interface ScoringEvent {
  timestamp: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  period: string;
  clock: string;
  edge: number;
  action: string;
  reason: string;
}
interface Props {
  scoringEvents: ScoringEvent[];
  cycleCount: number;
  liveGames: number;
  isRunning: boolean;
  wsConnected: boolean;
}
export function TopBar({ scoringEvents, cycleCount, liveGames, isRunning, wsConnected }: Props) {
  const tapeItems = scoringEvents.slice(-20).reverse().map((ev, i) => {
    const edgePct = (ev.edge * 100).toFixed(1);
    const color = ev.action === 'enter' ? 'var(--green)' : ev.edge > 0 ? 'var(--amber)' : 'var(--text-dim)';
    return (
      <span key={i} style={{ marginRight: '40px', color }}>
        {ev.awayTeam} @ {ev.homeTeam} {ev.period} {ev.clock} — {ev.awayScore}–{ev.homeScore} — edge: {ev.edge > 0 ? '+' : ''}{edgePct}%{ev.action === 'enter' ? ' → TRADE' : ''}
      </span>
    );
  });

  return (
    <div style={{
      height: '32px',
      background: 'var(--bg-secondary)',
      borderBottom: '1px solid var(--border-default)',
      display: 'flex', alignItems: 'center',
      overflow: 'hidden',
      fontSize: '0.7rem',
      fontFamily: 'var(--font-mono)',
    }}>
      {/* Logo */}
      <div style={{
        padding: '0 16px',
        borderRight: '1px solid var(--border-default)',
        whiteSpace: 'nowrap',
        color: 'var(--cyan)',
        fontWeight: 700,
        fontSize: '0.8rem',
        letterSpacing: '-0.02em',
        flexShrink: 0,
      }}>
        ONEPERCENT
      </div>

      {/* Scrolling tape */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {tapeItems.length > 0 ? (
          <div className="ticker-tape">{tapeItems}{tapeItems}</div>
        ) : (
          <span style={{ padding: '0 16px', color: 'var(--text-dim)' }}>Waiting for scoring events...</span>
        )}
      </div>

      {/* Stats */}
      <div style={{
        padding: '0 16px',
        borderLeft: '1px solid var(--border-default)',
        whiteSpace: 'nowrap',
        color: 'var(--text-dim)',
        flexShrink: 0,
        display: 'flex', gap: '12px',
      }}>
        <span>CYC <span style={{ color: 'var(--text-secondary)' }}>{cycleCount.toLocaleString()}</span></span>
        <span>LIVE <span style={{ color: liveGames > 0 ? 'var(--green)' : 'var(--text-dim)' }}>{liveGames}</span></span>
        <span style={{ color: isRunning ? 'var(--green)' : 'var(--red)' }}>{isRunning ? '● ON' : '○ OFF'}</span>
      </div>
    </div>
  );
}
