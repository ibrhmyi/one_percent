import { ConsensusResult, PreGameEdge, OddsAPIGame } from './types';
import type { WatchedMarket } from '@/lib/types';

// Polymarket fees (as of March 2026):
//   Taker: 0.75% peak on sports (dynamic, lower at extremes)
//   Maker: -0.20% (rebate — you get paid for limit orders)
// We use TAKER for worst-case (market order exit) and MAKER for best-case (limit order entry)
const TAKER_FEE = 0.0075;   // 0.75% — paid when taking liquidity
const MAKER_REBATE = 0.002;  // 0.20% — earned when providing liquidity

// Min edge thresholds AFTER fees (taker 0.75%, maker rebate 0.20%)
// With maker entry + taker exit, round-trip cost is ~0.55%
// So edges >1% are genuinely profitable
const MIN_EDGE: Record<string, number> = {
  high: 0.015,   // 1.5% — high confidence, multiple sharp sources agree
  medium: 0.025, // 2.5% — medium confidence
  low: 0.04,     // 4.0% — low confidence, only models available
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
  // Net payout: win pays (1 - takerFee), entry via maker earns rebate
  // Effective cost = targetPrice - MAKER_REBATE (we get paid to enter)
  // Effective payout = 1 - TAKER_FEE (we pay to exit)
  const effectiveCost = targetPrice * (1 - MAKER_REBATE);
  const netPayout = (1 - TAKER_FEE);
  const b = (netPayout - effectiveCost) / effectiveCost;

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

    // Edge AFTER fees: maker rebate on entry, taker fee on exit
    // Net edge = fairValue - marketPrice - (taker fee) + (maker rebate on entry)
    const yesEdge = yesFair - market.yesPrice - TAKER_FEE + (market.yesPrice * MAKER_REBATE);
    const noEdge = noFair - market.noPrice - TAKER_FEE + (market.noPrice * MAKER_REBATE);

    // Skip if Polymarket spread is too wide (can't enter/exit efficiently)
    const polySpread = Math.abs(1 - market.yesPrice - market.noPrice);
    if (polySpread > 0.08) continue; // 8% spread = too illiquid

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
