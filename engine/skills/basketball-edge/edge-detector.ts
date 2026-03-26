import { ConsensusResult, PreGameEdge, OddsAPIGame } from './types';
import type { WatchedMarket } from '@/lib/types';

const MIN_EDGE: Record<string, number> = {
  high: 0.03,
  medium: 0.05,
  low: 0.08,
};

/**
 * Target price = where we place our limit order.
 * Must be BELOW fair value (buy cheap, sell at true value).
 * We move from market price toward fair value by an aggressiveness factor.
 * Never exceeds fairValue - 1¢ (we always want positive EV at entry).
 */
function calculateTargetPrice(
  marketPrice: number,
  fairValue: number,
  confidence: 'high' | 'medium' | 'low'
): number {
  // How far toward fair value we're willing to go (lower = more patient maker orders)
  const aggressiveness = confidence === 'high' ? 0.40 : confidence === 'medium' ? 0.50 : 0.60;
  const raw = marketPrice + aggressiveness * (fairValue - marketPrice);
  // CRITICAL: Never place order at or above fair value — that's negative EV
  const maxTarget = fairValue - 0.01;
  const clamped = Math.min(raw, maxTarget);
  return Math.round(clamped * 100) / 100;
}

/**
 * Kelly criterion for pre-game sizing.
 * f* = (p * b - q) / b, where:
 *   p = consensus probability
 *   q = 1 - p
 *   b = payout ratio = (1 - targetPrice) / targetPrice
 *
 * We use quarter Kelly (x 0.25) for safety.
 * Capped at 15% of bankroll per bet.
 * Minimum bet: $5.
 */
export function calculateKellySize(
  fairValue: number,
  targetPrice: number,
  bankroll: number
): number {
  const kellyFraction = parseFloat(process.env.KELLY_FRACTION || '0.25');
  const maxPositionPct = 0.15;
  const minBet = parseFloat(process.env.MIN_KELLY_BET || '5');

  const p = fairValue;
  const q = 1 - p;
  const b = (1 - targetPrice) / targetPrice;

  const fullKelly = (p * b - q) / b;
  if (fullKelly <= 0) return 0;

  const bet = bankroll * kellyFraction * fullKelly;
  const capped = Math.min(bet, bankroll * maxPositionPct);

  return capped >= minBet ? Math.round(capped * 100) / 100 : 0;
}

/**
 * Detect pre-game edges.
 * Implements spread filter (Amendment 3): skip if books disagree > 10%.
 */
export function detectEdges(
  oddsGames: Array<{
    game: OddsAPIGame;
    consensus: ConsensusResult;
    market: WatchedMarket;
    homeIsYes: boolean;
  }>,
  bankroll: number,
  existingOrderGameIds: Set<string>
): PreGameEdge[] {
  const edges: PreGameEdge[] = [];

  for (const { game, consensus, market, homeIsYes } of oddsGames) {
    if (existingOrderGameIds.has(game.id)) continue;

    const minsUntilStart = (new Date(game.commence_time).getTime() - Date.now()) / 60000;
    if (minsUntilStart < 5) continue;
    if (minsUntilStart > 48 * 60) continue;

    // SPREAD FILTER: Skip if bookmakers disagree too much (Amendment 3)
    if (consensus.spread > 0.10) {
      console.log(`[PreGameEdge] Skip ${game.home_team} vs ${game.away_team}: book spread ${(consensus.spread * 100).toFixed(1)}% too high`);
      continue;
    }

    const homeFair = consensus.homeWinProb;
    const awayFair = consensus.awayWinProb;

    const yesFair = homeIsYes ? homeFair : awayFair;
    const noFair = homeIsYes ? awayFair : homeFair;

    const yesEdge = yesFair - market.yesPrice;
    const noEdge = noFair - market.noPrice;

    let side: 'YES' | 'NO';
    let fairValue: number;
    let marketPrice: number;
    let edge: number;

    if (yesEdge >= noEdge && yesEdge > 0) {
      side = 'YES';
      fairValue = yesFair;
      marketPrice = market.yesPrice;
      edge = yesEdge;
    } else if (noEdge > 0) {
      side = 'NO';
      fairValue = noFair;
      marketPrice = market.noPrice;
      edge = noEdge;
    } else {
      continue;
    }

    const minEdge = MIN_EDGE[consensus.confidence] || 0.05;
    if (edge < minEdge) continue;

    const targetPrice = calculateTargetPrice(marketPrice, fairValue, consensus.confidence);
    // Guard: if target >= fairValue, this is not worth entering
    if (targetPrice >= fairValue) continue;
    const kellySize = calculateKellySize(fairValue, targetPrice, bankroll);
    if (kellySize === 0) continue;

    // EV = (fairValue - targetPrice) * size — profit if consensus is correct
    const ev = (fairValue - targetPrice) * kellySize;

    edges.push({
      oddsGameId: game.id,
      sportKey: game.sport_key,
      homeTeam: game.home_team,
      awayTeam: game.away_team,
      commenceTime: game.commence_time,
      consensus,
      conditionId: market.conditionId,
      yesTokenId: market.yesTokenId || '',
      noTokenId: market.noTokenId || '',
      yesPrice: market.yesPrice,
      noPrice: market.noPrice,
      polymarketSpread: Math.abs(1 - market.yesPrice - market.noPrice),
      side,
      fairValue,
      marketPrice,
      edge,
      ev,
      targetPrice,
      kellySize,
      availableLiquidity: 0,
      estimatedSlippage: 0,
    });
  }

  edges.sort((a, b) => b.ev - a.ev);
  return edges;
}
