'use client';

import type { CycleLog } from '@/lib/types';

interface Props {
  logs: CycleLog[];
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}

export function DataLogPanel({ logs }: Props) {
  const reversed = [...logs].reverse(); // newest first

  if (reversed.length === 0) {
    return (
      <div className="card-border rounded-2xl p-10 text-center">
        <div className="text-slate-600 text-sm font-mono">No scoring events logged yet</div>
        <div className="text-slate-700 text-xs font-mono mt-1">Data is collected during live games</div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <span className="text-[10px] font-mono text-slate-600 uppercase tracking-wider">Scoring Events</span>
        <span className="text-[10px] font-mono text-slate-700">{logs.length} entries</span>
      </div>

      <div className="card-border rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="border-b border-white/[0.06] text-slate-600 text-[10px] uppercase tracking-wider">
                <th className="text-left px-4 py-3">Time</th>
                <th className="text-left px-4 py-3">Game</th>
                <th className="text-left px-4 py-3">Score</th>
                <th className="text-right px-4 py-3">Model</th>
                <th className="text-right px-4 py-3">Market</th>
                <th className="text-right px-4 py-3">Edge</th>
                <th className="text-right px-4 py-3">Kelly</th>
                <th className="text-left px-4 py-3">Action</th>
                <th className="text-left px-4 py-3 max-w-xs">Reason</th>
              </tr>
            </thead>
            <tbody>
              {reversed.map((log, i) => {
                const edgePct = (log.edge * 100).toFixed(1);
                const isEnter = log.action === 'enter';
                return (
                  <tr
                    key={i}
                    className="border-b border-white/[0.03] last:border-0 hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">{formatTime(log.timestamp)}</td>
                    <td className="px-4 py-2.5 text-slate-400 whitespace-nowrap">
                      {log.awayTeam} @ {log.homeTeam}
                    </td>
                    <td className="px-4 py-2.5 text-slate-300 whitespace-nowrap tabular-nums">
                      {log.awayScore}–{log.homeScore} {log.period} {log.clock}
                    </td>
                    <td className="px-4 py-2.5 text-right text-cyan-400 tabular-nums">
                      {(log.modelProbability * 100).toFixed(1)}%
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-400 tabular-nums">
                      {(log.marketPrice * 100).toFixed(1)}%
                    </td>
                    <td className={`px-4 py-2.5 text-right tabular-nums font-semibold ${
                      log.edge > 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}>
                      {log.edge > 0 ? '+' : ''}{edgePct}%
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-500 tabular-nums">
                      {(log.kellySize * 100).toFixed(0)}%
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                        isEnter
                          ? 'bg-emerald-400/10 border border-emerald-400/25 text-emerald-400'
                          : 'bg-white/[0.04] border border-white/[0.08] text-slate-600'
                      }`}>
                        {log.action}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600 max-w-xs truncate">{log.reason}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
