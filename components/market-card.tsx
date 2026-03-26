'use client';

import { useState, useEffect } from 'react';
import type { WatchedMarket } from '@/lib/types';

interface Props {
  market: WatchedMarket;
}

// ─── Countdown hook — ticks every second ───
function useCountdown(targetIso: string | null): {
  label: string;
  urgent: boolean;
  seconds: number;
} {
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
  const urgent = diff < 30 * 60; // < 30 min

  if (h > 0) return { label: `${h}h ${m}m ${String(s).padStart(2, '0')}s`, urgent: false, seconds: diff };
  if (m > 0) return { label: `${m}m ${String(s).padStart(2, '0')}s`, urgent, seconds: diff };
  return { label: `${s}s`, urgent: true, seconds: diff };
}

function formatStartTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function formatVolume(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

export function MarketCard({ market }: Props) {
  const isLive =
    market.status === 'live' ||
    market.status === 'edge_detected' ||
    market.status === 'position_open';

  const countdown = useCountdown(isLive ? null : market.gameStartTime);

  return (
    <button
      onClick={() => window.open(market.url, '_blank', 'noopener,noreferrer')}
      className="w-full text-left card-border rounded-2xl p-5 hover:bg-white/[0.025] transition-all duration-150 group"
    >
      {/* ── Row 1: Tags + Start time ── */}
      <div className="flex items-start justify-between gap-4 mb-3">
        {/* Tags */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono font-semibold px-2.5 py-1 rounded-full border border-white/10 text-slate-400 uppercase tracking-wider">
            Polymarket
          </span>
          <span className="text-[10px] font-mono font-semibold px-2.5 py-1 rounded-full border border-white/10 text-slate-400 uppercase tracking-wider">
            Sports
          </span>
          <span className="text-[10px] font-mono font-semibold px-2.5 py-1 rounded-full border border-cyan-400/20 text-cyan-500 uppercase tracking-wider bg-cyan-400/5">
            NBA
          </span>
        </div>

        {/* Start time + link arrow */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="text-right">
            <div className="text-[10px] font-mono text-slate-600 uppercase tracking-wider">Start Time</div>
            <div className="text-xs font-mono text-slate-300 mt-0.5">
              {formatStartTime(market.gameStartTime)}
            </div>
          </div>
          <div className="w-7 h-7 rounded-lg border border-white/10 flex items-center justify-center text-slate-500 group-hover:text-slate-300 group-hover:border-white/20 transition-colors flex-shrink-0">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M2 8L8 2M8 2H4M8 2V6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
        </div>
      </div>

      {/* ── Row 2: Title + Status badge ── */}
      <div className="flex items-center justify-between gap-4 mb-4">
        <h3 className="text-base font-medium text-slate-100 leading-snug flex-1 min-w-0 truncate">
          {market.title}
        </h3>

        {isLive ? (
          <span className="flex items-center gap-1.5 bg-green-500/10 border border-green-500/25 rounded-full px-3 py-1 flex-shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            <span className="text-[11px] font-mono font-bold text-green-400 uppercase tracking-wider">Live</span>
          </span>
        ) : countdown.seconds <= 0 ? (
          <span className="text-[11px] font-mono text-amber-400 border border-amber-400/25 bg-amber-400/5 px-3 py-1 rounded-full flex-shrink-0">
            Starting soon
          </span>
        ) : (
          <span className={`text-[11px] font-mono font-bold tabular-nums px-3 py-1 rounded-full border flex-shrink-0 ${
            countdown.urgent
              ? 'bg-red-500/10 border-red-500/30 text-red-400'
              : 'bg-slate-800/60 border-slate-700/50 text-slate-400'
          }`}>
            {countdown.label}
          </span>
        )}
      </div>

      {/* ── Live score (if available) ── */}
      {market.gameData && (
        <div className="mb-4 flex items-center gap-3 px-1">
          <span className="text-sm text-slate-400">{market.gameData.homeTeam}</span>
          <span className="text-lg font-mono font-bold text-white tabular-nums">
            {market.gameData.homeScore}–{market.gameData.awayScore}
          </span>
          <span className="text-sm text-slate-400">{market.gameData.awayTeam}</span>
          <span className="text-xs font-mono text-slate-600 ml-1">
            {market.gameData.period} {market.gameData.clock}
          </span>
        </div>
      )}

      {/* ── Row 3: 4 metric boxes ── */}
      <div className="grid grid-cols-4 gap-2">
        <MetricBox
          label="YES PRICE"
          value={`${(market.yesPrice * 100).toFixed(1)}¢`}
          valueClass="text-emerald-400"
          bgClass="bg-emerald-500/5 border-emerald-500/15"
        />
        <MetricBox
          label="NO PRICE"
          value={`${(market.noPrice * 100).toFixed(1)}¢`}
          valueClass="text-rose-400"
          bgClass="bg-rose-500/5 border-rose-500/15"
        />
        <MetricBox
          label="SPREAD"
          value={market.spread !== null && market.spread !== undefined ? `${market.spread.toFixed(1)}¢` : '—'}
          valueClass="text-slate-200"
          bgClass="bg-white/[0.03] border-white/[0.06]"
        />
        <MetricBox
          label="VOLUME"
          value={formatVolume(market.volume)}
          valueClass="text-slate-200"
          bgClass="bg-white/[0.03] border-white/[0.06]"
        />
      </div>

      {/* ── Edge bar (if detected) ── */}
      {market.edge !== null && market.aiEstimate !== null && (
        <div className="mt-3 border border-amber-400/15 bg-amber-400/5 rounded-xl px-4 py-2.5 flex items-center gap-4">
          <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider whitespace-nowrap">
            AI Edge
          </span>
          <div className="flex-1 bg-white/5 rounded-full h-1 overflow-hidden">
            <div
              className="h-full bg-amber-400 rounded-full transition-all"
              style={{ width: `${Math.min(100, Math.abs(market.edge) * 500)}%` }}
            />
          </div>
          <span className="text-xs font-mono text-amber-400 font-bold whitespace-nowrap">
            {market.edge >= 0 ? '+' : ''}{(market.edge * 100).toFixed(1)}%
          </span>
          <span className="text-xs font-mono text-cyan-400 whitespace-nowrap">
            Model {(market.aiEstimate * 100).toFixed(0)}%
          </span>
        </div>
      )}
    </button>
  );
}

function MetricBox({
  label,
  value,
  valueClass,
  bgClass,
}: {
  label: string;
  value: string;
  valueClass: string;
  bgClass: string;
}) {
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${bgClass}`}>
      <div className="text-[9px] font-mono text-slate-600 uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-base font-mono font-bold ${valueClass} tabular-nums`}>{value}</div>
    </div>
  );
}
