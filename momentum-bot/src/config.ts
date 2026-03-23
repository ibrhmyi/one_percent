import { z } from 'zod';
import { BotConfig } from './types.js';

const configSchema = z.object({
  velocityThreshold: z.coerce.number().default(0.04),
  windowMs: z.coerce.number().default(4000),
  minYesBid: z.coerce.number().default(0.05),
  maxYesBid: z.coerce.number().default(0.75),
  positionSizeUsd: z.coerce.number().default(25),
  maxOpenPositions: z.coerce.number().default(3),
  maxTotalExposureUsd: z.coerce.number().default(150),
  dryRun: z
    .union([z.boolean(), z.string()])
    .transform((val) => val === true || val === 'true')
    .default(true),
  cooldownMs: z.coerce.number().default(30000),
  polyWsUrl: z
    .string()
    .default('wss://ws-subscriptions-clob.polymarket.com/ws/market'),
});

function getEnv(): Record<string, string | undefined> {
  return process.env;
}

export function loadBotConfig(): BotConfig {
  const env = getEnv() as Record<string, string | undefined>;

  const config = configSchema.parse({
    velocityThreshold: env.VELOCITY_THRESHOLD,
    windowMs: env.WINDOW_MS,
    minYesBid: env.MIN_YES_BID,
    maxYesBid: env.MAX_YES_BID,
    positionSizeUsd: env.POSITION_SIZE_USD,
    maxOpenPositions: env.MAX_OPEN_POSITIONS,
    maxTotalExposureUsd: env.MAX_TOTAL_EXPOSURE_USD,
    dryRun: env.DRY_RUN,
    cooldownMs: env.COOLDOWN_MS,
    polyWsUrl: env.POLY_WS_URL,
  });

  return config;
}
