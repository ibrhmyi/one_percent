'use client';

import type { AccountState } from '@/lib/types';

interface Props {
  account: AccountState;
}

export function AccountPanel({ account }: Props) {
  const pnlTodayColor = account.pnlToday >= 0 ? 'text-green-400' : 'text-red-400';
  const pnlTotalColor = account.pnlTotal >= 0 ? 'text-green-400' : 'text-red-400';

  return (
    <div className="glass-card rounded-xl p-4 h-full">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-mono uppercase tracking-widest text-slate-500">Account</span>
        <span className={`text-xs font-mono px-2 py-0.5 rounded font-bold ${
          account.mode === 'dry_run'
            ? 'bg-amber-400/10 text-amber-400 border border-amber-400/20'
            : 'bg-green-400/10 text-green-400 border border-green-400/20'
        }`}>
          {account.mode === 'dry_run' ? 'DRY RUN' : 'LIVE'}
        </span>
      </div>

      <div className="space-y-2">
        <Row label="Balance" value={`$${account.bankroll.toFixed(2)}`} valueClass="text-white" />
        <Row label="PnL Today" value={`${account.pnlToday >= 0 ? '+' : ''}$${account.pnlToday.toFixed(2)}`} valueClass={pnlTodayColor} />
        <Row label="PnL Total" value={`${account.pnlTotal >= 0 ? '+' : ''}$${account.pnlTotal.toFixed(2)}`} valueClass={pnlTotalColor} />
        <Row label="Open Pos." value={String(account.openPositions)} valueClass="text-white" />
        <div className="pt-1 border-t border-white/5">
          <span className="text-xs text-slate-600 font-mono truncate block">{account.polymarketId}</span>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, valueClass }: { label: string; value: string; valueClass: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-xs text-slate-500">{label}</span>
      <span className={`text-sm font-mono font-semibold ${valueClass}`}>{value}</span>
    </div>
  );
}
