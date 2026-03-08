import { z } from "zod";

export const platformSchema = z.enum(["polymarket", "kalshi", "unknown"]);
export type Platform = z.infer<typeof platformSchema>;

export const normalizedMarketSchema = z.object({
  id: z.string(),
  title: z.string(),
  slug: z.string().nullable(),
  category: z.string().nullable().optional(),
  eventSlug: z.string().nullable().optional(),
  marketTicker: z.string().nullable().optional(),
  eventTicker: z.string().nullable().optional(),
  platform: platformSchema,
  closeTime: z.string(),
  isLive: z.boolean().optional(),
  yesPrice: z.number().nullable(),
  noPrice: z.number().nullable(),
  volume: z.number().nullable(),
  eventVolume: z.number().nullable().optional(),
  liquidity: z.number().nullable(),
  url: z.string().nullable(),
  status: z.string().nullable(),
  yesTokenId: z.string().nullable().optional(),
  noTokenId: z.string().nullable().optional(),
  resolutionWindowMin: z.number().nullable().optional(),
  resolutionWindowMax: z.number().nullable().optional(),
  confidence: z.enum(["low", "medium", "high"]).nullable().optional(),
  tradeable: z.boolean().nullable().optional(),
  aiReason: z.string().nullable().optional()
});

export type NormalizedMarket = z.infer<typeof normalizedMarketSchema> & {
  sourceRaw?: unknown;
};

export type MarketSort = "urgency" | "soonest" | "liquidity" | "volume" | "signal";
export type MarketBadge = "Active" | "Closing Soon" | "Missing data";

export interface MarketStore {
  getMarkets(): Promise<NormalizedMarket[]>;
  saveMarkets(markets: NormalizedMarket[]): Promise<void>;
  getLastUpdated(): Promise<string | null>;
}

export interface MarketQuery {
  platform?: Platform | "all";
  category?: string | "all";
  maxHours?: number | null;
  minVolume?: number | null;
  minYesPrice?: number | null;
  minNoPrice?: number | null;
  onlyLive?: boolean;
  sort?: MarketSort;
  tradeable?: boolean | null;
}

export interface MarketApiResponse {
  markets: NormalizedMarket[];
  total: number;
  filteredTotal: number;
  lastUpdated: string | null;
  source: "cache" | "live" | "stale-cache" | "error";
  error: string | null;
}
