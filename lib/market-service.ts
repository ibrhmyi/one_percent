import { resolveMarketCategoryFromTags } from "@/lib/category";
import { appConfig } from "@/lib/config";
import { sortMarkets } from "@/lib/market-query";
import { normalizeGammaPolymarketMarket } from "@/lib/normalize";
import {
  fetchGammaMarketsClosingWithinHours,
  fetchGammaMarketsForEventFamily
} from "@/lib/polymarket";
import { marketStore } from "@/lib/store";
import { analyzeMarketWithAI, type MarketSignal } from "@/lib/ai/analyzeMarket";
import { getCachedSignal, upsertSignal, isSignalStale } from "@/lib/supabase";
import type { MarketApiResponse, NormalizedMarket } from "@/lib/types";

let inFlightRefresh: Promise<MarketApiResponse> | null = null;
const LIVE_LOOKBACK_HOURS = 4;
const SOURCE_LOOKAHEAD_HOURS = Math.max(appConfig.marketScanWindowHours, 24);
const SIGNAL_MIN_YES_PRICE = 0.01;
const SIGNAL_MIN_TAIL_PRICE = 0.7;
const SIGNAL_MIN_VOLUME = 1_000;

function isCacheFresh(lastUpdated: string | null) {
  if (!lastUpdated) {
    return false;
  }

  return Date.now() - new Date(lastUpdated).getTime() < appConfig.cacheTtlMs;
}

function dedupeMarkets(markets: NormalizedMarket[]) {
  const seen = new Map<string, NormalizedMarket>();

  for (const market of markets) {
    seen.set(market.id, market);
  }

  return [...seen.values()];
}

function isWithinHoursAroundNow(market: NormalizedMarket, pastHours: number, futureHours: number) {
  const closeAt = new Date(market.closeTime).getTime();
  const now = Date.now();
  const min = now - Math.max(0, pastHours) * 60 * 60 * 1000;
  const max = now + Math.max(0, futureHours) * 60 * 60 * 1000;
  return closeAt >= min && closeAt <= max;
}

function isPolymarketMarket(market: NormalizedMarket) {
  return market.platform === "polymarket";
}

function normalizeProbability(value: number | null) {
  if (value === null) {
    return null;
  }

  return value > 1 ? value / 100 : value;
}

function getSpread(market: NormalizedMarket) {
  const yes = normalizeProbability(market.yesPrice);
  const no = normalizeProbability(market.noPrice);

  if (yes === null || no === null) {
    return null;
  }

  return Number(Math.abs(yes - no).toFixed(4));
}

function isAICandidate(market: NormalizedMarket) {
  const yes = normalizeProbability(market.yesPrice);
  const no = normalizeProbability(market.noPrice);
  const volume = market.volume ?? 0;
  const hoursUntilClose = (new Date(market.closeTime).getTime() - Date.now()) / (1000 * 60 * 60);
  const withinConfiguredWindow =
    hoursUntilClose >= 0 && hoursUntilClose <= SOURCE_LOOKAHEAD_HOURS;
  const isLive = market.isLive === true;

  return (
    yes !== null &&
    no !== null &&
    yes >= SIGNAL_MIN_YES_PRICE &&
    no >= SIGNAL_MIN_YES_PRICE &&
    (yes >= SIGNAL_MIN_TAIL_PRICE || no >= SIGNAL_MIN_TAIL_PRICE) &&
    volume >= SIGNAL_MIN_VOLUME &&
    (isLive || withinConfiguredWindow)
  );
}

function withNormalizedCategory(market: NormalizedMarket): NormalizedMarket {
  return {
    ...market,
    category: resolveMarketCategoryFromTags([market.category])
  };
}

function withAggregatedEventVolume(markets: NormalizedMarket[]) {
  const eventVolumeBySlug = new Map<string, number>();

  for (const market of markets) {
    if (!market.eventSlug || market.volume === null) {
      continue;
    }

    eventVolumeBySlug.set(
      market.eventSlug,
      (eventVolumeBySlug.get(market.eventSlug) ?? 0) + market.volume
    );
  }

  return markets.map((market) => {
    if (!market.eventSlug) {
      return {
        ...market,
        eventVolume: market.volume
      };
    }

    return {
      ...market,
      eventVolume: eventVolumeBySlug.get(market.eventSlug) ?? market.volume
    };
  });
}

function buildFallbackSignal(market: NormalizedMarket): MarketSignal {
  const startMs = new Date(market.closeTime).getTime();
  const elapsedMinutes = Number.isNaN(startMs)
    ? 0
    : Math.max(0, Math.round((Date.now() - startMs) / 60_000));

  if (market.isLive) {
    const min = Math.max(elapsedMinutes + 5, 60);
    const max = Math.max(min + 45, elapsedMinutes + 120);
    return {
      resolutionWindowMin: min,
      resolutionWindowMax: max,
      confidence: "low",
      tradeable: false,
      reason: "Heuristic fallback"
    };
  }

  return {
    resolutionWindowMin: 90,
    resolutionWindowMax: 180,
    confidence: "low",
    tradeable: false,
    reason: "Heuristic fallback"
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>
) {
  const safeConcurrency = Math.max(1, concurrency);
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex]);
    }
  }

  const workers = Array.from(
    { length: Math.min(safeConcurrency, items.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

async function enrichWithAISignals(markets: NormalizedMarket[]): Promise<NormalizedMarket[]> {
  const maxMarketsToAnalyze = Math.max(appConfig.aiMaxMarketsPerScan, 200);
  const cacheMinutes = appConfig.aiSignalCacheMinutes;
  const aiCandidates = markets
    .filter(isAICandidate)
    .sort((left, right) => {
      const leftYes = normalizeProbability(left.yesPrice) ?? 0;
      const leftNo = normalizeProbability(left.noPrice) ?? 0;
      const rightYes = normalizeProbability(right.yesPrice) ?? 0;
      const rightNo = normalizeProbability(right.noPrice) ?? 0;
      const leftTail = Math.max(leftYes, leftNo);
      const rightTail = Math.max(rightYes, rightNo);

      if (leftTail !== rightTail) {
        return rightTail - leftTail;
      }

      const leftVolume = left.volume ?? 0;
      const rightVolume = right.volume ?? 0;
      if (leftVolume !== rightVolume) {
        return rightVolume - leftVolume;
      }

      return new Date(left.closeTime).getTime() - new Date(right.closeTime).getTime();
    });

  const staleCandidates: NormalizedMarket[] = [];
  const enrichedMarkets: NormalizedMarket[] = [...markets];

  for (const market of aiCandidates) {
    const cachedSignal = await getCachedSignal(market.id);

    if (cachedSignal && !isSignalStale(cachedSignal, cacheMinutes)) {
      const index = enrichedMarkets.findIndex((m) => m.id === market.id);
      if (index !== -1) {
        enrichedMarkets[index] = {
          ...enrichedMarkets[index],
          resolutionWindowMin: cachedSignal.resolution_window_min_minutes,
          resolutionWindowMax: cachedSignal.resolution_window_max_minutes,
          confidence: cachedSignal.confidence,
          tradeable: cachedSignal.tradeable ?? false,
          aiReason: cachedSignal.reason
        };
      }
    } else {
      staleCandidates.push(market);
    }
  }

  const marketsToAnalyze = staleCandidates.slice(0, Math.min(maxMarketsToAnalyze, staleCandidates.length));
  const analyzed = await mapWithConcurrency(
    marketsToAnalyze,
    appConfig.aiConcurrency,
    async (market) => {
      const aiSignal = await analyzeMarketWithAI(market);
      return { market, signal: aiSignal ?? buildFallbackSignal(market) };
    }
  );

  await mapWithConcurrency(
    analyzed,
    appConfig.aiConcurrency,
    async ({ market, signal }) => {
      if (!signal) {
        return null;
      }

      const index = enrichedMarkets.findIndex((m) => m.id === market.id);
      if (index !== -1) {
        enrichedMarkets[index] = {
          ...enrichedMarkets[index],
          resolutionWindowMin: signal.resolutionWindowMin,
          resolutionWindowMax: signal.resolutionWindowMax,
          confidence: signal.confidence,
          tradeable: signal.tradeable,
          aiReason: signal.reason
        };
      }

      await upsertSignal({
        market_id: market.id,
        title: market.title,
        yes_price: market.yesPrice,
        no_price: market.noPrice,
        spread: getSpread(market),
        volume: market.volume,
        resolution_window_min_minutes: signal.resolutionWindowMin,
        resolution_window_max_minutes: signal.resolutionWindowMax,
        confidence: signal.confidence,
        tradeable: signal.tradeable,
        reason: signal.reason
      });

      return null;
    }
  );

  return enrichedMarkets;
}

async function refreshMarkets() {
  const rawPolymarketMarkets = await fetchGammaMarketsClosingWithinHours(
    SOURCE_LOOKAHEAD_HOURS,
    LIVE_LOOKBACK_HOURS
  );
  const normalized = rawPolymarketMarkets
    .map((market) => normalizeGammaPolymarketMarket(market))
    .filter((market): market is NormalizedMarket => market !== null);

  const marketsForCache = withAggregatedEventVolume(
    dedupeMarkets(normalized).filter(
      (market) =>
          isWithinHoursAroundNow(
            market,
            LIVE_LOOKBACK_HOURS,
            SOURCE_LOOKAHEAD_HOURS
          )
    )
      .map(withNormalizedCategory)
  );

  const marketsWithAI = await enrichWithAISignals(marketsForCache);

  await marketStore.saveMarkets(marketsWithAI);

  return {
    markets: marketsWithAI,
    total: marketsWithAI.length,
    filteredTotal: marketsWithAI.length,
    lastUpdated: await marketStore.getLastUpdated(),
    source: "live" as const,
    error: null
  };
}

export async function getEventFamilyMarkets(eventInput: string): Promise<MarketApiResponse> {
  const rawFamilyMarkets = await fetchGammaMarketsForEventFamily(eventInput);
  const normalized = rawFamilyMarkets
    .map((market) => normalizeGammaPolymarketMarket(market, false, true))
    .filter((market): market is NormalizedMarket => market !== null);
  const markets = sortMarkets(
    withAggregatedEventVolume(dedupeMarkets(normalized).map(withNormalizedCategory)),
    "soonest"
  );

  return {
    markets,
    total: markets.length,
    filteredTotal: markets.length,
    lastUpdated: new Date().toISOString(),
    source: "live",
    error: null
  };
}

export async function getClosingSoonMarkets(forceRefresh = false): Promise<MarketApiResponse> {
  const [cachedMarkets, lastUpdated] = await Promise.all([
    marketStore.getMarkets(),
    marketStore.getLastUpdated()
  ]);
  const prunedCachedMarkets = sortMarkets(
    cachedMarkets
      .filter(
        (market) =>
          isPolymarketMarket(market) &&
          isWithinHoursAroundNow(
            market,
            LIVE_LOOKBACK_HOURS,
            SOURCE_LOOKAHEAD_HOURS
          )
      )
      .map(withNormalizedCategory),
    "soonest"
  );
  const normalizedCachedMarkets = withAggregatedEventVolume(prunedCachedMarkets);

  if (normalizedCachedMarkets.length !== cachedMarkets.length) {
    await marketStore.saveMarkets(normalizedCachedMarkets);
  }

  const resolvedLastUpdated =
    normalizedCachedMarkets.length !== cachedMarkets.length
      ? await marketStore.getLastUpdated()
      : lastUpdated;

  if (!forceRefresh && normalizedCachedMarkets.length > 0) {
    if (isCacheFresh(lastUpdated)) {
      return {
        markets: normalizedCachedMarkets,
        total: normalizedCachedMarkets.length,
        filteredTotal: normalizedCachedMarkets.length,
        lastUpdated: resolvedLastUpdated,
        source: "cache",
        error: null
      };
    }

    // Keep UI responsive: return stale rows immediately and refresh in background.
    if (!inFlightRefresh) {
      inFlightRefresh = refreshMarkets().finally(() => {
        inFlightRefresh = null;
      });
    }

    return {
      markets: normalizedCachedMarkets,
      total: normalizedCachedMarkets.length,
      filteredTotal: normalizedCachedMarkets.length,
      lastUpdated: resolvedLastUpdated,
      source: "stale-cache",
      error: null
    };
  }

  if (!inFlightRefresh) {
    inFlightRefresh = refreshMarkets().finally(() => {
      inFlightRefresh = null;
    });
  }

  try {
    return await inFlightRefresh;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to refresh markets.";

    if (cachedMarkets.length > 0) {
      return {
        markets: normalizedCachedMarkets,
        total: normalizedCachedMarkets.length,
        filteredTotal: normalizedCachedMarkets.length,
        lastUpdated: resolvedLastUpdated,
        source: "stale-cache",
        error: message
      };
    }

    return {
      markets: [],
      total: 0,
      filteredTotal: 0,
      lastUpdated,
      source: "error",
      error: message
    };
  }
}
