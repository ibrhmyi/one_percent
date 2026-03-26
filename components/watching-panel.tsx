'use client';

import { useState, useEffect } from 'react';
import type { WatchedMarket } from '@/lib/types';

interface Props {
  markets: WatchedMarket[];
  focusedMarketId: string | null;
}

function useCountdown(targetIso: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!targetIso) return { label: '—', urgent: false, seconds: Infinity };
  const diff = Math.floor((new Date(targetIso).getTime() - now) / 1000);
  if (diff <= 0) return { label: 'Starting soon', urgent: true, seconds: 0 };
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  if (h > 0) return { label: `${h}h ${m}m ${String(s).padStart(2, '0')}s`, urgent: false, seconds: diff };
  if (m > 0) return { label: `${m}m ${String(s).padStart(2, '0')}s`, urgent: diff < 1800, seconds: diff };
  return { label: `${s}s`, urgent: true, seconds: diff };
}

function formatTime(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

function formatVolume(v: number) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

export function WatchingPanel({ markets, focusedMarketId }: Props) {
  const market = markets.find(m => m.id === focusedMarketId) ?? markets[0] ?? null;

  // Hooks must be called unconditionally — compute before any early return
  const isLive = market
    ? market.status === 'live' || market.status === 'edge_detected' || market.status === 'position_open'
    : false;
  const countdown = useCountdown(isLive ? null : market?.gameStartTime ?? null);

  if (!market) {
    return (
      <div className="card-border rounded-2xl p-10 text-center">
        <div className="text-2xl font-mono text-slate-700 mb-2">—</div>
        <div className="text-slate-600 text-sm font-mono">No market to watch right now</div>
        <div className="text-slate-700 text-xs font-mono mt-1">The brain will pick one as games approach</div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* ── Main focus card ── */}
      <div className="card-border rounded-2xl p-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-5">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono font-semibold px-2.5 py-1 rounded-full border border-white/10 text-slate-400 uppercase tracking-wider">Polymarket</span>
            <span className="text-[10px] font-mono font-semibold px-2.5 py-1 rounded-full border border-white/10 text-slate-400 uppercase tracking-wider">Sports</span>
            <span className="text-[10px] font-mono font-semibold px-2.5 py-1 rounded-full border border-cyan-400/20 text-cyan-500 bg-cyan-400/5 uppercase tracking-wider">NBA</span>
          </div>

          {isLive ? (
            <span className="flex items-center gap-1.5 bg-green-500/10 border border-green-500/25 rounded-full px-3 py-1 flex-shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              <span className="text-[11px] font-mono font-bold text-green-400 uppercase tracking-wider">Live</span>
            </span>
          ) : (
            <span className={`text-[11px] font-mono font-bold tabular-nums px-3 py-1 rounded-full border flex-shrink-0 ${
              countdown.urgent ? 'bg-red-500/10 border-red-500/30 text-red-400' : 'bg-slate-800/60 border-slate-700/50 text-slate-400'
            }`}>
              {countdown.label}
            </span>
          )}
        </div>

        {/* Title */}
        <h2 className="text-2xl font-semibold text-white mb-1 leading-tight">{market.title}</h2>
        <div className="text-xs font-mono text-slate-600 mb-5">{formatTime(market.gameStartTime)}</div>

        {/* Live score */}
        {market.gameData && (
          <div className="mb-5 flex items-center gap-4 card-border rounded-xl px-5 py-3">
            <span className="text-sm text-slate-400 flex-1 text-right">{market.gameData.homeTeam}</span>
            <span className="text-2xl font-mono font-bold text-white tabular-nums">
              {market.gameData.homeScore}–{market.gameData.awayScore}
            </span>
            <span className="text-sm text-slate-400 flex-1">{market.gameData.awayTeam}</span>
            <span className="text-xs font-mono text-slate-600">{market.gameData.period} {market.gameData.clock}</span>
          </div>
        )}

        {/* 4 metric boxes */}
        <div className="grid grid-cols-4 gap-2 mb-4">
          <MetricBox label="YES PRICE" value={`${(market.yesPrice * 100).toFixed(1)}¢`} valueClass="text-emerald-400" bg="bg-emerald-500/5 border-emerald-500/15" />
          <MetricBox label="NO PRICE"  value={`${(market.noPrice * 100).toFixed(1)}¢`}  valueClass="text-rose-400"    bg="bg-rose-500/5 border-rose-500/15" />
          <MetricBox label="SPREAD"    value={market.spread !== null && market.spread !== undefined ? `${market.spread.toFixed(1)}¢` : '—'} valueClass="text-slate-200" bg="bg-white/[0.03] border-white/[0.06]" />
          <MetricBox label="VOLUME"    value={formatVolume(market.volume)} valueClass="text-slate-200" bg="bg-white/[0.03] border-white/[0.06]" />
        </div>

        {/* AI analysis */}
        {market.edge !== null && market.aiEstimate !== null ? (
          <div className="border border-amber-400/15 bg-amber-400/5 rounded-xl px-4 py-3 flex items-center gap-4">
            <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">AI Edge</span>
            <div className="flex-1 bg-white/5 rounded-full h-1 overflow-hidden">
              <div className="h-full bg-amber-400 rounded-full" style={{ width: `${Math.min(100, Math.abs(market.edge) * 500)}%` }} />
            </div>
            <span className="text-xs font-mono text-amber-400 font-bold">{market.edge >= 0 ? '+' : ''}{(market.edge * 100).toFixed(1)}%</span>
            <span className="text-xs font-mono text-cyan-400">Model {(market.aiEstimate * 100).toFixed(0)}%</span>
            <span className="text-xs font-mono text-slate-500">Market {(market.yesPrice * 100).toFixed(0)}%</span>
          </div>
        ) : (
          <div className="border border-white/5 bg-white/[0.02] rounded-xl px-4 py-3 flex items-center gap-3">
            <div className="w-1.5 h-1.5 rounded-full bg-slate-700 animate-pulse" />
            <span className="text-xs font-mono text-slate-600">
              {isLive ? 'Scanning for edge...' : 'Waiting for game to start before scanning'}
            </span>
          </div>
        )}
      </div>

      {/* ── Other upcoming markets (mini list) ── */}
      {markets.length > 1 && (
        <div className="card-border rounded-2xl p-4">
          <div className="text-[10px] font-mono text-slate-600 uppercase tracking-wider mb-3">Also upcoming</div>
          <div className="space-y-2">
            {markets
              .filter(m => m.id !== market.id)
              .slice(0, 5)
              .map(m => <MiniMarketRow key={m.id} market={m} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function MetricBox({ label, value, valueClass, bg }: { label: string; value: string; valueClass: string; bg: string }) {
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${bg}`}>
      <div className="text-[9px] font-mono text-slate-600 uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-base font-mono font-bold tabular-nums ${valueClass}`}>{value}</div>
    </div>
  );
}

function MiniMarketRow({ market }: { market: WatchedMarket }) {
  const isLive = market.status === 'live' || market.status === 'edge_detected';
  const countdown = useCountdown(isLive ? null : market.gameStartTime);
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 border-b border-white/[0.04] last:border-0">
      <span className="text-sm text-slate-400 flex-1 truncate">{market.title}</span>
      {isLive ? (
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
          <span className="text-[10px] font-mono text-green-400">Live</span>
        </span>
      ) : (
        <span className={`text-xs font-mono tabular-nums whitespace-nowrap ${countdown.urgent ? 'text-red-400' : 'text-slate-500'}`}>
          {countdown.label}
        </span>
      )}
    </div>
  );
}
