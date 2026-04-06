/**
 * TRADE MANAGER — Handles position entry and exit lifecycle.
 *
 * enterPosition(): sizes the bet with Kelly criterion, creates a Trade record,
 *   places the order (dry-run simulated or live CLOB), and updates account state.
 * closePosition(): marks a trade as closed, calculates realized P&L, updates
 *   bankroll and skill stats.
 *
 * Depends on: state, skill-registry, order-manager, skills/nba-live-edge/win-probability
 * Called from: brain.ts (on positive-EV opportunity), exit-manager.ts (on exit trigger)
 */

import type { Opportunity, Trade } from '@/lib/types';
import { engineState, addMessage, getOpenTrade, updateAccount } from './state';
import { calcKellySize } from './skills/nba-live-edge/win-probability';
import { getSkill } from './skill-registry';
import { placeOrder, cancelOrder } from './order-manager';
import { setTradeContext } from './exit-manager';

const DRY_RUN = process.env.DRY_RUN !== 'false';

export async function enterPosition(opp: Opportunity): Promise<boolean> {
  const bankroll = engineState.account.bankroll;
  const size = calcKellySize(bankroll, opp.modelProbability, opp.marketPrice);

  if (size <= 0) {
    addMessage({
      text: `Skipping ${opp.title} — Kelly size too small ($${size})`,
      type: 'idle',
    });
    return false;
  }

  const tokens = size / opp.marketPrice;
  const skill = getSkill(opp.skillId);

  const trade: Trade = {
    id: `trade-${Date.now()}`,
    marketId: opp.marketId,
    marketTitle: opp.title,
    side: opp.side,
    entryPrice: opp.marketPrice,
    entryAmount: size,
    exitPrice: null,
    exitAmount: null,
    pnl: null,
    tokens,
    skillId: opp.skillId,
    skillIcon: skill?.icon ?? '📊',
    enteredAt: new Date().toISOString(),
    exitedAt: null,
    exitReason: null,
    status: 'open',
    peakPrice: opp.marketPrice,
    yesTokenId: opp.tokenId ?? '',
    noTokenId: '',
    isDryRun: DRY_RUN,
  };

  engineState.trades.push(trade);

  // Store game context for adaptive exit logic
  if (opp.skillId === 'nba-live-edge' && opp.gameData) {
    setTradeContext(trade.id, {
      fairValue: opp.modelProbability,
      secondsRemaining: opp.gameData.secondsRemaining,
      margin: Math.abs(opp.gameData.homeScore - opp.gameData.awayScore),
    });
  }

  if (DRY_RUN) {
    addMessage({
      text: `[DRY RUN] Entering: $${size.toFixed(2)} on ${opp.title.substring(0, 40)} ${opp.side.toUpperCase()} at $${opp.marketPrice.toFixed(2)} — Edge: ${(opp.edge * 100).toFixed(1)}%, EV: ${(opp.ev * 100).toFixed(1)}%`,
      type: 'action',
    });
  } else {
    // LIVE: place actual CLOB order via order-manager
    try {
      const gameData = opp.gameData ?? { homeTeam: '', awayTeam: '' };
      const order = await placeOrder({
        conditionId: opp.marketId,
        tokenId: opp.tokenId ?? '',
        tokenSide: opp.side === 'yes' ? 'YES' : 'NO',
        price: opp.marketPrice,
        size,
        sportKey: 'basketball',
        homeTeam: gameData.homeTeam ?? '',
        awayTeam: gameData.awayTeam ?? '',
        commenceTime: new Date().toISOString(),
        fairValue: opp.modelProbability,
        edge: opp.edge,
      });

      if (order) {
        trade.id = order.orderId; // Link trade to real order ID
        addMessage({
          text: `LIVE ORDER: $${size.toFixed(2)} on ${opp.title.substring(0, 40)} ${opp.side.toUpperCase()} @ ${(opp.marketPrice * 100).toFixed(0)}¢ | Order: ${order.orderId.substring(0, 12)}...`,
          type: 'action',
        });
      } else {
        trade.status = 'closed';
        trade.exitReason = 'rejected';
        addMessage({
          text: `Order rejected — deployment cap or CLOB error`,
          type: 'warning',
        });
        return false;
      }
    } catch (err) {
      trade.status = 'closed';
      trade.exitReason = 'rejected';
      addMessage({
        text: `Order failed: ${err instanceof Error ? err.message : String(err)}`,
        type: 'warning',
      });
      return false;
    }
  }

  // Update skill stats
  if (skill) skill.stats.trades++;

  updateAccount();
  return true;
}

export async function closePosition(
  trade: Trade,
  currentPrice: number,
  reason: Trade['exitReason']
): Promise<void> {
  const exitAmount = trade.tokens * currentPrice;
  const pnl = exitAmount - trade.entryAmount;

  trade.exitPrice = currentPrice;
  trade.exitAmount = exitAmount;
  trade.pnl = pnl;
  trade.exitedAt = new Date().toISOString();
  trade.exitReason = reason;
  trade.status = 'closed';

  // CLV (Closing Line Value): compare entry price to the market price at close.
  // Positive CLV means you bought cheaper than the closing price — a sign of real edge.
  // This is the single best predictor of long-term betting profitability.
  trade.clv = currentPrice - trade.entryPrice;

  // Update bankroll
  engineState.account.bankroll = engineState.account.bankroll - trade.entryAmount + exitAmount;

  // Update skill stats
  const skill = getSkill(trade.skillId);
  if (skill) {
    skill.stats.totalPnl += pnl;
    if (pnl > 0) skill.stats.wins++;
    else skill.stats.losses++;
  }

  const pnlStr = pnl >= 0 ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`;
  const clvStr = trade.clv >= 0 ? `+${(trade.clv * 100).toFixed(1)}%` : `${(trade.clv * 100).toFixed(1)}%`;

  if (DRY_RUN) {
    addMessage({
      text: `[DRY RUN] EXIT (${reason}): ${trade.marketTitle.substring(0, 35)} — ${pnlStr} | CLV: ${clvStr}`,
      type: pnl >= 0 ? 'success' : 'warning',
    });
  } else {
    addMessage({
      text: `EXIT (${reason}): ${trade.marketTitle.substring(0, 35)} — ${pnlStr} | CLV: ${clvStr}`,
      type: pnl >= 0 ? 'success' : 'warning',
    });
  }

  updateAccount();
}
