export type BotTradeStatus =
  | "open"
  | "filled"
  | "exit_placed"
  | "closed"
  | "cancelled";

export interface BotSignal {
  market_id: string;
  title: string;
  category?: string;
  yes_price: number;
  no_price: number;
  spread: number;
  volume: number;
  tradeable: boolean;
  confidence?: string;
  resolution_window_min_minutes?: number;
  resolution_window_max_minutes?: number;
  reason?: string;
  url?: string;
}

export interface BotTrade {
  id: string;
  market_id: string;
  title: string;
  side: "NO";
  entry_price: number;
  target_exit_price: number;
  size: number;
  status: BotTradeStatus;
  entry_timestamp: string;
  exit_timestamp: string | null;
  pnl_percent: number;
  reason: string;
}

export interface BotState {
  last_run_at: string;
  open_positions: number;
  total_exposure: number;
  dry_run: boolean;
}

export interface BotRiskLimits {
  maxOpenPositions: number;
  maxPositionSize: number;
  maxTotalExposure: number;
}

export interface BotEntryDecision {
  shouldEnter: boolean;
  reason: string;
}

export interface BotSignalDecision {
  signal: BotSignal;
  decision: BotEntryDecision;
}

export interface BotOverviewResponse {
  generatedAt: string;
  source: "signals-file" | "derived-from-markets";
  state: BotState;
  limits: BotRiskLimits;
  summary: {
    rawSignalsTotal: number;
    signalsConsidered: number;
    enterableNow: number;
    activeTrades: number;
    totalTrades: number;
    openPositions: number;
    totalExposure: number;
    botStartedAt: string;
    uptimeHours: number;
    startingBalanceUsd: number;
    realizedPnlUsd: number;
    projectedPnlUsd: number;
    totalPnlUsd: number;
    totalWealthUsd: number;
    estimatedBalanceUsd: number;
  };
  rawSignals: BotSignal[];
  decisions: BotSignalDecision[];
  activeTrades: BotTrade[];
  recentTrades: BotTrade[];
  previewTrades: BotTrade[];
}
