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

export function PositionsPanel({ orders, summary }: Props) {
  const active = orders.filter(o => o.status !== 'cancelled');

  if (active.length === 0) {
    return (
      <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div className="panel-header">
          Pre-Game Trades
          {summary && <span style={{ color: DIM, fontWeight: 400, marginLeft: 6 }}>${summary.totalDeployed.toFixed(0)} deployed</span>}
        </div>
        <div style={{ color: DIM, fontSize: '0.65rem', padding: '12px 0', textAlign: 'center', flex: 1 }}>
          No active pre-game trades
        </div>
      </div>
    );
  }

  return (
    <div className="panel" style={{ overflow: 'hidden', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header">
        Pre-Game Trades
        <span style={{ color: DIM, fontWeight: 400, marginLeft: 6 }}>
          {active.length} active · ${summary?.totalDeployed?.toFixed(0) ?? '0'} deployed
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 2 }}>
        {active.map(order => {
          const side = order.tokenSide ?? (order.fairValue > 0.5 ? 'YES' : 'NO');
          const isFilled = order.status === 'filled' || order.status === 'partially_filled';
          // Avg fill price — accounts for fills across multiple price levels
          const fillPrice = isFilled && order.avgFillPrice > 0 ? order.avgFillPrice : order.price;
          const edgePct = (order.edge * 100).toFixed(1);
          const tokens = Math.round((isFilled ? order.filledSize : order.size) / fillPrice);
          const dollarAmount = isFilled ? order.filledSize : order.size;
          const currentPrice = order.currentPrice ?? fillPrice;
          const unrealizedPnl = isFilled ? (currentPrice - fillPrice) * tokens : 0;
          const pnlStr = unrealizedPnl >= 0 ? `+$${unrealizedPnl.toFixed(2)}` : `-$${Math.abs(unrealizedPnl).toFixed(2)}`;
          const polyUrl = order.slug
            ? `https://polymarket.com/event/${order.slug}`
            : undefined;

          return (
            <a key={order.orderId} href={polyUrl} target="_blank" rel="noopener noreferrer"
              className="schedule-row-link"
              style={{ textDecoration: 'none', color: 'inherit' }}>
              <div className="card-interactive" style={{
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid var(--border-default)',
                borderRadius: 6,
                padding: '10px 12px',
              }}>
                {/* Teams + OPEN + Entry time */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.9)', fontWeight: 600 }}>
                    {order.awayTeam} vs {order.homeTeam}
                  </span>
                  <span style={{ fontSize: '0.5rem', color: 'var(--cyan)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                    OPEN {new Date(order.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}
                  </span>
                </div>

                {/* Position + current price on same row */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.6rem', marginBottom: 4 }}>
                  <span style={{ color: DIM }}>
                    Bought {side} ${dollarAmount.toFixed(0)} · {tokens} shares
                  </span>
                  <span style={{ color: 'rgba(255,255,255,0.9)', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                    {(currentPrice * 100).toFixed(1)}¢
                  </span>
                </div>

                {/* Entry · Limit Exit · Edge · P&L — all one row */}
                <div style={{ display: 'flex', gap: 12, fontSize: '0.6rem', fontFamily: 'var(--font-mono)', alignItems: 'center' }}>
                  <span>
                    <span style={{ color: DIM, fontSize: '0.5rem' }}>Entry </span>
                    <span style={{ color: 'rgba(255,255,255,0.9)' }}>{(fillPrice * 100).toFixed(1)}¢</span>
                  </span>
                  <span>
                    <span style={{ color: DIM, fontSize: '0.5rem' }}>Limit Exit </span>
                    <span style={{ color: 'rgba(255,255,255,0.9)' }}>{(order.fairValue * 100).toFixed(0)}¢</span>
                  </span>
                  <span>
                    <span style={{ color: DIM, fontSize: '0.5rem' }}>Edge </span>
                    <span style={{ color: 'rgba(255,255,255,0.9)', fontWeight: 600 }}>+{edgePct}%</span>
                  </span>
                  <span style={{ marginLeft: 'auto' }}>
                    <span style={{ color: unrealizedPnl >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>{pnlStr}</span>
                  </span>
                </div>
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}
