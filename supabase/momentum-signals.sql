-- OnePercent Momentum Bot: Signals Table
-- Stores real-time momentum signals fired by the Polymarket→Kalshi bot
-- Run this in your Supabase SQL Editor

CREATE TABLE IF NOT EXISTS momentum_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poly_condition_id TEXT NOT NULL,
  poly_token_id TEXT NOT NULL,
  title TEXT NOT NULL,
  yes_bid FLOAT NOT NULL,
  yes_ask FLOAT NOT NULL,
  velocity FLOAT NOT NULL,           -- price change per second (e.g. 0.08 = 8¢/sec)
  confidence TEXT NOT NULL CHECK (confidence IN ('low', 'medium', 'high')),
  dry_run BOOLEAN NOT NULL DEFAULT true,
  kalshi_ticker TEXT,                -- matched Kalshi market (null if no match)
  order_placed BOOLEAN NOT NULL DEFAULT false,
  order_id TEXT,
  order_error TEXT,
  fired_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_momentum_signals_fired_at ON momentum_signals(fired_at DESC);
CREATE INDEX IF NOT EXISTS idx_momentum_signals_confidence ON momentum_signals(confidence);
CREATE INDEX IF NOT EXISTS idx_momentum_signals_poly_condition ON momentum_signals(poly_condition_id);

ALTER TABLE momentum_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anon read-write momentum_signals" ON momentum_signals
  FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);
