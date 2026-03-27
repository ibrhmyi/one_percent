import { ConsensusResult, PreGameEdge, OddsAPIGame } from './types';
import type { WatchedMarket } from '@/lib/types';

// Polymarket taker fee — applied when EXITING a position
const TAKER_FEE = 0.02;

const MIN_EDGE: Record<string, number> = {
  high: 0.04,    // was 0.03 — raised to survive fees
  medium: 0.06,  // was 0.05
  low: 0.09,     // was 0.08
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
  const aggressiveness = confidence === 'high' ? 0.40 : confidence === 'medium' ? 0.50 : 0.60;
  const raw = marketPrice + aggressiveness * (fairValue - marketPrice);
  const maxTarget = fairValue - 0.01;
  const clamped = Math.min(raw, maxTarget);
  return Math.round(clamped * 100) / 100;
}

/**
 * Kelly criterion for pre-game sizing.
 * f* = (p * b - q) / b, where:
 *   p = consensus probability (fair value)
 *   q = 1 - p
 *   b = NET payout after taker fee = ((1 - TAKER_FEE) - targetPrice) / targetPrice
 *
 * Quarter Kelly (0.25x) for safety. Capped at 15% of bankroll per bet.
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
  // Net payout accounts for taker fee on exit
  const netPayout = (1 - TAKER_FEE);
  const b = (netPayout - targetPrice) / targetPrice;

  if (b <= 0) return 0;

  const fullKelly = (p * b - q) / b;
  if (fullKelly <= 0) return 0;

  const bet = bankroll * kellyFraction * fullKelly;
  const capped = Math.min(bet, bankroll * maxPositionPct);

  return capped >= minBet ? Math.round(capped * 100) / 100 : 0;
}

/**
 * Detect pre-game edges.
 * Edge = fairValue - marketPrice - TAKER_FEE (net edge after exit fee).
 * Spread filter: skip if books disagree > 10%.
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

    if (consensus.spread > 0.10) continue;

    const homeFair = consensus.homeWinProb;
    const awayFair = consensus.awayWinProb;

    const yesFair = homeIsYes ? homeFair : awayFair;
    const noFair = homeIsYes ? awayFair : homeFair;

    // Edge AFTER taker fee on exit
    const yesEdge = yesFair - market.yesPrice - TAKER_FEE;
    const noEdge = noFair - market.noPrice - TAKER_FEE;

    let side: 'YES' | 'NO';
    let fairValue: number;
    let marketPrice: number;
    let edge: number;

    if (yesEdge >= noEdge && yesEdge > 0) {
      side = 'YES'; fairValue = yesFair; marketPrice = market.yesPrice; edge = yesEdge;
    } else if (noEdge > 0) {
      side = 'NO'; fairValue = noFair; marketPrice = market.noPrice; edge = noEdge;
    } else {
      continue;
    }

    const minEdge = MIN_EDGE[consensus.confidence] || 0.06;
    if (edge < minEdge) continue;

    const targetPrice = calculateTargetPrice(marketPrice, fairValue, consensus.confidence);
    if (targetPrice >= fairValue) continue;
    const kellySize = calculateKellySize(fairValue, targetPrice, bankroll);
    if (kellySize === 0) continue;

    // EV = (fairValue - targetPrice - TAKER_FEE) * shares
    const shares = kellySize / targetPrice;
    const ev = (fairValue - targetPrice - TAKER_FEE) * shares;

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
