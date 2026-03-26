import type { Opportunity, Trade } from '@/lib/types';
import { engineState, addMessage, getOpenTrade, updateAccount } from './state';
import { calcKellySize } from './skills/nba-live-edge/win-probability';
import { getSkill } from './skill-registry';

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
    yesTokenId: '',
    noTokenId: '',
    isDryRun: DRY_RUN,
  };

  engineState.trades.push(trade);

  if (DRY_RUN) {
    addMessage({
      text: `[DRY RUN] Entering: $${size.toFixed(2)} on ${opp.title.substring(0, 40)} ${opp.side.toUpperCase()} at $${opp.marketPrice.toFixed(2)} — Edge: ${(opp.edge * 100).toFixed(1)}%, EV: ${(opp.ev * 100).toFixed(1)}%`,
      type: 'action',
    });
  } else {
    addMessage({
      text: `Entering: $${size.toFixed(2)} on ${opp.title.substring(0, 40)} ${opp.side.toUpperCase()} at $${opp.marketPrice.toFixed(2)}`,
      type: 'action',
    });
    // TODO: actual CLOB order placement when LIVE
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

  if (DRY_RUN) {
    addMessage({
      text: `[DRY RUN] EXIT (${reason}): ${trade.marketTitle.substring(0, 35)} — ${pnlStr}`,
      type: pnl >= 0 ? 'success' : 'warning',
    });
  } else {
    addMessage({
      text: `EXIT (${reason}): ${trade.marketTitle.substring(0, 35)} — ${pnlStr}`,
      type: pnl >= 0 ? 'success' : 'warning',
    });
  }

  updateAccount();
}
