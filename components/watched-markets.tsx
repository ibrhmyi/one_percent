'use client';

import { useState } from 'react';
import type { WatchedMarket } from '@/lib/types';
import { MarketCard } from './market-card';

type SortKey = 'time' | 'edge' | 'volume' | 'spread';

interface Props {
  markets: WatchedMarket[];
}

export function WatchedMarkets({ markets }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('time');

  const sorted = [...markets].sort((a, b) => {
    // Status priority first (hot markets float up)
    const statusPri = { position_open: 4, edge_detected: 3, trading: 2, live: 1, upcoming: 0 };
    const pa = statusPri[a.status] ?? 0;
    const pb = statusPri[b.status] ?? 0;
    if (pa !== pb) return pb - pa;

    switch (sortKey) {
      case 'time': {
        const ta = a.gameStartTime ? new Date(a.gameStartTime).getTime() : Infinity;
        const tb = b.gameStartTime ? new Date(b.gameStartTime).getTime() : Infinity;
        return ta - tb;
      }
      case 'edge':
        return (b.edge ?? -1) - (a.edge ?? -1);
      case 'volume':
        return b.volume - a.volume;
      case 'spread':
        return (b.spread ?? 0) - (a.spread ?? 0);
    }
  });

  if (markets.length === 0) {
    return (
      <div className="card-border rounded-2xl p-8 text-center">
        <div className="text-slate-600 text-sm font-mono mb-2">No NBA games starting in the next 24 hours</div>
        <div className="text-slate-700 text-xs font-mono">Markets appear here when upcoming games are found</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Sort bar ── */}
      <div className="flex items-center justify-between px-1">
        <span className="text-[10px] font-mono text-slate-600 uppercase tracking-wider">Sort</span>
        <div className="flex gap-2">
          {([
            { key: 'time', label: 'Time' },
            { key: 'edge', label: 'Edge' },
            { key: 'volume', label: 'Volume' },
            { key: 'spread', label: 'Spread' },
          ] as { key: SortKey; label: string }[]).map(s => (
            <button
              key={s.key}
              onClick={() => setSortKey(s.key)}
              className={`text-xs font-mono px-4 py-1.5 rounded-full border transition-all ${
                sortKey === s.key
                  ? 'bg-cyan-400/10 border-cyan-400/30 text-cyan-400'
                  : 'border-white/10 text-slate-500 hover:text-slate-300 hover:border-white/20'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Market cards ── */}
      <div className="space-y-3">
        {sorted.map(market => (
          <MarketCard key={market.id} market={market} />
        ))}
      </div>
    </div>
  );
}
