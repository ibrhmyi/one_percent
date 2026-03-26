import type { Skill, WatchedMarket, Opportunity, ESPNGame } from '@/lib/types';
import { fetchScoreboard, getLiveGames, getUpcomingGames, fetchPlayByPlay } from './espn-api';
import type { LeagueConfig, LeagueStats, ESPNPlay } from './types';
import { calcPolymarketFee } from './win-probability';
import { matchGameToMarket } from './market-matcher';
import { addMessage, engineState, addCycleLog } from '@/engine/state';
import { logScoreEvent, logPriceSnapshot, logFoulEvent, scheduleReactionSnapshots } from '@/engine/data-logger';
import { NBA_CONFIG } from './leagues/nba';
import { NCAA_CONFIG } from './leagues/ncaa';

/**
 * UNIFIED BASKETBALL SKILL
 *
 * Replaces nba-live-edge with a multi-league basketball skill.
 * Currently supports NBA and NCAA Basketball via ESPN APIs.
 *
 * SCORE-REACTIVE STRATEGY:
 * When ESPN reports Team A scored -> BUY Team A's token.
 * The edge is SPEED: we see the score before the market adjusts.
 * Profit comes from DIVERGENCE in close games with little time left.
 */
export class BasketballSkill implements Skill {
  id = 'basketball';
  name = 'Basketball Score Reactive';
  icon = '\u{1F3C0}';
  description = 'Multi-league basketball skill. Watches ESPN for scoring events across NBA and NCAA. Buys the scoring team\'s token before the market adjusts. Focuses on close late-game situations where each basket causes large price swings.';
  category = 'Basketball';
  status: 'active' | 'idle' | 'error' | 'paused' = 'active';
  pollIntervalMs = 1000;
  stats = { trades: 0, wins: 0, losses: 0, totalPnl: 0 };

  private leagues: LeagueConfig[] = [NBA_CONFIG, NCAA_CONFIG];

  private lastNarrationTime = 0;
  private readonly narrationCooldownMs = 10000;

  // Track previous scores to detect scoring events — keyed by gameId
  private prevScores: Map<string, { home: number; away: number; clock: string }> = new Map();

  // Foul detection: track when we last checked each game + which plays we've processed
  private lastFoulCheckAt: Map<string, number> = new Map();
  private seenPlayIds: Set<string> = new Set();

  // Per-league stats for UI display
  leagueStats: Map<string, LeagueStats> = new Map();

  /**
   * INFORMATION VALUE of a scoring event.
   *
   * Uses the ACTUAL Polymarket contract price as the baseline probability.
   * The market price already encodes team quality, home court, injuries — everything.
   *
   * Parameterized by league-specific K and TIME_SCALE values.
   */
  private calculateInformationValue(
    marketPrice: number,
    secondsRemaining: number,
    params: { K: number; TIME_SCALE: number }
  ): {
    informationValue: number;
    tradingCost: number;
    netProfit: number;
    fairPriceAfter: number;
    sizing: number;
    tradeable: boolean;
  } {
    const secs = Math.max(secondsRemaining, 10);
    const { K, TIME_SCALE: TS } = params;

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

    // Sizing: proportional to net profit — 2% net -> 20% bankroll, 10%+ -> 100%
    const sizing = tradeable ? Math.min(netProfit / 0.10, 1.0) : 0;

    return { informationValue, tradingCost, netProfit, fairPriceAfter, sizing, tradeable };
  }

  /**
   * Foul detection — runs every 2s per live game (non-blocking, fire-and-forget).
   * Fetches ESPN play-by-play, finds new foul/free throw plays, logs them,
   * and alerts on crunch-time fouls.
   */
  private async checkForFouls(
    game: ESPNGame,
    market: WatchedMarket,
    secsLeft: number,
    league: LeagueConfig
  ): Promise<void> {
    const now = Date.now();
    const lastCheck = this.lastFoulCheckAt.get(game.id) ?? 0;
    if (now - lastCheck < 2000) return;
    this.lastFoulCheckAt.set(game.id, now);

    let plays: ESPNPlay[];
    try {
      plays = await fetchPlayByPlay(league.sportPath, game.id);
    } catch {
      return;
    }

    const crunchTimePeriod = league.modelParams.TOTAL_PERIODS;

    for (const play of plays) {
      if (!play.id || this.seenPlayIds.has(play.id)) continue;
      this.seenPlayIds.add(play.id);

      const isCrunchTime = game.period >= crunchTimePeriod && secsLeft <= 300 && Math.abs(game.homeScore - game.awayScore) <= 6;
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
        isCrunchTime,
        league: league.name,
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
          text: `[${league.name}] CRUNCH FOUL: ${play.description} | Q${game.period} ${game.clock} | ${game.awayTeam} ${game.awayScore}-${game.homeScore} ${game.homeTeam}`,
          type: 'warning'
        });
      }
    }
  }

  /**
   * Fetch games from all configured leagues, returning combined results tagged with league.
   */
  private async fetchAllGames(): Promise<{ games: ESPNGame[]; leagueForGame: Map<string, LeagueConfig> }> {
    const allGames: ESPNGame[] = [];
    const leagueForGame = new Map<string, LeagueConfig>();

    const results = await Promise.allSettled(
      this.leagues.map(async (league) => {
        const games = await fetchScoreboard(
          league.sportPath,
          league.name,
          league.modelParams.QUARTER_SECONDS,
          league.modelParams.TOTAL_PERIODS
        );
        return { league, games };
      })
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const { league, games } = result.value;
        for (const game of games) {
          allGames.push(game);
          leagueForGame.set(game.id, league);
        }

        // Update league stats
        const live = getLiveGames(games);
        const upcoming = getUpcomingGames(games);
        this.leagueStats.set(league.id, {
          league: league.name,
          liveGames: live.length,
          upcomingGames: upcoming.length,
          matchedMarkets: 0, // updated below during matching
          lastScoringEvent: this.leagueStats.get(league.id)?.lastScoringEvent ?? null,
        });
      }
    }

    return { games: allGames, leagueForGame };
  }

  async detect(markets: WatchedMarket[]): Promise<Opportunity[]> {
    if (markets.length === 0) return [];

    const { games: allGames, leagueForGame } = await this.fetchAllGames();
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
        let bestLeague: LeagueConfig | null = null;

        for (const game of liveGames) {
          const league = leagueForGame.get(game.id);
          if (!league) continue;
          const market = matchGameToMarket(game, markets, league);
          const mktPrice = market ? market.yesPrice : 0.5;
          const info = this.calculateInformationValue(mktPrice, game.secondsRemaining, league.modelParams);
          if (info.netProfit > bestDivergence) {
            bestDivergence = info.netProfit;
            bestGame = game;
            bestLeague = league;
          }
        }

        if (bestGame && bestLeague) {
          const bestMarket = matchGameToMarket(bestGame, markets, bestLeague);
          const mktPrice = bestMarket ? bestMarket.yesPrice : 0.5;
          const info = this.calculateInformationValue(mktPrice, bestGame.secondsRemaining, bestLeague.modelParams);

          addMessage({
            text: `[${bestLeague.name}] ${liveGames.length} live | FOCUS: ${bestGame.awayTeam} @ ${bestGame.homeTeam} (${bestGame.awayScore}-${bestGame.homeScore} Q${bestGame.period} ${bestGame.clock}) — Market: ${(mktPrice * 100).toFixed(0)}c | Info value/basket: ${(info.informationValue * 100).toFixed(1)}% | Net: ${(info.netProfit * 100).toFixed(1)}% | ${info.tradeable ? 'TRADEABLE' : 'watching'}`,
            type: info.tradeable ? 'action' : 'info'
          });
        } else {
          addMessage({
            text: `${liveGames.length} live basketball games, no close late-game situations yet — watching...`,
            type: 'idle'
          });
        }
      } else if (upcomingGames.length > 0) {
        const next = upcomingGames[0];
        const nextLeague = leagueForGame.get(next.id);
        const startTime = next.scheduledStart
          ? new Date(next.scheduledStart).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
          : 'TBD';
        addMessage({ text: `[${nextLeague?.name ?? 'BBall'}] Next: ${next.awayTeam} @ ${next.homeTeam} at ${startTime}`, type: 'idle' });
      }
      this.lastNarrationTime = now;
    }

    if (liveGames.length === 0) return [];

    const opportunities: Opportunity[] = [];

    for (const game of liveGames) {
      const league = leagueForGame.get(game.id);
      if (!league) continue;

      const market = matchGameToMarket(game, markets, league);
      if (!market) continue;

      // Update matched markets count
      const stats = this.leagueStats.get(league.id);
      if (stats) stats.matchedMarkets++;

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

      // The scoring team's current token price
      // Home team = YES token, Away team = NO token
      const scoringTeamPrice = scoringTeam === 'home' ? market.yesPrice
                             : scoringTeam === 'away' ? market.noPrice
                             : market.yesPrice;

      const info = this.calculateInformationValue(scoringTeamPrice, secondsRemaining, league.modelParams);

      // Log cycle on every scoring event
      if (scoringTeam) {
        // Update league stats
        if (stats) stats.lastScoringEvent = new Date().toISOString();

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
          reason: `[${league.name}] ${scoringTeam === 'home' ? game.homeTeam : game.awayTeam} scored +${pointsScored} | Price: ${(scoringTeamPrice * 100).toFixed(1)}c -> Fair: ${(info.fairPriceAfter * 100).toFixed(1)}c | InfoValue: ${(info.informationValue * 100).toFixed(1)}%`
        });

        // Log the scoring event to disk
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
          sizing: info.sizing,
          league: league.name,
        });

        // Log t=0 price snapshot and schedule reaction snapshots
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
      this.checkForFouls(game, market, secondsRemaining, league).catch(() => {});

      // NO SCORING EVENT? Skip opportunity generation.
      if (!scoringTeam) continue;

      // SCORING EVENT DETECTED — but is the information valuable enough to trade?
      if (!info.tradeable) {
        addMessage({
          text: `[${league.name}] ${scoringTeam === 'home' ? game.homeTeam : game.awayTeam} scored +${pointsScored} — price ${(scoringTeamPrice * 100).toFixed(0)}c, info value ${(info.informationValue * 100).toFixed(1)}%, net ${(info.netProfit * 100).toFixed(1)}% (need >=2%). Skipping.`,
          type: 'info'
        });
        continue;
      }

      // TRADEABLE SCORING EVENT
      const side: 'yes' | 'no' = scoringTeam === 'home' ? 'yes' : 'no';
      const tokenId = side === 'yes' ? market.yesTokenId : market.noTokenId;

      addMessage({
        text: `[${league.name}] ${scoringTeam === 'home' ? game.homeTeam : game.awayTeam} SCORED +${pointsScored}! ` +
          `${game.awayTeam} @ ${game.homeTeam} (${game.awayScore}-${game.homeScore} Q${game.period} ${game.clock}) | ` +
          `BUY ${side.toUpperCase()} @ ${(scoringTeamPrice * 100).toFixed(1)}c -> fair ${(info.fairPriceAfter * 100).toFixed(1)}c | ` +
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
          league: league.name
        }
      });
    }

    return opportunities;
  }
}
