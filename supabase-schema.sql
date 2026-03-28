-- OnePercent Engine Tables
-- Run this in Supabase Dashboard > SQL Editor

-- Engine state: single row, updated every cycle
CREATE TABLE IF NOT EXISTS engine_state (
  id TEXT PRIMARY KEY DEFAULT 'singleton',
  is_running BOOLEAN DEFAULT false,
  last_cycle_at TIMESTAMPTZ,
  cycle_count INTEGER DEFAULT 0,
  uptime_seconds INTEGER DEFAULT 0,
  account JSONB DEFAULT '{}',
  watched_markets JSONB DEFAULT '[]',
  game_schedule JSONB DEFAULT '[]',
  scoring_events JSONB DEFAULT '[]',
  pre_game_watchlist JSONB DEFAULT '[]',
  pre_game_orders JSONB DEFAULT '[]',
  pre_game_summary JSONB,
  trades JSONB DEFAULT '[]',
  skills JSONB DEFAULT '[]',
  messages JSONB DEFAULT '[]',
  latest_message JSONB,
  live_games INTEGER DEFAULT 0,
  total_games INTEGER DEFAULT 0,
  ws_connected BOOLEAN DEFAULT false,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert the singleton row
INSERT INTO engine_state (id) VALUES ('singleton') ON CONFLICT (id) DO NOTHING;

-- Enable realtime on engine_state so frontend gets instant updates
ALTER PUBLICATION supabase_realtime ADD TABLE engine_state;

-- Enable RLS but allow anon read, authenticated write
ALTER TABLE engine_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read" ON engine_state
  FOR SELECT USING (true);

CREATE POLICY "Allow anon write" ON engine_state
  FOR ALL USING (true) WITH CHECK (true);

-- Trade history (persists across restarts)
CREATE TABLE IF NOT EXISTS trade_history (
  id TEXT PRIMARY KEY,
  market_id TEXT,
  market_title TEXT,
  side TEXT,
  token_side TEXT,
  entry_price NUMERIC,
  entry_amount NUMERIC,
  exit_price NUMERIC,
  exit_amount NUMERIC,
  pnl NUMERIC,
  tokens NUMERIC,
  skill_id TEXT,
  entered_at TIMESTAMPTZ,
  exited_at TIMESTAMPTZ,
  exit_reason TEXT,
  status TEXT DEFAULT 'open',
  is_dry_run BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE trade_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read" ON trade_history FOR SELECT USING (true);
CREATE POLICY "Allow anon write" ON trade_history FOR ALL USING (true) WITH CHECK (true);

-- Order history (persists across restarts)
CREATE TABLE IF NOT EXISTS order_history (
  order_id TEXT PRIMARY KEY,
  condition_id TEXT,
  token_id TEXT,
  token_side TEXT,
  price NUMERIC,
  size NUMERIC,
  filled_size NUMERIC DEFAULT 0,
  avg_fill_price NUMERIC DEFAULT 0,
  status TEXT DEFAULT 'resting',
  sport_key TEXT,
  home_team TEXT,
  away_team TEXT,
  commence_time TIMESTAMPTZ,
  fair_value NUMERIC,
  edge NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE order_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read" ON order_history FOR SELECT USING (true);
CREATE POLICY "Allow anon write" ON order_history FOR ALL USING (true) WITH CHECK (true);
