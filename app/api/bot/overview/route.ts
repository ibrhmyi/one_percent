import {
  BOT_ENTRY_PRICE,
  BOT_TARGET_EXIT_PRICE,
  calculatePnLPercent,
  evaluateSignalForEntry,
  getActiveTrades,
  getBotRiskLimits,
  getProposedPositionSize,
  normalizeProbability,
  summarizeOpenPositions,
  tradePnlUsd
} from "@/lib/bot-logic";
import { ensureBotStoreFiles, readBotSignals, readBotState, readBotTrades } from "@/lib/bot-store";
import { getClosingSoonMarkets } from "@/lib/market-service";
import { applyMarketQuery } from "@/lib/market-query";
import { listBotTrades, upsertBotTrade } from "@/lib/supabase";
import type { BotOverviewResponse, BotSignal, BotTrade } from "@/lib/bot-types";
import type { NormalizedMarket } from "@/lib/types";

export const dynamic = "force-dynamic";
const ACTIVE_STATUSES = new Set(["open", "filled", "exit_placed"]);
const DEFAULT_SIMULATED_UPTIME_HOURS = 2;
const DEMO_REALIZED_PNL_USD = 52.67;

function getStartingBalanceUsd() {
  const parsed = Number(process.env.BOT_START_BALANCE_USD ?? 1000);
  return Number.isFinite(parsed) ? parsed : 1000;
}

function getSimulatedUptimeHours() {
  const parsed = Number(process.env.BOT_SIMULATED_UPTIME_HOURS ?? DEFAULT_SIMULATED_UPTIME_HOURS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SIMULATED_UPTIME_HOURS;
}

function mapDbTradeToBotTrade(dbTrade: Awaited<ReturnType<typeof listBotTrades>>[number]): BotTrade {
  return {
    id: dbTrade.external_trade_id,
    market_id: dbTrade.market_id,
    title: dbTrade.title,
    side: dbTrade.side,
    entry_price: dbTrade.entry_price,
    target_exit_price: dbTrade.target_exit_price,
    size: dbTrade.size,
    status: dbTrade.status,
    entry_timestamp: dbTrade.entry_timestamp,
    exit_timestamp: dbTrade.exit_timestamp,
    pnl_percent: dbTrade.pnl_percent,
    reason: dbTrade.reason ?? "db trade"
  };
}

function deriveSignalFromMarket(market: NormalizedMarket): BotSignal | null {
  const yes = normalizeProbability(market.yesPrice);
  const no = normalizeProbability(market.noPrice);

  if (yes === null || no === null) {
    return null;
  }

  return {
    market_id: market.id,
    title: market.title,
    category: market.category ?? undefined,
    yes_price: Number(yes.toFixed(4)),
    no_price: Number(no.toFixed(4)),
    spread: Number(Math.abs(yes - no).toFixed(4)),
    volume: Number((market.eventVolume ?? market.volume ?? 0).toFixed(2)),
    tradeable: market.tradeable === true,
    confidence: market.confidence ?? undefined,
    resolution_window_min_minutes: market.resolutionWindowMin ?? undefined,
    resolution_window_max_minutes: market.resolutionWindowMax ?? undefined,
    reason: market.aiReason ?? undefined,
    url: market.url ?? undefined
  };
}

function isSportsSignalCategory(category: string | undefined): boolean {
  if (!category) {
    return false;
  }

  return category.trim().toLowerCase() === "sports";
}

function isMarketActiveForSignals(market: NormalizedMarket) {
  const closeAt = Date.parse(market.closeTime);
  if (Number.isNaN(closeAt) || closeAt <= Date.now()) {
    return false;
  }

  const status = (market.status ?? "").toLowerCase();
  if (status === "resolved" || status === "closed" || status === "expired" || status === "ended") {
    return false;
  }

  return true;
}

function sortDecisions(left: BotSignal, right: BotSignal) {
  if (left.no_price !== right.no_price) {
    return right.no_price - left.no_price;
  }

  if (left.spread !== right.spread) {
    return left.spread - right.spread;
  }

  return right.volume - left.volume;
}

function buildDemoTrades(signals: BotSignal[], nowMs: number): BotTrade[] {
  const pick = (index: number) =>
    signals[index]?.title ?? `Demo market ${index + 1}`;
  const pickId = (index: number) =>
    signals[index]?.market_id ?? `demo-market-${index + 1}`;
  const ts = (minutesAgo: number) => new Date(nowMs - minutesAgo * 60 * 1000).toISOString();

  return [
    {
      id: "demo-trade-1",
      market_id: pickId(0),
      title: pick(0),
      side: "NO",
      entry_price: BOT_ENTRY_PRICE,
      target_exit_price: BOT_TARGET_EXIT_PRICE,
      size: 500,
      status: "closed",
      entry_timestamp: ts(120),
      exit_timestamp: ts(115),
      pnl_percent: 5,
      reason: "demo trade from 2h ago"
    },
    {
      id: "demo-trade-2",
      market_id: pickId(1),
      title: pick(1),
      side: "NO",
      entry_price: BOT_ENTRY_PRICE,
      target_exit_price: BOT_TARGET_EXIT_PRICE,
      size: 500,
      status: "closed",
      entry_timestamp: ts(110),
      exit_timestamp: ts(105),
      pnl_percent: Number(((DEMO_REALIZED_PNL_USD - 25) / 500 * 100).toFixed(4)),
      reason: "demo trade from ~2h ago"
    },
    {
      id: "demo-trade-3",
      market_id: pickId(2),
      title: pick(2),
      side: "NO",
      entry_price: BOT_ENTRY_PRICE,
      target_exit_price: BOT_TARGET_EXIT_PRICE,
      size: 50,
      status: "exit_placed",
      entry_timestamp: ts(50),
      exit_timestamp: null,
      pnl_percent: calculatePnLPercent(BOT_ENTRY_PRICE, BOT_TARGET_EXIT_PRICE),
      reason: "demo open position from 50m ago"
    },
    {
      id: "demo-trade-4",
      market_id: pickId(3),
      title: pick(3),
      side: "NO",
      entry_price: BOT_ENTRY_PRICE,
      target_exit_price: BOT_TARGET_EXIT_PRICE,
      size: 50,
      status: "exit_placed",
      entry_timestamp: ts(40),
      exit_timestamp: null,
      pnl_percent: calculatePnLPercent(BOT_ENTRY_PRICE, BOT_TARGET_EXIT_PRICE),
      reason: "demo open position from 40m ago"
    },
    {
      id: "demo-trade-5",
      market_id: pickId(4),
      title: pick(4),
      side: "NO",
      entry_price: BOT_ENTRY_PRICE,
      target_exit_price: BOT_TARGET_EXIT_PRICE,
      size: 50,
      status: "exit_placed",
      entry_timestamp: ts(30),
      exit_timestamp: null,
      pnl_percent: calculatePnLPercent(BOT_ENTRY_PRICE, BOT_TARGET_EXIT_PRICE),
      reason: "demo open position from 30m ago"
    }
  ];
}

function isSignalQueueCandidate(signal: BotSignal) {
  if (!isSportsSignalCategory(signal.category)) {
    return false;
  }

  const normalizedSpread = normalizeProbability(signal.spread);
  const normalizedNoPrice = normalizeProbability(signal.no_price);

  if (!signal.tradeable) {
    return false;
  }

  if (normalizedSpread === null || normalizedSpread >= 0.1) {
    return false;
  }

  if (normalizedNoPrice === null || Number(normalizedNoPrice.toFixed(4)) !== BOT_ENTRY_PRICE) {
    return false;
  }

  return true;
}

export async function GET() {
  await ensureBotStoreFiles();

  const [signalsFromFile, state, fileTrades] = await Promise.all([
    readBotSignals(),
    readBotState(),
    readBotTrades()
  ]);
  await Promise.all(
    fileTrades.slice(0, 200).map((trade) =>
      upsertBotTrade({
        external_trade_id: trade.id,
        market_id: trade.market_id,
        title: trade.title,
        side: trade.side,
        entry_price: trade.entry_price,
        target_exit_price: trade.target_exit_price,
        size: trade.size,
        status: trade.status,
        entry_timestamp: trade.entry_timestamp,
        exit_timestamp: trade.exit_timestamp,
        pnl_percent: trade.pnl_percent,
        pnl_usd: tradePnlUsd(trade.size, trade.pnl_percent),
        reason: trade.reason,
        source: "json-store"
      })
    )
  );
  const dbTrades = (await listBotTrades(400)).map(mapDbTradeToBotTrade);
  const mergedById = new Map<string, BotTrade>();

  for (const trade of fileTrades) {
    mergedById.set(trade.id, trade);
  }
  for (const trade of dbTrades) {
    mergedById.set(trade.id, trade);
  }
  const trades = [...mergedById.values()];

  let source: BotOverviewResponse["source"] = "signals-file";
  let signals: BotSignal[] = [];
  try {
    const snapshot = await getClosingSoonMarkets();
    const shownMarkets = applyMarketQuery(snapshot.markets, {
      platform: "polymarket",
      category: "all",
      maxHours: 1,
      minVolume: 10_000,
      minYesPrice: 0.01,
      minNoPrice: 0.9,
      onlyLive: false,
      sort: "signal"
    });
    signals = shownMarkets
      .filter(isMarketActiveForSignals)
      .map(deriveSignalFromMarket)
      .filter((signal): signal is BotSignal => signal !== null)
      .sort(sortDecisions)
      .slice(0, 200);
    source = "derived-from-markets";
  } catch {
    signals = signalsFromFile;
    source = "signals-file";
  }
  const rawSignals = [...signals].sort(sortDecisions).slice(0, 200);
  const queueSignals = rawSignals.filter(isSignalQueueCandidate).slice(0, 25);
  const nowMs = Date.now();
  const effectiveTrades = trades.length > 0 ? trades : buildDemoTrades(rawSignals, nowMs);

  const limits = getBotRiskLimits();
  const activeTrades = getActiveTrades(effectiveTrades);
  const exposure = summarizeOpenPositions(effectiveTrades);
  const simulatedTrades = [...effectiveTrades];
  const previewTrades: BotOverviewResponse["previewTrades"] = [];
  const candidateSignals = [...queueSignals].sort(sortDecisions);
  let simulatedState = {
    ...state,
    open_positions: exposure.openPositions,
    total_exposure: exposure.exposure
  };
  const decisions = candidateSignals
    .map((signal) => {
      const decision = evaluateSignalForEntry(signal, simulatedState, simulatedTrades, limits);

      if (decision.shouldEnter) {
        const nextSize = getProposedPositionSize(limits);
        const previewTrade = {
          id: `simulated-${signal.market_id}`,
          market_id: signal.market_id,
          title: signal.title,
          side: "NO",
          entry_price: BOT_ENTRY_PRICE,
          target_exit_price: BOT_TARGET_EXIT_PRICE,
          size: nextSize,
          status: "exit_placed",
          entry_timestamp: new Date().toISOString(),
          exit_timestamp: null,
          pnl_percent: calculatePnLPercent(BOT_ENTRY_PRICE, BOT_TARGET_EXIT_PRICE),
          reason: "simulated queue placement"
        } as const;
        previewTrades.push(previewTrade);
        simulatedTrades.push(previewTrade);
        simulatedState = {
          ...simulatedState,
          open_positions: simulatedState.open_positions + 1,
          total_exposure: simulatedState.total_exposure + nextSize
        };
      }

      return { signal, decision };
    })
    .sort((left, right) => {
      if (left.decision.shouldEnter !== right.decision.shouldEnter) {
        return left.decision.shouldEnter ? -1 : 1;
      }

      return sortDecisions(left.signal, right.signal);
    });
  const uptimeHours = getSimulatedUptimeHours();
  const uptimeMs = uptimeHours * 60 * 60 * 1000;
  const fallbackBotStartedMs = nowMs - uptimeMs;
  const earliestTradeMs = effectiveTrades
    .map((trade) => Date.parse(trade.entry_timestamp))
    .filter((value) => Number.isFinite(value))
    .reduce((min, value) => Math.min(min, value), Number.POSITIVE_INFINITY);
  const botStartedMs = Number.isFinite(earliestTradeMs)
    ? Math.min(fallbackBotStartedMs, earliestTradeMs)
    : fallbackBotStartedMs;
  const botStartedAt = new Date(botStartedMs).toISOString();
  const startingBalanceUsd = getStartingBalanceUsd();
  const realizedPnlUsd = Number(
    effectiveTrades
      .filter((trade) => trade.status === "closed")
      .reduce((sum, trade) => sum + tradePnlUsd(trade.size, trade.pnl_percent), 0)
      .toFixed(4)
  );
  const projectedActualPnlUsd = Number(
    effectiveTrades
      .filter((trade) => ACTIVE_STATUSES.has(trade.status))
      .reduce((sum, trade) => sum + tradePnlUsd(trade.size, trade.pnl_percent), 0)
      .toFixed(4)
  );
  const projectedPreviewPnlUsd = Number(
    previewTrades
      .reduce((sum, trade) => sum + tradePnlUsd(trade.size, trade.pnl_percent), 0)
      .toFixed(4)
  );
  const projectedPnlUsd = Number((projectedActualPnlUsd + projectedPreviewPnlUsd).toFixed(4));
  const totalPnlUsd = Number((realizedPnlUsd + projectedPnlUsd).toFixed(4));
  const totalWealthUsd = Number((startingBalanceUsd + realizedPnlUsd + projectedActualPnlUsd).toFixed(4));
  const estimatedBalanceUsd = Number((startingBalanceUsd + totalPnlUsd).toFixed(4));

  const recentTrades = [...effectiveTrades]
    .sort((left, right) => {
      const leftTs = Date.parse(left.entry_timestamp);
      const rightTs = Date.parse(right.entry_timestamp);
      const leftSafe = Number.isNaN(leftTs) ? 0 : leftTs;
      const rightSafe = Number.isNaN(rightTs) ? 0 : rightTs;
      return rightSafe - leftSafe;
    })
    .slice(0, 20);

  const response: BotOverviewResponse = {
    generatedAt: new Date().toISOString(),
    source,
    state,
    limits,
    summary: {
      rawSignalsTotal: rawSignals.length,
      signalsConsidered: decisions.length,
      enterableNow: decisions.filter((item) => item.decision.shouldEnter).length,
      activeTrades: activeTrades.length,
      totalTrades: effectiveTrades.length,
      openPositions: exposure.openPositions,
      totalExposure: exposure.exposure,
      botStartedAt,
      uptimeHours,
      startingBalanceUsd,
      realizedPnlUsd,
      projectedPnlUsd,
      totalPnlUsd,
      totalWealthUsd,
      estimatedBalanceUsd
    },
    rawSignals,
    decisions,
    activeTrades,
    recentTrades,
    previewTrades: previewTrades.slice(0, 20)
  };

  return Response.json(response);
}
