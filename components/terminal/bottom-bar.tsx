'use client';
function formatUptime(secs: number) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h${String(m).padStart(2,'0')}m`;
  if (m > 0) return `${m}m${String(s).padStart(2,'0')}s`;
  return `${s}s`;
}
interface Props {
  wsConnected: boolean;
  isRunning: boolean;
  cycleCount: number;
  uptimeSeconds: number;
  liveGames: number;
  totalGames: number;
  lastCycleAt: string | null;
}
export function BottomBar({ wsConnected, isRunning, cycleCount, uptimeSeconds, liveGames, totalGames, lastCycleAt }: Props) {
  const latency = lastCycleAt
    ? Math.min(999, Date.now() - new Date(lastCycleAt).getTime())
    : null;
  return (
    <div style={{
      flexShrink: 0,
      background: 'var(--bg-card)',
      border: '1px solid var(--border-default)',
      borderRadius: 6,
      margin: '0 4px 4px 4px',
      padding: '4px 16px',
      display: 'flex', alignItems: 'center', gap: '16px',
      fontSize: '0.65rem', color: 'var(--text-dim)',
      fontFamily: 'var(--font-mono)',
    }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
        <span className="pulse-dot" style={{ width: 7, height: 7, borderRadius: '50%', display: 'inline-block', background: isRunning ? 'var(--green)' : 'var(--red)' }} />
        <span style={{ color: isRunning ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>{isRunning ? 'ACTIVE' : 'OFFLINE'}</span>
      </span>
      <span style={{ color: 'var(--border-accent)' }}>|</span>
      <span>WS: <span style={{ color: wsConnected ? 'var(--green)' : 'var(--amber)', fontWeight: 600 }}>{wsConnected ? '●LIVE' : '○POLL'}</span></span>
      <span style={{ color: 'var(--border-accent)' }}>|</span>
      <span>ESPN: <span style={{ color: 'var(--text-secondary)' }}>1.0/s</span></span>
      <span style={{ color: 'var(--border-accent)' }}>|</span>
      <span>CYCLE: <span style={{ color: 'var(--text-secondary)' }}>{cycleCount.toLocaleString()}</span></span>
      <span style={{ color: 'var(--border-accent)' }}>|</span>
      <span>GAMES: <span style={{ color: liveGames > 0 ? 'var(--green)' : 'var(--text-secondary)' }}>{liveGames} live</span> / {totalGames} total</span>
      <span style={{ color: 'var(--border-accent)' }}>|</span>
      {latency !== null && <><span>LAT: <span style={{ color: latency > 500 ? 'var(--amber)' : 'var(--text-secondary)' }}>{latency}ms</span></span><span style={{ color: 'var(--border-accent)' }}>|</span></>}
      <span>UP: <span style={{ color: 'var(--text-secondary)' }}>{formatUptime(uptimeSeconds)}</span></span>
      <span style={{ color: 'var(--border-accent)' }}>|</span>
      <span style={{ color: 'var(--text-dim)', marginLeft: 'auto' }}>1% ENGINE v1.0</span>
    </div>
  );
}
