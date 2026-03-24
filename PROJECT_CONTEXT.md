# OnePercent (1%) — Full Project Context & Decision History

> This document captures the complete evolution of the OnePercent project across all sessions.
> Claude Code should read this before making any architectural decisions.
> Last updated: March 24, 2026

---

## WHAT IS ONEPERCENT

OnePercent (1%) is an **AI-powered momentum trading platform for Polymarket**. It's a skill-based AI orchestrator that watches all live Polymarket markets, identifies which ones are about to make a drastic move, then deploys the right "skill" (detection engine) to catch that momentum faster than anyone else.

**Platform:** Polymarket (chosen over Kalshi — see Platform Decision below)
**Starting capital:** $400
**Founder:** İbrahim Yıldız
**Origin:** Built initially as a hackathon project (Rishi Hackathon) — a web dashboard scanning near-resolution Polymarket markets. Now building into a full autonomous trading platform.

---

## PLATFORM ARCHITECTURE: AI BRAIN + PLUGGABLE SKILLS

```
┌─────────────────────────────────────────────────────┐
│                    1% PLATFORM                       │
│                                                      │
│  ┌─────────────────────────────────────────────┐    │
│  │         DASHBOARD (Next.js UI)               │    │
│  │  Live markets • AI decisions • Trade log     │    │
│  └─────────────────────────────────────────────┘    │
│                                                      │
│  ┌─────────────────────────────────────────────┐    │
│  │         AI ORCHESTRATOR (brain)              │    │
│  │  Sees ALL markets → classifies each one →    │    │
│  │  predicts which will move → picks best →     │    │
│  │  deploys the right skill → trades            │    │
│  └────┬────────┬────────┬────────┬─────────────┘    │
│       │        │        │        │                   │
│  ┌────▼───┐┌───▼───┐┌───▼───┐┌──▼────┐             │
│  │ Sports ││ News  ││Crypto ││Politi │  ← Skills    │
│  │ ESPN   ││ Grok  ││Binance││Twitter│  (pluggable) │
│  └────────┘└───────┘└───────┘└───────┘              │
│                                                      │
│  ┌─────────────────────────────────────────────┐    │
│  │         EXECUTION ENGINE                     │    │
│  │  Polymarket CLOB • Position mgmt • Exits     │    │
│  └─────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

The AI brain does two things:
1. **PRIORITIZE** — Which market is about to make a drastic move? Focus $400 there.
2. **SKILL SELECT** — For that market, which skill/engine detects the momentum fastest?

Skills are modular. Each one has its own data source, detection logic, and edge model. You keep adding skills over time — the platform stays the same.

---

## PLATFORM DECISION: POLYMARKET (NOT KALSHI)

Decided March 24, 2026 after fee research. Reasons:

1. **Lower fees at our price points:** Polymarket dynamic taker fee at 90% prob = ~0.13%. Kalshi at same = ~0.63%. We trade at high probabilities after score changes, so Polymarket is 5x cheaper.
2. **500ms taker delay removed (Feb 18, 2026):** Our taker orders now execute instantly on Polymarket.
3. **We already built the integration:** Working CLOB WebSocket, Gamma API loader, all TypeScript.
4. **Global access:** Polymarket = crypto, anyone can use it. Kalshi = US only.
5. **Dynamic fee formula:** `fee = C × 0.25 × (p × (1-p))^2` — peaks at 0.44% at 50/50, drops to 0.13% at extremes. Our sports edge trades happen at 80-95% probability where fees are minimal.

Note: Polymarket expanded taker fees to sports markets on Feb 18, 2026. Maker fees remain 0% with rebates. Our strategy is TAKER (speed > cost), and the fees at our price points are acceptable.

---

## THE CORE INSIGHT (İbrahim's words)

> "In prediction markets, momentums are one directional. When the news drops in the market, it will go from 80 to 99, or from 20 to 99. Whenever that momentum just starts, hopping in makes sense."

> "For every single market, there must be a different dedicated strategy on catching those momentum drifts. It might be LLM processing, pulling news from a local source, pulling from Twitter, sports APIs, latency tests, checking similar markets. For every market, the fastest way to understand the momentum is different. So what if there is an AI that for every market decides on different strategies to employ?"

> "AI would decide: these markets are coming up, this sports market starts in half an hour and ends in two hours, let's put $400 on the sport market using the sports API. After the sports market is over, it might say the Trump speech is coming soon, the spike is probably going to happen using this model — we can be faster catching this."

---

## STRATEGY EVOLUTION & REJECTED APPROACHES

### REJECTED: AI Probability Mispricing (Session 1-2)
- **What:** Use LLMs to estimate "true" probability, bet against markets that disagree
- **Why rejected by İbrahim:** "oversaturated, a lot of people are doing it anyway"
- **Lesson:** Many teams already do this. No unique edge.

### REJECTED: Crypto Maker with Binance Signals (Session 2)
- **What:** Use Binance crypto price as leading indicator for Polymarket crypto markets, run market-making
- **Why rejected:** "$10-20/month is too low return, no one cares"
- **Lesson:** Need higher returns from $400 capital. Market-making returns are tiny at small scale.

### REJECTED: YES+NO Structural Arbitrage (Session 2)
- **What:** Buy YES on Polymarket + NO on Kalshi when combined price < $1
- **Why rejected:** "practically impossible, that never happens" — spreads are too tight, fees eat the edge
- **Lesson:** Cross-platform arb is theoretically sound but practically nonexistent.

### REJECTED: Whale Copy Trading (Session 2)
- **What:** Follow large Polymarket traders (whales) and copy their positions
- **Why rejected:** "bullshit" — by the time you detect the whale trade, the price has already moved
- **Lesson:** On-chain detection is too slow, and whales use multiple wallets.

### REJECTED: Pure News-to-Trade (Session 2)
- **What:** Monitor news APIs, classify headlines with LLM, trade the affected market
- **Why partially rejected:** "this is what the previous hackathon team built" (TradeMaxxer at https://devpost.com/software/trademaxxer)
- **Lesson:** TradeMaxxer already does this at 500ms latency. Need a different/better approach. However, news monitoring IS part of the v2 plan (combined with Grok).

### REJECTED: Pure Crypto Latency Arbitrage (Session 2)
- **What:** Use Binance WebSocket to front-run Polymarket crypto markets
- **Why rejected:** Dynamic taker fees on Polymarket kill margins. The fee structure eats the small edge.
- **Lesson:** Taker fees on Polymarket are 1-2%, requiring larger price moves to be profitable.

### CURRENT WINNER: AI Orchestrator with Sports Broadcast Lag (Session 2-3)
- **What:** Exploit the 15-45 second delay between live sports data (ESPN API, 0-5s) and TV/streaming broadcast (15-60s delay). Most Polymarket sports traders watch TV.
- **Why accepted:** Proven by $8M bot and $5→$3.7M bot on Polymarket. 15-45 second window is enormous. ESPN API is free with no auth/rate limits.
- **İbrahim's reaction:** "I kinda got interested about the sports bet idea. We can definitely do that because majority of the people trading are watching it from YouTube or from TV."

---

## THE MODEL: THREE-VERSION ARCHITECTURE

### v1 — Sports Oracle (Week 1-2) ← BUILDING NOW
- **Data source:** ESPN hidden API (free, no auth, no rate limit)
- **Edge:** Know sports scores 15-45 seconds before TV viewers trade on Polymarket
- **How it works:**
  1. Poll ESPN every 10s for live game scores
  2. On score change → calculate win probability using logistic model
  3. Compare model probability to Polymarket price
  4. If edge > 10% → place TAKER order
  5. Exit at 92¢, or on reversal/stall/timeout
- **Win probability formulas:**
  - NBA: `P = 1/(1+exp(-0.7 * lead/(0.45*sqrt(seconds_remaining))))`
  - NFL: logistic with 2.5-point possession bonus
  - Soccer: Poisson-based λ = 0.033 * minutes_remaining
  - MLB: logistic with 0.5 runs/inning expected
- **Cost:** $5.30/month (just VPS)
- **ESPN API endpoints:**
  - NBA: `site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard`
  - NFL: `site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard`
  - MLB: `site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard`
  - NHL: `site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard`
  - Soccer: `site.api.espn.com/apis/site/v2/sports/soccer/{league}/scoreboard`

### v2 — News Hunter Skill + Dashboard UI (Week 3-4)
- **New skill:** Grok API (xAI) with native Twitter/X awareness
- **Edge:** Grok has real-time Twitter access built-in. Batch-classify 20 markets every 15s: "Is there breaking news affecting these markets?"
- **Cost:** ~$28.30/month (Grok API credits: $25 free signup + $150/month for data sharing = $175 free credits. Grok 4.1 Fast: $0.20/M input, $0.50/M output → ~$0.000045 per classification call)
- **New skill files:** `skills/news-skill.ts`, `skills/rss-stream.ts`
- **Dashboard:** Next.js web UI showing live markets, AI decisions, active skill, trade log, P&L
- **AI brain upgrade:** Now picks between Sports Skill and News Skill per market

### v3 — Full Brain + More Skills (Week 5-8)
- **New skills:** Crypto Exchange (Binance feed), Politics (RSS + sentiment), Scheduled Events (earnings, speeches)
- **Brain upgrade:** Bayesian learning loop — learns from past trades, adjusts model confidence
- **Platform features:** Skill performance analytics, cross-market correlation detection
- **Cost:** ~$38.30/month

---

## KEY TECHNICAL DETAILS

### Polymarket CLOB WebSocket (WORKING — DO NOT TOUCH)
- URL: `wss://ws-subscriptions-clob.polymarket.com/ws/market`
- Subscribe: `{ assets_ids: [...tokenIds], type: 'market' }`
- Heartbeat: send `PING` every 9 seconds
- Max 180 assets per connection (chunk if more)
- Events: `book` (full snapshot), `price_change` (delta)
- File: `src/polymarket-clob.ts` — battle-tested, auto-reconnects

### Polymarket Gamma API (Market Discovery)
- URL: `https://gamma-api.polymarket.com/markets`
- Returns flat array (not `{ data: [] }`)
- CamelCase fields: `conditionId`, `clobTokenIds`, `outcomePrices`, `liquidityNum`
- `clobTokenIds` can be JSON string or array — always parse both
- `outcomePrices` same — parse both formats
- File: `src/market-loader.ts`

### Polymarket Order Execution
- Uses `@polymarket/clob-client` npm package
- Requires EIP-712 typed data signing (ethers.js wallet)
- Chain: Polygon (chain ID 137)
- CLOB REST API: `https://clob.polymarket.com`
- Need: API key + private key (wallet)

### TradeMaxxer (Competitor Reference)
- Hackathon project: https://devpost.com/software/trademaxxer
- Their approach: news API → keyword classification → Polymarket trade
- Their latency: 500ms end-to-end
- Our advantage over them: sports broadcast lag gives 15-45 SECOND window (not ms), and we use dedicated sport-specific models instead of generic news classification

### Volume Spike Claim (CORRECTED)
- I initially claimed "volume spikes happen 1-3 seconds BEFORE price moves — that's free alpha"
- İbrahim questioned this. **Correction:** Academic research (Cont, Kukanov, Stoikov) supports order book imbalance predicting 5-30s ahead on traditional exchanges, but on Polymarket specifically, volume and price move nearly simultaneously when news drops.
- **The real alpha is knowing the NEWS first, not detecting volume first.** Volume detection is a backup confirmation, not the primary edge.

---

## POLYMARKET SPORTS VOLUME (why this works)
- NFL games: $55.3M total volume
- NBA: $5.9M
- FIFA World Cup 2026: upcoming (massive expected volume)
- Total sports: $713M+ across all sports markets
- There's enough liquidity for a $400 bot to find fills easily

---

## UI / DASHBOARD (v2+)

v1 is backend-only (CLI bot, logs to terminal). Starting v2, we add a Next.js dashboard.

### Dashboard Pages:
1. **Live Markets** — All Polymarket markets the AI is watching, with real-time prices streaming via WebSocket. Color-coded by category (sports=green, politics=blue, crypto=orange, etc.)
2. **AI Focus** — Which market the AI currently prioritizes, why (edge calculation shown), which skill is active, countdown to expected move
3. **Trade Log** — Every trade: entry/exit price, P&L, skill used, edge at entry, time held
4. **Skills Panel** — All available skills, their status (active/idle), hit rate, avg return per trade
5. **Portfolio** — Current bankroll, open positions, total P&L, equity curve chart

### Tech Stack (matches hackathon project):
- Next.js 15 (App Router)
- TypeScript
- Tailwind CSS
- Real-time updates via WebSocket or Server-Sent Events
- The bot backend runs as a separate process, dashboard connects via API/WebSocket

### UI Priority:
- v1: No UI, CLI only. Focus on making the trading engine work.
- v2: Basic dashboard — live markets + trade log + P&L
- v3: Full dashboard with skills panel, AI reasoning view, analytics

---

## CAPITAL MANAGEMENT
- **Kelly Criterion:** f* = (p*b - q) / b where p = model probability, b = odds ratio, q = 1-p
- **Half-Kelly:** Use 50% of Kelly for safety (config.kellyFraction = 0.5)
- **Concentration:** All $400 goes to the SINGLE best opportunity at any moment — don't spread thin
- **Max position:** 25% of bankroll ($100) per trade
- **Exit rules:**
  - Target: sell at 92¢
  - Stall: exit if <2¢ movement in 5 minutes
  - Reversal: exit if price drops 10¢ from peak
  - Timeout: exit after 24 hours
  - Game over: exit when game ends

---

## PROJECT FILE STRUCTURE

```
onepercent.markets/
├── README.md                          # Original hackathon readme
├── PROJECT_CONTEXT.md                 # THIS FILE — full history
├── CLAUDE_CODE_V1_PROMPT.md           # Claude Code build instructions for v1
├── OnePercent_v4_Blueprint.docx       # Final blueprint (v1/v2/v3 specs)
├── OnePercent_Momentum_Blueprint_v3.docx  # Superseded (news-triggered)
├── OnePercent_Implementation_Blueprint_v2.docx  # Superseded (AI mispricing)
└── momentum-bot/
    ├── package.json
    ├── tsconfig.json
    ├── .env                           # Create from template in CLAUDE_CODE_V1_PROMPT.md
    └── src/
        ├── index.ts                   # Entry point (REWRITE for v1)
        ├── config.ts                  # Config loader (EXTEND for v1)
        ├── types.ts                   # Type definitions (EXTEND for v1)
        ├── logger.ts                  # Console logger (KEEP)
        ├── polymarket-clob.ts         # CLOB WebSocket (KEEP — WORKING)
        ├── market-loader.ts           # Gamma API loader (REFACTOR for sports)
        ├── market-matcher.ts          # Kalshi matcher (REPLACE with ESPN→Poly)
        ├── momentum-detector.ts       # Velocity detector (KEEP as Layer 3)
        ├── supabase-client.ts         # Signal persistence (KEEP)
        ├── risk-manager.ts            # Old risk logic (DELETE)
        ├── kalshi-executor.ts         # Kalshi orders (DELETE)
        └── kalshi-rest.ts             # Kalshi REST (DELETE)
```

---

## FILES TO CREATE FOR V1

```
src/orchestrator.ts       # The brain — scans games, scores opportunities, allocates capital
src/sports-plugin.ts      # ESPN API polling + score change detection
src/win-probability.ts    # NBA/NFL/Soccer/MLB probability formulas
src/trade-manager.ts      # Position tracking, Half-Kelly sizing, exposure limits
src/polymarket-executor.ts # CLOB order placement (TAKER mode)
src/exit-manager.ts       # Position monitoring, exit triggers
```

---

## GROWTH PROJECTIONS (CONSERVATIVE)
- Month 1: $400 → $680 (70% growth, 2 trades/week at 8% avg return)
- Month 2: $680 → $1,156
- Month 3: $1,156 → $1,965 (+ v2 News Hunter)
- Month 6: ~$10,582

---

## İBRAHIM'S PRIORITIES (in his words)
1. "I only have $400. Make it work with $400."
2. "I want to produce one strategy right now" (v1 first, then expand)
3. "The AI would decide which markets to put money and how to get the momentum"
4. "Let's launch this up too fast"
5. "Do deep deep research and calculations, lay us the formula to start making money"

---

## THINGS THAT DON'T WORK / GOTCHAS DISCOVERED
- `npm global install` fails without custom prefix — use `mkdir -p ~/.npm-global && npm config set prefix ~/.npm-global`
- ESPN API returns different response structures per sport — must handle each sport's JSON shape separately
- Polymarket `clobTokenIds` is sometimes a JSON string, sometimes an array — always parse both
- "Trump" keyword appears in 50+ markets — can't do simple keyword matching for news markets (this is why v1 focuses on sports where team matching is deterministic)
- Kalshi API is public but separate from Polymarket — we're NOT using Kalshi for v1
- The momentum detector (linear regression velocity) fires false positives on thin markets — use minimum liquidity filter ($500)
