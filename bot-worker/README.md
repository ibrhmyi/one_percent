# OnePercent Bot Worker

Local simulated trading worker for OnePercent near-resolution signals.

## What It Does

- Polls local signals every 2 seconds (`/data/signals.json`)
- Applies entry rules for NO-tail opportunities
- Simulates immediate entry fill and immediate exit order placement
- Writes machine-readable trade lifecycle output (`/data/bot-trades.json`)
- Writes worker state (`/data/bot-state.json`)

This worker is simulation-only and is `DRY_RUN=true` by default.

## Run Locally

```bash
cd bot-worker
npm install
npm run dev
```

Optional env setup:

```bash
cp .env.example .env
```

## Data Files

- Input signals: `/data/signals.json`
- Output trades: `/data/bot-trades.json`
- Output state: `/data/bot-state.json`

## Strategy Rules

The bot enters only when all are true:

- `no_price` is exactly `0.97`
- `spread < 0.10` (below 10 cents)
- `tradeable === true`
- no existing active trade (`open`, `filled`, `exit_placed`) for the same `market_id`
- risk limits are respected

Risk limits:

- `MAX_OPEN_POSITIONS` (default `5`)
- `MAX_POSITION_SIZE` (default `50`)
- `MAX_TOTAL_EXPOSURE` (default `200`)

Execution simulation:

- Entry: buy `NO` at `0.97`, immediate simulated fill
- Exit: immediate simulated sell placement at `0.9999`
- Trade status moves to `exit_placed` and remains visible until a future close rule is added
- If `SUPABASE_URL` and `SUPABASE_ANON_KEY` are set, each simulated trade is upserted to `bot_trades`
