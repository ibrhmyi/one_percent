'use client';

import type { Trade } from '@/lib/types';

interface Props {
  trade: Trade;
}

const EXIT_LABELS: Record<string, string> = {
  target: 'Target',
  reversal: 'Reversal',
  stall: 'Stall',
  timeout: 'Timeout',
  game_over: 'Game Over',
};

export function TradeRow({ trade }: Props) {
  const isOpen = trade.status === 'open';
  const pnl = trade.pnl;
  const pnlColor = pnl === null ? 'text-amber-400' : pnl >= 0 ? 'text-green-400' : 'text-red-400';
  const rowBg = isOpen
    ? 'bg-amber-400/5 border-amber-400/20'
    : (pnl ?? 0) >= 0
    ? 'bg-green-400/5 border-green-400/10'
    : 'bg-red-400/5 border-red-400/10';

  const entryTime = new Date(trade.enteredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const amountOut = isOpen ? '—' : `$${(trade.exitAmount ?? 0).toFixed(2)}`;
  const pnlStr = isOpen ? 'OPEN' : pnl !== null ? `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}` : '—';

  return (
    <div className={`grid grid-cols-7 gap-2 items-center px-4 py-3 rounded-lg border text-xs font-mono ${rowBg}`}>
      <span className="text-slate-400">{entryTime}</span>
      <span className="col-span-2 text-white truncate" title={trade.marketTitle}>
        {trade.skillIcon} {trade.marketTitle.substring(0, 28)}
      </span>
      <span className={`font-bold ${trade.side === 'yes' ? 'text-green-400' : 'text-red-400'}`}>
        {trade.side.toUpperCase()}
      </span>
      <span className="text-white">${trade.entryAmount.toFixed(2)}</span>
      <span className="text-slate-300">{amountOut}</span>
      <span className={`font-bold ${pnlColor}`}>
        {pnlStr}
        {trade.exitReason && (
          <span className="text-slate-600 font-normal ml-1">({EXIT_LABELS[trade.exitReason] ?? trade.exitReason})</span>
        )}
        {trade.isDryRun && <span className="text-amber-500/60 ml-1">[sim]</span>}
      </span>
    </div>
  );
}
