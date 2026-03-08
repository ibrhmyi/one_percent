"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { applyMarketQuery } from "@/lib/market-query";
import {
  formatCompactCurrency,
  formatCountdown,
  formatDateTime,
  formatPriceIndicator,
  formatSpread
} from "@/lib/format";
import type { MarketApiResponse, NormalizedMarket } from "@/lib/types";

const REFRESH_INTERVAL_MS = 60_000;
const COUNTDOWN_TICK_MS = 1_000;
const POLYMARKET_WSS_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/market";
const STREAM_ASSET_CHUNK_SIZE = 180;
const MIN_VOLUME_USD = 10_000;

type DashboardProps = {
  initialResponse: MarketApiResponse;
  eventInput?: string | null;
};

type LiveSpreadByMarket = Record<
  string,
  {
    yes: number | null;
    no: number | null;
  }
>;

type PriceDirection = "up" | "down" | null;
type LivePricePulseByMarket = Record<
  string,
  {
    yes: PriceDirection;
    no: PriceDirection;
  }
>;
type SortMode = "tails" | "volume" | "spread";

const PRICE_PULSE_MS = 1_000;

function ArrowBoxIcon() {
  return (
    <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-200 transition group-hover:border-cyan-400/30 group-hover:text-cyan-200">
      <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
        <path
          d="M7 17L17 7M9 7H17V15"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

function formatCategoryLabel(category: string) {
  return category.replace(/\b\w/g, (match) => match.toUpperCase());
}

function CardFrame({
  href,
  children
}: {
  href: string | null;
  children: ReactNode;
}) {
  const className =
    "group block h-full rounded-3xl transition duration-200 hover:-translate-y-0.5 hover:border-white/15";

  if (!href) {
    return <div className={className}>{children}</div>;
  }

  return (
    <a href={href} className={className} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

function MarketCard({
  market,
  now,
  spread,
  pricePulse
}: {
  market: NormalizedMarket;
  now: number;
  spread: number | null;
  pricePulse?: {
    yes: PriceDirection;
    no: PriceDirection;
  };
}) {
  const volume = market.volume;
  const countdown = formatCountdown(market.closeTime, now);
  const platformBadgeClass =
    market.platform === "polymarket"
      ? "border-fuchsia-400/30 bg-fuchsia-500/15 text-fuchsia-200"
      : "border-cyan-400/20 bg-cyan-400/10 text-cyan-200";
  const yesPulseClass =
    pricePulse?.yes === "up"
      ? "border-emerald-400/40 bg-emerald-500/10"
      : pricePulse?.yes === "down"
        ? "border-red-400/40 bg-red-500/10"
        : "border-line bg-black/20";
  const noPulseClass =
    pricePulse?.no === "up"
      ? "border-emerald-400/40 bg-emerald-500/10"
      : pricePulse?.no === "down"
        ? "border-red-400/40 bg-red-500/10"
        : "border-line bg-black/20";

  return (
    <CardFrame href={market.url}>
      <article className="card-border flex h-full flex-col rounded-3xl p-5 shadow-panel">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2">
          <div className="flex min-h-[2.75rem] flex-wrap items-start gap-2">
            <span
              className={`inline-flex rounded-full border px-3 py-1 text-[0.68rem] uppercase tracking-[0.22em] ${platformBadgeClass}`}
            >
              {market.platform}
            </span>
            {market.category ? (
              <span className="inline-flex rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[0.68rem] uppercase tracking-[0.18em] text-zinc-300">
                {formatCategoryLabel(market.category)}
              </span>
            ) : null}
          </div>

          <div className="flex min-h-[2.75rem] items-start justify-end gap-2.5">
            <div className="flex flex-col items-end">
              <p className="text-[0.55rem] uppercase tracking-[0.2em] text-zinc-500">Start time</p>
              <p className="mt-0.5 text-[0.72rem] text-zinc-200">{formatDateTime(market.closeTime)}</p>
            </div>
            <ArrowBoxIcon />
          </div>

          <div>
            <h2
              className="max-w-2xl break-words font-display text-xl leading-6 text-white transition group-hover:text-cyan-100"
              title={market.title}
            >
              {market.title}
            </h2>
          </div>

          <div className="flex min-h-[3.25rem] items-start justify-end gap-2">
            {market.isLive ? (
              <span className="inline-flex rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-[0.68rem] uppercase tracking-[0.22em] text-cyan-200">
                <span className="mr-2 inline-flex h-4 w-4 items-center justify-center rounded-full border border-emerald-400/40 bg-emerald-400/10">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-300" />
                </span>
                LIVE
              </span>
            ) : (
              <span className="inline-flex rounded-full border border-red-400/40 bg-red-500/10 px-3 py-1 text-[0.68rem] font-medium tabular-nums tracking-[0.08em] text-red-200">
                {countdown}
              </span>
            )}
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:mt-auto md:grid-cols-4">
          <div className={`rounded-2xl border p-4 transition-colors duration-300 ${yesPulseClass}`}>
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">YES Price</p>
            <p className="mt-2 text-lg text-white">{formatPriceIndicator(market.yesPrice)}</p>
          </div>
          <div className={`rounded-2xl border p-4 transition-colors duration-300 ${noPulseClass}`}>
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">NO Price</p>
            <p className="mt-2 text-lg text-white">{formatPriceIndicator(market.noPrice)}</p>
          </div>
          <div className="rounded-2xl border border-line bg-black/20 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Spread</p>
            <p className="mt-2 text-lg text-white">{formatSpread(spread)}</p>
          </div>
          <div className="rounded-2xl border border-line bg-black/20 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Volume</p>
            <p className="mt-2 text-lg text-white">{formatCompactCurrency(volume)}</p>
          </div>
        </div>
      </article>
    </CardFrame>
  );
}

export function MarketDashboard({ initialResponse, eventInput = null }: DashboardProps) {
  const [response, setResponse] = useState(initialResponse);
  const [liveSpreadByMarket, setLiveSpreadByMarket] = useState<LiveSpreadByMarket>({});
  const [livePricePulseByMarket, setLivePricePulseByMarket] = useState<LivePricePulseByMarket>({});
  const [sortMode, setSortMode] = useState<SortMode>("tails");
  const [now, setNow] = useState(Date.now());
  const seenTradeKeys = useRef<Set<string>>(new Set());
  const previousPricesByMarketRef = useRef<Map<string, { yes: number | null; no: number | null }>>(
    new Map()
  );
  const pulseTimeoutsRef = useRef<Map<string, number>>(new Map());

  const isEventFocusMode = Boolean(eventInput);

  useEffect(() => {
    let active = true;

    const refresh = async () => {
      try {
        const query = eventInput
          ? `?event=${encodeURIComponent(eventInput)}`
          : "?onlyLive=1&maxHours=24";
        const result = await fetch(`/api/markets/closing-soon${query}`, {
          cache: "no-store"
        });

        const payload = (await result.json()) as MarketApiResponse;

        if (active) {
          setResponse(payload);
        }
      } catch (error) {
        if (active) {
          setResponse((current) => ({
            ...current,
            error: error instanceof Error ? error.message : "Refresh failed."
          }));
        }
      }
    };

    void refresh();
    const intervalId = window.setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [eventInput]);

  useEffect(() => {
    const timerId = window.setInterval(() => {
      setNow(Date.now());
    }, COUNTDOWN_TICK_MS);

    return () => {
      window.clearInterval(timerId);
    };
  }, []);

  useEffect(() => {
    const previous = previousPricesByMarketRef.current;
    const next = new Map<string, { yes: number | null; no: number | null }>();
    const pulseUpdates: Array<{
      marketId: string;
      side: "yes" | "no";
      direction: "up" | "down";
    }> = [];
    const normalize = (value: number | null) => {
      if (value === null) {
        return null;
      }

      return value > 1 ? value / 100 : value;
    };

    for (const market of response.markets) {
      const yes = normalize(market.yesPrice);
      const no = normalize(market.noPrice);
      const prev = previous.get(market.id);

      if (prev && yes !== null && prev.yes !== null && yes !== prev.yes) {
        pulseUpdates.push({
          marketId: market.id,
          side: "yes",
          direction: yes > prev.yes ? "up" : "down"
        });
      }

      if (prev && no !== null && prev.no !== null && no !== prev.no) {
        pulseUpdates.push({
          marketId: market.id,
          side: "no",
          direction: no > prev.no ? "up" : "down"
        });
      }

      next.set(market.id, { yes, no });
    }

    previousPricesByMarketRef.current = next;

    if (pulseUpdates.length === 0) {
      return;
    }

    setLivePricePulseByMarket((current) => {
      const updated: LivePricePulseByMarket = { ...current };

      for (const update of pulseUpdates) {
        updated[update.marketId] = {
          yes: updated[update.marketId]?.yes ?? null,
          no: updated[update.marketId]?.no ?? null,
          [update.side]: update.direction
        };
      }

      return updated;
    });

    for (const update of pulseUpdates) {
      const key = `${update.marketId}:${update.side}`;
      const existing = pulseTimeoutsRef.current.get(key);

      if (existing) {
        window.clearTimeout(existing);
      }

      const timeoutId = window.setTimeout(() => {
        setLivePricePulseByMarket((current) => {
          const row = current[update.marketId];

          if (!row || row[update.side] === null) {
            return current;
          }

          return {
            ...current,
            [update.marketId]: {
              ...row,
              [update.side]: null
            }
          };
        });
        pulseTimeoutsRef.current.delete(key);
      }, PRICE_PULSE_MS);

      pulseTimeoutsRef.current.set(key, timeoutId);
    }
  }, [response.markets]);

  useEffect(
    () => () => {
      for (const timeoutId of pulseTimeoutsRef.current.values()) {
        window.clearTimeout(timeoutId);
      }

      pulseTimeoutsRef.current.clear();
    },
    []
  );

  const visibleMarkets = isEventFocusMode
    ? response.markets
    : applyMarketQuery(response.markets, {
        platform: "polymarket",
        category: "sports",
        maxHours: 24,
        minVolume: null,
        minYesPrice: null,
        minNoPrice: null,
        onlyLive: true,
        sort: "soonest"
      });
  const normalizeProbability = (value: number | null) => {
    if (value === null) {
      return null;
    }

    return value > 1 ? value / 100 : value;
  };
  const spreadByMarket = (market: NormalizedMarket) =>
    liveSpreadByMarket[market.id]?.yes ?? liveSpreadByMarket[market.id]?.no ?? null;
  const passesPriceAndSpreadFilter = (market: NormalizedMarket) => {
    const yes = normalizeProbability(market.yesPrice);
    const no = normalizeProbability(market.noPrice);
    const spread = spreadByMarket(market);
    const volume = market.volume;
    const normalizedSpread = spread === null ? null : spread > 1 ? spread / 100 : spread;
    const hasMinimumTradablePrice = yes !== null && no !== null && yes >= 0.01 && no >= 0.01;
    const hasStrongPrice = (yes !== null && yes >= 0.7) || (no !== null && no >= 0.7);
    const hasTightSpread = normalizedSpread !== null && normalizedSpread < 0.1;
    const hasMinimumVolume = volume !== null && volume >= MIN_VOLUME_USD;

    return hasMinimumTradablePrice && hasStrongPrice && hasTightSpread && hasMinimumVolume;
  };
  const normalizedNoPrice = (market: NormalizedMarket) => {
    if (market.noPrice === null) {
      return null;
    }

    return market.noPrice > 1 ? market.noPrice / 100 : market.noPrice;
  };
  const normalizedYesPrice = (market: NormalizedMarket) => {
    if (market.yesPrice === null) {
      return null;
    }

    return market.yesPrice > 1 ? market.yesPrice / 100 : market.yesPrice;
  };
  const tailScore = (market: NormalizedMarket) => {
    const yes = normalizedYesPrice(market);
    const no = normalizedNoPrice(market);

    if (yes === null && no === null) {
      return null;
    }

    return Math.max(yes ?? -1, no ?? -1);
  };
  const filteredMarkets = visibleMarkets.filter(passesPriceAndSpreadFilter);
  const topMarkets = [...filteredMarkets].sort((left, right) => {
    if (sortMode === "tails") {
      const leftTail = tailScore(left);
      const rightTail = tailScore(right);
      const tailDelta = (rightTail ?? -1) - (leftTail ?? -1);

      if (tailDelta !== 0) {
        return tailDelta;
      }
    }

    if (sortMode === "volume") {
      const volumeDelta = (right.volume ?? -1) - (left.volume ?? -1);

      if (volumeDelta !== 0) {
        return volumeDelta;
      }
    }

    if (sortMode === "spread") {
      const leftSpread = spreadByMarket(left);
      const rightSpread = spreadByMarket(right);

      if (leftSpread === null && rightSpread === null) {
        return 0;
      }

      if (leftSpread === null) {
        return 1;
      }

      if (rightSpread === null) {
        return -1;
      }

      const spreadDelta = leftSpread - rightSpread;

      if (spreadDelta !== 0) {
        return spreadDelta;
      }
    }

    return left.id.localeCompare(right.id);
  });
  const streamMarkets = visibleMarkets.filter((market) => market.platform === "polymarket");
  const streamSubscriptionKey = streamMarkets
    .map((market) => `${market.id}:${market.yesTokenId ?? ""}:${market.noTokenId ?? ""}`)
    .sort()
    .join("|");
  const lastUpdated = response.lastUpdated ? formatDateTime(response.lastUpdated) : "Never";
  const activeMarketsCount = topMarkets.filter(
    (market) => market.isLive === true || market.status?.toLowerCase() === "open"
  ).length;

  useEffect(() => {
    const assetSideMap = new Map<
      string,
      {
        marketId: string;
        side: "yes" | "no";
      }
    >();

    for (const market of streamMarkets) {
      if (market.yesTokenId) {
        assetSideMap.set(market.yesTokenId, { marketId: market.id, side: "yes" });
      }

      if (market.noTokenId) {
        assetSideMap.set(market.noTokenId, { marketId: market.id, side: "no" });
      }
    }

    if (assetSideMap.size === 0) {
      return;
    }

    const assetIdChunks: string[][] = [];
    const assetIds = [...assetSideMap.keys()];

    for (let index = 0; index < assetIds.length; index += STREAM_ASSET_CHUNK_SIZE) {
      assetIdChunks.push(assetIds.slice(index, index + STREAM_ASSET_CHUNK_SIZE));
    }

    const sockets: WebSocket[] = [];
    const heartbeatIds: number[] = [];

    const updateMarket = (assetId: string, price: number | null) => {
      const descriptor = assetSideMap.get(assetId);

      if (!descriptor || price === null || Number.isNaN(price)) {
        return;
      }

      setResponse((current) => ({
        ...current,
        markets: current.markets.map((market) => {
          if (market.id !== descriptor.marketId) {
            return market;
          }

          const nextYesPrice = descriptor.side === "yes" ? price : 1 - price;
          const nextNoPrice = descriptor.side === "no" ? price : 1 - price;

          return {
            ...market,
            yesPrice: Number(nextYesPrice.toFixed(4)),
            noPrice: Number(nextNoPrice.toFixed(4))
          };
        })
      }));
    };

    const updateSpread = (assetId: string, bestBid: unknown, bestAsk: unknown) => {
      const descriptor = assetSideMap.get(assetId);

      if (!descriptor) {
        return;
      }

      const bid = Number(bestBid);
      const ask = Number(bestAsk);

      if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0 || ask < bid) {
        return;
      }

      const side = descriptor.side;
      const spread = Number((ask - bid).toFixed(4));

      setLiveSpreadByMarket((current) => {
        const previous = current[descriptor.marketId] ?? { yes: null, no: null };

        if (previous[side] === spread) {
          return current;
        }

        return {
          ...current,
          [descriptor.marketId]: {
            ...previous,
            [side]: spread
          }
        };
      });
    };

    const resolveMidPrice = (bestBid: unknown, bestAsk: unknown) => {
      const bid = Number(bestBid);
      const ask = Number(bestAsk);

      if (Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask > 0) {
        return (bid + ask) / 2;
      }

      if (Number.isFinite(bid) && bid > 0) {
        return bid;
      }

      if (Number.isFinite(ask) && ask > 0) {
        return ask;
      }

      return null;
    };

    const handleMessage = (payload: unknown) => {
      if (!payload || typeof payload !== "object") {
        return;
      }

      const message = payload as Record<string, unknown>;

      if (message.event_type === "best_bid_ask" && typeof message.asset_id === "string") {
        updateSpread(message.asset_id, message.best_bid, message.best_ask);
        updateMarket(message.asset_id, resolveMidPrice(message.best_bid, message.best_ask));
      }

      if (message.event_type === "last_trade_price" && typeof message.asset_id === "string") {
        const tradePrice = Number(message.price);
        const tradeKey = `${message.asset_id}:${message.timestamp}:${message.price}:${message.size}`;

        if (!seenTradeKeys.current.has(tradeKey)) {
          seenTradeKeys.current.add(tradeKey);

          if (seenTradeKeys.current.size > 500) {
            const firstKey = seenTradeKeys.current.values().next().value;

            if (firstKey) {
              seenTradeKeys.current.delete(firstKey);
            }
          }

          updateMarket(
            message.asset_id,
            Number.isFinite(tradePrice) ? tradePrice : null
          );
        }
      }

      if (message.event_type === "price_change" && Array.isArray(message.price_changes)) {
        for (const item of message.price_changes) {
          if (!item || typeof item !== "object") {
            continue;
          }

          const change = item as Record<string, unknown>;

          if (typeof change.asset_id === "string") {
            updateSpread(change.asset_id, change.best_bid, change.best_ask);
            updateMarket(
              change.asset_id,
              resolveMidPrice(change.best_bid, change.best_ask) ?? Number(change.price)
            );
          }
        }
      }

      if (message.event_type === "book" && typeof message.asset_id === "string") {
        const bids = Array.isArray(message.bids) ? message.bids : [];
        const asks = Array.isArray(message.asks) ? message.asks : [];
        const bestBid = bids[0] && typeof bids[0] === "object" ? (bids[0] as Record<string, unknown>).price : null;
        const bestAsk = asks[0] && typeof asks[0] === "object" ? (asks[0] as Record<string, unknown>).price : null;

        updateSpread(message.asset_id, bestBid, bestAsk);
        updateMarket(message.asset_id, resolveMidPrice(bestBid, bestAsk));
      }
    };

    for (const chunk of assetIdChunks) {
      const socket = new WebSocket(POLYMARKET_WSS_URL);
      sockets.push(socket);

      socket.onopen = () => {
        socket.send(
          JSON.stringify({
            assets_ids: chunk,
            type: "market",
            custom_feature_enabled: true
          })
        );

        const heartbeatId = window.setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send("PING");
          }
        }, 9_000);

        heartbeatIds.push(heartbeatId);
      };

      socket.onmessage = (event) => {
        if (typeof event.data !== "string" || event.data === "PONG") {
          return;
        }

        try {
          const parsed = JSON.parse(event.data) as unknown;

          if (Array.isArray(parsed)) {
            parsed.forEach(handleMessage);
            return;
          }

          handleMessage(parsed);
        } catch {
          // Ignore malformed or non-JSON frames.
        }
      };
    }

    return () => {
      for (const heartbeatId of heartbeatIds) {
        window.clearInterval(heartbeatId);
      }

      for (const socket of sockets) {
        socket.close();
      }
    };
  }, [streamSubscriptionKey]);

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-6 py-8 lg:px-8">
      <section className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-panel-glow px-6 pb-10 pt-8 shadow-panel lg:px-8">
        <div className="relative z-10 flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs uppercase tracking-[0.38em] text-cyan-300">OnePercent</p>
            <h1 className="mt-4 font-display text-4xl text-white sm:text-5xl">
              {isEventFocusMode ? "Event market depth on Polymarket." : "Near resolution grabs."}
            </h1>
            <p className="mt-3 text-sm text-zinc-300">
              {isEventFocusMode
                ? "All sub-markets for one event family."
                : "AI detected near resolution sports markets on polymarket with spread < 0.1$, volume > 10K$, and prices near tail."}
            </p>
          </div>

          <div className="flex items-center gap-3 text-sm text-zinc-300">
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">Last updated</p>
              <p className="mt-1 font-medium text-white">{lastUpdated}</p>
            </div>
          </div>
        </div>
        <div className="absolute bottom-3 right-6 text-right lg:right-8">
          <p className="text-[0.62rem] uppercase tracking-[0.2em] text-zinc-500">Active markets</p>
          <p className="mt-1 font-display text-2xl text-white">{activeMarketsCount.toLocaleString()}</p>
        </div>
      </section>

      <section className="mt-5 rounded-2xl border border-white/10 bg-slate-950/75 px-4 py-3 shadow-panel">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Sort</p>
          <div className="flex items-center gap-2">
            {(["tails", "volume", "spread"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setSortMode(mode)}
                className={`rounded-xl border px-3 py-1.5 text-sm transition ${
                  sortMode === mode
                    ? "border-cyan-400/40 bg-cyan-400/15 text-cyan-100"
                    : "border-white/10 bg-white/5 text-zinc-300 hover:border-white/20"
                }`}
              >
                {mode[0].toUpperCase()}
                {mode.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </section>

      {response.error ? (
        <section className="mt-6 rounded-3xl border border-danger/30 bg-danger/10 px-5 py-4 text-sm text-red-100">
          {response.error}
        </section>
      ) : null}

      {topMarkets.length === 0 ? (
        <p className="mt-6 text-sm text-zinc-400">
          {isEventFocusMode
            ? "No markets in this event match YES/NO >= $0.70, spread < $0.10, and volume >= $10k."
            : "No live/upcoming sports markets match YES/NO >= $0.70, spread < $0.10, and volume >= $10k."}
        </p>
      ) : (
        <section className="mt-6 grid gap-4 xl:grid-cols-2">
          {topMarkets.map((market) => (
            <MarketCard
              key={market.id}
              market={market}
              now={now}
              spread={liveSpreadByMarket[market.id]?.yes ?? liveSpreadByMarket[market.id]?.no ?? null}
              pricePulse={livePricePulseByMarket[market.id]}
            />
          ))}
        </section>
      )}
    </main>
  );
}
