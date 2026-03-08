import { appConfig } from "@/lib/config";
import { createRequestSpacer } from "@/lib/throttle";
import { z } from "zod";

const gammaMarketSchema = z.object({
  slug: z.string(),
  liquidityNum: z.number().nullable().optional(),
  volumeNum: z.number().nullable().optional(),
  outcomePrices: z.string().optional(),
  events: z
    .array(
      z.object({
        slug: z.string().optional(),
        volume: z.number().nullable().optional(),
        live: z.boolean().optional(),
        startTime: z.string().optional(),
        startDate: z.string().optional()
      })
    )
    .optional()
});

const gammaMarketsPageSchema = z.array(z.record(z.string(), z.unknown()));
const gammaEventsPageSchema = z.array(z.record(z.string(), z.unknown()));
const waitForTurn = createRequestSpacer(appConfig.requestSpacingMs);

function toEpochMs(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1_000_000_000_000 ? value : value * 1000;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const asNumber = Number(value);

    if (Number.isFinite(asNumber)) {
      return asNumber > 1_000_000_000_000 ? asNumber : asNumber * 1000;
    }

    const parsed = Date.parse(value);

    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return null;
}

async function fetchGammaMarketsPage(offset: number, limit: number) {
  await waitForTurn();

  const url = new URL("https://gamma-api.polymarket.com/markets");
  url.searchParams.set("active", "true");
  url.searchParams.set("closed", "false");
  url.searchParams.set("archived", "false");
  url.searchParams.set("order", "endDate");
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("limit", String(limit));

  const response = await fetch(url.toString(), {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Polymarket Gamma request failed (${response.status}).`);
  }

  return gammaMarketsPageSchema.parse(await response.json());
}

async function fetchGammaEventsBySlug(slug: string) {
  await waitForTurn();

  const url = new URL("https://gamma-api.polymarket.com/events");
  url.searchParams.set("slug", slug);

  const response = await fetch(url.toString(), {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Polymarket Gamma event request failed (${response.status}).`);
  }

  return gammaEventsPageSchema.parse(await response.json());
}

function trimSlug(input: string) {
  return input.trim().replace(/^\/+|\/+$/g, "");
}

export function extractPolymarketEventSlug(input: string) {
  const trimmed = trimSlug(input);

  if (trimmed.length === 0) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    const hostname = url.hostname.toLowerCase();

    if (!hostname.includes("polymarket.com")) {
      return trimSlug(url.pathname);
    }

    const segments = url.pathname.split("/").filter(Boolean);

    if (segments.length >= 3 && segments[0] === "sports") {
      return trimSlug(segments[2]);
    }

    if (segments.length >= 2 && segments[0] === "event") {
      return trimSlug(segments[1]);
    }

    if (segments.length >= 1) {
      return trimSlug(segments[segments.length - 1] ?? "");
    }
  } catch {
    return trimmed;
  }

  return trimmed;
}

export async function fetchGammaMarketsForEventFamily(eventInput: string) {
  const eventSlug = extractPolymarketEventSlug(eventInput);

  if (!eventSlug) {
    return [];
  }

  const baseSlug = eventSlug.replace(/-(more-markets|alt-lines)$/i, "");
  const familySlugs = [...new Set([baseSlug, `${baseSlug}-more-markets`, `${baseSlug}-alt-lines`])];
  const markets: Record<string, unknown>[] = [];

  for (const slug of familySlugs) {
    const events = await fetchGammaEventsBySlug(slug);

    for (const event of events) {
      const eventMeta = {
        slug: typeof event.slug === "string" ? event.slug : slug,
        title: event.title,
        ticker: event.ticker,
        category: event.category,
        tags: event.tags,
        startDate: event.startDate,
        endDate: event.endDate,
        live: event.live
      };
      const eventMarkets = Array.isArray(event.markets)
        ? (event.markets as unknown[])
        : [];

      for (const market of eventMarkets) {
        if (!market || typeof market !== "object") {
          continue;
        }

        const record = market as Record<string, unknown>;
        const merged: Record<string, unknown> = {
          ...record,
          events: Array.isArray(record.events) && record.events.length > 0 ? record.events : [eventMeta]
        };
        markets.push(merged);
      }
    }
  }

  return markets;
}

export async function fetchGammaMarketsClosingWithinHours(
  hours: number,
  includePastHours = 0
) {
  const pageSize = 500;
  const maxPages = Math.ceil(25_000 / pageSize);
  const now = Date.now();
  const cutoff = now + Math.max(1, hours) * 60 * 60 * 1000;
  const floor = now - Math.max(0, includePastHours) * 60 * 60 * 1000;
  const collected: Record<string, unknown>[] = [];
  let offset = 0;

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const page = await fetchGammaMarketsPage(offset, pageSize);

    if (page.length === 0) {
      break;
    }

    let pageMinEndMs: number | null = null;

    for (const market of page) {
      const endMs = toEpochMs(market.endDate);

      if (endMs === null) {
        continue;
      }

      if (pageMinEndMs === null || endMs < pageMinEndMs) {
        pageMinEndMs = endMs;
      }

      if (endMs >= floor && endMs <= cutoff) {
        collected.push(market);
      }
    }

    if (pageMinEndMs !== null && pageMinEndMs > cutoff) {
      break;
    }

    if (page.length < pageSize) {
      break;
    }

    offset += page.length;
  }

  return collected;
}

export async function fetchGammaMarketBySlug(slug: string) {
  const url = new URL("https://gamma-api.polymarket.com/markets");
  url.searchParams.set("slug", slug);

  const response = await fetch(url.toString(), {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Polymarket Gamma request failed (${response.status}).`);
  }

  const payload = z.array(gammaMarketSchema).parse(await response.json());
  return payload[0] ?? null;
}
