"use client";

import { useEffect, useMemo, useState } from "react";
import { formatCompactCurrency, formatDateTime, formatPriceIndicator, formatSpread } from "@/lib/format";
import type { BotOverviewResponse, BotTrade } from "@/lib/bot-types";

const BOT_REFRESH_INTERVAL_MS = 15_000;
const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2
});

function formatPnL(value: number) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function formatUsd(value: number) {
  return usdFormatter.format(value);
}

function tradePnlUsd(trade: BotTrade) {
  return Number((trade.size * (trade.pnl_percent / 100)).toFixed(4));
}

function normalizeProbability(value: number) {
  return value > 1 ? value / 100 : value;
}

function qualifiesStrategy(noPrice: number, spread: number, tradeable: boolean, category?: string) {
  const normalizedNo = Number(normalizeProbability(noPrice).toFixed(4));
  const normalizedSpread = normalizeProbability(spread);
  const isSports = category?.trim().toLowerCase() === "sports";
  return isSports && tradeable && normalizedNo === 0.97 && normalizedSpread < 0.1;
}

function statusBadgeClass(status: BotTrade["status"]) {
  if (status === "exit_placed" || status === "filled" || status === "open") {
    return "border-cyan-400/40 bg-cyan-500/15 text-cyan-100";
  }

  if (status === "closed") {
    return "border-emerald-400/40 bg-emerald-500/15 text-emerald-100";
  }

  return "border-zinc-400/20 bg-zinc-500/10 text-zinc-300";
}

export function BotTab() {
  const [overview, setOverview] = useState<BotOverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const refresh = async () => {
      try {
        const result = await fetch("/api/bot/overview", { cache: "no-store" });

        if (!result.ok) {
          throw new Error(`Bot endpoint returned ${result.status}`);
        }

        const payload = (await result.json()) as BotOverviewResponse;

        if (active) {
          setOverview(payload);
          setError(null);
        }
      } catch (fetchError) {
        if (active) {
          setError(fetchError instanceof Error ? fetchError.message : "Failed to load bot overview.");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void refresh();
    const intervalId = window.setInterval(refresh, BOT_REFRESH_INTERVAL_MS);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, []);

  const topDecisions = useMemo(
    () => (overview ? overview.decisions.slice(0, 14) : []),
    [overview]
  );
  const liveSignals = useMemo(
    () => (overview ? overview.rawSignals.slice(0, 12) : []),
    [overview]
  );
  const tradePanelTitle = overview?.activeTrades.length
    ? "Active Trades"
    : "Dry-Run Preview Trades";
  const tradePanelSubtitle = overview?.activeTrades.length
    ? `${overview.activeTrades.length} active`
    : `${overview?.previewTrades.length ?? 0} preview`;
  const displayTrades = overview?.activeTrades.length
    ? overview.activeTrades
    : (overview?.previewTrades ?? []);

  return (
    <>
      <section className="mt-5 rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-3 shadow-panel">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm uppercase tracking-[0.2em] text-cyan-100">Bot Control Panel</h2>
          <p className="text-xs text-cyan-200/80">
            {overview
              ? `Updated ${formatDateTime(overview.generatedAt)} • Live ${overview.summary.uptimeHours}h (since ${formatDateTime(overview.summary.botStartedAt)}) • ${overview.source === "signals-file" ? "Signals file" : "Derived signals"}`
              : "Loading bot state"}
          </p>
        </div>
      </section>

      {loading && !overview ? (
        <p className="mt-5 text-sm text-zinc-300">Loading bot overview...</p>
      ) : null}

      {error ? (
        <section className="mt-5 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
          {error}
        </section>
      ) : null}

      {overview ? (
        <>
          <section className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-8">
            <article className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Dry run</p>
              <p className="mt-2 text-xl text-white">{overview.state.dry_run ? "ON" : "OFF"}</p>
            </article>
            <article className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Enterable now</p>
              <p className="mt-2 text-xl text-white">{overview.summary.enterableNow}</p>
            </article>
            <article className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Open positions</p>
              <p className="mt-2 text-xl text-white">
                {overview.summary.openPositions}/{overview.limits.maxOpenPositions}
              </p>
            </article>
            <article className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Exposure</p>
              <p className="mt-2 text-xl text-white">
                {formatCompactCurrency(overview.summary.totalExposure)} / {formatCompactCurrency(overview.limits.maxTotalExposure)}
              </p>
            </article>
            <article className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-emerald-300">Money made</p>
              <p className="mt-2 text-xl text-emerald-100">{formatUsd(overview.summary.realizedPnlUsd)}</p>
            </article>
            <article className="rounded-2xl border border-cyan-500/30 bg-cyan-500/10 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-cyan-300">Projected pnl</p>
              <p className="mt-2 text-xl text-cyan-100">{formatUsd(overview.summary.projectedPnlUsd)}</p>
            </article>
            <article className="rounded-2xl border border-sky-500/30 bg-sky-500/10 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-sky-300">Total wealth</p>
              <p className="mt-2 text-xl text-sky-100">{formatUsd(overview.summary.totalWealthUsd)}</p>
            </article>
            <article className="rounded-2xl border border-violet-500/30 bg-violet-500/10 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-violet-300">Est. balance</p>
              <p className="mt-2 text-xl text-violet-100">
                {formatUsd(overview.summary.estimatedBalanceUsd)}
              </p>
              <p className="mt-1 text-[0.68rem] uppercase tracking-[0.14em] text-violet-300/75">
                Start {formatUsd(overview.summary.startingBalanceUsd)}
              </p>
            </article>
          </section>

          <section className="mt-5 rounded-2xl border border-violet-500/30 bg-violet-500/10 px-4 py-3 shadow-panel">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm uppercase tracking-[0.2em] text-violet-200">Live Signals</h3>
              <p className="text-xs text-violet-200/75">{overview.summary.rawSignalsTotal} signals loaded</p>
            </div>

            {liveSignals.length === 0 ? (
              <p className="mt-3 text-sm text-zinc-300">No live signals right now.</p>
            ) : (
              <div className="mt-3 grid gap-2">
                {liveSignals.map((signal) => {
                  const matches = qualifiesStrategy(
                    signal.no_price,
                    signal.spread,
                    signal.tradeable,
                    signal.category
                  );

                  return (
                    <article
                      key={`live-${signal.market_id}`}
                      className="rounded-xl border border-white/10 bg-black/20 px-3 py-2"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="text-sm text-white">{signal.title}</p>
                          <p className="mt-1 text-xs text-zinc-400">
                            NO {formatPriceIndicator(signal.no_price)} • Spread {formatSpread(signal.spread)} • Vol {formatCompactCurrency(signal.volume)}
                          </p>
                        </div>
                        <span
                          className={`inline-flex rounded-full border px-2.5 py-1 text-[0.65rem] uppercase tracking-[0.16em] ${
                            matches
                              ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-100"
                              : "border-zinc-400/30 bg-zinc-500/10 text-zinc-300"
                          }`}
                        >
                          {matches ? "Rule Match" : "Watching"}
                        </span>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <section className="mt-5 rounded-2xl border border-violet-500/30 bg-violet-500/10 px-4 py-3 shadow-panel">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm uppercase tracking-[0.2em] text-violet-200">Signal Queue</h3>
              <p className="text-xs text-violet-200/75">{overview.summary.signalsConsidered} signals considered</p>
            </div>

            {topDecisions.length === 0 ? (
              <p className="mt-3 text-sm text-zinc-300">No candidate signals yet.</p>
            ) : (
              <div className="mt-3 grid gap-2">
                {topDecisions.map(({ signal, decision }) => (
                  <article
                    key={signal.market_id}
                    className="rounded-xl border border-white/10 bg-black/20 px-3 py-2"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm text-white">{signal.title}</p>
                        <p className="mt-1 text-xs text-zinc-400">
                          NO {formatPriceIndicator(signal.no_price)} • Spread {formatSpread(signal.spread)} • Vol {formatCompactCurrency(signal.volume)}
                        </p>
                      </div>
                      <span
                        className={`inline-flex rounded-full border px-2.5 py-1 text-[0.65rem] uppercase tracking-[0.16em] ${
                          decision.shouldEnter
                            ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-100"
                            : "border-amber-400/40 bg-amber-500/15 text-amber-100"
                        }`}
                      >
                        {decision.shouldEnter ? "Enter" : "Skip"}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-zinc-300">{decision.reason}</p>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="mt-5 grid gap-4 xl:grid-cols-2">
            <article className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm uppercase tracking-[0.2em] text-zinc-100">{tradePanelTitle}</h3>
                <span className="text-xs text-zinc-400">{tradePanelSubtitle}</span>
              </div>
              {displayTrades.length === 0 ? (
                <p className="mt-3 text-sm text-zinc-400">No dry-run trades available yet.</p>
              ) : (
                <div className="mt-3 grid gap-2">
                  {displayTrades.slice(0, 8).map((trade) => (
                    <article key={trade.id} className="rounded-xl border border-white/10 bg-black/30 px-3 py-2">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm text-white">{trade.title}</p>
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[0.62rem] uppercase tracking-[0.14em] ${statusBadgeClass(trade.status)}`}>
                          {trade.status}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-zinc-400">
                        Entry {formatPriceIndicator(trade.entry_price)} • Target {formatPriceIndicator(trade.target_exit_price)} • Size {trade.size}
                      </p>
                      <p className="mt-1 text-xs text-emerald-300">
                        Expected {formatUsd(tradePnlUsd(trade))} ({formatPnL(trade.pnl_percent)})
                      </p>
                    </article>
                  ))}
                </div>
              )}
            </article>

            <article className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm uppercase tracking-[0.2em] text-zinc-100">Recent Trades</h3>
                <span className="text-xs text-zinc-400">{overview.recentTrades.length}</span>
              </div>
              {overview.recentTrades.length === 0 ? (
                <p className="mt-3 text-sm text-zinc-400">No trades recorded yet.</p>
              ) : (
                <div className="mt-3 grid gap-2">
                  {overview.recentTrades.slice(0, 8).map((trade) => (
                    <article key={`recent-${trade.id}`} className="rounded-xl border border-white/10 bg-black/30 px-3 py-2">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm text-white">{trade.title}</p>
                        <p className={`text-xs ${trade.pnl_percent >= 0 ? "text-emerald-300" : "text-red-300"}`}>
                          {formatPnL(trade.pnl_percent)}
                        </p>
                      </div>
                      <p className="mt-1 text-xs text-zinc-400">
                        {formatDateTime(trade.entry_timestamp)} • {trade.status}
                      </p>
                    </article>
                  ))}
                </div>
              )}
            </article>
          </section>
        </>
      ) : null}
    </>
  );
}
