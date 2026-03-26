import type { ModelParams } from './types';

/**
 * Parameterized logistic regression win probability model.
 * Formula: P_home = 1 / (1 + exp(-K * lead / (TIME_SCALE * sqrt(secondsRemaining))))
 */
export function calcWinProbability(
  homeScore: number,
  awayScore: number,
  secondsRemaining: number,
  params: ModelParams
): number {
  if (secondsRemaining === 0) {
    if (homeScore > awayScore) return 0.98;
    if (awayScore > homeScore) return 0.02;
    return 0.5;
  }

  const lead = homeScore - awayScore;
  const effectiveSeconds = Math.max(secondsRemaining, 30);
  const z = -params.K * lead / (params.TIME_SCALE * Math.sqrt(effectiveSeconds));
  const pHome = 1 / (1 + Math.exp(z));

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
export function calcKellySize(
  bankroll: number,
  modelProb: number,
  entryPrice: number
): number {
  const kellyFraction = Number(process.env.KELLY_FRACTION) || 0.5;
  const maxPositionPct = Number(process.env.MAX_POSITION_PCT) || 0.25;
  const minBet = Number(process.env.MIN_KELLY_BET) || 10;

  const b = 1 / entryPrice - 1;
  const q = 1 - modelProb;
  const fullKelly = (modelProb * b - q) / b;

  if (fullKelly <= 0) return 0;

  const size = bankroll * fullKelly * kellyFraction;
  const capped = Math.min(size, bankroll * maxPositionPct);

  if (capped < minBet) return 0;
  return Math.round(capped * 100) / 100;
}
