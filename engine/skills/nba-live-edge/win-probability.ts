// Logistic regression win probability model for NBA games.
// Formula: P_home = 1 / (1 + exp(-0.7 * lead / (0.45 * sqrt(secondsRemaining))))
// Based on established in-game win probability research.

const MODEL_COEF = 0.7;
const STD_SCALE = 0.45;
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

// Polymarket dynamic taker fee formula
// fee = 0.25 * (p * (1-p))^2
export function calcPolymarketFee(price: number): number {
  return 0.25 * Math.pow(price * (1 - price), 2);
}

// Expected value: (modelProb * $1 payout) - cost - fee
export function calcEV(modelProb: number, entryPrice: number): number {
  const fee = calcPolymarketFee(entryPrice);
  return modelProb * 1.0 - entryPrice - fee;
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
