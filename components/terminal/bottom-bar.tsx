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

  const sep = <span style={{ color: 'rgba(255,255,255,0.08)', margin: '0 2px' }}>|</span>;

  return (
    <div style={{
      flexShrink: 0,
      background: 'rgba(20, 25, 34, 0.8)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      border: '1px solid var(--border-default)',
      borderRadius: 8,
      margin: '0 4px 4px 4px',
      padding: '5px 16px',
      display: 'flex', alignItems: 'center', gap: '12px',
      fontSize: '0.6rem', color: 'var(--text-dim)',
      fontFamily: 'var(--font-mono)',
      boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
    }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
        <span className="pulse-dot" style={{ width: 6, height: 6, borderRadius: '50%', display: 'inline-block', background: isRunning ? 'var(--green)' : 'var(--red)', boxShadow: isRunning ? '0 0 6px var(--green-glow)' : 'none' }} />
        <span style={{ color: isRunning ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>{isRunning ? 'ACTIVE' : 'OFFLINE'}</span>
      </span>
      {sep}
      <span>WS <span style={{ color: wsConnected ? 'var(--green)' : 'var(--text-dim)', fontWeight: 600 }}>{wsConnected ? 'LIVE' : 'POLL'}</span></span>
      {sep}
      <span>CYCLE <span style={{ color: 'var(--text-secondary)' }}>{cycleCount.toLocaleString()}</span></span>
      {sep}
      <span>GAMES <span style={{ color: liveGames > 0 ? 'var(--green)' : 'var(--text-secondary)' }}>{liveGames}</span><span style={{ color: 'var(--text-dim)' }}>/{totalGames}</span></span>
      {sep}
      {latency !== null && <><span>LAT <span style={{ color: latency > 500 ? 'var(--red)' : 'var(--text-secondary)' }}>{latency}ms</span></span>{sep}</>}
      <span>UP <span style={{ color: 'var(--text-secondary)' }}>{formatUptime(uptimeSeconds)}</span></span>
      <span style={{ color: 'var(--text-dim)', marginLeft: 'auto', fontSize: '0.55rem', letterSpacing: '0.05em' }}>1% ENGINE v1.0</span>
    </div>
  );
}
