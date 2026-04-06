// Logistic regression win probability model for NBA games.
// Formula: P_home = 1 / (1 + exp(-K * lead / (TS * sqrt(secondsRemaining))))
//
// Calibrated from 8,690 scoring events across 104 NBA games (March 2026).
// Backtest: backtest/calibrate_v3.py — optimized for Brier score vs game outcomes.
//
// K/TS ratio ≈ 3.0 matches established basketball win probability research.
// IMPORTANT: The Polymarket market is very efficient — scoring events are priced
// within 1-2 seconds. This model predicts FAIR VALUE, not exploitable edge.
// Actual post-scoring price moves average 0.01¢ directionally (near zero).

const MODEL_COEF = 1.15;
const STD_SCALE = 0.38;
const MIN_SECONDS = 30; // avoid sqrt(0)

export function calcWinProbability(
  homeScore: number,
  awayScore: number,
  secondsRemaining: number
): number {
  if (secondsRemaining === 0) {
    // Game over
    if (homeScore > awayScore) return 0.98;
    if (awayScore > homeScore) return 0.02;
    return 0.5;
  }

  const lead = homeScore - awayScore;
  const effectiveSeconds = Math.max(secondsRemaining, MIN_SECONDS);
  const z = -MODEL_COEF * lead / (STD_SCALE * Math.sqrt(effectiveSeconds));
  const pHome = 1 / (1 + Math.exp(z));

  // Clamp to [0.02, 0.98] — never fully certain
  return Math.min(0.98, Math.max(0.02, pHome));
}

// Polymarket fees (March 2026):
//   Taker: 0.75% flat on trade value (sports markets)
//   Maker: -0.20% rebate (limit orders)
// The old dynamic formula (0.25 * (p*(1-p))^2) is outdated.
const TAKER_FEE = 0.0075;

export function calcPolymarketFee(_price: number): number {
  return TAKER_FEE;
}

// Expected value: (modelProb * $1 payout) - cost - fee
export function calcEV(modelProb: number, entryPrice: number): number {
  return modelProb * (1 - TAKER_FEE) - entryPrice;
}

// Half-Kelly position sizing
// Returns dollar amount to bet (0 if below minimum)
export function calcKellySize(
  bankroll: number,
  modelProb: number,
  entryPrice: number
): number {
  const kellyFraction = Number(process.env.KELLY_FRACTION) || 0.5;
  const maxPositionPct = Number(process.env.MAX_POSITION_PCT) || 0.25;
  const minBet = Number(process.env.MIN_KELLY_BET) || 10;

  // b = decimal odds (profit per $1 staked)
  const b = 1 / entryPrice - 1;
  const q = 1 - modelProb;

  // Full Kelly: f = (p * b - q) / b
  const fullKelly = (modelProb * b - q) / b;

  if (fullKelly <= 0) return 0; // negative edge

  const size = bankroll * fullKelly * kellyFraction;
  const capped = Math.min(size, bankroll * maxPositionPct);

  if (capped < minBet) return 0; // skip tiny bets
  return Math.round(capped * 100) / 100;
}
