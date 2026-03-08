-- OnePercent V2: Signals Table
-- Run this in your Supabase SQL Editor

CREATE TABLE IF NOT EXISTS signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  yes_price FLOAT,
  no_price FLOAT,
  spread FLOAT,
  volume FLOAT,
  resolution_window_min_minutes INT,
  resolution_window_max_minutes INT,
  confidence TEXT CHECK (confidence IN ('low', 'medium', 'high')),
  tradeable BOOLEAN DEFAULT false,
  reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for faster lookups by market_id
CREATE INDEX IF NOT EXISTS idx_signals_market_id ON signals(market_id);

-- Index for sorting by updated_at (for cache invalidation)
CREATE INDEX IF NOT EXISTS idx_signals_updated_at ON signals(updated_at DESC);

-- Enable Row Level Security (optional - adjust as needed)
ALTER TABLE signals ENABLE ROW LEVEL SECURITY;

-- Policy for anon key access (adjust based on your security needs)
CREATE POLICY "Allow anon read-write" ON signals
  FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);
