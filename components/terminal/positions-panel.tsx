'use client';

interface PreGameOrder {
  orderId: string;
  conditionId: string;
  tokenId: string;
  side: 'BUY';
  tokenSide?: 'YES' | 'NO';
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
  summary: { restingCount: number; filledCount: number; totalDeployed: number } | null;
}

const DIM = 'rgba(255,255,255,0.4)';
const LABEL: React.CSSProperties = { fontSize: '0.55rem', color: DIM, textTransform: 'uppercase', letterSpacing: '0.05em', width: 56, flexShrink: 0 };
const VALUE: React.CSSProperties = { fontSize: '0.68rem', color: 'rgba(255,255,255,0.9)', fontFamily: 'var(--font-mono)' };

function getBetMeaning(order: PreGameOrder): string {
  const side = order.tokenSide ?? (order.fairValue > 0.5 ? 'YES' : 'NO');
  // If YES, we're betting the home team wins (assuming homeIsYes)
  // Simplify: show team name based on side
  if (side === 'YES') return `${order.homeTeam.split(' ').pop()} wins`;
  return `${order.homeTeam.split(' ').pop()} loses`;
}

export function PositionsPanel({ orders, summary }: Props) {
  const active = orders.filter(o => o.status !== 'cancelled');

  if (active.length === 0) {
    return (
      <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div className="panel-header">
          Pre-Game Positions
          {summary && <span style={{ color: DIM, fontWeight: 400, marginLeft: 6 }}>${summary.totalDeployed.toFixed(0)} deployed</span>}
        </div>
        <div style={{ color: DIM, fontSize: '0.65rem', padding: '12px 0', textAlign: 'center', flex: 1 }}>
          No active pre-game positions
        </div>
      </div>
    );
  }

  return (
    <div className="panel" style={{ overflow: 'hidden', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header">
        Pre-Game Positions
        <span style={{ color: DIM, fontWeight: 400, marginLeft: 6 }}>
          {active.length} active · ${summary?.totalDeployed?.toFixed(0) ?? '0'} deployed
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 2 }}>
        {active.map(order => {
          const side = order.tokenSide ?? (order.fairValue > 0.5 ? 'YES' : 'NO');
          const isFilled = order.status === 'filled' || order.status === 'partially_filled';
          const fillPrice = isFilled ? order.avgFillPrice : order.price;
          const edgeCents = (order.edge * 100).toFixed(1);
          const edgePct = (order.edge * 100).toFixed(1);
          const tokens = Math.round(order.size / order.price);
          const potentialProfit = ((1 - fillPrice) * tokens).toFixed(2);
          const polyUrl = `https://polymarket.com/search?query=${encodeURIComponent(order.homeTeam + ' ' + order.awayTeam)}`;

          return (
            <a key={order.orderId} href={polyUrl} target="_blank" rel="noopener noreferrer"
              className="schedule-row-link"
              style={{ textDecoration: 'none', color: 'inherit' }}>
              <div className="card-interactive" style={{
                background: 'var(--bg-card-elevated)',
                border: '1px solid var(--border-default)',
                borderLeft: `3px solid ${isFilled ? 'var(--green)' : 'var(--cyan)'}`,
                borderRadius: 6,
                padding: '10px 12px',
              }}>
                {/* Teams + link */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.9)', fontWeight: 600 }}>
                    {order.awayTeam} @ {order.homeTeam}
                  </span>
                  <span style={{ fontSize: '0.5rem', color: DIM }}>↗</span>
                </div>

                {/* Key-value rows */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <span style={LABEL}>{isFilled ? 'Position' : 'Order'}</span>
                    <span style={{ ...VALUE, color: 'var(--cyan)' }}>
                      {isFilled ? 'Bought' : 'Buy'} {side} ({getBetMeaning(order)})
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <span style={LABEL}>{isFilled ? 'Entry' : 'Limit'}</span>
                    <span style={VALUE}>{(fillPrice * 100).toFixed(0)}¢ per share</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <span style={LABEL}>Fair</span>
                    <span style={VALUE}>{(order.fairValue * 100).toFixed(0)}¢</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <span style={LABEL}>Edge</span>
                    <span style={{ ...VALUE, color: 'var(--green)', fontWeight: 700 }}>+{edgeCents}¢ per share (+{edgePct}%)</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <span style={LABEL}>Size</span>
                    <span style={VALUE}>${order.size.toFixed(0)} · {tokens} shares</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <span style={LABEL}>Status</span>
                    <span style={{
                      fontSize: '0.6rem', fontWeight: 600,
                      color: isFilled ? 'var(--green)' : DIM,
                    }}>
                      {isFilled ? '● FILLED' : '○ RESTING · waiting fill'}
                    </span>
                    {order.orderId.startsWith('sim-') && (
                      <span style={{ fontSize: '0.5rem', color: DIM, marginLeft: 6, padding: '1px 4px', border: '1px solid var(--border-default)', borderRadius: 2 }}>DRY</span>
                    )}
                  </div>
                </div>

                {/* Outcome line */}
                {isFilled && (
                  <div style={{ fontSize: '0.55rem', color: DIM, marginTop: 6, paddingTop: 4, borderTop: '1px solid var(--border-default)' }}>
                    If {side === 'YES' ? 'wins' : 'outcome correct'} → profit ${potentialProfit}
                    <span style={{ margin: '0 6px' }}>·</span>
                    If wrong → lose ${order.size.toFixed(0)}
                  </div>
                )}
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}
