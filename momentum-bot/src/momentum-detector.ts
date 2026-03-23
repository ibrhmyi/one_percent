import {
  BookSnapshot,
  BotConfig,
  MomentumSignal,
  PricePoint,
  WatchedMarket,
} from './types.js';

function linearRegressionSlope(points: PricePoint[]): number {
  if (points.length < 2) return 0;

  const n = points.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;

  const minTime = points[0].timestamp;

  for (const point of points) {
    const x = point.timestamp - minTime; // time in ms
    const y = point.price;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumX2 += x * x;
  }

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);

  // slope is price/ms, convert to price/second
  return slope * 1000;
}

export class MomentumDetector {
  private priceHistory: Map<string, PricePoint[]> = new Map();
  private lastSignalTime: Map<string, number> = new Map();
  private config: BotConfig;
  private onSignal: (signal: MomentumSignal) => void;

  constructor(config: BotConfig, onSignal: (signal: MomentumSignal) => void) {
    this.config = config;
    this.onSignal = onSignal;
  }

  processBookUpdate(snapshot: BookSnapshot, market: WatchedMarket): void {
    const { conditionId } = snapshot;

    // Initialize price history for this market if needed
    if (!this.priceHistory.has(conditionId)) {
      this.priceHistory.set(conditionId, []);
    }

    // Create price point
    const midPrice = (snapshot.yesBid + snapshot.yesAsk) / 2;
    const pricePoint: PricePoint = {
      price: midPrice,
      timestamp: snapshot.timestamp,
    };

    // Add to ring buffer (max 50 points)
    const history = this.priceHistory.get(conditionId)!;
    history.push(pricePoint);
    if (history.length > 50) {
      history.shift();
    }

    // Check cooldown
    const lastSignal = this.lastSignalTime.get(conditionId);
    if (lastSignal && snapshot.timestamp - lastSignal < this.config.cooldownMs) {
      return;
    }

    // Entry guards
    if (
      snapshot.yesBid < this.config.minYesBid ||
      snapshot.yesBid > this.config.maxYesBid
    ) {
      return;
    }

    // Get points within window
    const windowStart = snapshot.timestamp - this.config.windowMs;
    const relevantPoints = history.filter((p) => p.timestamp >= windowStart);

    if (relevantPoints.length < 2) {
      return;
    }

    // Calculate velocity
    const velocity = linearRegressionSlope(relevantPoints);

    // Check threshold
    if (velocity <= this.config.velocityThreshold) {
      return;
    }

    // Determine confidence
    let confidence: 'low' | 'medium' | 'high' = 'low';
    if (
      velocity > this.config.velocityThreshold * 2 &&
      relevantPoints.length >= 5
    ) {
      // Check if price sustained over 500ms
      const oldestPoint = relevantPoints[0];
      const newestPoint = relevantPoints[relevantPoints.length - 1];
      if (newestPoint.timestamp - oldestPoint.timestamp >= 500) {
        confidence = 'high';
      }
    } else if (relevantPoints.length >= 3) {
      confidence = 'medium';
    }

    // Fire signal
    const signal: MomentumSignal = {
      polyConditionId: conditionId,
      polyTokenId: snapshot.tokenId,
      title: market.title,
      yesBid: snapshot.yesBid,
      yesAsk: snapshot.yesAsk,
      velocity,
      priceHistory: relevantPoints,
      confidence,
      timestamp: snapshot.timestamp,
    };

    // Update cooldown and fire
    this.lastSignalTime.set(conditionId, snapshot.timestamp);
    this.onSignal(signal);
  }

  resetMarket(conditionId: string): void {
    this.priceHistory.delete(conditionId);
    this.lastSignalTime.delete(conditionId);
  }
}
