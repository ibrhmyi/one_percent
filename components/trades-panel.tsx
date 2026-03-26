'use client';

import type { Trade } from '@/lib/types';
import { TradeRow } from './trade-row';

interface Props {
  trades: Trade[];
}

export function TradesPanel({ trades }: Props) {
  const closed = trades.filter(t => t.status === 'closed');
  const wins = closed.filter(t => (t.pnl ?? 0) > 0).length;
  const totalPnl = closed.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const winRate = closed.length > 0 ? ((wins / closed.length) * 100).toFixed(0) + '%' : '--%';
  const pnlColor = totalPnl >= 0 ? 'text-green-400' : 'text-red-400';

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="flex flex-wrap gap-4 px-4 py-3 glass-card rounded-xl text-xs font-mono">
        <Stat label="Total Trades" value={String(trades.length)} />
        <Stat label="Wins" value={String(wins)} color="text-green-400" />
        <Stat label="Losses" value={String(closed.length - wins)} color="text-red-400" />
        <Stat label="Win Rate" value={winRate} />
        <Stat
          label="Total PnL"
          value={`${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}`}
          color={pnlColor}
        />
      </div>

      {trades.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 text-slate-600">
          <p className="text-sm font-mono">No trades yet.</p>
          <p className="text-xs mt-1">Trades appear here when the brain finds an edge.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {/* Header */}
          <div className="grid grid-cols-7 gap-2 px-4 py-2 text-xs font-mono uppercase tracking-wider text-slate-600">
            <span>Time</span>
            <span className="col-span-2">Market</span>
            <span>Side</span>
            <span>In</span>
            <span>Out</span>
            <span>PnL</span>
          </div>
          {[...trades].reverse().map(trade => (
            <TradeRow key={trade.id} trade={trade} />
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color = 'text-white' }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-slate-500">{label}:</span>
      <span className={`font-semibold ${color}`}>{value}</span>
    </div>
  );
}
