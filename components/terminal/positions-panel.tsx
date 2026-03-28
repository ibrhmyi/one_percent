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
  exitPrice?: number;
  exitOrderStatus?: 'pending' | 'resting' | 'filled' | 'none';
  currentPrice?: number;
  spread?: number;
  slug?: string;
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
          const edgePct = (order.edge * 100).toFixed(1);
          const tokens = Math.round(order.size / order.price);
          const currentPrice = order.currentPrice ?? order.price;
          const unrealizedPnl = isFilled ? (currentPrice - fillPrice) * tokens : 0;
          const pnlStr = unrealizedPnl >= 0 ? `+$${unrealizedPnl.toFixed(2)}` : `-$${Math.abs(unrealizedPnl).toFixed(2)}`;
          const polyUrl = order.slug
            ? `https://polymarket.com/event/${order.slug}`
            : `https://polymarket.com/search?query=${encodeURIComponent(order.homeTeam + ' ' + order.awayTeam)}`;

          return (
            <a key={order.orderId} href={polyUrl} target="_blank" rel="noopener noreferrer"
              className="schedule-row-link"
              style={{ textDecoration: 'none', color: 'inherit' }}>
              <div className="card-interactive" style={{
                border: '1px solid var(--border-default)',
                borderLeft: `3px solid ${isFilled ? 'var(--green)' : 'var(--cyan)'}`,
                borderRadius: 6,
                padding: '10px 12px',
              }}>
                {/* Teams */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.9)', fontWeight: 600 }}>
                    {order.awayTeam} @ {order.homeTeam}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    {order.orderId.startsWith('sim-') && (
                      <span style={{ fontSize: '0.45rem', color: DIM, padding: '1px 3px', border: '1px solid var(--border-default)', borderRadius: 2 }}>DRY</span>
                    )}
                    <span style={{ fontSize: '0.5rem', color: DIM }}>↗</span>
                  </div>
                </div>

                {/* Position + Side */}
                <div style={{ fontSize: '0.6rem', color: 'var(--cyan)', marginBottom: 4 }}>
                  {isFilled ? 'Bought' : 'Buy'} {side} ({getBetMeaning(order)})
                </div>

                {/* Entry · Fair · Edge in one row */}
                <div style={{ display: 'flex', gap: 12, fontSize: '0.6rem', fontFamily: 'var(--font-mono)', marginBottom: 4 }}>
                  <span><span style={{ color: DIM, fontSize: '0.5rem' }}>{isFilled ? 'ENTRY ' : 'LIMIT '}</span><span style={{ color: 'rgba(255,255,255,0.9)' }}>{(fillPrice * 100).toFixed(0)}¢</span></span>
                  <span><span style={{ color: DIM, fontSize: '0.5rem' }}>FAIR </span><span style={{ color: 'rgba(255,255,255,0.9)' }}>{(order.fairValue * 100).toFixed(0)}¢</span></span>
                  <span><span style={{ color: DIM, fontSize: '0.5rem' }}>EDGE </span><span style={{ color: 'var(--green)', fontWeight: 700 }}>+{edgePct}%</span></span>
                  {(order.spread ?? 0) > 0 && (
                    <span><span style={{ color: DIM, fontSize: '0.5rem' }}>SPRD </span><span style={{ color: (order.spread ?? 0) > 10 ? 'var(--red)' : DIM }}>{(order.spread ?? 0).toFixed(0)}¢</span></span>
                  )}
                </div>

                {/* Exit order + Value + Status */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', gap: 10, fontSize: '0.55rem' }}>
                    <span style={{ color: DIM }}>${order.size.toFixed(0)} · {tokens}sh</span>
                    {isFilled && (
                      <>
                        <span style={{ color: DIM }}>Now {(currentPrice * 100).toFixed(0)}¢</span>
                        <span style={{ color: unrealizedPnl >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>{pnlStr}</span>
                      </>
                    )}
                  </div>
                  <span style={{ fontSize: '0.55rem', fontWeight: 600, color: isFilled ? 'var(--green)' : DIM }}>
                    {isFilled ? '● FILLED' : '○ RESTING'}
                  </span>
                </div>

                {/* Exit order info */}
                {isFilled && order.exitPrice && (
                  <div style={{ fontSize: '0.5rem', color: DIM, marginTop: 4, paddingTop: 4, borderTop: '1px solid var(--border-default)' }}>
                    EXIT @ {(order.exitPrice * 100).toFixed(0)}¢
                    <span style={{ marginLeft: 8, color: order.exitOrderStatus === 'filled' ? 'var(--green)' : DIM }}>
                      {order.exitOrderStatus === 'filled' ? '● FILLED' : order.exitOrderStatus === 'resting' ? '○ AWAITING' : '○ PENDING'}
                    </span>
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
