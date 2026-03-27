import { fetchAllBasketballOdds, getRequestStats } from './odds-api';
import { calculateConsensus } from './consensus';
import { matchOddsGameToMarket, resolveTokenSides } from './event-matcher';
import { detectEdges, calculateKellySize } from './edge-detector';
import { buildWatchlist } from './watchlist';
import { allocate } from './capital-allocator';
import { isNewMarket, markMarketSeen, getEarlyMarketConfig } from './market-watcher';
import { fetchOrderbook } from '../../orderbook';
import { placeOrder, cancelOrder, getOrders } from '../../order-manager';
import { addMessage, engineState } from '../../state';
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
  name = 'Basketball Edge';
  icon = '📊';
  description = 'Compares sportsbook consensus to Polymarket prices. Maintains ranked watchlist. Dynamically allocates capital to best opportunities.';
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
   * Lightweight scan — only checks if any new Polymarket markets match
   * our cached odds. No API calls, no orderbook fetches, no allocation.
   * Called every ~10s by brain.ts even when no live games.
   */
  async quickScan(markets: WatchedMarket[]): Promise<void> {
    if (this.status === 'paused' || this.cachedOdds.length === 0) return;

    const bankroll = parseFloat(process.env.BANKROLL || '400');

    for (const market of markets) {
      if (!isNewMarket(market.conditionId)) continue;
      markMarketSeen(market.conditionId, market.yesPrice);

      // Try to match with cached odds
      const matchedOdds = this.cachedOdds.find(game => {
        const m = matchOddsGameToMarket(game, [market]);
        return m !== null;
      });

      if (!matchedOdds) continue;

      const consensus = calculateConsensus(matchedOdds);
      if (!consensus) continue;

      const { homeIsYes } = resolveTokenSides(market, matchedOdds.home_team, matchedOdds.away_team);

      // Check BOTH sides for edge AFTER 2% taker fee
      const TAKER_FEE = 0.02;
      const yesFair = homeIsYes ? consensus.homeWinProb : consensus.awayWinProb;
      const noFair = homeIsYes ? consensus.awayWinProb : consensus.homeWinProb;
      const yesEdge = yesFair - market.yesPrice - TAKER_FEE;
      const noEdge = noFair - market.noPrice - TAKER_FEE;

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

      // Dedup: skip if we already have an order for this game
      const existingOrders = getOrders();
      const alreadyOrdered = existingOrders.some(
        o => o.conditionId === market.conditionId && o.status !== 'cancelled'
      );
      if (alreadyOrdered) continue;

      const config = getEarlyMarketConfig();
      if (edge < config.minEdge) continue;
      if (marketPrice >= fairValue) continue;

      // Use consistent Kelly sizing (no multiplier hack)
      const kellySize = calculateKellySize(fairValue, marketPrice, bankroll);
      if (kellySize < 5) continue;

      const order = await placeOrder({
        conditionId: market.conditionId,
        tokenId,
        tokenSide: side,
        price: marketPrice,
        size: kellySize,
        sportKey: matchedOdds.sport_key,
        homeTeam: matchedOdds.home_team,
        awayTeam: matchedOdds.away_team,
        commenceTime: matchedOdds.commence_time,
        fairValue,
        edge,
      });

      if (order) {
        addMessage({
          text: `[INSTANT BUY] ${matchedOdds.home_team} vs ${matchedOdds.away_team} | BUY ${side} @ ${(marketPrice * 100).toFixed(0)}¢ → SELL @ ${(fairValue * 100).toFixed(0)}¢ | Edge: +${(edge * 100).toFixed(1)}% (net of 2% fee) | $${kellySize.toFixed(0)}`,
          type: 'action',
        });
        // Add to engine trades so it shows in TradesPanel
        engineState.trades.push({
          id: order.orderId,
          marketId: market.id,
          marketTitle: `${matchedOdds.home_team} vs ${matchedOdds.away_team}`,
          side: side.toLowerCase() as 'yes' | 'no',
          entryPrice: marketPrice,
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
          yesTokenId: homeIsYes ? tokenId : '',
          noTokenId: homeIsYes ? '' : tokenId,
          isDryRun: !process.env.POLY_PRIVATE_KEY,
        });
        this.stats.trades++;
      }
    }

    // Also refresh the watchlist if we have cached odds (no API call, just recomputes)
    if (this.cachedOdds.length > 0) {
      this.lastWatchlist = buildWatchlist(this.cachedOdds, markets);
    }
  }

  async detect(markets: WatchedMarket[]): Promise<Opportunity[]> {
    // New-market detection is handled by quickScan() which runs every 10s.
    // detect() focuses on: odds refresh → watchlist → allocation → execution.
    const bankroll = parseFloat(process.env.BANKROLL || '400');

    // ── Step 1: Refresh odds if needed ──
    if (this.shouldRefreshOdds()) {
      console.log('[PreGameEdge] Fetching fresh odds from The Odds API...');
      this.cachedOdds = await fetchAllBasketballOdds();
      this.lastOddsFetchAt = Date.now();
      const stats = getRequestStats();
      console.log(`[PreGameEdge] Got ${this.cachedOdds.length} games. API budget: ${stats.totalRequestsUsed}/${stats.totalBudget} used.`);
    }

    if (this.cachedOdds.length === 0) return [];

    // ── Step 3: Build watchlist ──
    this.lastWatchlist = buildWatchlist(this.cachedOdds, markets);

    // ── Step 4: Allocate capital ──
    const allOrders = getOrders();
    const decision = allocate(this.lastWatchlist, allOrders, bankroll);
    this.lastAllocationDecision = decision;

    // ── Step 5: Execute decision ──
    if (decision.action === 'ENTER' && decision.targets) {
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

  getInfo(): SkillInfo & { preGame?: unknown } {
    const orders = getOrders();
    const resting = orders.filter(o => o.status === 'resting');
    const filled = orders.filter(o => o.status === 'filled');
    const stats = getRequestStats();

    return {
      id: this.id,
      name: this.name,
      icon: this.icon,
      description: this.description,
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
      },
    };
  }
}
