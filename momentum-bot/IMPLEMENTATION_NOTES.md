# Momentum-Bot Implementation Notes

## Overview

This is the **core signal detection engine** for a Polymarket → Kalshi momentum arbitrage bot. The bot monitors Polymarket order books in real-time, detects rapid YES price movements, and fires `MomentumSignal` events for the execution layer to process on Kalshi.

## Key Design Decisions

### 1. Velocity Calculation via Linear Regression

The detector uses **least-squares linear regression** on price points collected over the rolling `WINDOW_MS` window:

```
velocity = slope(timestamp - minTime, price) × 1000
```

This is more robust than simple delta-based velocity because:
- Reduces noise from single-tick spikes
- Gives equal weight to all points in the window
- Easy to tune via `WINDOW_MS` (e.g., 4s = last 4 seconds of data)

The velocity is in **price units per second** (e.g., 0.08 = 8¢/sec for a 0-1 price scale).

### 2. Confidence Levels

Signals are classified by three factors:

- **high**: velocity > threshold × 2 AND ≥5 data points AND sustained >500ms
  - Only fires when momentum is truly strong and sustained
- **medium**: velocity > threshold AND ≥3 data points
  - Normal momentum signal
- **low**: velocity > threshold but <3 points
  - Early signal, may be noisy

This allows the execution layer to size positions based on confidence.

### 3. Entry Guards

The bot only fires signals if:

```typescript
yesBid >= minYesBid && yesBid <= maxYesBid
```

Default range: [5%, 75%]. This avoids:
- Binary (all-or-nothing) YES prices where momentum is less predictive
- Extreme prices where Kalshi may not have matching liquidity

### 4. Cooldown Per Market

After firing a signal for a market, the detector skips new signals for `COOLDOWN_MS` (default: 30 seconds). This prevents:
- Signal spam on the same market
- Multiple orders on momentum that's already in flight

### 5. Market Filtering (Server-Side)

Market candidates are fetched from Polymarket Gamma API with strict filters:

- **Active**: endDate within next 4 hours (event resolution expected soon)
- **Price**: YES between 5% and 75% (good momentum targets)
- **Liquidity**: liquidityNum > $1000 (sufficient order book depth)

Watchlist refreshes every 5 minutes. Filters are deterministic across runs.

### 6. Kalshi Integration Pattern

The bot uses **optional late-binding** for Kalshi execution:

```typescript
let executeOnKalshi: ((signal: MomentumSignal) => Promise<OrderResult>) | null = null;

async function initializeKalshiExecutor() {
  try {
    const mod = await import('./kalshi-executor.js');
    if (mod?.executeOnKalshi) {
      executeOnKalshi = mod.executeOnKalshi;
    }
  } catch {
    // Continue without executor
  }
}
```

This allows:
- The signal detector to be developed and tested independently
- The execution layer to be added later without changing detector code
- Paper trading mode (`DRY_RUN=true`) to still load the executor for simulation

### 7. Type Safety Across Layers

All shared types live in `src/types.ts`. The execution layer **must import from this exact location** to ensure compatibility:

```typescript
import { MomentumSignal, OrderResult } from './types.js';
```

This prevents TypeScript errors from type mismatch at the boundary.

## File-by-File Rationale

### `index.ts` - Orchestrator
- Loads config and watchlist
- Initializes detector and WebSocket
- Wires detector output to executor
- Handles graceful shutdown (SIGINT/SIGTERM)
- Refreshes watchlist every 5 minutes

### `momentum-detector.ts` - Signal Engine
- Maintains price history per market (max 50 points per market)
- Calculates velocity via linear regression
- Determines confidence based on data quality and momentum strength
- Enforces cooldown and entry guards
- Emits `MomentumSignal` events

### `polymarket-clob.ts` - WebSocket Client
- Connects to Polymarket CLOB subscription service
- Handles auth frame (empty credentials for public data)
- Subscribes to book channel with token IDs
- Parses `book` and `price_change` messages
- Auto-reconnects on close with 2-second delay
- Normalizes prices from cents to 0-1 scale

### `market-loader.ts` - Market Filtering
- Fetches all markets from Polymarket Gamma API
- Filters by endDate, price range, and liquidity
- Extracts condition IDs and YES token IDs
- Returns `WatchedMarket[]` for detector subscription

### `logger.ts` - Logging
- Color-coded console output (green for signals, yellow for books, red for errors)
- Structured logging with timestamps in ISO 8601
- Signal details (velocity, confidence, price history length)
- Order result logging (success/failure, order ID, fill price)

### `config.ts` - Configuration
- Parses environment variables with Zod validation
- Provides typed `BotConfig` object
- Defaults from `.env.example` if env vars not set

### `types.ts` - Type Definitions
- Single source of truth for all interfaces
- Shared between detector and executor
- Must be imported by execution layer

## Testing & Verification

### Unit Test (Momentum Detector Logic)
Run the test included in this repo:
```bash
node /tmp/test-momentum-bot.mjs
```

Expected output:
- Test 1 (slow rise): PASS - No signal fires (velocity below threshold)
- Test 2 (fast rise): PASS - Signal fires (velocity above threshold, high confidence)

### Integration Test (Full Bot Startup)
```bash
DRY_RUN=true npm start
```

Expected first output lines:
```
[time] Bot Starting
  DRY_RUN: ON (paper trading) | Velocity Threshold: 0.04/sec | Window: 4000ms
[time] kalshi-executor loaded
[time] Fetching markets from Polymarket Gamma API...
```

The bot will attempt to fetch markets. In a sandboxed environment with no network access, this will fail gracefully:
```
[time] ERROR Failed to load watchlist from Polymarket
[time] ERROR No markets loaded, exiting
```

In production with network access, the bot will:
1. Load active markets within 4 hours
2. Filter for good momentum setups (5-75% YES price)
3. Subscribe to Polymarket CLOB for those markets
4. Start logging book updates and detecting signals

## Performance Considerations

- **Memory**: Price history ring buffer (max 50 points/market) = negligible
- **CPU**: Linear regression is O(n) per book update; n ≤ 50 = fast
- **Network**: WebSocket reconnect on close, 5-minute watchlist refresh
- **Scalability**: Can handle 100s of markets without issues

## Future Extensions

1. **Market Matcher**: Auto-match Polymarket markets to Kalshi tickers (currently stubbed in execution layer)
2. **Risk Manager**: Track open positions, enforce exposure limits
3. **PnL Tracking**: Log fills and track performance
4. **Webhook/Alerts**: Send signals to external systems
5. **Backtesting**: Replay historical order books to tune thresholds

## Execution Layer Integration

The execution layer developer should:

1. **Import from this bot's types.ts**:
   ```typescript
   import { MomentumSignal, OrderResult } from '@momentum-bot/types';
   ```

2. **Implement executeOnKalshi()**:
   ```typescript
   export async function executeOnKalshi(signal: MomentumSignal): Promise<OrderResult> {
     // Match signal to Kalshi ticker
     // Check risk limits
     // Place order on Kalshi
     // Return OrderResult
   }
   ```

3. **Handle OrderResult**:
   - `success: true` means order was placed (or simulated in DRY_RUN mode)
   - `success: false` means order was skipped or failed
   - Executor is responsible for logging and error handling

4. **Use DRY_RUN mode for testing**:
   - `DRY_RUN=true` enables paper trading
   - Risk manager still tracks hypothetical positions
   - No live orders are placed

## Debugging

Enable verbose logging:
```bash
DRY_RUN=true npm start 2>&1 | grep -E "SIGNAL|ERROR|book"
```

Watch for:
- `SIGNAL` lines: Momentum detected
- `ERROR` lines: Network or processing issues
- `book` lines: Order book updates flowing correctly

Check logs for:
- Signal frequency (should be rare, ~1-2/hour in normal markets)
- Velocity values (should be > threshold to fire)
- Confidence levels (mix of low/medium/high)

## Known Limitations

1. **No market matching**: Execution layer must implement Polymarket→Kalshi ticker matching
2. **No position tracking**: Risk manager is stubbed; execution layer must implement
3. **No historical data**: Only live feeds, no backtest capability
4. **Polymarket-only**: Only monitors Polymarket, doesn't cross-exchange arbitrage
5. **No circuit breakers**: Relies on execution layer for risk limits
