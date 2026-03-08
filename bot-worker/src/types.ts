export type TradeStatus =
  | "open"
  | "filled"
  | "exit_placed"
  | "closed"
  | "cancelled";

export interface Signal {
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

export interface Trade {
  id: string;
  market_id: string;
  title: string;
  side: "NO";
  entry_price: number;
  target_exit_price: number;
  size: number;
  status: TradeStatus;
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
