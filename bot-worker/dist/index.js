"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const execution_1 = require("./execution");
const logger_1 = require("./logger");
const store_1 = require("./store");
const strategy_1 = require("./strategy");
const db_1 = require("./db");
function getDryRun() {
    return process.env.DRY_RUN !== "false";
}
function getPollIntervalMs() {
    const raw = Number(process.env.BOT_POLL_INTERVAL_MS ?? 2000);
    if (!Number.isFinite(raw) || raw < 250) {
        return 2000;
    }
    return raw;
}
function buildState(previous, trades) {
    const summary = (0, store_1.summarizeOpenPositions)(trades);
    return {
        ...previous,
        last_run_at: new Date().toISOString(),
        open_positions: summary.openPositions,
        total_exposure: summary.exposure,
        dry_run: getDryRun(),
    };
}
async function processSignal(signal, state, trades) {
    const decision = (0, strategy_1.evaluateSignalForEntry)(signal, state, trades);
    if (!decision.shouldEnter) {
        (0, logger_1.logSignalSkipped)(signal, decision.reason);
        return { state, trades };
    }
    const entered = (0, execution_1.createSimulatedTrade)(signal);
    (0, logger_1.logTradeEntered)(entered);
    const exitPlaced = (0, execution_1.placeSimulatedExit)(entered);
    (0, logger_1.logExitPlaced)(exitPlaced);
    try {
        await (0, db_1.upsertTradeToDatabase)(exitPlaced);
    }
    catch (error) {
        console.error("[db] Failed to persist trade. Keeping local write.", error);
    }
    const updatedTrades = [...trades, exitPlaced];
    const updatedState = buildState(state, updatedTrades);
    return { state: updatedState, trades: updatedTrades };
}
async function runCycle() {
    (0, logger_1.logCycleStarted)();
    let trades = await (0, store_1.readTrades)();
    let state = await (0, store_1.readBotState)();
    const signals = await (0, store_1.readSignals)();
    (0, logger_1.logSignalsLoaded)(signals.length);
    for (const signal of signals) {
        try {
            const result = await processSignal(signal, state, trades);
            state = result.state;
            trades = result.trades;
        }
        catch (error) {
            (0, logger_1.logSignalSkipped)(signal, `failed to process signal: ${String(error)}`);
        }
    }
    state = buildState(state, trades);
    await (0, store_1.writeTrades)(trades);
    await (0, store_1.writeBotState)(state);
}
async function main() {
    await (0, store_1.ensureStoreFiles)();
    const pollIntervalMs = getPollIntervalMs();
    let running = false;
    const execute = async () => {
        if (running) {
            return;
        }
        running = true;
        try {
            await runCycle();
        }
        catch (error) {
            (0, logger_1.logCycleError)(error);
        }
        finally {
            running = false;
        }
    };
    await execute();
    setInterval(() => {
        void execute();
    }, pollIntervalMs);
}
void main();
