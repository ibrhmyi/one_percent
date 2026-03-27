interface SeenMarket {
  conditionId: string;
  firstSeenAt: number;
  initialPrice: number;
}

const seenMarkets: Map<string, SeenMarket> = new Map();

export function isNewMarket(conditionId: string): boolean {
  return !seenMarkets.has(conditionId);
}

export function markMarketSeen(conditionId: string, yesPrice: number): void {
  seenMarkets.set(conditionId, {
    conditionId,
    firstSeenAt: Date.now(),
    initialPrice: yesPrice,
  });
}

export function getMarketAge(conditionId: string): number {
  const seen = seenMarkets.get(conditionId);
  if (!seen) return 0;
  return Date.now() - seen.firstSeenAt;
}

/**
 * For early markets (< 24h old), use relaxed thresholds:
 * - 10% min edge (vs 3-8% for mature) — structural gaps are fat
 * - Higher Kelly (0.35x vs 0.25x) — more aggressive on large gaps
 * - Skip liquidity check — we ARE the liquidity provider
 */
export function getEarlyMarketConfig() {
  return {
    minEdge: 0.04,  // After 2% taker fee subtracted from edge
    kellyFraction: 0.25,  // Consistent with Kelly formula
    skipLiquidityCheck: true,
    maxBetPct: 0.15,
  };
}
