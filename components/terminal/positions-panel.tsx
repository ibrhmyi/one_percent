'use client';

interface PreGameOrder {
  orderId: string;
  conditionId: string;
  tokenId: string;
  side: 'BUY';
  price: number;
  size: number;
  filledSize: number;
  avgFillPrice: number;
  status: 'resting' | 'partially_filled' | 'filled' | 'cancelled';
  strategy: string;
  sportKey: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  fairValue: number;
  edge: number;
  createdAt: string;
  updatedAt: string;
}

interface Props {
  orders: PreGameOrder[];
  summary: {
    restingCount: number;
    filledCount: number;
    totalDeployed: number;
  } | null;
}

function formatVol(v: number) {
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

export function PositionsPanel({ orders, summary }: Props) {
  const active = orders.filter(o => o.status !== 'cancelled');

  if (active.length === 0) {
    return (
      <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div className="panel-header">
          Pre-Game Positions
          {summary && (
            <span style={{ color: 'var(--text-dim)', fontWeight: 400, marginLeft: 6 }}>
              ${summary.totalDeployed.toFixed(0)} deployed
            </span>
          )}
        </div>
        <div style={{ color: 'var(--text-dim)', fontSize: '0.65rem', padding: '12px 0', textAlign: 'center', flex: 1 }}>
          No active pre-game positions
        </div>
      </div>
    );
  }

  const resting = active.filter(o => o.status === 'resting');
  const filled = active.filter(o => o.status === 'filled' || o.status === 'partially_filled');

  return (
    <div className="panel" style={{ overflow: 'hidden', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header">
        Pre-Game Positions
        <span style={{ color: 'var(--text-dim)', fontWeight: 400, marginLeft: 6 }}>
          {active.length} active · {formatVol(summary?.totalDeployed ?? 0)} deployed
        </span>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {/* Header row */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '2fr 60px 60px 60px 60px 60px',
          gap: 4, padding: '4px 6px',
          fontSize: '0.55rem', color: 'var(--text-dim)',
          textTransform: 'uppercase', letterSpacing: '0.08em',
          borderBottom: '1px solid var(--border-default)',
          position: 'sticky', top: 0, background: 'var(--bg-card)',
        }}>
          <span>Game</span>
          <span>Fair</span>
          <span>Price</span>
          <span>Edge</span>
          <span>Size</span>
          <span>Status</span>
        </div>

        {/* Filled positions first */}
        {filled.map(order => {
          const edgePct = (order.edge * 100).toFixed(1);
          // P&L = fair value - fill price (unrealized, based on consensus)
          const pnl = order.avgFillPrice > 0 ? order.fairValue - order.avgFillPrice : 0;

          return (
            <div key={order.orderId} style={{
              display: 'grid',
              gridTemplateColumns: '2fr 60px 60px 60px 60px 60px',
              gap: 4, padding: '6px 6px',
              borderBottom: '1px solid var(--border-default)',
              borderLeft: '2px solid var(--green)',
              background: 'rgba(34,197,94,0.04)',
              alignItems: 'center',
            }}>
              <div>
                <a
                  href={`https://polymarket.com/search?query=${encodeURIComponent(order.homeTeam + ' ' + order.awayTeam)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="schedule-row-link"
                  style={{ fontSize: '0.68rem', color: 'var(--text-primary)', fontWeight: 500, textDecoration: 'none', display: 'block' }}
                >
                  {order.awayTeam} @ {order.homeTeam} <span style={{ fontSize: '0.5rem', color: 'var(--text-dim)' }}>↗</span>
                </a>
                <div style={{ fontSize: '0.55rem', color: 'var(--text-dim)' }}>
                  Filled @ {(order.avgFillPrice * 100).toFixed(0)}¢
                  {pnl !== 0 && (
                    <span style={{ color: pnl > 0 ? 'var(--green)' : 'var(--red)', marginLeft: 4 }}>
                      {pnl > 0 ? '+' : ''}{(pnl * 100).toFixed(1)}¢
                    </span>
                  )}
                </div>
              </div>
              <span style={{ fontSize: '0.65rem', color: 'var(--cyan)', fontFamily: 'var(--font-mono)' }}>
                {(order.fairValue * 100).toFixed(0)}%
                <span style={{ fontSize: '0.45rem', color: 'var(--text-dim)', marginLeft: 2 }}>
                  {order.fairValue > 0.5 ? 'YES' : 'NO'}
                </span>
              </span>
              <span style={{ fontSize: '0.65rem', color: 'var(--green)', fontFamily: 'var(--font-mono)' }}>
                {(order.price * 100).toFixed(0)}¢
              </span>
              <span style={{ fontSize: '0.65rem', color: 'var(--green)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                +{edgePct}%
              </span>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                ${order.filledSize.toFixed(0)}
              </span>
              <span style={{
                fontSize: '0.5rem', padding: '1px 5px', borderRadius: 2,
                background: 'rgba(34,197,94,0.15)', color: 'var(--green)',
                border: '1px solid rgba(34,197,94,0.3)', fontWeight: 600,
                textAlign: 'center',
              }}>FILLED</span>
            </div>
          );
        })}

        {/* Resting orders */}
        {resting.map(order => {
          const edgePct = (order.edge * 100).toFixed(1);

          return (
            <div key={order.orderId} style={{
              display: 'grid',
              gridTemplateColumns: '2fr 60px 60px 60px 60px 60px',
              gap: 4, padding: '6px 6px',
              borderBottom: '1px solid var(--border-default)',
              borderLeft: '2px solid var(--amber)',
              background: 'rgba(245,158,11,0.03)',
              alignItems: 'center',
            }}>
              <div>
                <a
                  href={`https://polymarket.com/search?query=${encodeURIComponent(order.homeTeam + ' ' + order.awayTeam)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="schedule-row-link"
                  style={{ fontSize: '0.68rem', color: 'var(--text-primary)', fontWeight: 500, textDecoration: 'none', display: 'block' }}
                >
                  {order.awayTeam} @ {order.homeTeam} <span style={{ fontSize: '0.5rem', color: 'var(--text-dim)' }}>↗</span>
                </a>
                <div style={{ fontSize: '0.55rem', color: 'var(--text-dim)' }}>
                  {order.orderId.startsWith('sim-') ? 'DRY' : 'LIVE'} · Limit @ {(order.price * 100).toFixed(0)}¢
                </div>
              </div>
              <span style={{ fontSize: '0.65rem', color: 'var(--cyan)', fontFamily: 'var(--font-mono)' }}>
                {(order.fairValue * 100).toFixed(0)}%
                <span style={{ fontSize: '0.45rem', color: 'var(--text-dim)', marginLeft: 2 }}>
                  {order.fairValue > 0.5 ? 'YES' : 'NO'}
                </span>
              </span>
              <span style={{ fontSize: '0.65rem', color: 'var(--amber)', fontFamily: 'var(--font-mono)' }}>
                {(order.price * 100).toFixed(0)}¢
              </span>
              <span style={{ fontSize: '0.65rem', color: 'var(--green)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                +{edgePct}%
              </span>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                ${order.size.toFixed(0)}
              </span>
              <span style={{
                fontSize: '0.5rem', padding: '1px 5px', borderRadius: 2,
                background: 'rgba(245,158,11,0.12)', color: 'var(--amber)',
                border: '1px solid rgba(245,158,11,0.25)', fontWeight: 600,
                textAlign: 'center',
              }}>RESTING</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
