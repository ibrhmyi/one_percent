import path from "node:path";
import { z } from "zod";

const envSchema = z.object({
  DOME_API_KEY: z.string().default(""),
  DOME_API_BASE_URL: z.string().url().default("https://api.domeapi.io/v1"),
  KALSHI_API_KEY_ID: z.string().default(""),
  KALSHI_PRIVATE_KEY: z.string().default(""),
  KALSHI_WS_URL: z.string().url().default("wss://api.elections.kalshi.com/trade-api/ws/v2"),
  CACHE_TTL_SECONDS: z.coerce.number().int().min(5).default(45),
  MAX_MARKETS: z.coerce.number().int().min(20).max(1000).default(200),
  MARKET_SCAN_WINDOW_HOURS: z.coerce.number().int().min(1).max(720).default(1),
  REQUEST_SPACING_MS: z.coerce.number().int().min(100).default(120),
  PRICE_ENRICH_MARKETS: z.coerce.number().int().min(0).max(200).default(20),
  CACHE_FILE_PATH: z.string().optional(),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_ANON_KEY: z.string().default(""),
  GROQ_API_KEY: z.string().default(""),
  MINIMAX_API_KEY: z.string().default(""),
  AI_SIGNAL_CACHE_MINUTES: z.coerce.number().int().min(1).default(5),
  AI_MAX_MARKETS_PER_SCAN: z.coerce.number().int().min(1).max(500).default(200),
  AI_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(8)
});

const parsedEnv = envSchema.parse({
  DOME_API_KEY: process.env.DOME_API_KEY,
  DOME_API_BASE_URL: process.env.DOME_API_BASE_URL,
  KALSHI_API_KEY_ID: process.env.KALSHI_API_KEY_ID,
  KALSHI_PRIVATE_KEY: process.env.KALSHI_PRIVATE_KEY,
  KALSHI_WS_URL: process.env.KALSHI_WS_URL,
  CACHE_TTL_SECONDS: process.env.CACHE_TTL_SECONDS,
  MAX_MARKETS: process.env.MAX_MARKETS,
  MARKET_SCAN_WINDOW_HOURS: process.env.MARKET_SCAN_WINDOW_HOURS,
  REQUEST_SPACING_MS: process.env.REQUEST_SPACING_MS,
  PRICE_ENRICH_MARKETS: process.env.PRICE_ENRICH_MARKETS,
  CACHE_FILE_PATH: process.env.CACHE_FILE_PATH,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  GROQ_API_KEY: process.env.GROQ_API_KEY,
  MINIMAX_API_KEY: process.env.MINIMAX_API_KEY,
  AI_SIGNAL_CACHE_MINUTES: process.env.AI_SIGNAL_CACHE_MINUTES,
  AI_MAX_MARKETS_PER_SCAN: process.env.AI_MAX_MARKETS_PER_SCAN,
  AI_CONCURRENCY: process.env.AI_CONCURRENCY
});

const defaultCachePath = process.env.VERCEL
  ? "/tmp/onepercent-markets.json"
  : path.join(process.cwd(), ".cache", "onepercent-markets.json");

export const appConfig = {
  domeApiKey: parsedEnv.DOME_API_KEY,
  domeApiBaseUrl: parsedEnv.DOME_API_BASE_URL,
  kalshiApiKeyId: parsedEnv.KALSHI_API_KEY_ID,
  kalshiPrivateKey: parsedEnv.KALSHI_PRIVATE_KEY,
  kalshiWsUrl: parsedEnv.KALSHI_WS_URL,
  cacheTtlMs: parsedEnv.CACHE_TTL_SECONDS * 1000,
  maxMarkets: parsedEnv.MAX_MARKETS,
  marketScanWindowHours: parsedEnv.MARKET_SCAN_WINDOW_HOURS,
  requestSpacingMs: parsedEnv.REQUEST_SPACING_MS,
  priceEnrichMarkets: parsedEnv.PRICE_ENRICH_MARKETS,
  cacheFilePath: parsedEnv.CACHE_FILE_PATH ?? defaultCachePath,
  supabaseUrl: parsedEnv.SUPABASE_URL ?? "",
  supabaseAnonKey: parsedEnv.SUPABASE_ANON_KEY,
  groqApiKey: parsedEnv.GROQ_API_KEY || parsedEnv.MINIMAX_API_KEY,
  aiSignalCacheMinutes: parsedEnv.AI_SIGNAL_CACHE_MINUTES,
  aiMaxMarketsPerScan: parsedEnv.AI_MAX_MARKETS_PER_SCAN,
  aiConcurrency: parsedEnv.AI_CONCURRENCY
};
