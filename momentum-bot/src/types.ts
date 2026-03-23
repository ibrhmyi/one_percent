export interface BookSnapshot {
  conditionId: string;       // Polymarket condition ID (hex string)
  tokenId: string;           // YES token ID
  yesBid: number;            // Best YES bid (0-1 scale)
  yesAsk: number;            // Best YES ask (0-1 scale)
  timestamp: number;         // Unix ms
}

export interface PricePoint {
  price: number;             // YES mid price (0-1 scale)
  timestamp: number;         // Unix ms
}

export interface MomentumSignal {
  polyConditionId: string;   // Polymarket condition ID
  polyTokenId: string;       // YES token ID
  title: string;             // Market title (human readable)
  yesBid: number;            // Current YES bid at signal time
  yesAsk: number;            // Current YES ask at signal time
  velocity: number;          // Price change per second (e.g. 0.08 = 8¢/sec)
  priceHistory: PricePoint[]; // Last N price points used to compute velocity
  confidence: 'low' | 'medium' | 'high';
  timestamp: number;         // Unix ms when signal fired
}

export interface OrderResult {
  success: boolean;
  orderId?: string;
  kalshiTicker: string;
  side: 'yes' | 'no';
  sizeUsd: number;
  fillPrice?: number;
  errorMessage?: string;
  dryRun: boolean;
  timestamp: number;
}

export interface WatchedMarket {
  polyConditionId: string;
  polyTokenId: string;       // YES token ID (needed for CLOB subscription)
  title: string;
  kalshiTicker: string | null; // null if no Kalshi match found
  addedAt: number;
}

export interface BotConfig {
  velocityThreshold: number;
  windowMs: number;
  minYesBid: number;
  maxYesBid: number;
  positionSizeUsd: number;
  maxOpenPositions: number;
  maxTotalExposureUsd: number;
  dryRun: boolean;
  cooldownMs: number;
  polyWsUrl: string;
}
