# OnePercent — AI Trading Platform for Polymarket

## MANDATORY: Read this file before ANY work
**`V1_FRESH_BUILD.md`** — This is THE spec. Complete V1 build instructions including UI layout, AI brain architecture, the NBA Live Edge skill (deep spec), all TypeScript interfaces, file structure, build order, and success criteria.

## Quick Rules
- This is a FRESH BUILD. Delete old hackathon code (momentum-bot/, bot-worker/, old components)
- KEEP: `lib/polymarket.ts` (Gamma API client — it works)
- Start with DRY_RUN=true — validate edge detection before live trading
- All $400 capital goes to the SINGLE best opportunity at any moment
- v1 = Platform + AI Brain + NBA Live Edge skill (ONE skill only)
- ESPN API is free, no auth, no rate limit. Poll every 1 second during live games.
- Polymarket prices are 0-1 scale (0.65 = 65 cents = 65% implied probability)
- `clobTokenIds` from Gamma API can be JSON string OR array — always handle both
- The AI brain does NOT use an LLM for decisions — all logic is hardcoded. "AI" = orchestrator + win probability model
- Engine runs server-side in the Next.js process, frontend polls API every 2 seconds
- Dark theme, modern glassmorphic UI. One page, three tabs.
- NO fixed edge thresholds. Trade when expected value is positive after Polymarket fees. Kelly sizing handles position size automatically.
- Every brain cycle logs data (score, model prob, market price, edge, EV) to data/cycle_logs.json for model calibration.
