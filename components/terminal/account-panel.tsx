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
  preGameDeployed?: number;
  skillStats?: SkillStats[];
}

const DIM = 'rgba(255,255,255,0.4)';

function fmtMoney(v: number): string {
  const clean = Math.abs(v) < 0.005 ? 0 : v;
  return `${clean > 0 ? '+' : ''}$${clean.toFixed(2)}`;
}

export function AccountPanel({ account, trades, preGameOrderCount, preGameDeployed, skillStats }: Props) {
  const isLive = account.mode === 'live';
  const deployed = preGameDeployed ?? 0;
  const available = account.bankroll - deployed;
  const deployedPct = account.bankroll > 0 ? ((deployed / account.bankroll) * 100).toFixed(0) : '0';

  const closedTrades = trades.filter(t => t.status === 'closed');
  const skillTotalTrades = skillStats?.reduce((s, st) => s + st.trades, 0) ?? 0;
  const totalTrades = trades.length + skillTotalTrades;
  const skillWins = skillStats?.reduce((s, st) => s + st.wins, 0) ?? 0;
  const liveWins = closedTrades.filter(t => (t.pnl ?? 0) > 0).length;
  const totalWins = liveWins + skillWins;
  const winRate = closedTrades.length > 0 ? `${((totalWins / closedTrades.length) * 100).toFixed(0)}%` : '—';
  const totalOpenPos = account.openPositions + (preGameOrderCount ?? 0);

  const rows: Array<{ label: string; value: string; color?: string }> = [
    { label: 'Deployed', value: `$${deployed.toFixed(0)} (${deployedPct}%)`, color: deployed > 0 ? 'var(--cyan)' : undefined },
    { label: 'Available', value: `$${available.toFixed(0)}` },
    { label: 'P&L Today', value: fmtMoney(account.pnlToday), color: account.pnlToday > 0 ? 'var(--green)' : account.pnlToday < 0 ? 'var(--red)' : undefined },
    { label: 'P&L Total', value: fmtMoney(account.pnlTotal), color: account.pnlTotal > 0 ? 'var(--green)' : account.pnlTotal < 0 ? 'var(--red)' : undefined },
    { label: 'Open Pos', value: String(totalOpenPos) },
    { label: 'Trades', value: String(totalTrades) },
    { label: 'Win Rate', value: winRate },
  ];

  return (
    <div className="panel">
      <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>Account</span>
        <span className="badge" style={{
          background: isLive ? 'rgba(34,197,94,0.15)' : 'rgba(6,182,212,0.15)',
          color: isLive ? 'var(--green)' : 'var(--cyan)',
          border: `1px solid ${isLive ? 'rgba(34,197,94,0.3)' : 'rgba(6,182,212,0.3)'}`,
        }}>
          {isLive ? '● LIVE' : '○ DRY RUN'}
        </span>
      </div>

      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: '0.55rem', color: DIM, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Equity</div>
        <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'rgba(255,255,255,0.9)', fontFamily: 'var(--font-mono)' }}>
          ${account.bankroll.toFixed(2)}
        </div>
      </div>

      {rows.map(({ label, value, color }) => (
        <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid var(--border-default)' }}>
          <span style={{ color: DIM, fontSize: '0.65rem' }}>{label}</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: color ?? 'rgba(255,255,255,0.9)' }}>
            {value}
          </span>
        </div>
      ))}

      <div style={{ marginTop: 6, paddingTop: 4, borderTop: '1px solid var(--border-default)', fontSize: '0.6rem', color: DIM }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Kelly</span><span>25% (quarter)</span></div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Min Bet</span><span>$5</span></div>
      </div>
    </div>
  );
}
