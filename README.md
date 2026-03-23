# OnePercent

OnePercent is an AI-powered intelligence layer for prediction markets. It identifies short-term market biases to surface tradeable signals with repeatable +1% returns. The platform scans markets approaching resolution, enriches them with AI-driven analysis, and ranks opportunities by confidence and expected resolution timing.

Built for the Rishi Hackathon.

## Features

- **AI Signal Engine**: Near-resolution market analysis using Groq's LLaMA models to estimate resolution windows and confidence levels
- **Multi-Platform Support**: Scans Polymarket with real-time price updates via WebSocket
- **Smart Filtering**: Filters by volume, liquidity, spread, and tradeability scores
- **Signal Sorting**: Rank opportunities by soonest resolution, liquidity, volume, or AI signal strength
- **Live Updates**: Real-time price streaming for active monitoring

## Tech Stack

- Next.js 15 (App Router)
- TypeScript
- Tailwind CSS
- Groq API (LLaMA 3.3 70B)
- Supabase (signal caching)
- Polymarket API & WebSocket

## Getting Started

1. Install dependencies:

```bash
npm install
```

2. Configure environment:

```bash
cp .env.example .env.local
```

3. Add your API keys:

- `GROQ_API_KEY` - Get one at [groq.com](https://groq.com)
- `SUPABASE_URL` & `SUPABASE_ANON_KEY` - Optional, for signal caching

4. Start the server:

```bash
npm run dev
```

5. Open [http://localhost:3000](http://localhost:3000)

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `CACHE_TTL_SECONDS` | Cache freshness window | 45 |
| `MARKET_SCAN_WINDOW_HOURS` | Scan window in hours | 1 |
| `GROQ_API_KEY` | Groq API key for AI analysis | - |
| `SUPABASE_URL` | Supabase project URL | - |
| `SUPABASE_ANON_KEY` | Supabase anon key | - |
| `AI_SIGNAL_CACHE_MINUTES` | AI signal cache threshold | 5 |
| `AI_MAX_MARKETS_PER_SCAN` | Max AI analyses per refresh | 10 |
| `AI_CONCURRENCY` | Parallel AI requests | 8 |

## API

`GET /api/markets/closing-soon`

Query parameters:

- `platform` - Filter by platform (polymarket, kalshi)
- `maxHours` - Hours ahead to scan (default: 24)
- `minVolume` - Minimum volume filter
- `minYesPrice` - Minimum YES price
- `sort` - Sort by: soonest, liquidity, volume, signal
- `limit` - Result limit
- `refresh` - Force cache refresh (1)

## Supabase Setup

Run the SQL migrations to enable AI signal caching:

- `supabase/signals.sql` - AI signal cache table
- `supabase/bot-trades.sql` - Bot trade history

## How It Works

1. **Market Discovery**: Fetches markets closing within the scan window from Polymarket
2. **Filtering**: Applies volume, spread, and price filters
3. **AI Enrichment**: Analyzes each market with Groq LLaMA to estimate:
   - Resolution window (minutes from now)
   - Confidence level (low/medium/high)
   - Tradeability score
4. **Ranking**: Sorts by AI signal strength or traditional metrics
5. **Live Updates**: Streams real-time prices via WebSocket

## Live Demo

**https://onepercentmarkets.vercel.app**

## Deploy

Deploy to Vercel with the same environment variables. For production, replace the JSON cache with a KV store (Redis/Vercel KV).
