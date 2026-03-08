import { resolveMarketCategoryFromTags } from "@/lib/category";
import type { NormalizedMarket } from "@/lib/types";
import { normalizedMarketSchema } from "@/lib/types";

function pickNumber(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);

      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return null;
}

function pickString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") {
      return value;
    }
  }

  return null;
}

function pickCategoryCandidates(...values: unknown[]) {
  const candidates: string[] = [];

  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") {
      candidates.push(value);
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string" && item.trim() !== "") {
          candidates.push(item);
        }
      }
    }
  }

  return candidates;
}

function toIsoString(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value > 1_000_000_000_000 ? value : value * 1000;
    return new Date(milliseconds).toISOString();
  }

  if (typeof value === "string" && value.trim() !== "") {
    const numeric = Number(value);

    if (Number.isFinite(numeric)) {
      const milliseconds = numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
      return new Date(milliseconds).toISOString();
    }

    const parsed = new Date(value);

    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  return null;
}

function pickIsoString(...values: unknown[]) {
  for (const value of values) {
    const normalized = toIsoString(value);

    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function pickRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseStringArray(value: unknown) {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }

  if (typeof value === "string" && value.trim() !== "") {
    try {
      const parsed = JSON.parse(value);

      if (Array.isArray(parsed)) {
        return parsed.filter((item): item is string => typeof item === "string");
      }
    } catch {
      return [];
    }
  }

  return [];
}

export function normalizeDomePolymarketMarket(
  rawMarket: Record<string, unknown>,
  includeSourceRaw = false
): NormalizedMarket | null {
  const archived =
    rawMarket.archived === true ||
    rawMarket.is_archived === true ||
    rawMarket.isArchived === true;

  if (archived) {
    return null;
  }

  const status = pickString(rawMarket.status, rawMarket.market_status);
  const isTradable =
    status === null || ["open", "active", "tradable"].includes(status.toLowerCase());

  if (!isTradable) {
    return null;
  }

  const closeTime = pickIsoString(
    rawMarket.close_time,
    rawMarket.end_time,
    rawMarket.resolution_time,
    rawMarket.completed_time
  );

  if (!closeTime) {
    return null;
  }

  const sideA = rawMarket.side_a as Record<string, unknown> | undefined;
  const sideB = rawMarket.side_b as Record<string, unknown> | undefined;
  const extraFields = rawMarket.extra_fields as Record<string, unknown> | undefined;

  // Current DOME payloads expose token ids on side_a / side_b, but not obvious live pricing
  // on the list endpoint. We preserve nullable fields so a future price-enrichment pass can
  // fill them without changing the public schema.
  const yesPrice = pickNumber(
    rawMarket.yes_price,
    rawMarket.price_yes,
    sideA?.price,
    extraFields?.yes_price
  );

  const noPrice =
    pickNumber(rawMarket.no_price, rawMarket.price_no, sideB?.price, extraFields?.no_price) ??
    (yesPrice !== null ? Number((1 - yesPrice).toFixed(4)) : null);
  const categoryCandidates = pickCategoryCandidates(
    rawMarket.category,
    rawMarket.tags,
    extraFields?.category,
    extraFields?.tags
  );

  const normalized: NormalizedMarket = {
    category: resolveMarketCategoryFromTags(categoryCandidates),
    id:
      pickString(rawMarket.condition_id, rawMarket.market_id, rawMarket.id, rawMarket.market_slug) ??
      crypto.randomUUID(),
    title: pickString(rawMarket.title, rawMarket.question) ?? "Untitled market",
    slug: pickString(rawMarket.market_slug, rawMarket.slug),
    eventSlug: pickString(rawMarket.event_slug),
    platform: "polymarket",
    closeTime,
    isLive:
      pickIsoString(rawMarket.game_start_time) !== null
        ? new Date(pickIsoString(rawMarket.game_start_time) as string).getTime() <= Date.now()
        : false,
    yesPrice,
    noPrice,
    volume: pickNumber(
      rawMarket.volume_total,
      rawMarket.volume,
      rawMarket.total_volume,
      extraFields?.volume_total
    ),
    liquidity: pickNumber(
      rawMarket.liquidity,
      rawMarket.liquidity_total,
      rawMarket.total_liquidity,
      extraFields?.liquidity
    ),
    yesTokenId: pickString(sideA?.id),
    noTokenId: pickString(sideB?.id),
    // DOME does not currently expose a public URL field on the list response.
    // The market slug maps to the Polymarket event path in current payloads.
    url:
      pickString(rawMarket.url) ??
      (pickString(rawMarket.event_slug) && pickString(rawMarket.market_slug)
        ? `https://polymarket.com/event/${pickString(rawMarket.event_slug)}/${pickString(rawMarket.market_slug)}`
        : pickString(rawMarket.market_slug)
          ? `https://polymarket.com/market/${pickString(rawMarket.market_slug)}`
        : null),
    status,
    ...(includeSourceRaw ? { sourceRaw: rawMarket } : {})
  };

  return normalizedMarketSchema.parse(normalized);
}

export function normalizeGammaPolymarketMarket(
  rawMarket: Record<string, unknown>,
  includeSourceRaw = false,
  includeClosed = false
): NormalizedMarket | null {
  const archived = rawMarket.archived === true;
  const closed = rawMarket.closed === true;
  const active = rawMarket.active === true;

  if (archived) {
    return null;
  }

  if (!includeClosed && (closed || !active)) {
    return null;
  }

  const event = Array.isArray(rawMarket.events) ? pickRecord(rawMarket.events[0]) : null;
  const closeTime = pickIsoString(
    rawMarket.endDate,
    rawMarket.end_date,
    rawMarket.closeTime,
    event?.endDate,
    event?.end_date
  );

  if (!closeTime) {
    return null;
  }

  const outcomePrices = parseStringArray(rawMarket.outcomePrices).map((value) => Number(value));
  const normalizedOutcomePrices = outcomePrices.map((value) =>
    Number.isFinite(value) ? (value > 1 ? value / 100 : value) : NaN
  );
  const yesPrice = Number.isFinite(normalizedOutcomePrices[0]) ? normalizedOutcomePrices[0] : null;
  const noPrice =
    Number.isFinite(normalizedOutcomePrices[1])
      ? normalizedOutcomePrices[1]
      : yesPrice !== null
        ? Number((1 - yesPrice).toFixed(4))
        : null;

  const tokenIds = parseStringArray(rawMarket.clobTokenIds);
  const categoryCandidates = pickCategoryCandidates(
    rawMarket.category,
    rawMarket.tags,
    rawMarket.question,
    rawMarket.title,
    rawMarket.slug,
    rawMarket.ticker,
    event?.category,
    event?.tags,
    event?.title,
    event?.slug,
    event?.ticker
  );
  const gameStartTime = pickIsoString(
    rawMarket.gameStartTime,
    rawMarket.game_start_time,
    event?.gameStartTime
  );
  const eventStart = pickIsoString(gameStartTime, event?.startDate, event?.start_time, rawMarket.startDate);
  const eventClose = new Date(closeTime).getTime();
  const now = Date.now();
  const gameStartMs = gameStartTime ? new Date(gameStartTime).getTime() : null;
  const eventLive =
    (typeof event?.live === "boolean" ? event.live : null) ??
    (typeof rawMarket.live === "boolean" ? (rawMarket.live as boolean) : null);
  const liveByGameClock =
    gameStartMs !== null
      ? now >= gameStartMs && now <= gameStartMs + 4 * 60 * 60 * 1000
      : null;
  const liveByEventStart =
    eventStart !== null ? new Date(eventStart).getTime() <= now && eventClose > now : null;

  const normalized: NormalizedMarket = {
    category: resolveMarketCategoryFromTags(categoryCandidates),
    id: pickString(rawMarket.conditionId, rawMarket.id, rawMarket.condition_id, rawMarket.slug) ?? crypto.randomUUID(),
    title: pickString(rawMarket.question, rawMarket.title) ?? "Untitled market",
    slug: pickString(rawMarket.slug, rawMarket.market_slug),
    eventSlug: pickString(event?.slug, rawMarket.eventSlug, rawMarket.event_slug),
    platform: "polymarket",
    closeTime,
    isLive:
      eventLive ??
      liveByGameClock ??
      liveByEventStart ??
      (rawMarket.acceptingOrders === true && eventClose > now),
    yesPrice,
    noPrice,
    volume: pickNumber(rawMarket.volumeNum, rawMarket.volume, rawMarket.volumeClob),
    liquidity: pickNumber(rawMarket.liquidityNum, rawMarket.liquidity, rawMarket.liquidityClob),
    yesTokenId: pickString(tokenIds[0]),
    noTokenId: pickString(tokenIds[1]),
    url:
      pickString(rawMarket.url) ??
      (pickString(event?.slug) && pickString(rawMarket.slug)
        ? `https://polymarket.com/event/${pickString(event?.slug)}/${pickString(rawMarket.slug)}`
        : pickString(rawMarket.slug)
          ? `https://polymarket.com/event/${pickString(rawMarket.slug)}`
          : null),
    status: closed ? "closed" : "open",
    ...(includeSourceRaw ? { sourceRaw: rawMarket } : {})
  };

  return normalizedMarketSchema.parse(normalized);
}

export function normalizeDomeKalshiMarket(
  rawMarket: Record<string, unknown>,
  includeSourceRaw = false
): NormalizedMarket | null {
  const archived =
    rawMarket.archived === true ||
    rawMarket.is_archived === true ||
    rawMarket.isArchived === true;

  if (archived) {
    return null;
  }

  const status = pickString(rawMarket.status, rawMarket.market_status);
  const isTradable =
    status === null || ["open", "active", "tradable"].includes(status.toLowerCase());

  if (!isTradable) {
    return null;
  }

  const closeTime = pickIsoString(
    rawMarket.close_time,
    rawMarket.end_time,
    rawMarket.resolution_time,
    rawMarket.completed_time
  );

  if (!closeTime) {
    return null;
  }

  const lastPrice = pickNumber(rawMarket.last_price, rawMarket.yes_price, rawMarket.price_yes);
  const normalizedYesPrice =
    typeof lastPrice === "number" ? (lastPrice > 1 ? lastPrice / 100 : lastPrice) : null;
  const normalizedNoPrice =
    normalizedYesPrice !== null ? Number((1 - normalizedYesPrice).toFixed(4)) : null;
  const eventTicker = pickString(rawMarket.event_ticker);
  const marketTicker = pickString(rawMarket.market_ticker);

  const normalized: NormalizedMarket = {
    id: marketTicker ?? pickString(rawMarket.id) ?? crypto.randomUUID(),
    title: pickString(rawMarket.title, rawMarket.question) ?? "Untitled market",
    slug: marketTicker,
    eventSlug: eventTicker,
    marketTicker,
    eventTicker,
    platform: "kalshi",
    closeTime,
    isLive:
      pickIsoString(rawMarket.start_time) !== null
        ? new Date(pickIsoString(rawMarket.start_time) as string).getTime() <= Date.now()
        : false,
    yesPrice: normalizedYesPrice,
    noPrice: normalizedNoPrice,
    volume: pickNumber(rawMarket.volume_24h, rawMarket.volume, rawMarket.volume_total),
    eventVolume: pickNumber(rawMarket.volume_24h, rawMarket.volume, rawMarket.volume_total),
    liquidity: null,
    url:
      pickString(rawMarket.url) ??
      (eventTicker && marketTicker ? `https://kalshi.com/markets/${eventTicker}/${marketTicker}` : null),
    status,
    ...(includeSourceRaw ? { sourceRaw: rawMarket } : {})
  };

  return normalizedMarketSchema.parse(normalized);
}
