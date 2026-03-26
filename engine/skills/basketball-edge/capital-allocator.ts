import { WatchlistEntry, AllocationDecision, PreGameOrder } from './types';
import { calculateKellySize } from './edge-detector';

const TAKER_FEE = 0.02;
const MIN_SWITCH_BENEFIT = 0.03;  // Only switch if net benefit > 3 cents/share
const EV_CLUSTER_THRESHOLD = 0.05; // Split capital when top EVs are within 5%
const MAX_POSITIONS = 3;           // Don't spread across more than 3

/**
 * Core allocation logic. Runs every 60-second cycle.
 *
 * Decides:
 * - HOLD: current position is still best, do nothing
 * - ENTER: no current position but opportunity exists
 * - SWITCH: current position fell out of top, exit + enter better one
 *   (only if net benefit > 3c/share after taker fees)
 * - EXIT: no good opportunities, exit current position
 */
export function allocate(
  watchlist: WatchlistEntry[],
  currentOrders: PreGameOrder[],
  bankroll: number
): AllocationDecision {

  const filledPositions = currentOrders.filter(
    o => o.status === 'filled' || o.status === 'partially_filled'
  );
  const restingOrders = currentOrders.filter(o => o.status === 'resting');

  // Active opportunities with positive EV
  const opportunities = watchlist.filter(
    w => w.polymarketMatched && w.bestSideEV > 0 && w.status === 'active_opportunity'
  );

  if (opportunities.length === 0) {
    return { action: 'HOLD', reason: 'No positive-EV opportunities available' };
  }

  // ── Build allocation targets (top 1-3 clustered by EV) ──
  const topEV = opportunities[0].bestSideEV;
  const cluster = opportunities
    .filter(o => topEV - o.bestSideEV <= EV_CLUSTER_THRESHOLD)
    .slice(0, MAX_POSITIONS);

  const totalClusterEV = cluster.reduce((s, o) => s + o.bestSideEV, 0);
  const targets = cluster.map(entry => {
    const weight = entry.bestSideEV / totalClusterEV;
    // BUY at current market price (taker) — this is the actual entry
    const marketPrice = entry.bestSide === 'YES' ? entry.currentYesPrice! : entry.currentNoPrice!;
    // Fair value = where we'll place our SELL limit to take profit
    const fairValue = entry.bestSide === 'YES'
      ? (entry.homeIsYes ? entry.homeFairValue : entry.awayFairValue)
      : (entry.homeIsYes ? entry.awayFairValue : entry.homeFairValue);

    return {
      conditionId: entry.conditionId!,
      tokenId: (entry.bestSide === 'YES' ? entry.yesTokenId : entry.noTokenId) || '',
      game: `${entry.homeTeam} vs ${entry.awayTeam}`,
      side: entry.bestSide as 'YES' | 'NO',
      entryPrice: marketPrice,  // Buy at market
      exitPrice: fairValue,     // Sell limit at fair value
      fairValue,
      ev: entry.bestSideEV,
      kellySize: Math.max(5, Math.round(bankroll * weight * 0.40)),
      weight,
    };
  });

  // ── Case 1: No positions and no resting orders -> ENTER ──
  if (filledPositions.length === 0 && restingOrders.length === 0) {
    return {
      action: 'ENTER',
      reason: `Entering top ${targets.length} opportunity/ies: ${targets.map(t => `${t.game} (EV +${(t.ev * 100).toFixed(1)}%)`).join(', ')}`,
      targets,
    };
  }

  // ── Case 2: Have resting (unfilled) orders -> switch is FREE ──
  if (filledPositions.length === 0 && restingOrders.length > 0) {
    const currentConditionIds = new Set(restingOrders.map(o => o.conditionId));
    const targetConditionIds = new Set(targets.map(t => t.conditionId));

    const needsRebalance = targets.some(t => !currentConditionIds.has(t.conditionId))
      || restingOrders.some(o => !targetConditionIds.has(o.conditionId));

    if (needsRebalance) {
      return {
        action: 'SWITCH',
        reason: `Rebalancing unfilled orders (FREE — no switching cost)`,
        targets,
        switchingCost: 0,
        netBenefit: targets[0].ev - (restingOrders[0]?.edge || 0),
      };
    }
    return { action: 'HOLD', reason: 'Current resting orders align with best opportunities' };
  }

  // ── Case 3: Have filled positions -> evaluate switching cost ──
  if (filledPositions.length > 0) {
    const pos = filledPositions[0];

    const posEntry = watchlist.find(w => w.conditionId === pos.conditionId);
    const currentPrice = posEntry
      ? (posEntry.currentYesPrice || pos.price)
      : pos.price;
    const remainingEV = pos.fairValue - currentPrice;
    const unrealizedPnL = currentPrice - pos.avgFillPrice;

    const stillInTargets = targets.some(t => t.conditionId === pos.conditionId);

    if (stillInTargets) {
      return {
        action: 'HOLD',
        reason: `Current position still ranked in top ${targets.length} | Remaining EV: +${(remainingEV * 100).toFixed(1)}% | P&L: ${unrealizedPnL > 0 ? '+' : ''}${(unrealizedPnL * 100).toFixed(1)}c`,
        currentPosition: {
          conditionId: pos.conditionId,
          game: `${pos.homeTeam} vs ${pos.awayTeam}`,
          entryPrice: pos.avgFillPrice,
          currentPrice,
          remainingEV,
          unrealizedPnL,
          size: pos.filledSize,
        },
      };
    }

    // Current position fell out of top targets -> evaluate switch
    const bestNewEV = targets[0].ev;
    const exitCost = pos.filledSize * TAKER_FEE;
    const netBenefit = bestNewEV - remainingEV - (exitCost / pos.filledSize);

    if (netBenefit > MIN_SWITCH_BENEFIT) {
      return {
        action: 'SWITCH',
        reason: `Better opportunity: ${targets[0].game} (EV +${(bestNewEV * 100).toFixed(1)}%) vs current remaining EV +${(remainingEV * 100).toFixed(1)}% | Net benefit after fees: +${(netBenefit * 100).toFixed(1)}c`,
        currentPosition: {
          conditionId: pos.conditionId,
          game: `${pos.homeTeam} vs ${pos.awayTeam}`,
          entryPrice: pos.avgFillPrice,
          currentPrice,
          remainingEV,
          unrealizedPnL,
          size: pos.filledSize,
        },
        targets,
        switchingCost: exitCost,
        netBenefit,
      };
    }

    return {
      action: 'HOLD',
      reason: `Switching not worth it: net benefit +${(netBenefit * 100).toFixed(1)}c < ${(MIN_SWITCH_BENEFIT * 100).toFixed(0)}c threshold | Current remaining EV: +${(remainingEV * 100).toFixed(1)}%`,
      currentPosition: {
        conditionId: pos.conditionId,
        game: `${pos.homeTeam} vs ${pos.awayTeam}`,
        entryPrice: pos.avgFillPrice,
        currentPrice,
        remainingEV,
        unrealizedPnL,
        size: pos.filledSize,
      },
    };
  }

  return { action: 'HOLD', reason: 'Current allocation is optimal' };
}
