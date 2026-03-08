import type {
  BotEntryDecision,
  BotRiskLimits,
  BotSignal,
  BotState,
  BotTrade,
  BotTradeStatus
} from "@/lib/bot-types";

const ACTIVE_STATUSES: BotTradeStatus[] = ["open", "filled", "exit_placed"];
export const BOT_ENTRY_PRICE = 0.97;
export const BOT_TARGET_EXIT_PRICE = 0.9999;
const MAX_SPREAD_FOR_ENTRY = 0.1;

function isSportsCategory(category: string | undefined): boolean {
  if (!category) {
    return false;
  }

  return category.trim().toLowerCase() === "sports";
}

function toBoundedNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return parsed;
}

export function getBotRiskLimits(): BotRiskLimits {
  return {
    maxOpenPositions: toBoundedNumber(process.env.MAX_OPEN_POSITIONS, 5),
    maxPositionSize: toBoundedNumber(process.env.MAX_POSITION_SIZE, 50),
    maxTotalExposure: toBoundedNumber(process.env.MAX_TOTAL_EXPOSURE, 200)
  };
}

export function getProposedPositionSize(limits: BotRiskLimits) {
  return Math.min(50, limits.maxPositionSize);
}

export function getActiveTrades(trades: BotTrade[]) {
  return trades.filter((trade) => ACTIVE_STATUSES.includes(trade.status));
}

export function summarizeOpenPositions(trades: BotTrade[]) {
  const activeTrades = getActiveTrades(trades);

  return {
    openPositions: activeTrades.length,
    exposure: activeTrades.reduce((sum, trade) => sum + trade.size, 0)
  };
}

export function evaluateSignalForEntry(
  signal: BotSignal,
  state: BotState,
  existingTrades: BotTrade[],
  limits = getBotRiskLimits()
): BotEntryDecision {
  if (!isSportsCategory(signal.category)) {
    return { shouldEnter: false, reason: "sports markets only" };
  }

  if (!signal.tradeable) {
    return { shouldEnter: false, reason: "signal not tradeable" };
  }

  const normalizedNoPrice = Number(normalizeProbability(signal.no_price)?.toFixed(4));
  if (normalizedNoPrice !== BOT_ENTRY_PRICE) {
    return { shouldEnter: false, reason: "no price is not exactly 0.97" };
  }

  const normalizedSpread = normalizeProbability(signal.spread);
  if (normalizedSpread === null || normalizedSpread >= MAX_SPREAD_FOR_ENTRY) {
    return { shouldEnter: false, reason: "spread must be < 0.10" };
  }

  const duplicate = existingTrades.some(
    (trade) =>
      trade.market_id === signal.market_id && ACTIVE_STATUSES.includes(trade.status)
  );
  if (duplicate) {
    return { shouldEnter: false, reason: "already has an active trade" };
  }

  if (state.open_positions >= limits.maxOpenPositions) {
    return {
      shouldEnter: false,
      reason: `max open positions reached (${limits.maxOpenPositions})`
    };
  }

  if (limits.maxPositionSize <= 0) {
    return {
      shouldEnter: false,
      reason: "max position size must be > 0"
    };
  }

  const proposedSize = getProposedPositionSize(limits);
  if (state.total_exposure + proposedSize > limits.maxTotalExposure) {
    return {
      shouldEnter: false,
      reason: `max total exposure exceeded (${limits.maxTotalExposure})`
    };
  }

  return { shouldEnter: true, reason: "entry conditions met" };
}

export function normalizeProbability(value: number | null) {
  if (value === null) {
    return null;
  }

  return value > 1 ? value / 100 : value;
}

export function calculatePnLPercent(entryPrice: number, exitPrice: number) {
  if (entryPrice <= 0) {
    return 0;
  }

  return Number((((exitPrice - entryPrice) / entryPrice) * 100).toFixed(4));
}

export function tradePnlUsd(size: number, pnlPercent: number) {
  return Number((size * (pnlPercent / 100)).toFixed(4));
}
