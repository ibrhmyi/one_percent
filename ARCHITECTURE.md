# OnePercent Architecture

AI-powered sports trading bot for Polymarket. Detects edges in basketball
markets using real-time ESPN scores, sportsbook odds (Pinnacle, Kambi),
and prediction models (ESPN BPI, Bart Torvik). Runs as a Next.js server
with a glassmorphic terminal UI.

## Project Structure

```
app/                    Next.js App Router
  page.tsx              Landing page
  terminal/page.tsx     Main trading terminal UI
  blog/page.tsx         Blog/marketing page
  api/
    brain/state/        GET: returns full engine state (markets, trades, account)
    brain/logs/         GET: returns brain message log
    brain/skills/       GET: returns registered skill info
    markets/            GET: returns watched markets
    trades/             GET: returns trade history
    odds/scrape/        GET: DraftKings/FanDuel odds scraper (geo-dependent)
    waitlist/           POST: waitlist signup

engine/                 Server-side trading engine (runs in Next.js process)
  brain.ts              Central orchestrator: market discovery, cycle loop, boot
  state.ts              Singleton in-memory state store
  trade-manager.ts      Position entry/exit lifecycle, Kelly sizing
  exit-manager.ts       Exit rule evaluation (target, reversal, stall, timeout)
  order-manager.ts      CLOB order placement + Supabase persistence
  skill-registry.ts     Skill registration and lookup
  price-feed.ts         WebSocket price feed from Polymarket CLOB
  supabase-sync.ts      Pushes state to Supabase for Vercel frontend
  local-persistence.ts  Saves/restores state to disk (data/ directory)
  orderbook.ts          CLOB orderbook fetch + fill simulation
  data-logger.ts        JSONL logger for research data (scores, reactions, fouls)

  skills/
    basketball/         Live game skill: score-reactive trading
    basketball-edge/    Pre-game skill: odds-based edge detection
    nba-live-edge/      Original NBA-only live skill (still used for Kelly calc)

  predictions/
    aggregator.ts       Combines all sources into weighted fair value per game
    espn-bpi.ts         ESPN BPI win probabilities (free, no auth)
    torvik.ts           Bart Torvik T-Rank for NCAAB (free)
    pinnacle.ts         Pinnacle pre-game odds poller (sharpest book)
    pinnacle-live.ts    Pinnacle live in-game odds
    kambi.ts            Kambi/Unibet odds poller (second book source)
    sportsbook-poller.ts DraftKings/FanDuel scraper (disabled, geo-blocked)
    injury-monitor.ts   ESPN injury API monitor (triggers edge recalc)
    team-aliases.ts     Team name normalization across sources

components/
  terminal/             Trading terminal UI components
    top-bar.tsx         Status bar (mode, uptime, WS status)
    bottom-bar.tsx      Navigation tabs
    markets-table.tsx   Market list with prices and edges
    odds-ranker.tsx     Pre-game odds comparison table
    game-schedule.tsx   Game schedule with ESPN start times
    score-feed.tsx      Live scoring event feed
    positions-panel.tsx Open positions display
    trades-panel.tsx    Trade history
    account-panel.tsx   Account stats (bankroll, P&L)
    skills-panel.tsx    Skill status cards
    sparkline.tsx       Mini price chart component
  access-gate.tsx       Password gate for terminal access
  sound-toggle.tsx      Sound effects toggle

lib/
  types.ts              TypeScript interfaces (Skill, Trade, Market, etc.)
  polymarket.ts         Gamma API client for market data
  supabase.ts           Supabase client setup
  config.ts             App configuration (Zod-validated)
  throttle.ts           Request spacing utility

data/                   Live bot state (DO NOT DELETE)
  bot-state.json        Current bankroll, trades, P&L (auto-saved every 30s)
  bot-trades.json       Permanent trade log
  pregame_orders.json   Pre-game order state

research/data/          JSONL research data (scores, reactions, fouls per day)

supabase/               SQL migration files
```

## How the Engine Works

### Boot Sequence
1. `instrumentation.ts` calls `startBrain()` when Next.js server starts
2. Brain loads persisted state from `data/bot-state.json`
3. Registers skills: Basketball (live) + Basketball Edge (pre-game)
4. Starts pollers: Pinnacle, Kambi, injury monitor
5. Starts WebSocket price feed to Polymarket CLOB
6. Runs initial market discovery + prediction refresh

### Brain Cycle (every 1 second)
1. Simulate dry-run fills (if DRY_RUN mode)
2. Update P&L on all open trades
3. If no live games: run pre-game skill (quickScan/10s, detect/60s)
4. If live games: run all skills on live markets
5. Collect opportunities, sort by EV, enter best one (if no open position)
6. Sync state to Supabase (throttled to every 30s)
7. Save state to disk (throttled to every 30s)

### Exit Monitor (every 2 seconds)
Checks open trades against exit rules: target price, reversal from peak,
stall detection, timeout, and market settlement.

### Data Flow
```
ESPN Scores ──┐
Pinnacle Odds ├──> Predictions/Aggregator ──> Fair Value
Kambi Odds ───┤                                  │
ESPN BPI ─────┤                                  v
Torvik ───────┘                           Edge = Fair - Market Price
                                                 │
Gamma API ──> Market Discovery                   v
CLOB WS ───> Real-time Prices          Brain Cycle: detect() per skill
                                                 │
                                                 v
                                          Kelly Sizing ──> Order Manager ──> Trade
```

## Environment Variables

See `.env.example` for the full list. Key variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key |
| `DRY_RUN` | No | `true` (default) = simulated, `false` = live trading |
| `BANKROLL` | No | Starting capital (default: 10000) |
| `POLY_PRIVATE_KEY` | Live only | Polymarket wallet private key |

## Running Locally

```bash
cp .env.example .env.local
# Fill in Supabase credentials at minimum
npm install
npm run build && npm start
# Engine starts automatically via instrumentation.ts
# UI at http://localhost:3000/terminal
```

## Vercel Deployment

The Vercel deployment serves the frontend only. It reads engine state from
Supabase (populated by the local bot process). The bot must run locally
(or on a VPS) because:
- It needs persistent WebSocket connections
- It polls ESPN every 1 second
- Vercel serverless functions have execution time limits

The `api/brain/state` route on Vercel reads from Supabase instead of
in-memory engine state. The local bot writes to Supabase every 30 seconds.
