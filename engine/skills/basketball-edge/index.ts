import { fetchAllBasketballOdds, getRequestStats } from './odds-api';
import { calculateConsensus } from './consensus';
import { matchOddsGameToMarket, resolveTokenSides } from './event-matcher';
import { detectEdges, calculateKellySize } from './edge-detector';
import { buildWatchlist } from './watchlist';
import { allocate } from './capital-allocator';
import { isNewMarket, markMarketSeen, getEarlyMarketConfig } from './market-watcher';
import { fetchOrderbook } from '../../orderbook';
import { placeOrder, cancelOrder, getOrders } from '../../order-manager';
import { addMessage } from '../../state';
import type { WatchedMarket, Opportunity, Skill, SkillInfo, SkillStats } from '@/lib/types';
import { OddsAPIGame, PreGameEdge, WatchlistEntry, AllocationDecision } from './types';
import { appendFileSync, mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';

const SIGNAL_LOG = 'data/pregame_signals.jsonl';

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
      const fairValue = homeIsYes ? consensus.homeWinProb : consensus.awayWinProb;
      const marketPrice = homeIsYes ? market.yesPrice : market.noPrice;
      const edge = fairValue - marketPrice;

      const config = getEarlyMarketConfig();
      if (edge < config.minEdge) continue;

      const targetPrice = marketPrice + 0.03;
      const kellySize = calculateKellySize(fairValue, targetPrice, bankroll);
      const adjustedSize = Math.min(kellySize * (config.kellyFraction / 0.25), bankroll * config.maxBetPct);

      if (adjustedSize < 5) continue;

      const tokenId = (homeIsYes ? market.yesTokenId : market.noTokenId) || '';
      const order = await placeOrder({
        conditionId: market.conditionId,
        tokenId,
        price: targetPrice,
        size: adjustedSize,
        sportKey: matchedOdds.sport_key,
        homeTeam: matchedOdds.home_team,
        awayTeam: matchedOdds.away_team,
        commenceTime: matchedOdds.commence_time,
        fairValue,
        edge,
      });

      if (order) {
        addMessage({
          text: `[INSTANT ENTRY] NEW MARKET: ${matchedOdds.home_team} vs ${matchedOdds.away_team} | Consensus: ${(fairValue * 100).toFixed(0)}% | Poly: ${(marketPrice * 100).toFixed(0)}c | EDGE: +${(edge * 100).toFixed(0)}% | BUY @ ${targetPrice} ($${adjustedSize.toFixed(0)})`,
          type: 'action',
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
    // ── Step 1: Check for NEW markets (Gamma is free, always check) ──
    const bankroll = parseFloat(process.env.BANKROLL || '400');

    for (const market of markets) {
      if (isNewMarket(market.conditionId)) {
        markMarketSeen(market.conditionId, market.yesPrice);

        // Try to match with cached odds
        const matchedOdds = this.cachedOdds.find(game => {
          const m = matchOddsGameToMarket(game, [market]);
          return m !== null;
        });

        if (matchedOdds) {
          const consensus = calculateConsensus(matchedOdds);
          if (consensus) {
            const { homeIsYes } = resolveTokenSides(market, matchedOdds.home_team, matchedOdds.away_team);
            const fairValue = homeIsYes ? consensus.homeWinProb : consensus.awayWinProb;
            const marketPrice = homeIsYes ? market.yesPrice : market.noPrice;
            const edge = fairValue - marketPrice;

            const config = getEarlyMarketConfig();

            if (edge >= config.minEdge) {
              // FAT EARLY EDGE
              const targetPrice = marketPrice + 0.03;
              const kellySize = calculateKellySize(fairValue, targetPrice, bankroll);
              const adjustedSize = Math.min(kellySize * (config.kellyFraction / 0.25), bankroll * config.maxBetPct);

              if (adjustedSize >= 5) {
                const tokenId = (homeIsYes ? market.yesTokenId : market.noTokenId) || '';
                const order = await placeOrder({
                  conditionId: market.conditionId,
                  tokenId,
                  price: targetPrice,
                  size: adjustedSize,
                  sportKey: matchedOdds.sport_key,
                  homeTeam: matchedOdds.home_team,
                  awayTeam: matchedOdds.away_team,
                  commenceTime: matchedOdds.commence_time,
                  fairValue,
                  edge,
                });

                if (order) {
                  addMessage({
                    text: `[EARLY ENTRY] NEW MARKET: ${matchedOdds.home_team} vs ${matchedOdds.away_team} | Consensus: ${(fairValue * 100).toFixed(0)}% | Poly: ${(marketPrice * 100).toFixed(0)}c | EDGE: +${(edge * 100).toFixed(0)}% | BUY @ ${targetPrice} ($${adjustedSize.toFixed(0)})`,
                    type: 'action',
                  });
                  this.stats.trades++;
                }
              }
            }
          }
        }
      }
    }

    // ── Step 2: Refresh odds if needed ──
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
          price: target.entryPrice,
          size: target.kellySize,
          sportKey: this.lastWatchlist.find(w => w.conditionId === target.conditionId)?.sportKey || '',
          homeTeam: target.game.split(' vs ')[0],
          awayTeam: target.game.split(' vs ')[1],
          commenceTime: this.lastWatchlist.find(w => w.conditionId === target.conditionId)?.commenceTime || '',
          fairValue: target.fairValue,
          edge: target.ev,
        });

        if (order) {
          addMessage({
            text: `[PRE-GAME][ENTER] ${target.game} | Consensus: ${(target.fairValue * 100).toFixed(1)}% | Poly: ${(target.entryPrice * 100).toFixed(0)}c | EV: +${(target.ev * 100).toFixed(1)}% | BUY ${target.side} @ ${target.entryPrice} ($${target.kellySize.toFixed(0)})`,
            type: 'action',
          });
          this.stats.trades++;
        }
      }
    } else if (decision.action === 'SWITCH' && decision.targets && decision.currentPosition) {
      // Exit current position (market sell to reduce complexity in V1)
      addMessage({
        text: `[PRE-GAME][EXIT] ${decision.currentPosition.game} | Better opportunity available (net benefit: +${(decision.netBenefit! * 100).toFixed(1)}c)`,
        type: 'warning',
      });

      // Enter new position
      for (const target of decision.targets) {
        const order = await placeOrder({
          conditionId: target.conditionId,
          tokenId: target.tokenId,
          price: target.entryPrice,
          size: target.kellySize,
          sportKey: this.lastWatchlist.find(w => w.conditionId === target.conditionId)?.sportKey || '',
          homeTeam: target.game.split(' vs ')[0],
          awayTeam: target.game.split(' vs ')[1],
          commenceTime: this.lastWatchlist.find(w => w.conditionId === target.conditionId)?.commenceTime || '',
          fairValue: target.fairValue,
          edge: target.ev,
        });

        if (order) {
          addMessage({
            text: `[PRE-GAME][SWITCH] ${target.game} | New opportunity: EV +${(target.ev * 100).toFixed(1)}% | BUY ${target.side} @ ${target.entryPrice} ($${target.kellySize.toFixed(0)})`,
            type: 'action',
          });
          this.stats.trades++;
        }
      }
    }

    // ── Step 6: Cancel orders for games about to start ──
    for (const order of allOrders) {
      if (order.status !== 'resting') continue;

      const minsUntilGame = (new Date(order.commenceTime).getTime() - Date.now()) / 60000;
      if (minsUntilGame < 5) {
        await cancelOrder(order.orderId);
        addMessage({
          text: `[PRE-GAME] Cancelled unfilled order: ${order.homeTeam} vs ${order.awayTeam} (game starting)`,
          type: 'info',
        });
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
        totalDeployed: resting.reduce((s, o) => s + o.size, 0),
        apiRequestsUsed: stats.totalRequestsUsed,
        apiRequestsBudget: stats.totalBudget,
        lastScanAt: this.lastOddsFetchAt ? new Date(this.lastOddsFetchAt).toISOString() : null,
        cachedGames: this.cachedOdds.length,
      },
    };
  }
}
