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

function formatDuration(ms: number): string {
  if (ms <= 0) return '0m';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function TradesPanel({ trades, mode }: Props) {
  const recent = [...trades].reverse().slice(0, 10);
  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header">Recent Trades</div>
      {recent.length === 0 ? (
        <div style={{ color: DIM, fontSize: '0.7rem', flex: 1 }}>No trades yet</div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 2 }}>
          {recent.map(t => {
            const pnl = t.pnl ?? 0;
            const isOpen = t.status === 'open';
            const isProfit = pnl > 0;
            const isLoss = pnl < 0;
            const borderColor = isOpen ? 'var(--cyan)' : isProfit ? 'var(--green)' : isLoss ? 'var(--red)' : 'var(--border-accent)';
            const nowPrice = t.exitPrice ?? t.currentPrice ?? t.entryPrice;
            const tokens = t.tokens ?? (t.entryAmount > 0 && t.entryPrice > 0 ? Math.round(t.entryAmount / t.entryPrice) : 0);

            // Hold duration
            const holdMs = t.exitedAt
              ? new Date(t.exitedAt).getTime() - new Date(t.enteredAt).getTime()
              : Date.now() - new Date(t.enteredAt).getTime();

            return (
              <div key={t.id} className="card-interactive" style={{
                background: 'var(--bg-card-elevated)',
                border: '1px solid var(--border-default)',
                borderLeft: `3px solid ${borderColor}`,
                borderRadius: 6,
                padding: '10px 12px',
              }}>
                {/* Header: Status + P&L */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontSize: '0.6rem', fontWeight: 600, color: isOpen ? 'var(--cyan)' : isProfit ? 'var(--green)' : isLoss ? 'var(--red)' : DIM }}>
                    {isOpen ? '● OPEN' : isProfit ? '✓ CLOSED' : '✗ CLOSED'}
                    {!isOpen && ` · ${isProfit ? '+' : ''}$${(Math.abs(pnl) < 0.005 ? 0 : pnl).toFixed(2)}`}
                  </span>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    {(mode !== 'live' || t.isDryRun) && (
                      <span style={{ fontSize: '0.5rem', color: DIM, padding: '1px 4px', border: '1px solid var(--border-default)', borderRadius: 2 }}>DRY</span>
                    )}
                  </div>
                </div>

                {/* Teams */}
                <div style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.9)', fontWeight: 600, marginBottom: 2 }}>
                  {t.marketTitle ?? '—'}
                </div>
                <div style={{ fontSize: '0.55rem', color: DIM, marginBottom: 6 }}>
                  Bought {t.side?.toUpperCase()} · {tokens} shares
                </div>

                {/* Price row */}
                <div style={{ display: 'flex', gap: 16, fontSize: '0.65rem', fontFamily: 'var(--font-mono)' }}>
                  <div>
                    <span style={{ color: DIM, fontSize: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Entry </span>
                    <span style={{ color: 'rgba(255,255,255,0.9)' }}>{(t.entryPrice * 100).toFixed(0)}¢</span>
                  </div>
                  <div>
                    <span style={{ color: DIM, fontSize: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{isOpen ? 'Now ' : 'Exit '}</span>
                    <span style={{ color: 'rgba(255,255,255,0.9)' }}>{(nowPrice * 100).toFixed(0)}¢</span>
                  </div>
                  {isOpen && (
                    <div>
                      <span style={{ color: DIM, fontSize: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>P&L </span>
                      <span style={{ color: DIM }}>$0.00</span>
                    </div>
                  )}
                  <div style={{ marginLeft: 'auto' }}>
                    <span style={{ color: DIM, fontSize: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Hold </span>
                    <span style={{ color: DIM }}>{formatDuration(holdMs)}</span>
                  </div>
                </div>

                {/* Exit reason for closed trades */}
                {!isOpen && t.exitReason && (
                  <div style={{ fontSize: '0.5rem', color: DIM, marginTop: 4 }}>
                    Reason: {t.exitReason.replace(/_/g, ' ')}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
