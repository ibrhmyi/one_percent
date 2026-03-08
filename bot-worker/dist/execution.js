"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculatePnLPercent = calculatePnLPercent;
exports.createSimulatedTrade = createSimulatedTrade;
exports.placeSimulatedExit = placeSimulatedExit;
const node_crypto_1 = __importDefault(require("node:crypto"));
const ENTRY_PRICE = 0.97;
const TARGET_EXIT_PRICE = 0.9999;
function getPositionSize() {
    const maxPositionSize = Number(process.env.MAX_POSITION_SIZE ?? 50);
    return Math.max(1, Math.min(50, maxPositionSize));
}
function calculatePnLPercent(entryPrice, exitPrice) {
    if (entryPrice <= 0) {
        return 0;
    }
    return Number((((exitPrice - entryPrice) / entryPrice) * 100).toFixed(4));
}
function createSimulatedTrade(signal) {
    const now = new Date().toISOString();
    return {
        id: node_crypto_1.default.randomUUID(),
        market_id: signal.market_id,
        title: signal.title,
        side: "NO",
        entry_price: ENTRY_PRICE,
        target_exit_price: TARGET_EXIT_PRICE,
        size: getPositionSize(),
        status: "filled",
        entry_timestamp: now,
        exit_timestamp: null,
        pnl_percent: calculatePnLPercent(ENTRY_PRICE, TARGET_EXIT_PRICE),
        reason: signal.reason ?? "near-resolution signal",
    };
}
function placeSimulatedExit(trade) {
    return {
        ...trade,
        status: "exit_placed",
        target_exit_price: TARGET_EXIT_PRICE,
        pnl_percent: calculatePnLPercent(trade.entry_price, TARGET_EXIT_PRICE),
    };
}
