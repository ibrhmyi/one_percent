'use client';
interface AccountState {
  bankroll: number;
  pnlToday: number;
  pnlTotal: number;
  openPositions: number;
  mode: 'dry_run' | 'live';
  polymarketId: string;
}
interface Trade { status: string; pnl?: number; }
interface SkillStats { trades: number; wins: number; losses: number; totalPnl: number; }
interface Props {
  account: AccountState;
  trades: Trade[];
  preGameOrderCount?: number;
  skillStats?: SkillStats[];
}

export function AccountPanel({ account, trades, preGameOrderCount, skillStats }: Props) {
  const isLive = account.mode === 'live';

  // Combine live trades + skill stats for total trade/win count
  const liveTrades = trades.length;
  const skillTotalTrades = skillStats?.reduce((s, st) => s + st.trades, 0) ?? 0;
  const totalTrades = liveTrades + skillTotalTrades;
  const liveWins = trades.filter(t => (t.pnl ?? 0) > 0).length;
  const skillWins = skillStats?.reduce((s, st) => s + st.wins, 0) ?? 0;
  const totalWins = liveWins + skillWins;
  const winRate = totalTrades > 0 ? ((totalWins / totalTrades) * 100).toFixed(0) : '—';

  // Open positions = live engine positions + pre-game orders
  const totalOpenPos = account.openPositions + (preGameOrderCount ?? 0);

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
        { label: 'Open Pos', value: totalOpenPos, isNum: false },
        { label: 'Win Rate', value: winRate, isNum: false, suffix: '%' },
        { label: 'Trades', value: totalTrades, isNum: false },
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
