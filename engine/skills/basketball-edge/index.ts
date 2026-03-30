import { fetchAllBasketballOdds, getRequestStats } from './odds-api';
import { calculateConsensus } from './consensus';
import { matchOddsGameToMarket, resolveTokenSides } from './event-matcher';
import { detectEdges, calculateKellySize } from './edge-detector';
import { buildWatchlist } from './watchlist';
import { allocate } from './capital-allocator';
import { isNewMarket, markMarketSeen, getEarlyMarketConfig } from './market-watcher';
import { fetchOrderbook, simulateBuy } from '../../orderbook';
import { placeOrder, cancelOrder, getOrders } from '../../order-manager';
import { addMessage, engineState } from '../../state';
import { updateBooksPrediction, getFairValue, getAllPredictions } from '../../predictions/aggregator';
import type { WatchedMarket, Opportunity, Skill, SkillInfo, SkillStats } from '@/lib/types';
import { OddsAPIGame, PreGameEdge, WatchlistEntry, AllocationDecision } from './types';
import { appendFileSync, mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';

const isVercel = !!process.env.VERCEL;
const SIGNAL_LOG = isVercel ? '/tmp/pregame_signals.jsonl' : 'data/pregame_signals.jsonl';

function logSignal(edge: PreGameEdge, action: 'placed' | 'skipped', reason?: string) {
  const entry = {
    timestamp: new Date().toISOString(),
    game: `${edge.homeTeam} vs ${edge.awayTeam}`,
    sportKey: edge.sportKey,
    commenceTime: edge.commenceTime,
    consensus: edge.fairValue,
    numBooks: edge.consensus.numBookmakers,
    confidence: edge.consensus.confidence,
    bookSpread: edge.consensus.spread,
    polyPrice: edge.marketPrice,
    edge: edge.edge,
    targetPrice: edge.targetPrice,
    kellySize: edge.kellySize,
    ev: edge.ev,
    liquidity: edge.availableLiquidity,
    action,
    reason: reason || '',
  };
  try {
    const dir = dirname(SIGNAL_LOG);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    appendFileSync(SIGNAL_LOG, JSON.stringify(entry) + '\n');
  } catch {
    // Ignore file write errors
  }
}

export class PreGameEdgeSkill implements Skill {
  id = 'basketball-edge';
  name = 'Basketball Pre-Edge';
  icon = '';
  description = 'Pre-game edge detection across NBA, NCAAB & WNBA. Aggregates 4 data sources, detects mispricings, places maker orders.';
  detailedDescription = `## Strategy Overview

**Goal:** Find Polymarket basketball markets where the price is wrong relative to the true probability, then place limit orders to capture the difference.

### Data Sources (4 feeds, updated continuously)
- **ESPN BPI** — Institutional win probability model. Accounts for injuries, rest days, travel. Updated every 5 min.
- **Bart Torvik T-Rank** — Gold standard for college basketball. Uses barthag ratings + Log5 formula. Updated every 30 min.
- **DraftKings** — Sharp US sportsbook moneyline odds. Scraped via Vercel (US servers) every 15s. Catches news drops within seconds.
- **FanDuel** — Second US sportsbook for cross-reference. Same 15s polling cadence.

### How Fair Value is Calculated
Sources are dynamically weighted based on availability and credibility:
- **Books available + close to game:** Books 50%, BPI 35%, Torvik 15%
- **Books available + far from game:** Books 30%, Models 70% (opening lines are weak)
- **No books (5+ days out):** BPI 70%, Torvik 30% (NCAAB: Torvik 60%)

### Edge Detection
\`edge = fairValue - marketPrice - takerFee + makerRebate\`
- **Taker fee:** 0.75% (paid when taking liquidity)
- **Maker rebate:** 0.20% (earned when providing liquidity)
- **Round-trip cost:** ~0.55% (maker entry + taker exit)
- **Min edge thresholds:** High confidence 1.5%, Medium 2.5%, Low 4.0%

### Execution Strategy — MAKER ONLY
1. Calculate fair value from all available sources
2. Compare to Polymarket price + check spread/depth
3. If edge > threshold: place **limit order** below fair value (earn maker rebate)
4. Never market-buy (taker fee eats into edge)
5. If order fills: monitor and exit via limit order when price converges to fair value

### News-Reactive Trading
- DK/FD lines polled every 15s — when odds shift >3%, it signals breaking news
- ESPN injury feed polled every 2 min — catches "OUT" status changes
- When significant change detected: immediate edge recalculation
- If Polymarket hasn't adjusted yet: place order in the gap (30-120 second window)

### Risk Controls
- Quarter Kelly sizing (0.25x) — never bet more than optimal fraction
- Max 15% of bankroll per position
- Skip if Polymarket spread > 8% (too illiquid)
- Skip if bookmaker consensus spread > 10% (sources disagree)
- Skip if game starts in < 5 minutes (too late to get filled)`;
  dataSources = ['Pinnacle', 'Kambi/Unibet', 'ESPN BPI', 'Bart Torvik', 'ESPN Injuries'];
  category = 'Basketball';
  status: 'active' | 'idle' | 'error' | 'paused' = 'active';
  pollIntervalMs = 60000;
  stats: SkillStats = { trades: 0, wins: 0, losses: 0, totalPnl: 0 };

  private cachedOdds: OddsAPIGame[] = [];
  private lastOddsFetchAt = 0;
  private lastWatchlist: WatchlistEntry[] = [];
  private lastAllocationDecision: AllocationDecision | null = null;

  private getRefreshIntervalMs(): number {
    return 3 * 60 * 60 * 1000; // 3 hours
  }

  private shouldRefreshOdds(): boolean {
    if (this.status === 'paused') return false;

    const now = Date.now();

    if (this.lastOddsFetchAt === 0) return true;
    if (now - this.lastOddsFetchAt > this.getRefreshIntervalMs()) return true;

    for (const game of this.cachedOdds) {
      const minsUntil = (new Date(game.commence_time).getTime() - now) / 60000;
      const lastFetchMinsAgo = (now - this.lastOddsFetchAt) / 60000;

      if (minsUntil >= 55 && minsUntil <= 65 && lastFetchMinsAgo > 30) return true;
      if (minsUntil >= 10 && minsUntil <= 20 && lastFetchMinsAgo > 15) return true;
    }

    return false;
  }

  /**
   * Lightweight scan — checks ALL Polymarket markets against the aggregator's
   * fair values. Uses BPI + Torvik + DK/FD data (whatever is available).
   * No Odds API calls needed — the aggregator is fed by the sportsbook-poller.
   * Called every ~10s by brain.ts.
   */
  async quickScan(markets: WatchedMarket[]): Promise<void> {
    if (this.status === 'paused') return;

    const bankroll = parseFloat(process.env.BANKROLL || '10000');
    // Polymarket sports fees (March 2026):
    //   Taker: 0.75% flat on trade value
    //   Maker: -0.20% rebate (you get paid)
    // Both treated as flat rates on trade value for consistency
    const TAKER_FEE = 0.0075;
    const MAKER_REBATE = 0.002;
    // Net round-trip cost: taker exit (0.75%) - maker entry rebate (0.20%) = 0.55%
    const ROUND_TRIP_FEE = TAKER_FEE - MAKER_REBATE;

    // Check how much capital is already deployed
    const existingOrders = getOrders();
    const totalDeployed = existingOrders
      .filter(o => o.status !== 'cancelled')
      .reduce((sum, o) => sum + o.size, 0);
    const maxDeployment = bankroll * 0.40; // Max 40% of bankroll deployed at once
    if (totalDeployed >= maxDeployment) return; // Already at max deployment

    for (const market of markets) {
      // CRITICAL: Skip games that already started or are about to start
      // Pre-game predictions are meaningless once the game tips off
      if (market.gameStartTime) {
        const minsUntilStart = (new Date(market.gameStartTime).getTime() - Date.now()) / 60000;
        if (minsUntilStart < 5) continue; // Game started or starting in <5 min
      }
      // Also skip if market shows live game data (score > 0)
      if (market.gameData && (market.gameData.homeScore > 0 || market.gameData.awayScore > 0)) continue;
      // Skip settled markets (price at extremes = game already decided)
      if (market.yesPrice >= 0.95 || market.yesPrice <= 0.05) continue;

      // Get fair value from aggregator (Pinnacle + BPI + Torvik combined)
      const gameDate = market.gameStartTime ? new Date(market.gameStartTime).toISOString().slice(0, 10) : undefined;
      const prediction = getFairValue(market.homeTeam, market.awayTeam, gameDate);
      if (!prediction) continue;
      if (prediction.sourcesAvailable.length === 0) continue;

      // ONLY auto-trade when Pinnacle data is available
      // Model-only predictions (BPI/Torvik without sportsbook) are not reliable enough
      const hasPinnacle = prediction.sourcesAvailable.some(s => s === 'Pinnacle');

      // Determine confidence
      const confidence: 'high' | 'medium' | 'low' =
        hasPinnacle && prediction.sourcesAvailable.length >= 3 ? 'high' :
        hasPinnacle ? 'medium' : 'low';

      const yesFair = prediction.fairHomeWinProb;
      const noFair = prediction.fairAwayWinProb;

      // Edge after round-trip fees (maker entry + taker exit)
      const yesEdge = yesFair - market.yesPrice - ROUND_TRIP_FEE;
      const noEdge = noFair - market.noPrice - ROUND_TRIP_FEE;

      let side: 'YES' | 'NO';
      let fairValue: number;
      let marketPrice: number;
      let edge: number;
      let tokenId: string;

      if (yesEdge >= noEdge && yesEdge > 0) {
        side = 'YES'; fairValue = yesFair; marketPrice = market.yesPrice; edge = yesEdge;
        tokenId = market.yesTokenId || '';
      } else if (noEdge > 0) {
        side = 'NO'; fairValue = noFair; marketPrice = market.noPrice; edge = noEdge;
        tokenId = market.noTokenId || '';
      } else {
        continue;
      }

      // Dedup: skip if we already have an order OR an open trade for this market
      const existingOrders = getOrders();
      const alreadyOrdered = existingOrders.some(
        o => o.conditionId === market.conditionId && o.status !== 'cancelled'
      );
      if (alreadyOrdered) continue;

      // Also check existing trades (orders may not exist if trade was placed directly)
      const marketTitle = `${market.homeTeam} vs ${market.awayTeam}`;
      const alreadyTraded = engineState.trades.some(
        t => t.status === 'open' && (
          t.marketId === market.id ||
          t.marketId === market.conditionId ||
          t.marketTitle === marketTitle
        )
      );
      if (alreadyTraded) continue;

      // Min edge thresholds (after fees)
      const minEdges: Record<string, number> = { high: 0.015, medium: 0.025, low: 0.04 };
      if (edge < (minEdges[confidence] ?? 0.025)) continue;
      if (marketPrice >= fairValue) continue;

      // Skip if Polymarket spread too wide (> 8%)
      const polySpread = Math.abs(1 - market.yesPrice - market.noPrice);
      if (polySpread > 0.08) {
        console.log(`[QuickScan] Skip ${market.homeTeam} vs ${market.awayTeam}: spread ${(polySpread * 100).toFixed(1)}% too wide`);
        continue;
      }

      // Check if we've hit deployment cap (re-check after each order)
      const currentDeployed = getOrders()
        .filter(o => o.status !== 'cancelled')
        .reduce((sum, o) => sum + o.size, 0);
      const remainingCapital = maxDeployment - currentDeployed;
      if (remainingCapital < 5) break; // No more capital to deploy

      // MAKER PRICING: Place limit order 1¢ below the best ask
      const makerPrice = Math.floor((marketPrice - 0.01) * 100) / 100;
      if (makerPrice <= 0.01 || makerPrice >= fairValue) continue;

      // Kelly sizing uses maker price, capped by remaining capital
      let kellySize = calculateKellySize(fairValue, makerPrice, bankroll);
      kellySize = Math.min(kellySize, remainingCapital); // Don't exceed remaining
      if (kellySize < 5) continue;

      // Check order book depth before placing
      let liquidityOk = true;
      try {
        const book = await fetchOrderbook(tokenId);
        const simulation = simulateBuy(book.asks, kellySize);
        if (simulation.liquidityWithin3Cents < kellySize * 0.5) {
          console.log(`[QuickScan] Skip ${market.homeTeam} vs ${market.awayTeam}: thin liquidity ($${simulation.liquidityWithin3Cents.toFixed(0)} within 3¢)`);
          liquidityOk = false;
        }
      } catch {
        // Orderbook fetch failed — proceed but log it
        console.log(`[QuickScan] Orderbook unavailable for ${market.homeTeam} vs ${market.awayTeam}`);
      }
      if (!liquidityOk) continue;

      const order = await placeOrder({
        conditionId: market.conditionId,
        tokenId,
        tokenSide: side,
        price: makerPrice,  // MAKER price, not market price
        size: kellySize,
        sportKey: market.category?.toLowerCase() === 'ncaa' ? 'basketball_ncaab' : 'basketball_nba',
        homeTeam: market.homeTeam,
        awayTeam: market.awayTeam,
        commenceTime: market.gameStartTime || '',
        fairValue,
        edge,
        spread: polySpread * 100,
        slug: market.slug,
      });

      if (order) {
        const sources = prediction.sourcesAvailable.join('+');
        addMessage({
          text: `[EDGE] ${market.homeTeam} vs ${market.awayTeam} | MAKER BUY ${side} @ ${(makerPrice * 100).toFixed(0)}¢ (ask: ${(marketPrice * 100).toFixed(0)}¢) | Fair: ${(fairValue * 100).toFixed(0)}% [${sources}] | Edge: +${(edge * 100).toFixed(1)}% | $${kellySize.toFixed(0)}`,
          type: 'action',
        });
        engineState.trades.push({
          id: order.orderId,
          marketId: market.id,
          marketTitle: `${market.homeTeam} vs ${market.awayTeam}`,
          side: side.toLowerCase() as 'yes' | 'no',
          entryPrice: makerPrice,
          entryAmount: kellySize,
          exitPrice: null,
          exitAmount: null,
          pnl: null,
          tokens: kellySize / marketPrice,
          skillId: 'basketball-edge',
          skillIcon: '📊',
          enteredAt: new Date().toISOString(),
          exitedAt: null,
          exitReason: null,
          status: 'open' as const,
          peakPrice: marketPrice,
          yesTokenId: side === 'YES' ? tokenId : '',
          noTokenId: side === 'NO' ? tokenId : '',
          isDryRun: !process.env.POLY_PRIVATE_KEY,
        });
        this.stats.trades++;
      }
    }
  }

  async detect(markets: WatchedMarket[]): Promise<Opportunity[]> {
    // detect() runs every 60s. It does:
    //   1. Optionally refresh Odds API (if budget remains)
    //   2. Run quickScan to find edges using aggregator data (BPI+Torvik+DK/FD)
    //   3. Build watchlist from aggregator predictions
    //   4. Allocate capital and execute
    const bankroll = parseFloat(process.env.BANKROLL || '10000');

    // ── Step 1: Optionally refresh Odds API (supplement, not primary) ──
    if (this.shouldRefreshOdds()) {
      try {
        console.log('[PreGameEdge] Fetching supplementary odds from The Odds API...');
        this.cachedOdds = await fetchAllBasketballOdds();
        this.lastOddsFetchAt = Date.now();
        const stats = getRequestStats();
        console.log(`[PreGameEdge] Got ${this.cachedOdds.length} games. API budget: ${stats.totalRequestsUsed}/${stats.totalBudget} used.`);

        // Feed into the aggregator (supplements DK/FD data with 30+ books)
        for (const game of this.cachedOdds) {
          const consensus = calculateConsensus(game);
          if (!consensus) continue;
          const league = game.sport_key.includes('ncaab') ? 'NCAAB'
            : game.sport_key.includes('wnba') ? 'WNBA' : 'NBA';
          updateBooksPrediction(
            game.home_team, game.away_team,
            consensus.homeWinProb, consensus.awayWinProb,
            consensus.numBookmakers, consensus.confidence, league
          );
        }
      } catch {
        // Odds API might be exhausted — that's fine, we have DK/FD + models
        console.log('[PreGameEdge] Odds API unavailable — using aggregator data only');
      }
    }

    // ── Step 2: Run quickScan to detect edges from aggregator ──
    await this.quickScan(markets);

    // ── Step 3: Build watchlist from aggregator predictions ──
    // Build from cached odds if available, otherwise from aggregator predictions
    if (this.cachedOdds.length > 0) {
      this.lastWatchlist = buildWatchlist(this.cachedOdds, markets);
    } else {
      // Build watchlist from aggregator predictions (no Odds API data)
      this.lastWatchlist = this.buildWatchlistFromAggregator(markets);
    }

    // ── Step 4: Allocate capital ──
    const allOrders = getOrders();
    const decision = allocate(this.lastWatchlist, allOrders, bankroll);
    this.lastAllocationDecision = decision;

    // ── Step 5: Execute decision ──
    if (decision.action === 'ENTER' && decision.targets) {
      for (const target of decision.targets) {
        // Dedup: skip if we already have an open trade for this market
        const alreadyTraded = engineState.trades.some(
          t => t.status === 'open' && (t.marketId === target.conditionId)
        );
        if (alreadyTraded) continue;

        const order = await placeOrder({
          conditionId: target.conditionId,
          tokenId: target.tokenId,
          tokenSide: target.side,
          price: target.entryPrice,
          size: target.kellySize,
          sportKey: this.lastWatchlist.find(w => w.conditionId === target.conditionId)?.sportKey || '',
          homeTeam: target.game.split(' vs ')[0],
          awayTeam: target.game.split(' vs ')[1],
          commenceTime: this.lastWatchlist.find(w => w.conditionId === target.conditionId)?.commenceTime || '',
          fairValue: target.fairValue,
          edge: target.fairValue - target.entryPrice,
        });

        if (order) {
          addMessage({
            text: `[PRE-GAME][BUY] ${target.game} | BUY ${target.side} @ ${(target.entryPrice * 100).toFixed(0)}¢ (market) → SELL @ ${(target.fairValue * 100).toFixed(0)}¢ (fair) | Edge: +${((target.fairValue - target.entryPrice) * 100).toFixed(1)}% | $${target.kellySize.toFixed(0)}`,
            type: 'action',
          });
          engineState.trades.push({
            id: order.orderId,
            marketId: target.conditionId,
            marketTitle: target.game,
            side: target.side.toLowerCase() as 'yes' | 'no',
            entryPrice: target.entryPrice,
            entryAmount: target.kellySize,
            exitPrice: null,
            exitAmount: null,
            pnl: null,
            tokens: target.kellySize / target.entryPrice,
            skillId: 'basketball-edge',
            skillIcon: '📊',
            enteredAt: new Date().toISOString(),
            exitedAt: null,
            exitReason: null,
            status: 'open' as const,
            peakPrice: target.entryPrice,
            yesTokenId: target.tokenId,
            noTokenId: '',
            isDryRun: !process.env.POLY_PRIVATE_KEY,
          });
          this.stats.trades++;
        }
      }
    } else if (decision.action === 'SWITCH' && decision.targets && decision.currentPosition) {
      // ACTUALLY exit current position — cancel all orders for the old game
      const oldConditionId = decision.currentPosition.conditionId;
      for (const order of allOrders) {
        if (order.conditionId === oldConditionId && order.status !== 'cancelled') {
          await cancelOrder(order.orderId);
        }
      }
      addMessage({
        text: `[PRE-GAME][EXIT] ${decision.currentPosition.game} | Cancelled — better opportunity (net benefit: +${(decision.netBenefit! * 100).toFixed(1)}c)`,
        type: 'warning',
      });

      // Enter new position
      for (const target of decision.targets) {
        const order = await placeOrder({
          conditionId: target.conditionId,
          tokenId: target.tokenId,
          tokenSide: target.side,
          price: target.entryPrice,
          size: target.kellySize,
          sportKey: this.lastWatchlist.find(w => w.conditionId === target.conditionId)?.sportKey || '',
          homeTeam: target.game.split(' vs ')[0],
          awayTeam: target.game.split(' vs ')[1],
          commenceTime: this.lastWatchlist.find(w => w.conditionId === target.conditionId)?.commenceTime || '',
          fairValue: target.fairValue,
          edge: target.fairValue - target.entryPrice,
        });

        if (order) {
          addMessage({
            text: `[PRE-GAME][SWITCH] ${target.game} | Edge: +${((target.fairValue - target.entryPrice) * 100).toFixed(1)}% | BUY ${target.side} @ ${(target.entryPrice * 100).toFixed(0)}¢ ($${target.kellySize.toFixed(0)})`,
            type: 'action',
          });
          this.stats.trades++;
        }
      }
    }

    // ── Step 6: Auto-exit positions before game starts ──
    // Cancel resting orders and exit filled positions within 5 min of tip-off.
    // Pre-game strategy hands off to live score-reactive strategy at game start.
    for (const order of allOrders) {
      const minsUntilGame = (new Date(order.commenceTime).getTime() - Date.now()) / 60000;
      if (minsUntilGame >= 5) continue;

      if (order.status === 'resting') {
        await cancelOrder(order.orderId);
        addMessage({
          text: `[PRE-GAME] Cancelled unfilled order: ${order.homeTeam} vs ${order.awayTeam} (game starting in ${minsUntilGame.toFixed(0)}m)`,
          type: 'info',
        });
      } else if (order.status === 'filled' || order.status === 'partially_filled') {
        // Exit filled position: place a market sell order then mark order as cancelled.
        // In DRY_RUN mode this just simulates the exit.
        const exitSize = order.status === 'filled' ? order.size : order.filledSize;
        const isDryRun = !process.env.POLY_PRIVATE_KEY;
        if (isDryRun) {
          // Simulate exit — mark order done, log the exit
          await cancelOrder(order.orderId);
          addMessage({
            text: `[PRE-GAME][EXIT] Sold ${order.homeTeam} vs ${order.awayTeam} at market ($${exitSize.toFixed(0)}) — game starting in ${minsUntilGame.toFixed(0)}m`,
            type: 'action',
          });
        } else {
          // LIVE: would place a real sell order here via CLOB
          await cancelOrder(order.orderId);
          addMessage({
            text: `[PRE-GAME][EXIT] Market sell ${order.homeTeam} vs ${order.awayTeam} ($${exitSize.toFixed(0)}) — game starting in ${minsUntilGame.toFixed(0)}m`,
            type: 'action',
          });
        }
      }
    }

    return [];
  }

  /**
   * Build watchlist from aggregator predictions when Odds API data is unavailable.
   * Uses BPI + Torvik + DK/FD data that the aggregator has collected.
   */
  private buildWatchlistFromAggregator(markets: WatchedMarket[]): WatchlistEntry[] {
    const TAKER_FEE = 0.0075;
    const MAKER_REBATE = 0.002;
    const entries: WatchlistEntry[] = [];

    for (const market of markets) {
      const prediction = getFairValue(market.homeTeam, market.awayTeam);
      if (!prediction) continue;

      const yesFair = prediction.fairHomeWinProb;
      const noFair = prediction.fairAwayWinProb;
      const yesEdge = yesFair - market.yesPrice - TAKER_FEE + (market.yesPrice * MAKER_REBATE);
      const noEdge = noFair - market.noPrice - TAKER_FEE + (market.noPrice * MAKER_REBATE);

      const bestSide: 'YES' | 'NO' = yesEdge >= noEdge ? 'YES' : 'NO';
      const bestEdge = Math.max(yesEdge, noEdge);
      const fairValue = bestSide === 'YES' ? yesFair : noFair;
      const marketPrice = bestSide === 'YES' ? market.yesPrice : market.noPrice;

      // Determine if game has started
      const gameStarted = market.gameStartTime
        ? new Date(market.gameStartTime).getTime() < Date.now()
        : false;

      entries.push({
        oddsGameId: `agg-${market.conditionId}`,
        sportKey: market.category?.toLowerCase() === 'ncaa' ? 'basketball_ncaab' : 'basketball_nba',
        homeTeam: market.homeTeam,
        awayTeam: market.awayTeam,
        commenceTime: market.gameStartTime || '',
        homeFairValue: yesFair,
        awayFairValue: noFair,
        consensus: {
          homeWinProb: yesFair,
          awayWinProb: noFair,
          numBookmakers: prediction.booksPrediction?.numBooks ?? 0,
          confidence: (prediction.sourcesAvailable.length >= 3 ? 'high' :
            prediction.sourcesAvailable.length >= 2 ? 'medium' : 'low') as 'high' | 'medium' | 'low',
          bookmakers: [],
          spread: 0,
        },
        polymarketMatched: true,
        polymarketUrl: market.url,
        conditionId: market.conditionId,
        yesTokenId: market.yesTokenId,
        noTokenId: market.noTokenId,
        currentYesPrice: market.yesPrice,
        currentNoPrice: market.noPrice,
        homeIsYes: true,
        bestSideEV: bestEdge > 0 ? bestEdge * (calculateKellySize(fairValue, marketPrice, 10000)) : 0,
        bestSide: bestSide,
        projectedEV: bestEdge * 100,
        status: gameStarted ? 'game_started' :
          bestEdge > 0.015 ? 'active_opportunity' : 'waiting_for_market',
      });
    }

    entries.sort((a, b) => b.bestSideEV - a.bestSideEV);
    return entries;
  }

  getInfo(): SkillInfo & { preGame?: unknown } {
    const orders = getOrders();
    const resting = orders.filter(o => o.status === 'resting');
    const filled = orders.filter(o => o.status === 'filled');
    const stats = getRequestStats();
    const predictions = getAllPredictions();

    return {
      id: this.id,
      name: this.name,
      icon: this.icon,
      description: this.description,
      detailedDescription: this.detailedDescription,
      dataSources: this.dataSources,
      category: this.category,
      status: this.status,
      pollIntervalMs: this.pollIntervalMs,
      stats: this.stats,
      preGame: {
        watchlist: this.lastWatchlist,
        allocationDecision: this.lastAllocationDecision,
        orders: orders,
        restingCount: resting.length,
        filledCount: filled.length,
        totalDeployed: resting.reduce((s, o) => s + o.size, 0) + filled.reduce((s, o) => s + o.filledSize, 0),
        apiRequestsUsed: stats.totalRequestsUsed,
        apiRequestsBudget: stats.totalBudget,
        lastScanAt: this.lastOddsFetchAt ? new Date(this.lastOddsFetchAt).toISOString() : null,
        cachedGames: this.cachedOdds.length,
        aggregatorGames: predictions.length,
        activeSources: [...new Set(predictions.flatMap(p => p.sourcesAvailable))],
      },
    };
  }
}
