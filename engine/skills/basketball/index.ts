import type { Skill, WatchedMarket, Opportunity, ESPNGame } from '@/lib/types';
import { fetchScoreboard, getLiveGames, getUpcomingGames, fetchPlayByPlay } from './espn-api';
import type { LeagueConfig, LeagueStats, ESPNPlay } from './types';
import { calcPolymarketFee } from './win-probability';
import { matchGameToMarket } from './market-matcher';
import { addMessage, engineState, addCycleLog } from '@/engine/state';
import { logScoreEvent, logPriceSnapshot, logFoulEvent, scheduleReactionSnapshots } from '@/engine/data-logger';
import { fetchPinnacleLiveOdds, matchPinnacleLive } from '@/engine/predictions/pinnacle-live';
import { NBA_CONFIG } from './leagues/nba';
import { NCAA_CONFIG } from './leagues/ncaa';
import { WNBA_CONFIG } from './leagues/wnba';

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
  name = 'Basketball Live-Edge';
  icon = '';
  description = 'Multi-league basketball skill. Watches ESPN for scoring events across NBA and NCAA. Buys the scoring team\'s token before the market adjusts. Focuses on close late-game situations where each basket causes large price swings.';
  category = 'Basketball';
  status: 'active' | 'idle' | 'error' | 'paused' = 'active';
  pollIntervalMs = 1000;
  stats = { trades: 0, wins: 0, losses: 0, totalPnl: 0 };

  private leagues: LeagueConfig[] = [NBA_CONFIG, NCAA_CONFIG, WNBA_CONFIG];

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
   * Fetch TODAY's games from all configured leagues (fast — 1 request per league).
   * Only fetches today's scoreboard, not 7 days. This runs every 1 second
   * so it must be fast.
   */
  private async fetchAllGames(): Promise<{ games: ESPNGame[]; leagueForGame: Map<string, LeagueConfig> }> {
    const allGames: ESPNGame[] = [];
    const leagueForGame = new Map<string, LeagueConfig>();
    const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports';

    const results = await Promise.allSettled(
      this.leagues.map(async (league) => {
        try {
          const res = await fetch(`${ESPN_BASE}/${league.sportPath}/scoreboard`, {
            signal: AbortSignal.timeout(5000),
            cache: 'no-store',
          });
          if (!res.ok) return { league, games: [] as ESPNGame[] };
          const data = await res.json();
          const games: ESPNGame[] = [];

          for (const event of data?.events ?? []) {
            const comp = event.competitions?.[0];
            if (!comp) continue;
            const home = comp.competitors?.find((c: any) => c.homeAway === 'home');
            const away = comp.competitors?.find((c: any) => c.homeAway === 'away');
            if (!home || !away) continue;

            const state = (event.status?.type?.state ?? 'pre') as 'pre' | 'in' | 'post';
            const period = event.status?.period ?? 1;
            const clock = event.status?.displayClock ?? '';
            const homeScore = parseInt(home.score ?? '0', 10);
            const awayScore = parseInt(away.score ?? '0', 10);

            const qs = league.modelParams.QUARTER_SECONDS;
            const tp = league.modelParams.TOTAL_PERIODS;
            let secondsRemaining = 0;
            if (state === 'in') {
              const clockParts = clock.split(':');
              const clockSecs = (parseInt(clockParts[0] ?? '0') * 60) + parseInt(clockParts[1] ?? '0');
              const remainingPeriods = tp - period;
              secondsRemaining = clockSecs + (remainingPeriods * qs);
            }

            games.push({
              id: String(event.id),
              name: String(event.name ?? ''),
              homeTeam: String(home.team?.shortDisplayName || home.team?.displayName || ''),
              awayTeam: String(away.team?.shortDisplayName || away.team?.displayName || ''),
              homeAbbr: String(home.team?.abbreviation ?? '').toLowerCase(),
              awayAbbr: String(away.team?.abbreviation ?? '').toLowerCase(),
              homeScore, awayScore, period, clock, state, secondsRemaining,
              scheduledStart: String(event.date ?? ''),
              league: league.name,
            });
          }
          return { league, games };
        } catch {
          return { league, games: [] as ESPNGame[] };
        }
      })
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const { league, games } = result.value;
        for (const game of games) {
          allGames.push(game);
          leagueForGame.set(game.id, league);
        }

        const live = getLiveGames(games);
        const upcoming = getUpcomingGames(games);
        this.leagueStats.set(league.id, {
          league: league.name,
          liveGames: live.length,
          upcomingGames: upcoming.length,
          matchedMarkets: 0,
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

    // Fetch Pinnacle live odds — sharpest real-time probability source
    const pinnacleLiveOdds = liveGames.length > 0 ? await fetchPinnacleLiveOdds() : [];

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

      // Determine which Polymarket side (YES/NO) corresponds to the ESPN home team.
      // Polymarket YES = first team in title (market.homeTeam).
      // ESPN home team might be either the YES or NO side.
      const espnHomeLower = game.homeTeam.toLowerCase();
      const marketHomeLower = market.homeTeam.toLowerCase();
      // Check if ESPN's home team matches Polymarket's YES team (market.homeTeam)
      const espnHomeIsYes = marketHomeLower.includes(espnHomeLower.split(' ').pop() ?? '') ||
                            espnHomeLower.includes(marketHomeLower.split(' ').pop() ?? '');

      // The scoring team's Polymarket token price
      let scoringTeamPrice: number;
      if (scoringTeam === 'home') {
        scoringTeamPrice = espnHomeIsYes ? market.yesPrice : market.noPrice;
      } else if (scoringTeam === 'away') {
        scoringTeamPrice = espnHomeIsYes ? market.noPrice : market.yesPrice;
      } else {
        scoringTeamPrice = market.yesPrice;
      }

      // Use Pinnacle live odds as the "true" probability (replaces logistic model)
      // Pinnacle is the sharpest book — their live line IS the true probability
      const pinnacleMatch = matchPinnacleLive(pinnacleLiveOdds, game.homeTeam, game.awayTeam);

      let trueScoringTeamProb: number;
      let trueSource: string;

      if (pinnacleMatch) {
        // Pinnacle available — use their de-vigged probability
        trueScoringTeamProb = scoringTeam === 'home'
          ? (espnHomeIsYes ? pinnacleMatch.homeWinProb : pinnacleMatch.awayWinProb)
          : (espnHomeIsYes ? pinnacleMatch.awayWinProb : pinnacleMatch.homeWinProb);
        trueSource = 'Pinnacle';
      } else {
        // No Pinnacle live odds — fall back to logistic model
        const modelInfo = this.calculateInformationValue(scoringTeamPrice, secondsRemaining, league.modelParams);
        trueScoringTeamProb = modelInfo.fairPriceAfter;
        trueSource = 'Model';
      }

      // Edge = Pinnacle (or model) probability - Polymarket price - fees
      const TAKER_FEE = 0.0075;
      const liveEdge = trueScoringTeamProb - scoringTeamPrice - TAKER_FEE;
      const isTradeable = liveEdge >= 0.02; // 2% minimum edge after fees

      // Also compute model info for logging (even when using Pinnacle)
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
          modelProbability: trueScoringTeamProb,
          marketPrice: scoringTeamPrice,
          edge: liveEdge,
          ev: liveEdge,
          fee: TAKER_FEE,
          kellySize: isTradeable ? 0.5 : 0,
          action: isTradeable ? 'enter' : 'skip',
          reason: `[${league.name}] ${scoringTeam === 'home' ? game.homeTeam : game.awayTeam} +${pointsScored}${pointsScored === 1 ? ' FT' : ''} | ${trueSource}: ${(trueScoringTeamProb * 100).toFixed(1)}% | Market: ${(scoringTeamPrice * 100).toFixed(1)}c | Spike: ${(info.informationValue * 100).toFixed(1)}% | Edge: ${(liveEdge * 100).toFixed(1)}%`
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

      // SCORING EVENT DETECTED — is there a real edge between Pinnacle and Polymarket?
      if (!isTradeable) {
        addMessage({
          text: `[${league.name}] ${scoringTeam === 'home' ? game.homeTeam : game.awayTeam} scored +${pointsScored} — ${trueSource}: ${(trueScoringTeamProb * 100).toFixed(1)}%, Market: ${(scoringTeamPrice * 100).toFixed(0)}c, Edge: ${(liveEdge * 100).toFixed(1)}% (need >=2%). Skipping.`,
          type: 'info'
        });
        continue;
      }

      // TRADEABLE SCORING EVENT
      // Map scoring team to the correct Polymarket side (YES/NO)
      let side: 'yes' | 'no';
      if (scoringTeam === 'home') {
        side = espnHomeIsYes ? 'yes' : 'no';
      } else {
        side = espnHomeIsYes ? 'no' : 'yes';
      }
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
