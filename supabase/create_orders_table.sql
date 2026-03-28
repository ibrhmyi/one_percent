-- Orders table for persisting pre-game and live trading orders
CREATE TABLE IF NOT EXISTS orders (
  order_id TEXT PRIMARY KEY,
  condition_id TEXT NOT NULL,
  token_id TEXT DEFAULT '',
  side TEXT DEFAULT 'BUY',
  token_side TEXT DEFAULT 'YES',
  price NUMERIC NOT NULL,
  size NUMERIC NOT NULL,
  filled_size NUMERIC DEFAULT 0,
  avg_fill_price NUMERIC DEFAULT 0,
  status TEXT DEFAULT 'resting',
  strategy TEXT DEFAULT 'pre-game-edge',
  sport_key TEXT DEFAULT '',
  home_team TEXT DEFAULT '',
  away_team TEXT DEFAULT '',
  commence_time TEXT DEFAULT '',
  fair_value NUMERIC DEFAULT 0,
  edge NUMERIC DEFAULT 0,
  exit_price NUMERIC DEFAULT 0,
  exit_order_status TEXT DEFAULT 'pending',
  current_price NUMERIC DEFAULT 0,
  spread NUMERIC DEFAULT 0,
  slug TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_teams ON orders(home_team, away_team);

-- Enable RLS
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY "Service role full access" ON orders
  FOR ALL USING (true) WITH CHECK (true);
