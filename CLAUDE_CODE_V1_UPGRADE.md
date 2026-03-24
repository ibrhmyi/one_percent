# 1% v1 Upgrade — From Hackathon Scanner to Momentum Trading Platform

> **READ FIRST:** `PROJECT_CONTEXT.md` and `CLAUDE_CODE_V1_PROMPT.md`
> This file describes what needs to CHANGE from the current codebase.

---

## PROBLEM: Current state is NOT v1

The current app is still the hackathon near-resolution scanner with a thin momentum layer. It needs to become an **AI-orchestrated momentum trading platform** with pluggable skills.

### What's wrong right now:
1. No ESPN API — the core v1 data source is missing entirely
2. No win probability models — the logistic formulas for NBA/NFL/Soccer/MLB don't exist
3. No orchestrator brain — nothing scores opportunities or allocates capital
4. AI brain is doing resolution-window estimation (Groq/LLaMA) — not momentum detection
5. Bot worker checks if `no_price === 0.97` — that's a tail-grabbing strategy, not momentum trading
6. Still references Kalshi in the momentum dashboard UI
7. No Polymarket order execution (no `@polymarket/clob-client`)
8. No exit manager
9. No skill/plugin architecture
10. Dashboard shows markets but has no concept of AI focus, active skill, or trade decisions

---

## WHAT TO BUILD

### Phase 1: Backend — Sports Oracle Skill (the actual v1 engine)

Create these files per the spec in `CLAUDE_CODE_V1_PROMPT.md`:

```
src/skills/sports/            ← NEW: Sports skill directory
  espn-api.ts                 ← ESPN API client (poll scoreboard endpoints)
  win-probability.ts          ← NBA/NFL/Soccer/MLB logistic models
  market-matcher.ts           ← ESPN game → Polymarket market fuzzy matching
  index.ts                    ← Sports skill entry point (exports detect() method)

src/orchestrator/             ← NEW: AI brain
  brain.ts                    ← Scores all opportunities, picks best, allocates capital
  skill-registry.ts           ← Registry of available skills (sports, news, etc.)
  types.ts                    ← Opportunity, SkillResult, BrainDecision types

src/execution/                ← NEW: Trade execution
  trade-manager.ts            ← Position tracking, Half-Kelly sizing
  polymarket-executor.ts      ← CLOB order placement via @polymarket/clob-client
  exit-manager.ts             ← Monitor positions, trigger exits (92¢, reversal, stall, timeout)

src/index.ts                  ← REWRITE: Starts orchestrator loop + WebSocket + market refresh
```

#### Skill Interface (all skills must implement this):

```typescript
interface Skill {
  name: string;                           // e.g. "sports-espn"
  supportedCategories: string[];          // e.g. ["sports"]

  // Called by brain every cycle. Returns opportunities this skill detected.
  detect(markets: PolymarketSportsMarket[]): Promise<SkillDetection[]>;

  // How often this skill needs to poll (ms)
  pollIntervalMs: number;
}

interface SkillDetection {
  marketId: string;
  tokenId: string;
  title: string;
  modelProbability: number;      // skill's estimated true probability
  currentPrice: number;          // Polymarket's current price
  edge: number;                  // modelProbability - currentPrice
  direction: 'buy_yes' | 'buy_no';
  confidence: number;            // 0-1
  skill: string;                 // which skill produced this
  reasoning: string;             // human-readable explanation
}
```

#### ESPN API (see CLAUDE_CODE_V1_PROMPT.md for full endpoints):
```
NBA:    site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard
NFL:    site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard
MLB:    site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard
NHL:    site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard
Soccer: site.api.espn.com/apis/site/v2/sports/soccer/{league}/scoreboard
```

Free, no auth, no rate limit. Poll every 10 seconds.

#### Win Probability (see CLAUDE_CODE_V1_PROMPT.md for exact formulas):
- NBA: `P = 1/(1+exp(-0.7 * lead/(0.45*sqrt(seconds_remaining))))`
- NFL: logistic with 2.5-point possession bonus
- Soccer: Poisson-based
- MLB: logistic with 0.5 runs/inning

### Phase 2: Dashboard — Make it a Platform UI

Transform the existing Next.js dashboard from a market scanner into a trading platform:

#### Page 1: Market Scanner (upgrade existing `/` page)
Keep the market cards but add:
- **AI Priority Score** on each card — how likely is this market to move soon (from the brain)
- **Active Skill Badge** — which skill is monitoring this market (Sports/News/None)
- **Event Timeline** — when did the event start, when will it end, what's the current state
- **Score/Status** — for sports: live score from ESPN. For others: latest relevant data point
- **Edge Indicator** — if the brain sees an edge, show it: "Model: 88% vs Market: 72% = +16% edge"
- Sort options: by edge size, by event time, by AI priority score

#### Each Market Card should show:
```
┌─────────────────────────────────────────────────────┐
│ [SPORTS] [LIVE]                          [POLYMARKET]│
│                                                      │
│ Will the Lakers win vs Celtics?                      │
│                                                      │
│ Score: Lakers 98 - Celtics 91 | Q4 3:42              │
│ ─────────────────────────────────────────────────     │
│ YES 72¢ → Model says 88%                             │
│ Edge: +16%  |  Skill: Sports ESPN  |  Priority: #1   │
│                                                      │
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐                │
│ │ YES  │ │ NO   │ │Spread│ │Volume│                 │
│ │ 72¢  │ │ 28¢  │ │ 1.2¢ │ │$45.2K│                │
│ └──────┘ └──────┘ └──────┘ └──────┘                 │
│                                                      │
│ AI: "Lakers lead by 7 with 3:42 left in Q4.         │
│      Win probability 88% but market at 72%.           │
│      15% edge detected via Sports ESPN skill."        │
└─────────────────────────────────────────────────────┘
```

#### Page 2: AI Brain Dashboard (`/brain`)
New page showing the orchestrator's decision-making:
- **Current Focus** — which market the AI is allocating capital to right now
- **Opportunity Feed** — all detected opportunities ranked by score, with edge, direction, skill
- **Decision Log** — "Allocated $100 to Lakers vs Celtics (Sports ESPN, edge 16%)" with timestamps
- **Capital Status** — bankroll, available capital, exposure, open positions

#### Page 3: Trade Log (`/trades`)
- All trades: open and closed
- Entry price, current price, exit price, P&L
- Which skill triggered the trade
- Exit reason (target, reversal, stall, timeout, game over)
- Running P&L total and equity curve chart

#### Page 4: Skills Panel (`/skills`)
- All registered skills with status (active/idle/error)
- Per-skill stats: trades made, win rate, avg return, total P&L
- Add/remove skills (future: v2 adds News skill here)

### Phase 3: Connect Backend to Frontend

The bot backend (orchestrator + skills + execution) should expose data via:
- **API routes** in Next.js (`/api/brain/status`, `/api/brain/opportunities`, `/api/trades`, `/api/skills`)
- **Or WebSocket** for real-time updates to the dashboard
- The brain writes its state to a shared store (Supabase, or file-based for v1)

---

## WHAT TO KEEP

1. `lib/polymarket.ts` — Gamma API fetching (keep, it works)
2. `components/market-dashboard.tsx` — The card UI foundation (refactor, add new fields)
3. `lib/types.ts` — Market types (extend with new fields)
4. `lib/ai/analyzeMarket.ts` — Groq AI analysis (keep for resolution estimation, but it's NOT the main brain)
5. `lib/format.ts`, `lib/category.ts` — Utility functions (keep)
6. `momentum-bot/src/polymarket-clob.ts` — Working CLOB WebSocket (keep, use in orchestrator)
7. The overall Next.js structure, Tailwind styling, dark theme

## WHAT TO DELETE OR REPLACE

1. `bot-worker/src/strategy.ts` — The `no_price === 0.97` check is not our strategy. Replace with orchestrator brain.
2. `components/momentum-dashboard.tsx` — References Kalshi, old momentum signals. Replace with brain dashboard.
3. `app/momentum/page.tsx` — Replace with `/brain` page
4. `momentum-bot/src/kalshi-executor.ts` — Delete (we don't use Kalshi)
5. `momentum-bot/src/kalshi-rest.ts` — Delete
6. `momentum-bot/src/risk-manager.ts` — Replace with trade-manager.ts

---

## ENVIRONMENT VARIABLES TO ADD

```env
# Orchestrator
BANKROLL=400
MIN_EDGE=0.10
MAX_POSITION_PCT=0.25
MAX_OPEN_POSITIONS=1
KELLY_FRACTION=0.5

# ESPN
ESPN_POLL_INTERVAL_MS=10000
ENABLED_SPORTS=nba,nfl

# Exit Rules
EXIT_TARGET_PRICE=0.92
EXIT_STALL_MINUTES=5
EXIT_REVERSAL_CENTS=10
EXIT_TIMEOUT_HOURS=24

# Polymarket Execution
POLY_API_KEY=
POLY_PRIVATE_KEY=

# Keep existing
DRY_RUN=true
GROQ_API_KEY=...
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
```

---

## NPM PACKAGES TO ADD

```bash
npm install @polymarket/clob-client ethers
```

---

## SUCCESS CRITERIA

v1 is done when:
1. Dashboard shows live sports markets with ESPN scores embedded in cards
2. Each card shows: live score, model probability vs market price, edge, active skill
3. The AI brain page shows which market it's focusing on and why
4. In DRY_RUN mode, the bot logs "Would buy $X of [market] at [price], edge [Y]%"
5. The skill architecture exists so we can plug in News skill for v2
6. ESPN polling detects score changes within 10 seconds
7. Win probability model produces reasonable estimates (test: when a team leads by 10 in Q4 of NBA, model should say >80%)
