'use client';

interface Trade {
  id: string;
  marketTitle?: string;
  side: string;
  entryPrice: number;
  currentPrice?: number;
  exitPrice?: number | null;
  entryAmount: number;
  tokens?: number;
  pnl?: number | null;
  status: string;
  enteredAt: string;
  exitedAt?: string | null;
  exitReason?: string | null;
  isDryRun?: boolean;
}
interface Props { trades: Trade[]; mode: string; }

const DIM = 'rgba(255,255,255,0.4)';

export function TradesPanel({ trades, mode }: Props) {
  const recent = [...trades].reverse().slice(0, 15);
  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header">Live Trades</div>
      {recent.length === 0 ? (
        <div style={{ color: DIM, fontSize: '0.7rem', flex: 1 }}>No trades yet</div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 2 }}>
          {recent.map(t => {
            const pnl = t.pnl ?? 0;
            const isOpen = t.status === 'open';
            const isProfit = pnl >= 0 && !isOpen;
            const isLoss = pnl < 0;
            const nowPrice = t.exitPrice ?? t.currentPrice ?? t.entryPrice;
            const tokens = t.tokens ?? (t.entryAmount > 0 && t.entryPrice > 0 ? Math.round(t.entryAmount / t.entryPrice) : 0);
            const pnlStr = pnl >= 0 ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`;

            return (
              <div key={t.id} className="card-interactive" style={{
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid var(--border-default)',
                borderLeft: `3px solid ${isOpen ? 'var(--cyan)' : isProfit ? 'var(--green)' : isLoss ? 'var(--red)' : 'var(--border-default)'}`,
                borderRadius: 6,
                padding: '10px 12px',
              }}>
                {/* Teams + time/closed status */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.9)', fontWeight: 600 }}>
                    {t.marketTitle ?? '—'}
                  </span>
                  <span style={{ fontSize: '0.5rem', color: DIM, fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                    {isOpen
                      ? `OPEN ${new Date(t.enteredAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}`
                      : `CLOSED ${t.exitedAt ? new Date(t.exitedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }) : ''}`
                    }
                  </span>
                </div>

                {/* Position + current/exit price */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.6rem', marginBottom: 4 }}>
                  <span style={{ color: DIM }}>
                    Bought {t.side?.toUpperCase()} ${t.entryAmount.toFixed(0)} · {Math.round(tokens)} shares
                  </span>
                  <span style={{ color: 'rgba(255,255,255,0.9)', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                    {(nowPrice * 100).toFixed(1)}¢
                  </span>
                </div>

                {/* Entry + P&L */}
                <div style={{ display: 'flex', gap: 12, fontSize: '0.6rem', fontFamily: 'var(--font-mono)', alignItems: 'center' }}>
                  <span>
                    <span style={{ color: DIM, fontSize: '0.5rem' }}>Entry </span>
                    <span style={{ color: 'rgba(255,255,255,0.9)' }}>{(t.entryPrice * 100).toFixed(1)}¢</span>
                  </span>
                  {!isOpen && (
                    <span>
                      <span style={{ color: DIM, fontSize: '0.5rem' }}>Exit </span>
                      <span style={{ color: 'rgba(255,255,255,0.9)' }}>{(nowPrice * 100).toFixed(1)}¢</span>
                    </span>
                  )}
                  <span style={{ marginLeft: 'auto' }}>
                    <span style={{ color: isLoss ? 'var(--red)' : isProfit ? 'var(--green)' : DIM, fontWeight: 600 }}>
                      {isOpen ? '$0.00' : pnlStr}
                    </span>
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
