'use client';
interface AccountState {
  bankroll: number;
  pnlToday: number;
  pnlTotal: number;
  openPositions: number;
  mode: 'dry_run' | 'live';
  polymarketId: string;
}
interface Trade { status: string; }
interface Props { account: AccountState; trades: Trade[]; }

export function AccountPanel({ account, trades }: Props) {
  const isLive = account.mode === 'live';
  const todayTrades = trades.length;
  const wins = trades.filter((t: any) => t.pnl > 0).length;
  const winRate = todayTrades > 0 ? ((wins / todayTrades) * 100).toFixed(0) : '—';

  return (
    <div className="panel">
      <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>Account</span>
        <span className="badge" style={{
          background: isLive ? 'rgba(34,197,94,0.15)' : 'rgba(245,158,11,0.15)',
          color: isLive ? 'var(--green)' : 'var(--amber)',
          border: `1px solid ${isLive ? 'rgba(34,197,94,0.3)' : 'rgba(245,158,11,0.3)'}`,
        }}>
          {isLive ? '● LIVE' : '○ DRY RUN'}
        </span>
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: '0.6rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Equity</div>
        <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
          ${account.bankroll.toFixed(2)}
        </div>
      </div>

      {[
        { label: 'P&L Today', value: account.pnlToday, isNum: true },
        { label: 'P&L Total', value: account.pnlTotal, isNum: true },
        { label: 'Open Pos', value: account.openPositions, isNum: false },
        { label: 'Win Rate', value: winRate, isNum: false, suffix: '%' },
        { label: 'Trades', value: todayTrades, isNum: false },
      ].map(({ label, value, isNum, suffix }) => (
        <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid var(--border-default)' }}>
          <span style={{ color: 'var(--text-dim)', fontSize: '0.7rem' }}>{label}</span>
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.75rem',
            color: isNum ? (Number(value) > 0 ? 'var(--green)' : Number(value) < 0 ? 'var(--red)' : 'var(--text-secondary)') : 'var(--text-secondary)',
          }}>
            {isNum && Number(value) > 0 ? '+' : ''}{isNum ? `$${Number(value).toFixed(2)}` : value}{suffix ?? ''}
          </span>
        </div>
      ))}

      <div style={{ marginTop: 8, paddingTop: 6, borderTop: '1px solid var(--border-default)', fontSize: '0.65rem', color: 'var(--text-dim)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Kelly Fraction</span><span>25%</span></div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Min Bet</span><span>$5</span></div>
      </div>
    </div>
  );
}
