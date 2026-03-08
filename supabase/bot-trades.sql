-- OnePercent V2: Bot Trades Table
-- Run this in your Supabase SQL Editor

CREATE TABLE IF NOT EXISTS bot_trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_trade_id TEXT UNIQUE NOT NULL,
  market_id TEXT NOT NULL,
  title TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('NO')),
  entry_price FLOAT NOT NULL,
  target_exit_price FLOAT NOT NULL,
  size FLOAT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'filled', 'exit_placed', 'closed', 'cancelled')),
  entry_timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
  exit_timestamp TIMESTAMP WITH TIME ZONE,
  pnl_percent FLOAT NOT NULL,
  pnl_usd FLOAT NOT NULL,
  reason TEXT,
  source TEXT DEFAULT 'bot-worker',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bot_trades_market_id ON bot_trades(market_id);
CREATE INDEX IF NOT EXISTS idx_bot_trades_entry_timestamp ON bot_trades(entry_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_bot_trades_status ON bot_trades(status);

ALTER TABLE bot_trades ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anon read-write bot_trades" ON bot_trades
  FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);
