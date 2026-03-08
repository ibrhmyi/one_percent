"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDataPaths = getDataPaths;
exports.ensureStoreFiles = ensureStoreFiles;
exports.readSignals = readSignals;
exports.readTrades = readTrades;
exports.writeTrades = writeTrades;
exports.readBotState = readBotState;
exports.writeBotState = writeBotState;
exports.summarizeOpenPositions = summarizeOpenPositions;
const node_fs_1 = require("node:fs");
const promises_1 = require("node:fs/promises");
const node_path_1 = __importDefault(require("node:path"));
const SIGNALS_FILE = "signals.json";
const TRADES_FILE = "bot-trades.json";
const STATE_FILE = "bot-state.json";
const ACTIVE_STATUSES = ["open", "filled", "exit_placed"];
function isRecord(value) {
    return typeof value === "object" && value !== null;
}
function toNumber(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === "string") {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return null;
}
function resolveDataDir() {
    const cwd = process.cwd();
    const localData = node_path_1.default.resolve(cwd, "data");
    if ((0, node_fs_1.existsSync)(localData)) {
        return localData;
    }
    return node_path_1.default.resolve(cwd, "..", "data");
}
async function ensureFile(filePath, fallback) {
    const dir = node_path_1.default.dirname(filePath);
    if (!(0, node_fs_1.existsSync)(dir)) {
        await (0, promises_1.mkdir)(dir, { recursive: true });
    }
    if (!(0, node_fs_1.existsSync)(filePath)) {
        await (0, promises_1.writeFile)(filePath, fallback, "utf8");
    }
}
async function safeReadJson(filePath, fallback) {
    try {
        const raw = await (0, promises_1.readFile)(filePath, "utf8");
        return JSON.parse(raw);
    }
    catch (error) {
        console.error(`[store] Failed to read/parse ${filePath}. Using fallback.`, error);
        return fallback;
    }
}
function sanitizeSignal(value) {
    if (!isRecord(value)) {
        return null;
    }
    const marketId = value.market_id;
    const title = value.title;
    const yesPrice = toNumber(value.yes_price);
    const noPrice = toNumber(value.no_price);
    const spread = toNumber(value.spread);
    const volume = toNumber(value.volume);
    const tradeable = value.tradeable;
    if (typeof marketId !== "string" ||
        typeof title !== "string" ||
        yesPrice === null ||
        noPrice === null ||
        spread === null ||
        volume === null ||
        typeof tradeable !== "boolean") {
        return null;
    }
    return {
        market_id: marketId,
        title,
        category: typeof value.category === "string" ? value.category : undefined,
        yes_price: yesPrice,
        no_price: noPrice,
        spread,
        volume,
        tradeable,
        confidence: typeof value.confidence === "string" ? value.confidence : undefined,
        resolution_window_min_minutes: toNumber(value.resolution_window_min_minutes) ?? undefined,
        resolution_window_max_minutes: toNumber(value.resolution_window_max_minutes) ?? undefined,
        reason: typeof value.reason === "string" ? value.reason : undefined,
        url: typeof value.url === "string" ? value.url : undefined,
    };
}
function isTradeStatus(value) {
    return (value === "open" ||
        value === "filled" ||
        value === "exit_placed" ||
        value === "closed" ||
        value === "cancelled");
}
function sanitizeTrade(value) {
    if (!isRecord(value)) {
        return null;
    }
    if (typeof value.id !== "string" ||
        typeof value.market_id !== "string" ||
        typeof value.title !== "string" ||
        value.side !== "NO" ||
        toNumber(value.entry_price) === null ||
        toNumber(value.target_exit_price) === null ||
        toNumber(value.size) === null ||
        !isTradeStatus(value.status) ||
        typeof value.entry_timestamp !== "string" ||
        !(typeof value.exit_timestamp === "string" || value.exit_timestamp === null) ||
        toNumber(value.pnl_percent) === null ||
        typeof value.reason !== "string") {
        return null;
    }
    return {
        id: value.id,
        market_id: value.market_id,
        title: value.title,
        side: "NO",
        entry_price: toNumber(value.entry_price) ?? 0,
        target_exit_price: toNumber(value.target_exit_price) ?? 0,
        size: toNumber(value.size) ?? 0,
        status: value.status,
        entry_timestamp: value.entry_timestamp,
        exit_timestamp: value.exit_timestamp,
        pnl_percent: toNumber(value.pnl_percent) ?? 0,
        reason: value.reason,
    };
}
function defaultBotState() {
    return {
        last_run_at: new Date(0).toISOString(),
        open_positions: 0,
        total_exposure: 0,
        dry_run: process.env.DRY_RUN !== "false",
    };
}
function getDataPaths() {
    const dataDir = resolveDataDir();
    return {
        dataDir,
        signalsPath: node_path_1.default.resolve(dataDir, SIGNALS_FILE),
        tradesPath: node_path_1.default.resolve(dataDir, TRADES_FILE),
        statePath: node_path_1.default.resolve(dataDir, STATE_FILE),
    };
}
async function ensureStoreFiles() {
    const paths = getDataPaths();
    await ensureFile(paths.signalsPath, "[]\n");
    await ensureFile(paths.tradesPath, "[]\n");
    await ensureFile(paths.statePath, `${JSON.stringify(defaultBotState(), null, 2)}\n`);
}
async function readSignals() {
    const { signalsPath } = getDataPaths();
    await ensureFile(signalsPath, "[]\n");
    const parsed = await safeReadJson(signalsPath, []);
    if (!Array.isArray(parsed)) {
        return [];
    }
    const signals = [];
    for (const item of parsed) {
        const signal = sanitizeSignal(item);
        if (signal) {
            signals.push(signal);
        }
    }
    return signals;
}
async function readTrades() {
    const { tradesPath } = getDataPaths();
    await ensureFile(tradesPath, "[]\n");
    const parsed = await safeReadJson(tradesPath, []);
    if (!Array.isArray(parsed)) {
        return [];
    }
    const trades = [];
    for (const item of parsed) {
        const trade = sanitizeTrade(item);
        if (trade) {
            trades.push(trade);
        }
    }
    return trades;
}
async function writeTrades(trades) {
    const { tradesPath } = getDataPaths();
    await ensureFile(tradesPath, "[]\n");
    await (0, promises_1.writeFile)(tradesPath, `${JSON.stringify(trades, null, 2)}\n`, "utf8");
}
async function readBotState() {
    const { statePath } = getDataPaths();
    const fallback = defaultBotState();
    await ensureFile(statePath, `${JSON.stringify(fallback, null, 2)}\n`);
    const parsed = await safeReadJson(statePath, fallback);
    if (!isRecord(parsed)) {
        return fallback;
    }
    return {
        last_run_at: typeof parsed.last_run_at === "string" ? parsed.last_run_at : fallback.last_run_at,
        open_positions: toNumber(parsed.open_positions) ?? fallback.open_positions,
        total_exposure: toNumber(parsed.total_exposure) ?? fallback.total_exposure,
        dry_run: typeof parsed.dry_run === "boolean" ? parsed.dry_run : fallback.dry_run,
    };
}
async function writeBotState(state) {
    const { statePath } = getDataPaths();
    await ensureFile(statePath, `${JSON.stringify(defaultBotState(), null, 2)}\n`);
    await (0, promises_1.writeFile)(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}
function summarizeOpenPositions(trades) {
    const activeTrades = trades.filter((trade) => ACTIVE_STATUSES.includes(trade.status));
    return {
        openPositions: activeTrades.length,
        exposure: activeTrades.reduce((sum, trade) => sum + trade.size, 0),
    };
}
