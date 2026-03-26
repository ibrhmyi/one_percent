import type { Skill, WatchedMarket, Opportunity, ESPNGame } from '@/lib/types';
import { fetchNBAScoreboard, getLiveGames, getUpcomingGames, fetchPlayByPlay } from './espn-api';
import type { ESPNPlay } from './espn-api';
import { calcPolymarketFee } from './win-probability';
import { matchGameToMarket } from './market-matcher';
import { addMessage, engineState, addCycleLog } from '@/engine/state';
import { logScoreEvent, logPriceSnapshot, logFoulEvent, scheduleReactionSnapshots } from '@/engine/data-logger';

/**
 * SCORE-REACTIVE STRATEGY
 *
 * When ESPN reports Team A scored → BUY Team A's token.
 * No model needed. The edge is SPEED: we see the score before the market adjusts.
 *
 * Profit comes from DIVERGENCE: close games with little time left have
 * massive price swings per basket. A 2-point basket when tied with 1 min left
 * moves the token price ~28%. That's the trade.
 *
 * ENTRY: Taker order (speed matters — buy instantly)
 * EXIT:  Maker order (place limit sell at target, let market come to us, 0% fee)
 */
export class NBALiveEdge implements Skill {
  id = 'nba-live-edge';
  name = 'NBA Score Reactive';
  icon = '🏀';
  description = 'Watches ESPN for scoring events. When a team scores, buys their token before the market adjusts. Focuses on close Q4 games where each basket causes 5-30% price swings.';
  category = 'NBA';
  status: 'active' | 'idle' | 'error' | 'paused' = 'active';
  pollIntervalMs = 1000;
  stats = { trades: 0, wins: 0, losses: 0, totalPnl: 0 };

  private lastNarrationTime = 0;
  private readonly narrationCooldownMs = 10000;

  // Track previous scores to detect scoring events
  private prevScores: Map<string, { home: number; away: number; clock: string }> = new Map();

  // Foul detection: track when we last checked each game + which plays we've processed
  private lastFoulCheckAt: Map<string, number> = new Map();
  private seenPlayIds: Set<string> = new Set();

  /**
   * INFORMATION VALUE of a scoring event.
   *
   * Uses the ACTUAL Polymarket contract price as the baseline probability.
   * The market price already encodes team quality, home court, injuries — everything.
   *
   * Calibrated from real Polymarket + ESPN data (3 games, 22 data points)
   * K=1.15, TS=0.38 (fit to DEN@PHX, ORL@CLE, NO@NYK March 24 2026)
   */
  private calculateInformationValue(marketPrice: number, secondsRemaining: number): {
    informationValue: number;
    tradingCost: number;
    netProfit: number;
    fairPriceAfter: number;
    sizing: number;
    tradeable: boolean;
  } {
    const secs = Math.max(secondsRemaining, 10);
    const K = 1.15, TS = 0.38;

    const p = Math.max(0.02, Math.min(0.98, marketPrice));

    // Reverse-engineer implied lead from the market price
    const impliedLead = -TS * Math.sqrt(secs) * Math.log(1 / p - 1) / K;

    // After +2 basket by the scoring team
    const newLead = impliedLead + 2;
    const z = -K * newLead / (TS * Math.sqrt(secs));
    const fairPriceAfter = 1.0 / (1.0 + Math.exp(Math.max(-10, Math.min(10, z))));

    const informationValue = Math.abs(fairPriceAfter - p);

    // Trading cost = entry taker fee + exit taker fee
    const entryFee = calcPolymarketFee(p);
    const exitFee = calcPolymarketFee(Math.min(0.98, p + informationValue));
    const tradingCost = entryFee + exitFee;
    const netProfit = informationValue - tradingCost;

    // Minimum net profit threshold: 2% (covers slippage + execution risk)
    const tradeable = netProfit >= 0.02;

    // Sizing: proportional to net profit — 2% net → 20% bankroll, 10%+ → 100%
    const sizing = tradeable ? Math.min(netProfit / 0.10, 1.0) : 0;

    return { informationValue, tradingCost, netProfit, fairPriceAfter, sizing, tradeable };
  }

  /**
   * Foul detection — runs every 2s per live game (non-blocking, fire-and-forget).
   * Fetches ESPN play-by-play, finds new foul/free throw plays, logs them,
   * and alerts on crunch-time fouls (Q4, <5min, within 6 points).
   */
  private async checkForFouls(game: ESPNGame, market: WatchedMarket, secsLeft: number): Promise<void> {
    const now = Date.now();
    const lastCheck = this.lastFoulCheckAt.get(game.id) ?? 0;
    if (now - lastCheck < 2000) return; // throttle to 2s
    this.lastFoulCheckAt.set(game.id, now);

    let plays: ESPNPlay[];
    try {
      plays = await fetchPlayByPlay(game.id);
    } catch {
      return;
    }

    for (const play of plays) {
      if (!play.id || this.seenPlayIds.has(play.id)) continue;
      this.seenPlayIds.add(play.id);

      const isCrunchTime = game.period >= 4 && secsLeft <= 300 && Math.abs(game.homeScore - game.awayScore) <= 6;
      const marketId = market.id;
      const marketSlug = market.slug;

      logFoulEvent({
        timestamp: new Date().toISOString(),
        gameId: game.id,
        game: `${game.awayTeam} @ ${game.homeTeam}`,
        playId: play.id,
        type: play.type,
        description: play.description,
        teamId: play.teamId,
        period: game.period,
        clock: game.clock,
        secsLeft,
        homeScore: game.homeScore,
        awayScore: game.awayScore,
        yesPrice: market.yesPrice,
        noPrice: market.noPrice,
        isCrunchTime
      });

      scheduleReactionSnapshots(
        {
          gameId: game.id,
          game: `${game.awayTeam} @ ${game.homeTeam}`,
          trigger: 'foul',
          period: game.period,
          clock: game.clock,
          secsLeft,
          homeScore: game.homeScore,
          awayScore: game.awayScore
        },
        () => {
          const m = engineState.watchedMarkets.find(x => x.id === marketId || x.slug === marketSlug);
          return { yesPrice: m?.yesPrice ?? 0.5, noPrice: m?.noPrice ?? 0.5 };
        }
      );

      if (isCrunchTime) {
        addMessage({
          text: `⚠️ CRUNCH FOUL: ${play.description} | Q${game.period} ${game.clock} | ${game.awayTeam} ${game.awayScore}–${game.homeScore} ${game.homeTeam}`,
          type: 'warning'
        });
      }
    }
  }

  async detect(markets: WatchedMarket[]): Promise<Opportunity[]> {
    if (markets.length === 0) return [];

    const allGames = await fetchNBAScoreboard();
    const liveGames = getLiveGames(allGames);
    const upcomingGames = getUpcomingGames(allGames);

    // Only update status if not paused (user toggle takes priority)
    if (this.status !== 'paused') {
      this.status = liveGames.length > 0 ? 'active' : 'idle';
    }

    const now = Date.now();
    if (now - this.lastNarrationTime > this.narrationCooldownMs) {
      if (liveGames.length > 0) {
        // Find the best game to focus on — highest information value per basket
        let bestGame: ESPNGame | null = null;
        let bestDivergence = 0;

        for (const game of liveGames) {
          const market = matchGameToMarket(game, markets);
          const mktPrice = market ? market.yesPrice : 0.5;
          const info = this.calculateInformationValue(mktPrice, game.secondsRemaining);
          if (info.netProfit > bestDivergence) {
            bestDivergence = info.netProfit;
            bestGame = game;
          }
        }

        if (bestGame) {
          const bestMarket = matchGameToMarket(bestGame, markets);
          const mktPrice = bestMarket ? bestMarket.yesPrice : 0.5;
          const info = this.calculateInformationValue(mktPrice, bestGame.secondsRemaining);

          addMessage({
            text: `🏀 ${liveGames.length} live | FOCUS: ${bestGame.awayTeam} @ ${bestGame.homeTeam} (${bestGame.awayScore}-${bestGame.homeScore} Q${bestGame.period} ${bestGame.clock}) — Market: ${(mktPrice * 100).toFixed(0)}¢ | Info value/basket: ${(info.informationValue * 100).toFixed(1)}% | Net: ${(info.netProfit * 100).toFixed(1)}% | ${info.tradeable ? 'TRADEABLE' : 'watching'}`,
            type: info.tradeable ? 'action' : 'info'
          });
        } else {
          addMessage({
            text: `🏀 ${liveGames.length} live games, no close Q4 games yet — watching...`,
            type: 'idle'
          });
        }
      } else if (upcomingGames.length > 0) {
        const next = upcomingGames[0];
        const startTime = next.scheduledStart
          ? new Date(next.scheduledStart).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
          : 'TBD';
        addMessage({ text: `⏳ Next: ${next.awayTeam} @ ${next.homeTeam} at ${startTime}`, type: 'idle' });
      }
      this.lastNarrationTime = now;
    }

    if (liveGames.length === 0) return [];

    const opportunities: Opportunity[] = [];

    for (const game of liveGames) {
      const market = matchGameToMarket(game, markets);
      if (!market) continue;

      const secondsRemaining = game.secondsRemaining;

      // Check for SCORING EVENT
      const prev = this.prevScores.get(game.id);

      let scoringTeam: 'home' | 'away' | null = null;
      let pointsScored = 0;

      if (prev) {
        const homeDiff = game.homeScore - prev.home;
        const awayDiff = game.awayScore - prev.away;

        if (homeDiff > 0 && awayDiff === 0) {
          scoringTeam = 'home';
          pointsScored = homeDiff;
        } else if (awayDiff > 0 && homeDiff === 0) {
          scoringTeam = 'away';
          pointsScored = awayDiff;
        }
        // Both scored (rare, between polls) — skip
      }

      // Update stored score
      this.prevScores.set(game.id, {
        home: game.homeScore,
        away: game.awayScore,
        clock: game.clock
      });

      // The scoring team's current token price — this is what we'd buy
      // Home team = YES token, Away team = NO token
      const scoringTeamPrice = scoringTeam === 'home' ? market.yesPrice
                             : scoringTeam === 'away' ? market.noPrice
                             : market.yesPrice; // no scoring event — use yes for narration

      const info = this.calculateInformationValue(scoringTeamPrice, secondsRemaining);

      // Log cycle on every scoring event
      if (scoringTeam) {
        addCycleLog({
          timestamp: new Date().toISOString(),
          gameId: game.id,
          homeTeam: game.homeTeam,
          awayTeam: game.awayTeam,
          homeScore: game.homeScore,
          awayScore: game.awayScore,
          period: `Q${game.period}`,
          clock: game.clock,
          secondsRemaining,
          modelProbability: info.fairPriceAfter,
          marketPrice: scoringTeamPrice,
          edge: info.netProfit,
          ev: info.netProfit,
          fee: info.tradingCost,
          kellySize: info.sizing,
          action: 'enter',
          reason: `${scoringTeam === 'home' ? game.homeTeam : game.awayTeam} scored +${pointsScored} | Price: ${(scoringTeamPrice * 100).toFixed(1)}¢ → Fair: ${(info.fairPriceAfter * 100).toFixed(1)}¢ | InfoValue: ${(info.informationValue * 100).toFixed(1)}%`
        });

        // Log the scoring event to disk (price at t=0)
        logScoreEvent({
          timestamp: new Date().toISOString(),
          gameId: game.id,
          game: `${game.awayTeam} @ ${game.homeTeam}`,
          scoringTeam: scoringTeam === 'home' ? game.homeTeam : game.awayTeam,
          points: pointsScored,
          homeScore: game.homeScore,
          awayScore: game.awayScore,
          period: game.period,
          clock: game.clock,
          secsLeft: secondsRemaining,
          scoringTeamPrice,
          yesPrice: market.yesPrice,
          noPrice: market.noPrice,
          informationValue: info.informationValue,
          fairPriceAfter: info.fairPriceAfter,
          tradingCost: info.tradingCost,
          netProfit: info.netProfit,
          tradeable: info.tradeable,
          sizing: info.sizing
        });

        // Log t=0 price snapshot and schedule +5/10/20/30/40s reactions
        logPriceSnapshot({
          timestamp: new Date().toISOString(),
          gameId: game.id,
          game: `${game.awayTeam} @ ${game.homeTeam}`,
          yesPrice: market.yesPrice,
          noPrice: market.noPrice,
          homeScore: game.homeScore,
          awayScore: game.awayScore,
          period: game.period,
          clock: game.clock,
          secsLeft: secondsRemaining,
          trigger: 'score',
          offsetMs: 0
        });

        const capturedId = market.id;
        const capturedSlug = market.slug;
        scheduleReactionSnapshots(
          {
            gameId: game.id,
            game: `${game.awayTeam} @ ${game.homeTeam}`,
            trigger: 'score',
            period: game.period,
            clock: game.clock,
            secsLeft: secondsRemaining,
            homeScore: game.homeScore,
            awayScore: game.awayScore
          },
          () => {
            const m = engineState.watchedMarkets.find(x => x.id === capturedId || x.slug === capturedSlug);
            return { yesPrice: m?.yesPrice ?? 0.5, noPrice: m?.noPrice ?? 0.5 };
          }
        );
      }

      // Foul detection — fire and forget, throttled to 2s per game
      this.checkForFouls(game, market, secondsRemaining).catch(() => {});

      // NO SCORING EVENT? Skip opportunity generation.
      if (!scoringTeam) continue;

      // SCORING EVENT DETECTED — but is the information valuable enough to trade?
      if (!info.tradeable) {
        addMessage({
          text: `⚪ ${scoringTeam === 'home' ? game.homeTeam : game.awayTeam} scored +${pointsScored} — price ${(scoringTeamPrice * 100).toFixed(0)}¢, info value ${(info.informationValue * 100).toFixed(1)}%, net ${(info.netProfit * 100).toFixed(1)}% (need ≥2%). Skipping.`,
          type: 'info'
        });
        continue;
      }

      // TRADEABLE SCORING EVENT
      const side: 'yes' | 'no' = scoringTeam === 'home' ? 'yes' : 'no';
      const tokenId = side === 'yes' ? market.yesTokenId : market.noTokenId;

      addMessage({
        text: `🎯 ${scoringTeam === 'home' ? game.homeTeam : game.awayTeam} SCORED +${pointsScored}! ` +
          `${game.awayTeam} @ ${game.homeTeam} (${game.awayScore}-${game.homeScore} Q${game.period} ${game.clock}) | ` +
          `BUY ${side.toUpperCase()} @ ${(scoringTeamPrice * 100).toFixed(1)}¢ → fair ${(info.fairPriceAfter * 100).toFixed(1)}¢ | ` +
          `Info value: ${(info.informationValue * 100).toFixed(1)}% | Net: ${(info.netProfit * 100).toFixed(1)}% | ` +
          `Sizing: ${(info.sizing * 100).toFixed(0)}%`,
        type: 'action'
      });

      opportunities.push({
        marketId: market.id,
        tokenId,
        title: market.title,
        side,
        modelProbability: Math.min(0.98, info.fairPriceAfter),
        marketPrice: scoringTeamPrice,
        edge: info.netProfit,
        ev: info.netProfit,
        fee: info.tradingCost,
        confidence: info.sizing,
        skillId: this.id,
        gameData: {
          homeTeam: game.homeTeam,
          awayTeam: game.awayTeam,
          homeScore: game.homeScore,
          awayScore: game.awayScore,
          period: `Q${game.period}`,
          clock: game.clock,
          secondsRemaining,
          league: 'NBA'
        }
      });
    }

    return opportunities;
  }
}
