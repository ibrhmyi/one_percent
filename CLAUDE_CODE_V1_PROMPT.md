# OnePercent v1 — Sports Oracle: Claude Code Build Prompt

> **IMPORTANT:** Before starting, read `PROJECT_CONTEXT.md` in the project root. It contains the full decision history, rejected strategies (and WHY they were rejected), the three-version architecture, and key technical gotchas. Do not suggest approaches that are listed as rejected there.

You are building **OnePercent v1 (Sports Oracle)** — an AI-orchestrated Polymarket momentum trader that exploits the 15-45 second broadcast delay in live sports. Sports data APIs (ESPN) deliver scores 0-5s after the event; TV/streaming viewers see it 15-60s later. We trade in that window.

Starting capital: **$400**. Goal: concentrated bets on the single highest-EV sports opportunity at any moment.

---

## PROJECT LOCATION

```
/Users/ibrahimyildiz/Documents/Onepercent pull trading/onepercent.markets/momentum-bot/
```

This is an existing TypeScript project. You are **refactoring** it from a generic momentum detector into a Sports Oracle.

---

## EXISTING FILES (keep what's useful, refactor/replace the rest)

### Keep as-is:
- `src/logger.ts` — Console logger with colors. Works fine. Add new log functions as needed.
- `src/supabase-client.ts` — Supabase persistence. Keep for signal logging. Update the schema to match new signal types.
- `src/polymarket-clob.ts` — **Working** Polymarket CLOB WebSocket. Connects to `wss://ws-subscriptions-clob.polymarket.com/ws/market`. Handles book + price_change events, PING heartbeats every 9s, 180 assets/connection chunking, auto-reconnect. **Do NOT rewrite this.** It works.

### Refactor heavily:
- `src/types.ts` — Add new types for sports events, orchestrator, win probability, trade management. Keep `BookSnapshot`, `PricePoint`.
- `src/config.ts` — Add new config fields for ESPN polling, trade sizing, exit rules, sport toggles.
- `src/market-loader.ts` — Currently loads all Polymarket markets. Refactor to **filter for sports markets only** (by keyword matching on title: NBA, NFL, MLB, NHL, soccer, UFC, etc.). Keep the Gamma API fetching logic.
- `src/market-matcher.ts` — Currently matches Polymarket→Kalshi. **Replace entirely** with ESPN Game → Polymarket Market matching (fuzzy team name + date matching).
- `src/momentum-detector.ts` — The linear regression velocity detector. **Keep as a secondary signal** (Layer 3: order book confirmation). The primary signal is now from ESPN score changes + win probability model.
- `src/index.ts` — **Full rewrite** into the orchestrator entry point.

### Delete (no longer needed):
- `src/kalshi-executor.ts` — We're trading on Polymarket, not Kalshi.
- `src/kalshi-rest.ts` — Same.
- `src/risk-manager.ts` — Replace with new trade-manager.ts.

### New files to create:
- `src/orchestrator.ts` — The brain. Scans live games, scores opportunities, allocates capital.
- `src/sports-plugin.ts` — ESPN API polling + score change detection.
- `src/win-probability.ts` — NBA/NFL/Soccer/MLB win probability models.
- `src/trade-manager.ts` — Position tracking, Half-Kelly sizing, exposure limits.
- `src/polymarket-executor.ts` — Places TAKER orders on Polymarket CLOB via REST API.
- `src/exit-manager.ts` — Monitors open positions, triggers exits.

---

## PACKAGE.JSON

Current dependencies: `@supabase/supabase-js`, `ws`, `zod`. Add:
- `@polymarket/clob-client` — For order placement (EIP-712 signing)
- `ethers` — For wallet/signing (required by clob-client)
- `dotenv` — For .env loading (backup)
- `node-cron` — For scheduled tasks (optional, can use setInterval)

```json
{
  "dependencies": {
    "@supabase/supabase-js": "^2.100.0",
    "@polymarket/clob-client": "latest",
    "ethers": "^6.0.0",
    "ws": "^8.18.0",
    "zod": "^3.23.8"
  }
}
```

---

## ARCHITECTURE OVERVIEW

```
┌─────────────────────────────────────────────────────┐
│                   ORCHESTRATOR (brain)               │
│  - Scans all live games via ESPN every 10s           │
│  - For each game: compute win prob → compare to      │
│    Polymarket price → score opportunity              │
│  - Allocate $400 to the SINGLE best opportunity      │
│  - Route to trade-manager for execution              │
└─────────┬───────────────┬───────────────┬───────────┘
          │               │               │
    ┌─────▼─────┐  ┌─────▼─────┐  ┌─────▼─────┐
    │  Sports   │  │  Market   │  │  CLOB WS  │
    │  Plugin   │  │  Matcher  │  │ (existing) │
    │ ESPN API  │  │ ESPN→Poly │  │ price feed │
    └───────────┘  └───────────┘  └───────────┘
```

**Flow per cycle (every 10 seconds):**
1. Sports Plugin polls ESPN for all live games
2. For each game with a score change since last poll:
   a. Win Probability model computes P(home_win) from current score + time remaining
   b. Market Matcher finds the corresponding Polymarket market
   c. Get current Polymarket price from CLOB WebSocket cache
   d. Edge = |model_probability - market_price|
   e. If edge > 10% (0.10), create an opportunity
3. Orchestrator ranks all opportunities by edge × liquidity
4. Trade Manager sizes the position (Half-Kelly, max 25% of bankroll per trade)
5. Polymarket Executor places a TAKER order
6. Exit Manager monitors and exits when target hit

---

## FILE-BY-FILE SPECIFICATIONS

### 1. `src/types.ts` — Extended types

```typescript
// KEEP existing:
export interface BookSnapshot { ... }  // unchanged
export interface PricePoint { ... }    // unchanged

// ADD:
export interface SportEvent {
  espnGameId: string;
  sport: 'nba' | 'nfl' | 'mlb' | 'nhl' | 'soccer' | 'ufc';
  league: string;                    // e.g. "nba", "nfl", "eng.1"
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  gameClockSeconds: number;          // seconds remaining (0 = game over)
  period: number;                    // quarter/half/inning
  possession?: 'home' | 'away';     // NFL only
  status: 'pre' | 'in' | 'post';
  lastUpdated: number;               // Unix ms
}

export interface WinProbability {
  homeWin: number;                   // 0-1
  awayWin: number;                   // 0-1  (= 1 - homeWin for binary)
  model: string;                     // which model produced this
  confidence: number;                // 0-1 model confidence
}

export interface Opportunity {
  id: string;                        // `${espnGameId}-${polyConditionId}`
  sport: SportEvent;
  polyMarket: {
    conditionId: string;
    tokenId: string;                 // YES token ID
    title: string;
    currentPrice: number;            // from CLOB WS cache
    liquidity: number;
  };
  modelProb: number;                 // our win probability
  marketProb: number;                // Polymarket's implied probability
  edge: number;                      // modelProb - marketProb (signed)
  direction: 'buy_yes' | 'buy_no';  // which side to trade
  score: number;                     // edge * sqrt(liquidity) — ranking metric
  timestamp: number;
}

export interface Position {
  id: string;
  conditionId: string;
  tokenId: string;
  title: string;
  side: 'yes' | 'no';
  entryPrice: number;
  size: number;                      // in USDC
  shares: number;                    // shares bought
  entryTime: number;
  exitPrice?: number;
  exitTime?: number;
  pnl?: number;
  status: 'open' | 'closed' | 'expired';
  exitReason?: 'target' | 'stall' | 'reversal' | 'timeout' | 'game_over';
}

export interface OrchestratorConfig {
  // ESPN
  espnPollIntervalMs: number;        // default: 10000 (10s)
  enabledSports: string[];           // default: ['nba', 'nfl']

  // Trading
  bankroll: number;                  // default: 400
  minEdge: number;                   // default: 0.10 (10%)
  maxPositionPct: number;            // default: 0.25 (25% of bankroll)
  maxOpenPositions: number;          // default: 1
  kellyFraction: number;             // default: 0.5 (Half-Kelly)

  // Exit rules
  exitTargetPrice: number;           // default: 0.92 (sell at 92c)
  exitStallMinutes: number;          // default: 5
  exitReversalCents: number;         // default: 10 (exit if price drops 10c from peak)
  exitTimeoutHours: number;          // default: 24

  // Execution
  dryRun: boolean;                   // default: true
  polyWsUrl: string;
  polyApiKey: string;                // Polymarket API key
  polyPrivateKey: string;            // Wallet private key for signing
}
```

### 2. `src/config.ts` — Updated config loader

Load from environment variables with Zod validation. All the `OrchestratorConfig` fields above should map to env vars like:
- `BANKROLL=400`
- `MIN_EDGE=0.10`
- `MAX_POSITION_PCT=0.25`
- `ESPN_POLL_INTERVAL_MS=10000`
- `ENABLED_SPORTS=nba,nfl`
- `DRY_RUN=true`
- `POLY_API_KEY=...`
- `POLY_PRIVATE_KEY=...`
- `EXIT_TARGET_PRICE=0.92`
- etc.

### 3. `src/sports-plugin.ts` — ESPN API Integration

**ESPN Hidden API (free, no auth, no rate limit):**

```
Base URL: https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/scoreboard

Examples:
  NBA: /basketball/nba/scoreboard
  NFL: /football/nfl/scoreboard
  MLB: /baseball/mlb/scoreboard
  NHL: /hockey/nhl/scoreboard
  Soccer (EPL): /soccer/eng.1/scoreboard
  MLS: /soccer/usa.1/scoreboard
```

**Implementation:**

```typescript
export class SportsPlugin {
  private previousScores: Map<string, { home: number; away: number }> = new Map();
  private config: OrchestratorConfig;

  constructor(config: OrchestratorConfig) { ... }

  // Poll all enabled sports, return events with score changes
  async pollLiveGames(): Promise<{ events: SportEvent[]; scoreChanges: SportEvent[] }> {
    const allEvents: SportEvent[] = [];
    const changes: SportEvent[] = [];

    for (const sport of this.config.enabledSports) {
      const events = await this.fetchSport(sport);
      for (const event of events) {
        allEvents.push(event);

        const prevKey = event.espnGameId;
        const prev = this.previousScores.get(prevKey);

        if (prev && (prev.home !== event.homeScore || prev.away !== event.awayScore)) {
          changes.push(event);
        }

        this.previousScores.set(prevKey, {
          home: event.homeScore,
          away: event.awayScore
        });
      }
    }

    return { events: allEvents, scoreChanges: changes };
  }

  private async fetchSport(sport: string): Promise<SportEvent[]> {
    // Map sport to ESPN URL path
    // Parse the JSON response into SportEvent[]
    // Extract: teams, scores, game clock, period, status
    // Handle each sport's different response format
  }
}
```

**ESPN Response Parsing Notes:**
- Response shape: `{ events: [{ id, competitions: [{ competitors: [{team: {displayName}, score}], status: {clock, period, type: {state}} }] }] }`
- `status.type.state` = "pre" | "in" | "post"
- `status.displayClock` = "8:42" (mm:ss format for NBA/NFL)
- `competitors[0]` is usually HOME (check `homeAway` field)
- Game clock for NBA/NFL: parse "8:42" → convert to total seconds remaining based on period
- NFL: 4 quarters × 15 min = 3600s total. NBA: 4 quarters × 12 min = 2880s total.

### 4. `src/win-probability.ts` — Probability Models

Implement these formulas (run locally, zero cost, sub-ms speed):

**NBA:**
```typescript
function nbaProbability(lead: number, secondsRemaining: number): number {
  // Logistic model calibrated to NBA data
  // lead = homeScore - awayScore (positive = home leading)
  const pace = 0.45; // points per second pace factor
  const k = 0.7;     // steepness
  const x = lead / (pace * Math.sqrt(Math.max(secondsRemaining, 1)));
  return 1 / (1 + Math.exp(-k * x));
}
// Edge cases: if secondsRemaining <= 0 and lead > 0 → return 1.0
//             if secondsRemaining <= 0 and lead < 0 → return 0.0
//             if secondsRemaining <= 0 and lead == 0 → return 0.5 (OT)
```

**NFL:**
```typescript
function nflProbability(lead: number, secondsRemaining: number, hasPossession: boolean): number {
  const possessionBonus = hasPossession ? 2.5 : 0; // ~2.5 point possession value
  const effectiveLead = lead + possessionBonus;
  const k = 0.15;
  const x = effectiveLead / Math.sqrt(Math.max(secondsRemaining / 60, 0.1));
  return 1 / (1 + Math.exp(-k * x));
}
```

**Soccer:**
```typescript
function soccerProbability(lead: number, minutesRemaining: number): number {
  // Poisson-based: expected goals remaining ~ 0.033 per minute per team
  const lambda = 0.033 * minutesRemaining; // expected goals per team remaining
  if (lead >= 3) return 0.99;  // 3+ goal lead is essentially won
  if (lead <= -3) return 0.01;
  // Simplified logistic for speed
  const k = 0.8;
  const x = lead / Math.sqrt(Math.max(lambda, 0.01));
  return 1 / (1 + Math.exp(-k * x));
}
```

**MLB:**
```typescript
function mlbProbability(lead: number, inningsRemaining: number): number {
  // MLB: roughly 0.5 runs per inning per team
  const expectedRuns = 0.5 * inningsRemaining;
  const k = 0.6;
  const x = lead / Math.sqrt(Math.max(expectedRuns, 0.01));
  return 1 / (1 + Math.exp(-k * x));
}
```

**Export a unified function:**
```typescript
export function calculateWinProbability(event: SportEvent): WinProbability {
  const lead = event.homeScore - event.awayScore;
  let homeWin: number;

  switch (event.sport) {
    case 'nba': homeWin = nbaProbability(lead, event.gameClockSeconds); break;
    case 'nfl': homeWin = nflProbability(lead, event.gameClockSeconds, event.possession === 'home'); break;
    case 'soccer': homeWin = soccerProbability(lead, event.gameClockSeconds / 60); break;
    case 'mlb': homeWin = mlbProbability(lead, event.gameClockSeconds / (3 * 60)); break; // rough inning conversion
    default: homeWin = 0.5;
  }

  return {
    homeWin: Math.max(0.01, Math.min(0.99, homeWin)),
    awayWin: Math.max(0.01, Math.min(0.99, 1 - homeWin)),
    model: `${event.sport}-logistic-v1`,
    confidence: event.status === 'in' ? 0.8 : 0.3
  };
}
```

### 5. `src/market-matcher.ts` — ESPN → Polymarket Matching (FULL REWRITE)

Replace the old Kalshi matching. Now matches ESPN games to Polymarket sports markets.

```typescript
interface PolymarketSportsMarket {
  conditionId: string;
  tokenId: string;
  title: string;
  liquidity: number;
  currentPrice: number;  // from CLOB cache
}

export class MarketMatcher {
  private polyMarkets: PolymarketSportsMarket[] = [];
  private matchCache: Map<string, PolymarketSportsMarket | null> = new Map();

  updateMarkets(markets: PolymarketSportsMarket[]): void {
    this.polyMarkets = markets;
    this.matchCache.clear();
  }

  findMatch(event: SportEvent): PolymarketSportsMarket | null {
    const cacheKey = event.espnGameId;
    if (this.matchCache.has(cacheKey)) return this.matchCache.get(cacheKey)!;

    // Strategy:
    // 1. Normalize team names (remove city, handle abbreviations)
    // 2. Search Polymarket titles for BOTH team names in same market
    // 3. Check date alignment (game date matches market)
    // 4. Prefer "Will X win?" or "X vs Y" format markets

    const homeNorm = normalizeTeamName(event.homeTeam);
    const awayNorm = normalizeTeamName(event.awayTeam);

    for (const market of this.polyMarkets) {
      const titleLower = market.title.toLowerCase();
      if (titleLower.includes(homeNorm) && titleLower.includes(awayNorm)) {
        this.matchCache.set(cacheKey, market);
        return market;
      }
      // Also try abbreviated names
      if (titleLower.includes(abbreviate(event.homeTeam)) &&
          titleLower.includes(abbreviate(event.awayTeam))) {
        this.matchCache.set(cacheKey, market);
        return market;
      }
    }

    this.matchCache.set(cacheKey, null);
    return null;
  }
}

// Team name normalization: "Los Angeles Lakers" → "lakers"
// "Golden State Warriors" → "warriors"
// "LA Clippers" → "clippers"
// Remove: city names, "FC", "United", common prefixes
function normalizeTeamName(name: string): string { ... }

// Abbreviation: "Los Angeles Lakers" → "lal"
// Use a lookup table for major leagues
function abbreviate(name: string): string { ... }
```

**Important: You need a team name lookup table** for at least NBA (30 teams), NFL (32 teams), and top soccer leagues. Map full names, short names, and abbreviations.

### 6. `src/market-loader.ts` — Refactored for Sports Markets

Keep the existing Gamma API fetching but add a sports filter:

```typescript
const SPORTS_KEYWORDS = [
  // League names
  'nba', 'nfl', 'mlb', 'nhl', 'mls', 'premier league', 'champions league',
  'la liga', 'serie a', 'bundesliga', 'ufc', 'fifa',
  // Sport terms
  'win', 'beat', 'score', 'points', 'touchdown', 'goal',
  // Team names (top teams that appear frequently)
  'lakers', 'celtics', 'warriors', 'chiefs', 'eagles', '49ers',
  'yankees', 'dodgers', 'manchester', 'liverpool', 'arsenal',
  'real madrid', 'barcelona',
];

export async function loadSportsMarkets(): Promise<PolymarketSportsMarket[]> {
  // 1. Fetch all active markets from Gamma API (existing logic)
  // 2. Filter: title must contain at least one SPORTS_KEYWORD
  // 3. Filter: liquidity >= $500
  // 4. Filter: must be accepting orders
  // 5. Return with conditionId, tokenId, title, liquidity
  // 6. Also extract YES token price from outcomePrices
}
```

### 7. `src/trade-manager.ts` — Position Sizing & Tracking

```typescript
export class TradeManager {
  private positions: Map<string, Position> = new Map();
  private config: OrchestratorConfig;
  private currentBankroll: number;

  constructor(config: OrchestratorConfig) {
    this.config = config;
    this.currentBankroll = config.bankroll;
  }

  // Half-Kelly position sizing
  calculatePositionSize(opportunity: Opportunity): number {
    const p = opportunity.modelProb;           // our estimated probability
    const marketPrice = opportunity.marketProb; // price we'd pay
    const b = (1 / marketPrice) - 1;           // odds ratio (payout per $1 risked)
    const q = 1 - p;

    // Kelly fraction: f* = (p*b - q) / b
    const kelly = (p * b - q) / b;
    if (kelly <= 0) return 0;  // negative edge, don't trade

    // Half-Kelly for safety
    const halfKelly = kelly * this.config.kellyFraction;

    // Cap at maxPositionPct of bankroll
    const maxSize = this.currentBankroll * this.config.maxPositionPct;
    const size = Math.min(halfKelly * this.currentBankroll, maxSize);

    // Minimum $5 trade, maximum available bankroll
    return Math.max(5, Math.min(size, this.getAvailableBankroll()));
  }

  getAvailableBankroll(): number {
    let exposed = 0;
    for (const pos of this.positions.values()) {
      if (pos.status === 'open') exposed += pos.size;
    }
    return Math.max(0, this.currentBankroll - exposed);
  }

  canOpenPosition(): boolean {
    const openCount = [...this.positions.values()].filter(p => p.status === 'open').length;
    return openCount < this.config.maxOpenPositions;
  }

  openPosition(opportunity: Opportunity, size: number, shares: number): Position { ... }
  closePosition(id: string, exitPrice: number, reason: Position['exitReason']): void { ... }
  getOpenPositions(): Position[] { ... }
  getTotalPnl(): number { ... }
}
```

### 8. `src/polymarket-executor.ts` — Order Placement

```typescript
import { ClobClient } from '@polymarket/clob-client';

export class PolymarketExecutor {
  private client: ClobClient;
  private dryRun: boolean;

  constructor(config: OrchestratorConfig) {
    this.dryRun = config.dryRun;
    // Initialize ClobClient with wallet
    // See: https://github.com/Polymarket/clob-client
    // Requires: API key, private key, chain ID (137 for Polygon)
  }

  async placeTakerOrder(params: {
    tokenId: string;
    side: 'buy' | 'sell';
    amount: number;  // USDC amount
    price: number;   // limit price (set slightly above market for guaranteed fill)
  }): Promise<{ success: boolean; orderId?: string; fillPrice?: number; error?: string }> {
    if (this.dryRun) {
      logInfo(`[DRY RUN] Would place ${params.side} order: $${params.amount} at ${params.price}`);
      return { success: true, orderId: 'dry-run', fillPrice: params.price };
    }

    // Use ClobClient to create and sign a market order
    // TAKER mode: we want immediate fill, so use createMarketOrder or
    // set price slightly above best ask (for buys) / below best bid (for sells)
    //
    // Key: Polymarket uses EIP-712 typed data signing
    // The ClobClient handles this internally
  }

  async cancelOrder(orderId: string): Promise<boolean> { ... }
}
```

**Polymarket CLOB Client Setup:**
```typescript
import { ClobClient } from '@polymarket/clob-client';
import { ethers } from 'ethers';

const wallet = new ethers.Wallet(config.polyPrivateKey);
const client = new ClobClient(
  'https://clob.polymarket.com',  // mainnet
  137,                             // Polygon chain ID
  wallet,
  undefined,
  undefined,
  config.polyApiKey
);
```

### 9. `src/exit-manager.ts` — Position Exit Logic

```typescript
export class ExitManager {
  private peakPrices: Map<string, number> = new Map();

  // Called every time we get a price update from CLOB WebSocket
  checkExits(
    positions: Position[],
    currentPrices: Map<string, number>,  // tokenId → current mid price
    config: OrchestratorConfig
  ): Array<{ positionId: string; reason: Position['exitReason'] }> {
    const exits: Array<{ positionId: string; reason: Position['exitReason'] }> = [];

    for (const pos of positions) {
      if (pos.status !== 'open') continue;

      const currentPrice = currentPrices.get(pos.tokenId);
      if (!currentPrice) continue;

      // Track peak price for trailing stop
      const peak = this.peakPrices.get(pos.id) ?? pos.entryPrice;
      if (currentPrice > peak) this.peakPrices.set(pos.id, currentPrice);

      // EXIT RULE 1: Target hit (92c default)
      if (currentPrice >= config.exitTargetPrice) {
        exits.push({ positionId: pos.id, reason: 'target' });
        continue;
      }

      // EXIT RULE 2: Reversal (10c drop from peak)
      const peakPrice = this.peakPrices.get(pos.id) ?? pos.entryPrice;
      if (peakPrice - currentPrice >= config.exitReversalCents / 100) {
        exits.push({ positionId: pos.id, reason: 'reversal' });
        continue;
      }

      // EXIT RULE 3: Stall (no meaningful movement for 5 minutes)
      const elapsed = Date.now() - pos.entryTime;
      const priceChange = Math.abs(currentPrice - pos.entryPrice);
      if (elapsed > config.exitStallMinutes * 60_000 && priceChange < 0.02) {
        exits.push({ positionId: pos.id, reason: 'stall' });
        continue;
      }

      // EXIT RULE 4: Timeout (24h)
      if (elapsed > config.exitTimeoutHours * 3600_000) {
        exits.push({ positionId: pos.id, reason: 'timeout' });
        continue;
      }
    }

    return exits;
  }
}
```

### 10. `src/orchestrator.ts` — The Brain

```typescript
export class Orchestrator {
  private sportsPlugin: SportsPlugin;
  private marketMatcher: MarketMatcher;
  private tradeManager: TradeManager;
  private executor: PolymarketExecutor;
  private exitManager: ExitManager;
  private priceCache: Map<string, number>;  // tokenId → latest mid price
  private config: OrchestratorConfig;

  constructor(config: OrchestratorConfig) {
    this.config = config;
    this.sportsPlugin = new SportsPlugin(config);
    this.marketMatcher = new MarketMatcher();
    this.tradeManager = new TradeManager(config);
    this.executor = new PolymarketExecutor(config);
    this.exitManager = new ExitManager();
    this.priceCache = new Map();
  }

  async start(): Promise<void> {
    // 1. Load sports markets from Polymarket
    const markets = await loadSportsMarkets();
    this.marketMatcher.updateMarkets(markets);

    // 2. Subscribe to CLOB WebSocket for price updates
    const tokenIds = markets.map(m => m.tokenId);
    createPolymarketClobSocket(tokenIds, {
      onBook: (snapshot) => this.updatePriceCache(snapshot),
      onPriceChange: (snapshot) => {
        this.updatePriceCache(snapshot);
        this.checkExits();  // Check exits on every price update
      },
      onOpen: () => logInfo('CLOB WebSocket connected'),
      onError: (err) => logError('CLOB error', err),
    });

    // 3. Start ESPN polling loop
    setInterval(() => this.pollAndTrade(), this.config.espnPollIntervalMs);

    // 4. Refresh Polymarket markets every 5 minutes
    setInterval(async () => {
      const fresh = await loadSportsMarkets();
      this.marketMatcher.updateMarkets(fresh);
    }, 5 * 60_000);

    logInfo('OnePercent v1 Sports Oracle started');
  }

  private async pollAndTrade(): Promise<void> {
    try {
      // 1. Poll ESPN
      const { events, scoreChanges } = await this.sportsPlugin.pollLiveGames();

      if (scoreChanges.length === 0) return; // No score changes, nothing to do

      // 2. Score each change as an opportunity
      const opportunities: Opportunity[] = [];

      for (const event of scoreChanges) {
        // a. Calculate win probability
        const winProb = calculateWinProbability(event);

        // b. Find matching Polymarket market
        const market = this.marketMatcher.findMatch(event);
        if (!market) continue;

        // c. Get current Polymarket price
        const currentPrice = this.priceCache.get(market.tokenId) ?? market.currentPrice;

        // d. Calculate edge
        // Determine if this market is "home team wins" or "away team wins"
        const isHomeMarket = this.isHomeTeamMarket(market.title, event);
        const modelProb = isHomeMarket ? winProb.homeWin : winProb.awayWin;
        const edge = modelProb - currentPrice;

        // e. Only consider if edge > minimum threshold
        if (Math.abs(edge) < this.config.minEdge) continue;

        const direction = edge > 0 ? 'buy_yes' : 'buy_no';

        opportunities.push({
          id: `${event.espnGameId}-${market.conditionId}`,
          sport: event,
          polyMarket: {
            conditionId: market.conditionId,
            tokenId: market.tokenId,
            title: market.title,
            currentPrice,
            liquidity: market.liquidity,
          },
          modelProb,
          marketProb: currentPrice,
          edge: Math.abs(edge),
          direction,
          score: Math.abs(edge) * Math.sqrt(market.liquidity),
          timestamp: Date.now(),
        });
      }

      if (opportunities.length === 0) return;

      // 3. Rank by score, take the best
      opportunities.sort((a, b) => b.score - a.score);
      const best = opportunities[0];

      logInfo(`Best opportunity: ${best.polyMarket.title}`);
      logInfo(`  Edge: ${(best.edge * 100).toFixed(1)}% | Direction: ${best.direction}`);
      logInfo(`  Model: ${(best.modelProb * 100).toFixed(1)}% vs Market: ${(best.marketProb * 100).toFixed(1)}%`);

      // 4. Check if we can trade
      if (!this.tradeManager.canOpenPosition()) {
        logInfo('Max positions reached, skipping');
        return;
      }

      // 5. Size the position
      const size = this.tradeManager.calculatePositionSize(best);
      if (size < 5) {
        logInfo(`Position size too small ($${size.toFixed(2)}), skipping`);
        return;
      }

      // 6. Execute
      logInfo(`Placing ${best.direction} order: $${size.toFixed(2)} on "${best.polyMarket.title}"`);

      const result = await this.executor.placeTakerOrder({
        tokenId: best.polyMarket.tokenId,
        side: best.direction === 'buy_yes' ? 'buy' : 'sell',
        amount: size,
        price: best.direction === 'buy_yes'
          ? Math.min(best.marketProb + 0.02, 0.99)   // buy slightly above market
          : Math.max(best.marketProb - 0.02, 0.01),  // sell slightly below market
      });

      if (result.success) {
        const shares = size / (result.fillPrice ?? best.marketProb);
        this.tradeManager.openPosition(best, size, shares);
        logInfo(`Position opened: ${shares.toFixed(2)} shares at ${result.fillPrice}`);
      } else {
        logError(`Order failed: ${result.error}`);
      }
    } catch (error) {
      logError('Poll cycle error', error);
    }
  }

  private checkExits(): void {
    const openPositions = this.tradeManager.getOpenPositions();
    if (openPositions.length === 0) return;

    const exits = this.exitManager.checkExits(openPositions, this.priceCache, this.config);

    for (const exit of exits) {
      const pos = openPositions.find(p => p.id === exit.positionId);
      if (!pos) continue;

      const currentPrice = this.priceCache.get(pos.tokenId) ?? pos.entryPrice;

      logInfo(`Exiting position: ${pos.title} | Reason: ${exit.reason} | Price: ${currentPrice}`);

      // Place sell order
      this.executor.placeTakerOrder({
        tokenId: pos.tokenId,
        side: 'sell',
        amount: pos.shares,  // sell all shares
        price: Math.max(currentPrice - 0.02, 0.01),
      }).then(result => {
        if (result.success) {
          this.tradeManager.closePosition(pos.id, result.fillPrice ?? currentPrice, exit.reason);
          logInfo(`Position closed. PnL: $${((result.fillPrice ?? currentPrice) * pos.shares - pos.size).toFixed(2)}`);
        }
      }).catch(err => logError('Exit order failed', err));
    }
  }

  private updatePriceCache(snapshot: BookSnapshot): void {
    const mid = (snapshot.yesBid + snapshot.yesAsk) / 2;
    if (mid > 0) this.priceCache.set(snapshot.tokenId, mid);
  }

  private isHomeTeamMarket(title: string, event: SportEvent): boolean {
    // Check if the market title refers to the home team winning
    // Simple heuristic: if home team name appears first, or title says "Will [home] win"
    const titleLower = title.toLowerCase();
    const homeNorm = event.homeTeam.toLowerCase().split(' ').pop() ?? '';
    return titleLower.indexOf(homeNorm) < titleLower.length / 2;
  }
}
```

### 11. `src/index.ts` — Entry Point (REWRITE)

```typescript
import { Orchestrator } from './orchestrator.js';
import { loadConfig } from './config.js';
import { logInfo, logError } from './logger.js';

async function main(): Promise<void> {
  const config = loadConfig();

  logInfo('OnePercent v1 — Sports Oracle');
  logInfo(`Bankroll: $${config.bankroll} | Min Edge: ${config.minEdge * 100}% | Dry Run: ${config.dryRun}`);
  logInfo(`Sports: ${config.enabledSports.join(', ')}`);

  const orchestrator = new Orchestrator(config);
  await orchestrator.start();

  process.on('SIGINT', () => {
    logInfo('Shutting down...');
    process.exit(0);
  });
}

main().catch((error) => {
  logError('Fatal error', error);
  process.exit(1);
});
```

---

## .ENV FILE TEMPLATE

Create `.env` in the project root:

```env
# Trading
BANKROLL=400
MIN_EDGE=0.10
MAX_POSITION_PCT=0.25
MAX_OPEN_POSITIONS=1
KELLY_FRACTION=0.5
DRY_RUN=true

# ESPN
ESPN_POLL_INTERVAL_MS=10000
ENABLED_SPORTS=nba,nfl

# Exit Rules
EXIT_TARGET_PRICE=0.92
EXIT_STALL_MINUTES=5
EXIT_REVERSAL_CENTS=10
EXIT_TIMEOUT_HOURS=24

# Polymarket
POLY_WS_URL=wss://ws-subscriptions-clob.polymarket.com/ws/market
POLY_API_KEY=
POLY_PRIVATE_KEY=

# Supabase (optional, for logging)
SUPABASE_URL=
SUPABASE_ANON_KEY=
```

---

## BUILD & RUN

```bash
npm install
npm run dev        # development with watch mode
npm run start      # production
npm run typecheck  # verify types
```

---

## CRITICAL IMPLEMENTATION NOTES

1. **DO NOT rewrite `polymarket-clob.ts`** — it's battle-tested and working. Just use it.
2. **Start with DRY_RUN=true** — log everything, execute nothing. Validate the edge detection works before going live.
3. **ESPN API has no auth** — just fetch. No API key needed. No rate limit discovered. But be respectful: 10s polling is fine.
4. **Team name matching is the hardest part** — build a comprehensive lookup table. Use fuzzy matching as fallback. Test with real Polymarket market titles.
5. **The CLOB client requires a funded Polygon wallet** — user needs USDC on Polygon mainnet. The private key goes in `.env`.
6. **Polymarket prices are 0-1 scale** — 0.65 means 65 cents = 65% implied probability.
7. **For buy_no trades**: The YES token price is `currentPrice`. To bet on NO, you'd buy the NO token. The NO token ID is the second element in `clobTokenIds` array from the Gamma API. Make sure market-loader captures BOTH token IDs.
8. **Win probability models are approximate** — they're logistic simplifications. They work well enough for detecting 10%+ edges but are not research-grade. The edge comes from SPEED (knowing the score before the market), not model precision.
9. **Order placement needs careful handling** — use limit orders slightly above/below market to guarantee fills. Market orders may not exist on Polymarket CLOB.

---

## SUCCESS CRITERIA

The bot is working when:
1. It connects to ESPN and detects live game score changes in real-time
2. It matches those games to Polymarket markets correctly
3. It calculates win probability and identifies edges >10%
4. In DRY_RUN mode, it logs "Would place $X on [market] at [price]" with correct direction
5. The CLOB WebSocket stays connected and price cache is up-to-date
6. Exit rules trigger correctly based on price movements

Test with a live NBA game night — there should be multiple score changes per minute to validate the full pipeline.
