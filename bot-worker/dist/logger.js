"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logCycleStarted = logCycleStarted;
exports.logSignalsLoaded = logSignalsLoaded;
exports.logTradeEntered = logTradeEntered;
exports.logExitPlaced = logExitPlaced;
exports.logSignalSkipped = logSignalSkipped;
exports.logCycleError = logCycleError;
function stamp() {
    return new Date().toISOString();
}
function logCycleStarted() {
    console.log(`[${stamp()}] cycle started`);
}
function logSignalsLoaded(count) {
    console.log(`[${stamp()}] signals loaded: ${count}`);
}
function logTradeEntered(trade) {
    console.log(`[${stamp()}] trade entered: ${trade.market_id} NO @ ${trade.entry_price.toFixed(3)} size=${trade.size}`);
}
function logExitPlaced(trade) {
    console.log(`[${stamp()}] exit placed: ${trade.market_id} target @ ${trade.target_exit_price.toFixed(3)} (${trade.pnl_percent.toFixed(2)}%)`);
}
function logSignalSkipped(signal, reason) {
    console.log(`[${stamp()}] skipped ${signal.market_id}: ${reason}`);
}
function logCycleError(error) {
    console.error(`[${stamp()}] cycle error`, error);
}
