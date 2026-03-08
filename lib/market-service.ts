import { resolveMarketCategoryFromTags } from "@/lib/category";
import { appConfig } from "@/lib/config";
import { sortMarkets } from "@/lib/market-query";
import { normalizeGammaPolymarketMarket } from "@/lib/normalize";
import {
  fetchGammaMarketsClosingWithinHours,
  fetchGammaMarketsForEventFamily
} from "@/lib/polymarket";
import { marketStore } from "@/lib/store";
import type { MarketApiResponse, NormalizedMarket } from "@/lib/types";

let inFlightRefresh: Promise<MarketApiResponse> | null = null;
const LIVE_LOOKBACK_HOURS = 4;

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

async function refreshMarkets() {
  const rawPolymarketMarkets = await fetchGammaMarketsClosingWithinHours(
    appConfig.marketScanWindowHours,
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
          appConfig.marketScanWindowHours
        )
    )
      .map(withNormalizedCategory)
  );

  await marketStore.saveMarkets(marketsForCache);

  return {
    markets: marketsForCache,
    total: marketsForCache.length,
    filteredTotal: marketsForCache.length,
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
            appConfig.marketScanWindowHours
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
