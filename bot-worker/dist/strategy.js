"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shouldEnterTrade = shouldEnterTrade;
exports.evaluateSignalForEntry = evaluateSignalForEntry;
const ACTIVE_STATUSES = ["open", "filled", "exit_placed"];
const REQUIRED_ENTRY_NO_PRICE = 0.97;
const MAX_SPREAD = 0.1;
function normalizeProbability(value) {
    return value > 1 ? value / 100 : value;
}
function isSportsCategory(category) {
    if (!category) {
        return false;
    }
    return category.trim().toLowerCase() === "sports";
}
function getMaxOpenPositions() {
    return Number(process.env.MAX_OPEN_POSITIONS ?? 5);
}
function getMaxPositionSize() {
    return Number(process.env.MAX_POSITION_SIZE ?? 50);
}
function getMaxTotalExposure() {
    return Number(process.env.MAX_TOTAL_EXPOSURE ?? 200);
}
function shouldEnterTrade(signal, state, existingTrades) {
    return evaluateSignalForEntry(signal, state, existingTrades).shouldEnter;
}
function evaluateSignalForEntry(signal, state, existingTrades) {
    if (!isSportsCategory(signal.category)) {
        return { shouldEnter: false, reason: "sports markets only" };
    }
    if (!signal.tradeable) {
        return { shouldEnter: false, reason: "signal not tradeable" };
    }
    const normalizedNoPrice = Number(normalizeProbability(signal.no_price).toFixed(4));
    if (normalizedNoPrice !== REQUIRED_ENTRY_NO_PRICE) {
        return { shouldEnter: false, reason: "no price is not exactly 0.97" };
    }
    const normalizedSpread = normalizeProbability(signal.spread);
    if (normalizedSpread >= MAX_SPREAD) {
        return { shouldEnter: false, reason: "spread must be < 0.10" };
    }
    const duplicate = existingTrades.some((trade) => trade.market_id === signal.market_id && ACTIVE_STATUSES.includes(trade.status));
    if (duplicate) {
        return { shouldEnter: false, reason: "already has an active trade" };
    }
    const maxOpenPositions = getMaxOpenPositions();
    if (state.open_positions >= maxOpenPositions) {
        return {
            shouldEnter: false,
            reason: `max open positions reached (${maxOpenPositions})`,
        };
    }
    const maxPositionSize = getMaxPositionSize();
    if (maxPositionSize <= 0) {
        return { shouldEnter: false, reason: "max position size must be > 0" };
    }
    const proposedSize = Math.min(50, maxPositionSize);
    const maxTotalExposure = getMaxTotalExposure();
    if (state.total_exposure + proposedSize > maxTotalExposure) {
        return {
            shouldEnter: false,
            reason: `max total exposure exceeded (${maxTotalExposure})`,
        };
    }
    return { shouldEnter: true, reason: "entry conditions met" };
}
