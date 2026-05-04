# OnePercent

AI-powered sports trading bot for [Polymarket](https://polymarket.com). Detects edges in NBA markets using sportsbook odds, ESPN data, and prediction models — then trades them automatically on the Polymarket CLOB.

**Live at [onepercent.markets](https://onepercent.markets)**

## How It Works

The engine runs server-side inside a Next.js 15 app (via `instrumentation.ts`). It polls sportsbook odds, ESPN scores, and Polymarket prices on a 1-second loop, looking for two types of edge:

**Pre-Game Edge (Primary)** — Compares Pinnacle and other sharp sportsbook odds to Polymarket pre-game prices. When the sportsbook consensus disagrees with Polymarket by more than the fee threshold, places maker limit orders and holds through resolution.

**Live Scoring Edge (Bonus)** — Detects NBA scoring events via ESPN faster than Polymarket reprices. Taker-buys the scoring team's token during the lag window. Only trades in crunch time (Q4, close games) where the edge is statistically meaningful.

## Architecture

```
Pinnacle / Kambi Odds ──┐
ESPN BPI ────────────────┼──> Prediction Aggregator ──> Fair Value
Bart Torvik ─────────────┘                                  │
                                                            v
Gamma API ──> Market Discovery                 Edge = Fair - Market Price
CLOB WS ───> Real-time Prices                              │
ESPN Scores ─> Live Score Detection                         v
                                                   Kelly Sizing → Order → Trade
```

The frontend is a Bloomberg Terminal-style dashboard showing live games, brain decisions, open positions, and P&L.

## Tech Stack

- Next.js 15 (App Router)
- - TypeScript (strict)
  - - Tailwind CSS
    - - Polymarket CLOB API + WebSocket
      - - The Odds API (sportsbook odds)
        - - ESPN APIs (scores, injuries, BPI)
          - - Supabase (state sync, order persistence)
           
            - ## Getting Started
           
            - ```bash
              cp .env.example .env.local
              # Fill in Supabase keys + Odds API keys
              npm install
              npm run build && npm start
              ```

              The engine boots via `instrumentation.ts`. Open [http://localhost:3000/terminal](http://localhost:3000/terminal) for the trading dashboard, or [http://localhost:3000](http://localhost:3000) for the landing page.

              ## Environment Variables

              | Variable | Required | Description |
              |----------|----------|-------------|
              | `SUPABASE_URL` | Yes | Supabase project URL |
              | `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key |
              | `DRY_RUN` | No | `true` (default) = simulated, `false` = real money |
              | `BANKROLL` | No | Starting capital (default: 400) |
              | `POLY_PRIVATE_KEY` | Live only | Polymarket wallet private key |
              | `ODDS_API_KEY_1` / `_2` / `_3` | Yes | The Odds API keys (3 keys, 500 req/month each) |

              ## Project Structure

              ```
              engine/                     Trading engine (runs server-side)
                brain.ts                  Central orchestrator (1s loop)
                trade-manager.ts          Position entry, Kelly sizing
                exit-manager.ts           Exit rules (target, reversal, stall, timeout)
                order-manager.ts          CLOB order placement
                price-feed.ts             WebSocket to Polymarket CLOB
                state.ts                  Singleton state store
                skills/
                  basketball-edge/        Pre-game odds arbitrage strategy
                  basketball/             Live scoring strategy
                predictions/
                  aggregator.ts           Combines all sources into fair value
                  pinnacle.ts             Pinnacle odds
                  kambi.ts                Kambi/Unibet odds
                  espn-bpi.ts             ESPN BPI model
                  injury-monitor.ts       ESPN injury tracking

              app/
                page.tsx                  Landing page
                terminal/page.tsx         Trading terminal UI
                api/brain/state/          Engine state endpoint
                api/trades/               Trade history endpoint
                api/odds/scrape/          Odds scraper endpoint

              components/terminal/        Bloomberg Terminal-style UI components
              ```

              ## Deployment

              Frontend deploys to Vercel (reads from Supabase). The engine runs locally or on a VPS — it needs a persistent WebSocket connection and 1-second polling. State syncs to Supabase every 30 seconds so the Vercel frontend stays current.

              ## License

              Private. Not open source.
