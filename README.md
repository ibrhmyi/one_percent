# OnePercent

OnePercent is a minimal Next.js dashboard for scanning Polymarket markets that are about to close. The current v1 uses Polymarket's Gamma API for market discovery and Polymarket's websocket feed for live price updates on visible cards.

## Stack

- Next.js App Router
- TypeScript
- Tailwind CSS
- Server-side fetch helpers and a route handler
- JSON-file cache with a `MarketStore` interface for later KV or Redis replacement

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy the example env file and add your API key:

   ```bash
   cp .env.example .env.local
   ```

3. Start the development server:

   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000)

## Environment variables

- `CACHE_TTL_SECONDS`: freshness window before the app refreshes the cache
- `MARKET_SCAN_WINDOW_HOURS`: server-side scan/cache window in hours (default `1`)
- `REQUEST_SPACING_MS`: throttle spacing between Polymarket Gamma page calls
- `CACHE_FILE_PATH`: optional custom path for the JSON cache file

## How caching works

- The app reads from a `MarketStore` interface with `getMarkets()`, `saveMarkets()`, and `getLastUpdated()`.
- The default implementation is `JsonMarketStore` in [lib/store.ts](/Users/ibrahimyildiz/Documents/trae_projects/onepercent.markets/lib/store.ts).
- In local development, the cache is written to `.cache/onepercent-markets.json`.
- On Vercel, the fallback path is `/tmp/onepercent-markets.json` so the app can still run, but that storage is ephemeral.
- If the live Polymarket refresh fails, the API falls back to stale cached data when available.
- Expired markets are pruned before each cache write and scrubbed again on cache reads.

## Polymarket assumptions

- Market discovery uses `https://gamma-api.polymarket.com/markets` with pagination.
- The scanner keeps only open/non-archived markets with a valid `endDate`.
- The board shows all markets closing within the configured scan window (default 1 hour).
- Initial YES/NO and volume/liquidity come from Gamma market fields; visible cards then update from Polymarket's websocket.
- Visible cards update directly from Polymarket's market websocket.

## API route

- `GET /api/markets/closing-soon`
- Optional query params:
  - `platform=polymarket|kalshi|unknown`
  - `maxHours=72`
  - `minLiquidity=1000`
  - `sort=soonest|liquidity|volume`
  - `limit=20`
  - `refresh=1`

## Deploying to Vercel

1. Push the repo to GitHub.
2. Import the project into Vercel.
3. Add the same environment variables in the Vercel project settings.
4. Deploy.

For production persistence, replace the JSON store with a KV-backed implementation and keep the rest of the app unchanged.

## Swapping the cache later

1. Implement a new `MarketStore` in place of `JsonMarketStore`.
2. Keep the same method surface:
   - `getMarkets()`
   - `saveMarkets()`
   - `getLastUpdated()`
3. Replace the exported store in [lib/store.ts](/Users/ibrahimyildiz/Documents/trae_projects/onepercent.markets/lib/store.ts) or inject it from a provider module.

Vercel KV, Upstash Redis, or a hosted Redis instance can slot in here without touching the normalization, API route, or dashboard components.
