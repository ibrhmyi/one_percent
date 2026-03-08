import { appConfig } from "@/lib/config";
import { createRequestSpacer } from "@/lib/throttle";
import { z } from "zod";

const domeMarketsResponseSchema = z.object({
  markets: z.array(z.record(z.string(), z.unknown())),
  pagination: z
    .object({
      has_more: z.boolean().optional(),
      pagination_key: z.string().nullish()
    })
    .optional()
});

const domeMarketPriceResponseSchema = z.object({
  price: z.number(),
  at_time: z.number()
});

const waitForTurn = createRequestSpacer(appConfig.requestSpacingMs);

type FetchMarketsOptions = {
  endTime?: number;
  maxMarkets?: number | null;
};

async function domeFetch<T>(
  pathname: string,
  searchParams: Record<string, string | number | undefined>
): Promise<T> {
  if (!appConfig.domeApiKey) {
    throw new Error("DOME_API_KEY is missing.");
  }

  await waitForTurn();

  const url = new URL(`${appConfig.domeApiBaseUrl.replace(/\/$/, "")}/${pathname.replace(/^\//, "")}`);

  for (const [key, value] of Object.entries(searchParams)) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${appConfig.domeApiKey}`
    },
    cache: "no-store"
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`DOME request failed (${response.status}): ${detail}`);
  }

  return (await response.json()) as T;
}

export async function fetchPolymarketMarkets(
  maxMarkets: number | null = appConfig.maxMarkets,
  options: FetchMarketsOptions = {}
) {
  const collected: Record<string, unknown>[] = [];
  let paginationKey: string | undefined;
  const effectiveMaxMarkets = options.maxMarkets ?? maxMarkets;

  while (effectiveMaxMarkets === null || collected.length < effectiveMaxMarkets) {
    const remaining =
      effectiveMaxMarkets === null ? 100 : Math.max(1, effectiveMaxMarkets - collected.length);
    const pageSize = Math.min(100, remaining);
    const payload = domeMarketsResponseSchema.parse(
      await domeFetch("/polymarket/markets", {
        status: "open",
        limit: pageSize,
        end_time: options.endTime,
        pagination_key: paginationKey
      })
    );

    collected.push(...payload.markets);

    if (!payload.pagination?.has_more || !payload.pagination.pagination_key) {
      break;
    }

    paginationKey = payload.pagination.pagination_key;
  }

  return collected;
}

export async function fetchKalshiMarkets(maxMarkets: number) {
  const collected: Record<string, unknown>[] = [];
  let paginationKey: string | undefined;

  while (collected.length < maxMarkets) {
    const pageSize = Math.min(100, maxMarkets - collected.length);
    const payload = domeMarketsResponseSchema.parse(
      await domeFetch("/kalshi/markets", {
        status: "open",
        limit: pageSize,
        pagination_key: paginationKey
      })
    );

    collected.push(...payload.markets);

    if (!payload.pagination?.has_more || !payload.pagination.pagination_key) {
      break;
    }

    paginationKey = payload.pagination.pagination_key;
  }

  return collected;
}

export async function fetchPolymarketTokenPrice(tokenId: string) {
  const payload = domeMarketPriceResponseSchema.parse(
    await domeFetch(`/polymarket/market-price/${tokenId}`, {})
  );

  return payload.price;
}

const domeKalshiPriceResponseSchema = z.object({
  yes: z.object({
    price: z.number(),
    at_time: z.number()
  }),
  no: z.object({
    price: z.number(),
    at_time: z.number()
  })
});

export async function fetchKalshiMarketPrice(marketTicker: string) {
  const payload = domeKalshiPriceResponseSchema.parse(
    await domeFetch(`/kalshi/market-price/${marketTicker}`, {})
  );

  return {
    yesPrice: payload.yes.price,
    noPrice: payload.no.price
  };
}
