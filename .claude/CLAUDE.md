# OnePercent — AI Orchestrated Prediction Market Momentum Trader

## MANDATORY: Read these files before ANY work
1. `PROJECT_CONTEXT.md` — Full decision history, rejected strategies (and WHY), architecture, gotchas
2. `CLAUDE_CODE_V1_PROMPT.md` — Detailed v1 build instructions with file-by-file specs

## Quick Rules
- DO NOT suggest strategies listed as "REJECTED" in PROJECT_CONTEXT.md
- DO NOT rewrite `src/polymarket-clob.ts` — it's battle-tested and working
- Start with DRY_RUN=true — validate edge detection before live trading
- All $400 capital goes to the SINGLE best opportunity at any moment
- v1 = Sports Oracle (ESPN broadcast lag). v2 = News Hunter (Grok). v3 = Full Brain.
- ESPN API is free, no auth, no rate limit. Endpoints in PROJECT_CONTEXT.md.
- Polymarket prices are 0-1 scale (0.65 = 65 cents = 65% implied probability)
- `clobTokenIds` from Gamma API can be JSON string OR array — always handle both
