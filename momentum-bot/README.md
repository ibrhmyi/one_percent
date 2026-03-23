# Momentum-Bot: Polymarket → Kalshi Arbitrage Signal Detector

Core signal detection engine for detecting YES price momentum on Polymarket and signaling for execution on Kalshi.

## Architecture

The bot monitors Polymarket order books in real-time, detects rapid YES price movements (event resolution scenarios), and fires `MomentumSignal` events for the execution layer to process on Kalshi.

### Core Components

- **`momentum-detector.ts`**: Real-time velocity calculation using linear regression over rolling price windows
- **`polymarket-clob.ts`**: WebSocket client for Polymarket CLOB order book subscriptions
- **`market-loader.ts`**: Filters active markets from Polymarket Gamma API based on liquidity, timeframe, and price
- **`kalshi-executor.ts`**: Placeholder for order execution (implemented by execution layer developer)
- **`logger.ts`**: Structured, color-coded console logging
- **`config.ts`**: Environment variable parsing with Zod validation
- **`types.ts`**: Shared type definitions (must match execution layer exactly)

## Quick Start

### Install

```bash
npm install
```

### Run (Paper Trading)

```bash
DRY_RUN=true npm start
```

### Configure

Copy `.env.example` to `.env` and adjust parameters:

```bash
cp .env.example .env
```

Key tuning parameters:
- `VELOCITY_THRESHOLD=0.04` - Minimum price change per second (4¢/sec)
- `WINDOW_MS=4000` - Time window for velocity calculation
- `MIN_YES_BID=0.05`, `MAX_YES_BID=0.75` - Entry price guards
- `COOLDOWN_MS=30000` - Minimum time between signals per market

## Signal Detection

### Velocity Calculation

Uses **linear regression** on price points collected over the rolling `WINDOW_MS` window:

```
velocity = slope of regression line (price/ms) × 1000 → price/second
```

For example: 0.08 = 8¢ per second of upward momentum.

### Confidence Levels

- **high**: velocity > threshold × 2 AND ≥5 data points AND sustained >500ms
- **medium**: velocity > threshold AND ≥3 data points
- **low**: velocity > threshold but <3 points

### Entry Guards

Only signals fire if:
- `yesBid >= MIN_YES_BID` AND `yesBid <= MAX_YES_BID`
- No signal for this market within `COOLDOWN_MS`

## Data Flow

```
Polymarket CLOB WebSocket
    ↓ (book + price_change events)
BookSnapshot collection (conditionId, tokenId, bid, ask, timestamp)
    ↓
MomentumDetector.processBookUpdate()
    ↓ (velocity > threshold)
MomentumSignal event
    ↓
handleMomentumSignal()
    ↓
kalshi-executor.executeOnKalshi(signal)
    ↓
OrderResult logged
```

## Type Definitions

All shared types are in `src/types.ts`. The execution layer **must** import and use these exact types:

```typescript
export interface MomentumSignal {
  polyConditionId: string;    // Polymarket condition ID
  polyTokenId: string;        // YES token ID
  title: string;              // Market title
  yesBid: number;             // Current YES bid (0-1)
  yesAsk: number;             // Current YES ask (0-1)
  velocity: number;           // Price change per second
  priceHistory: PricePoint[]; // Last N points used for velocity
  confidence: 'low' | 'medium' | 'high';
  timestamp: number;          // Unix ms
}

export interface OrderResult {
  success: boolean;
  orderId?: string;
  kalshiTicker: string;
  side: 'yes' | 'no';
  sizeUsd: number;
  fillPrice?: number;
  errorMessage?: string;
  dryRun: boolean;
  timestamp: number;
}
```

## Development

### Build

```bash
npm run build
```

### Type Check

```bash
npm run typecheck
```

### Watch Mode

```bash
npm run dev
```

## Market Filtering

The bot loads candidate markets via Polymarket Gamma API:

- **Active**: `endDate` within next 4 hours
- **Price**: YES between 5% and 75% (good momentum targets)
- **Liquidity**: `liquidityNum > $1000`

Watchlist refreshes every 5 minutes. Markets are filtered server-side, not by the bot.

## Paper Trading (DRY_RUN=true)

When `DRY_RUN=true`:
- Signals fire normally
- kalshi-executor is still loaded (if available)
- No live orders placed
- Risk manager tracks hypothetical positions

## Logging

Color-coded console output:
- **Green** (`🔥`): Momentum signals detected
- **Yellow** (`book`): Order book updates
- **Red** (`❌`): Errors
- **Cyan** (`ℹ`): Info events

## Integration with Execution Layer

The bot expects `kalshi-executor.ts` to export:

```typescript
export async function executeOnKalshi(signal: MomentumSignal): Promise<OrderResult>
```

If the module is not available, the bot logs a warning and continues in signal-logging-only mode.

## File Structure

```
momentum-bot/
├── src/
│   ├── index.ts                 # Main orchestrator
│   ├── types.ts                 # Shared type definitions
│   ├── config.ts                # Environment config
│   ├── momentum-detector.ts      # Signal detection engine
│   ├── polymarket-clob.ts        # WebSocket client
│   ├── market-loader.ts          # Market filtering
│   ├── kalshi-executor.ts        # Execution stub (see note)
│   └── logger.ts                # Structured logging
├── dist/                        # Compiled JavaScript
├── package.json
├── tsconfig.json
└── .env.example
```

## Notes

- The bot uses ES2020 modules (`"type": "module"` in package.json)
- Polymarket CLOB requires only public market data (no auth needed)
- Kalshi execution is decoupled and optional
- All market filtering is deterministic (same filters across runs)
