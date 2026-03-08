import { getClosingSoonMarkets, getEventFamilyMarkets } from "@/lib/market-service";
import { applyMarketQuery } from "@/lib/market-query";
import { platformSchema, type MarketSort } from "@/lib/types";

export const dynamic = "force-dynamic";

function parseNumber(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseBoolean(value: string | null, defaultValue: boolean) {
  if (value === null) {
    return defaultValue;
  }

  if (value === "1" || value.toLowerCase() === "true") {
    return true;
  }

  if (value === "0" || value.toLowerCase() === "false") {
    return false;
  }

  return defaultValue;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const eventInput =
    searchParams.get("event") ??
    searchParams.get("eventSlug") ??
    searchParams.get("eventUrl");
  const sort = (searchParams.get("sort") as MarketSort | null) ?? (eventInput ? "soonest" : "signal");
  const category = eventInput ? searchParams.get("category") ?? "all" : "sports";
  const limit = parseNumber(searchParams.get("limit"));
  const onlyLive = parseBoolean(searchParams.get("onlyLive"), eventInput ? false : true);
  const maxHours = parseNumber(searchParams.get("maxHours")) ?? (eventInput ? null : onlyLive ? null : 1);
  const minVolume = parseNumber(searchParams.get("minVolume"));
  const minYesPrice = parseNumber(searchParams.get("minYesPrice"));
  const minNoPrice = parseNumber(searchParams.get("minNoPrice"));
  const tradeable = searchParams.get("tradeable") === "true" ? true : searchParams.get("tradeable") === "false" ? false : null;
  const forceRefresh = searchParams.get("refresh") === "1";
  const parsedPlatform = platformSchema.safeParse(searchParams.get("platform"));
  const platform = parsedPlatform.success
    ? parsedPlatform.data
    : eventInput
      ? "all"
      : "polymarket";

  const snapshot = eventInput
    ? await getEventFamilyMarkets(eventInput)
    : await getClosingSoonMarkets(forceRefresh);
  const hasExplicitEventFilters =
    searchParams.has("platform") ||
    searchParams.has("category") ||
    searchParams.has("maxHours") ||
    searchParams.has("minVolume") ||
    searchParams.has("minYesPrice") ||
    searchParams.has("minNoPrice") ||
    searchParams.has("onlyLive") ||
    searchParams.has("sort") ||
    searchParams.has("tradeable");
  const markets =
    eventInput && !hasExplicitEventFilters
      ? snapshot.markets
      : applyMarketQuery(snapshot.markets, {
          platform,
          category,
          maxHours,
          minVolume,
          minYesPrice,
          minNoPrice,
          onlyLive,
          sort,
          tradeable
        });

  const response = {
    ...snapshot,
    markets: limit ? markets.slice(0, limit) : markets,
    filteredTotal: markets.length
  };

  return Response.json(response, {
    status: response.error && response.markets.length === 0 ? 503 : 200
  });
}
