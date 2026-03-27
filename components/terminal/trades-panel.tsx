'use client';
interface Trade {
  id: string;
  marketTitle?: string;
  side: string;
  entryPrice: number;
  currentPrice?: number;
  exitPrice?: number;
  entryAmount: number;
  pnl?: number;
  status: string;
  enteredAt: string;
}
interface Props { trades: Trade[]; mode: string; }

export function TradesPanel({ trades, mode }: Props) {
  const recent = [...trades].reverse().slice(0, 10);
  return (
    <div className="panel">
      <div className="panel-header">Recent Trades</div>
      {recent.length === 0 ? (
        <div style={{ color: 'var(--text-dim)', fontSize: '0.7rem' }}>No trades yet</div>
      ) : recent.map(t => {
        const pnl = t.pnl ?? 0;
        const isProfit = pnl > 0;
        const pnlPct = t.entryPrice > 0 && t.entryAmount > 0
          ? ((pnl / (t.entryPrice * t.entryAmount)) * 100).toFixed(1)
          : '0.0';
        return (
          <div key={t.id} style={{
            borderLeft: `3px solid ${isProfit ? 'var(--green)' : pnl < 0 ? 'var(--red)' : 'var(--border-accent)'}`,
            paddingLeft: 8, marginBottom: 8, paddingBottom: 6,
            borderBottom: '1px solid var(--border-default)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-primary)', fontWeight: 600 }}>
                {t.side?.toUpperCase()} {t.marketTitle?.slice(0, 25) ?? '—'}
              </span>
              {mode !== 'live' && (
                <span className="badge" style={{ background: 'rgba(245,158,11,0.1)', color: 'var(--amber)', border: '1px solid rgba(245,158,11,0.3)' }}>
                  DRY
                </span>
              )}
            </div>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>
              Entry: {t.entryPrice.toFixed(3)} → {t.exitPrice ? `Exit: ${t.exitPrice.toFixed(3)}` : `Now: ${(t.currentPrice ?? t.entryPrice).toFixed(3)}`}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-dim)' }}>
                ${(t.entryAmount * t.entryPrice).toFixed(2)}
              </span>
              <span style={{ fontSize: '0.7rem', fontWeight: 600, color: isProfit ? 'var(--green)' : pnl < 0 ? 'var(--red)' : 'var(--text-dim)' }}>
                {pnl !== 0 ? `${isProfit ? '+' : ''}$${pnl.toFixed(2)} (${pnlPct}%)` : 'OPEN'}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
