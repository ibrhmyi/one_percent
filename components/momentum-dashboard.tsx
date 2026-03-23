"use client";

import { useEffect, useRef, useState } from "react";
import type { MomentumSignalRow, MomentumSignalsResponse } from "@/app/api/momentum/signals/route";

const POLL_MS = 5_000;

function confidenceBadge(confidence: string) {
  if (confidence === "high") {
    return (
      <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-semibold bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/30">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
        HIGH
      </span>
    );
  }
  if (confidence === "medium") {
    return (
      <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-semibold bg-yellow-500/20 text-yellow-400 ring-1 ring-yellow-500/30">
        MED
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold bg-zinc-700 text-zinc-400 ring-1 ring-zinc-600">
      LOW
    </span>
  );
}

function velColor(v: number) {
  if (v >= 0.12) return "text-emerald-400";
  if (v >= 0.07) return "text-yellow-400";
  return "text-zinc-300";
}

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

interface Props {
  confidence?: "low" | "medium" | "high" | "all";
}

export function MomentumDashboard({ confidence = "all" }: Props) {
  const [data, setData] = useState<MomentumSignalsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0); // forces re-render for relative times
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function fetchSignals() {
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (confidence !== "all") params.set("confidence", confidence);
      const res = await fetch(`/api/momentum/signals?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: MomentumSignalsResponse = await res.json();
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fetch failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchSignals();
    timerRef.current = setInterval(() => {
      fetchSignals();
      setTick((t) => t + 1); // refresh relative timestamps
    }, POLL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confidence]);

  const signals: MomentumSignalRow[] = data?.signals ?? [];

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-sm font-medium text-zinc-300">
            Live · refreshes every 5s
          </span>
          {data && (
            <span className="text-xs text-zinc-500">
              {data.total.toLocaleString()} total signals
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded px-2 py-0.5 text-xs font-mono bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/25">
            DRY RUN
          </span>
          {data && !data.supabaseConfigured && (
            <span className="rounded px-2 py-0.5 text-xs bg-red-500/15 text-red-400 ring-1 ring-red-500/25">
              Supabase not configured
            </span>
          )}
        </div>
      </div>

      {/* Loading / error states */}
      {loading && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-8 text-center text-sm text-zinc-500">
          Loading signals…
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-800 bg-red-950/30 p-4 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* No signals yet */}
      {!loading && !error && signals.length === 0 && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-10 text-center space-y-2">
          <p className="text-sm font-medium text-zinc-400">
            {data?.tableReady === false ? "⏳ Run SQL migration first" : "No signals yet"}
          </p>
          <p className="text-xs text-zinc-600">
            {!data?.supabaseConfigured
              ? "Add MOMENTUM_SUPABASE_URL and MOMENTUM_SUPABASE_ANON_KEY to .env.local, then restart."
              : data?.tableReady === false
              ? "Paste supabase/momentum-signals.sql into your Supabase SQL Editor and run it."
              : "Bot is running — signals will appear here within seconds of firing."}
          </p>
        </div>
      )}

      {/* Signal table */}
      {signals.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900/60">
                <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500 uppercase tracking-wide">Market</th>
                <th className="px-3 py-2.5 text-center text-xs font-medium text-zinc-500 uppercase tracking-wide">Conf</th>
                <th className="px-3 py-2.5 text-right text-xs font-medium text-zinc-500 uppercase tracking-wide">Velocity</th>
                <th className="px-3 py-2.5 text-right text-xs font-medium text-zinc-500 uppercase tracking-wide">Bid / Ask</th>
                <th className="px-3 py-2.5 text-center text-xs font-medium text-zinc-500 uppercase tracking-wide">Kalshi</th>
                <th className="px-3 py-2.5 text-center text-xs font-medium text-zinc-500 uppercase tracking-wide">Order</th>
                <th className="px-3 py-2.5 text-right text-xs font-medium text-zinc-500 uppercase tracking-wide">Fired</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {signals.map((s) => (
                <tr
                  key={s.id}
                  className="bg-zinc-950 hover:bg-zinc-900/80 transition-colors"
                >
                  <td className="px-4 py-3 max-w-xs">
                    <span className="line-clamp-2 text-zinc-200 leading-snug">{s.title}</span>
                    <span className="block mt-0.5 font-mono text-[10px] text-zinc-600 truncate">
                      {s.poly_condition_id.slice(0, 12)}…
                    </span>
                  </td>
                  <td className="px-3 py-3 text-center">
                    {confidenceBadge(s.confidence)}
                  </td>
                  <td className={`px-3 py-3 text-right font-mono font-semibold tabular-nums ${velColor(s.velocity)}`}>
                    {(s.velocity * 100).toFixed(1)}¢/s
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-xs tabular-nums text-zinc-400">
                    {(s.yes_bid * 100).toFixed(1)} / {(s.yes_ask * 100).toFixed(1)}
                  </td>
                  <td className="px-3 py-3 text-center">
                    {s.kalshi_ticker ? (
                      <span className="font-mono text-xs text-sky-400">{s.kalshi_ticker}</span>
                    ) : (
                      <span className="text-xs text-zinc-600">—</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-center">
                    {s.dry_run ? (
                      <span className="text-xs text-amber-500">dry</span>
                    ) : s.order_placed ? (
                      <span className="text-xs text-emerald-400">✓ filled</span>
                    ) : (
                      <span className="text-xs text-red-400" title={s.order_error ?? ""}>✗</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right text-xs text-zinc-500 tabular-nums whitespace-nowrap">
                    {relativeTime(s.fired_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
