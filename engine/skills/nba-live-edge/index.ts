import type { Skill, WatchedMarket, Opportunity, ESPNGame } from '@/lib/types';
import { fetchNBAScoreboard, getLiveGames, getUpcomingGames, fetchPlayByPlay } from './espn-api';
import type { ESPNPlay } from './espn-api';
import {
  fetchNBACDNScoreboard,
  fetchNBACDNPlayByPlay,
  extractScoringPlays,
  calcNBASecsRemaining,
  type ScoringPlay,
  type NBAScoreboardGame,
} from './nba-cdn-api';
import { calcPolymarketFee } from './win-probability';
import { matchGameToMarket } from './market-matcher';
import { addMessage, engineState, addCycleLog } from '@/engine/state';
import { logScoreEvent, logPriceSnapshot, logFoulEvent, scheduleReactionSnapshots } from '@/engine/data-logger';

/**
 * SCORE-REACTIVE STRATEGY — Dual-source detection
 *
 * Polls BOTH ESPN REST and NBA.com CDN play-by-play in parallel.
 * Whichever reports a scoring event first wins (race condition).
 *
 * NBA.com CDN play-by-play:
 *   - Returns individual plays with unique IDs (actionNumber)
 *   - Detects scoring by play type ("Made Shot") — no score-diffing needed
 *   - Typically 2-5s faster than ESPN REST scoreboard
 *
 * ESPN REST scoreboard:
 *   - Fallback: still detects scores via total-score diffing
 *   - More reliable for game metadata (team names, schedule)
 *
 * ENTRY: Taker order (speed matters — buy instantly)
 * EXIT:  Adaptive based on game context (see exit-manager.ts)
 */
export class NBALiveEdge implements Skill {
  id = 'nba-live-edge';
  name = 'NBA Score Reactive';
  icon = '🏀';
  description = 'Dual-source scoring detection (NBA CDN + ESPN). Buys scoring team token before market adjusts. Focuses on close Q4 games.';
  category = 'NBA';
  status: 'active' | 'idle' | 'error' | 'paused' = 'active';
  pollIntervalMs = 1000;
  stats = { trades: 0, wins: 0, losses: 0, totalPnl: 0 };

  private lastNarrationTime = 0;
  private readonly narrationCooldownMs = 10000;

  // ── ESPN score-diff detection (fallback) ──
  private prevScores: Map<string, { home: number; away: number; clock: string }> = new Map();

  // ── NBA CDN play-by-play detection (primary) ──
  private seenNBAPlays: Set<string> = new Set();  // "gameId:actionNumber"
  private nbaGameMap: Map<string, NBAScoreboardGame> = new Map(); // gameId → game info
  // Map ESPN game IDs to NBA game IDs (different formats)
  private espnToNbaId: Map<string, string> = new Map();

  // ── Foul detection ──
  private lastFoulCheckAt: Map<string, number> = new Map();
  private seenFoulPlays: Set<string> = new Set();
  private readonly MAX_SEEN_PLAYS = 5000;

  // ── Dedup: prevent double-firing from both sources ──
  // Key: "gameId:homeScore:awayScore" → timestamp when first detected
  private recentDetections: Map<string, number> = new Map();
  private readonly DEDUP_WINDOW_MS = 5000; // ignore same score from 2nd source within 5s

  /**
   * INFORMATION VALUE of a scoring event.
   *
   * K=1.15, TS=0.38 (K/TS≈3.0 matches NBA win probability research).
   * Calculates the THEORETICAL fair value after a basket.
   * Edge = fairPriceAfter - currentMarketPrice.
   */
  private calculateInformationValue(marketPrice: number, secondsRemaining: number, points: number = 2): {
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

    // After scoring event by the scoring team
    const newLead = impliedLead + points;
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
   * Check if this score state was already detected (dedup between sources).
   * Returns true if this is a NEW detection, false if duplicate.
   */
  private isNewDetection(gameId: string, homeScore: number, awayScore: number): boolean {
    const key = `${gameId}:${homeScore}:${awayScore}`;
    const now = Date.now();

    // Clean old entries
    for (const [k, ts] of this.recentDetections) {
      if (now - ts > this.DEDUP_WINDOW_MS) this.recentDetections.delete(k);
    }

    if (this.recentDetections.has(key)) return false;
    this.recentDetections.set(key, now);
    return true;
  }

  /**
   * Refresh NBA CDN scoreboard and build game ID mapping.
   * NBA uses "0022500XXX" format, ESPN uses different IDs.
   * We match by team tricodes.
   */
  private async refreshNBAScoreboard(espnGames: ESPNGame[]): Promise<void> {
    const nbaGames = await fetchNBACDNScoreboard();
    this.nbaGameMap.clear();

    for (const ng of nbaGames) {
      if (ng.gameStatus !== 2) continue; // only live games
      this.nbaGameMap.set(ng.gameId, ng);

      // Match to ESPN by team tricodes
      for (const eg of espnGames) {
        if (eg.state !== 'in') continue;
        const espnHome = eg.homeAbbr.toUpperCase();
        const espnAway = eg.awayAbbr.toUpperCase();
        const nbaHome = ng.homeTeam.teamTricode.toUpperCase();
        const nbaAway = ng.awayTeam.teamTricode.toUpperCase();

        if ((espnHome === nbaHome && espnAway === nbaAway) ||
            (espnHome === nbaHome) || (espnAway === nbaAway)) {
          this.espnToNbaId.set(eg.id, ng.gameId);
        }
      }
    }
  }

  /**
   * Poll NBA CDN play-by-play for all live games.
   * Returns new scoring plays detected since last poll.
   */
  private async pollNBACDN(espnGames: ESPNGame[]): Promise<ScoringPlay[]> {
    const allNewPlays: ScoringPlay[] = [];

    for (const [nbaGameId, nbaGame] of this.nbaGameMap) {
      const plays = await fetchNBACDNPlayByPlay(nbaGameId);
      if (plays.length === 0) continue;

      const newScoring = extractScoringPlays(
        plays,
        nbaGameId,
        nbaGame.homeTeam.teamTricode,
        this.seenNBAPlays,
      );

      allNewPlays.push(...newScoring);
    }

    // Bound memory
    if (this.seenNBAPlays.size > this.MAX_SEEN_PLAYS) {
      const arr = [...this.seenNBAPlays];
      this.seenNBAPlays = new Set(arr.slice(-3000));
    }

    return allNewPlays;
  }

  /**
   * Foul detection — runs every 2s per live game (non-blocking).
   */
  private async checkForFouls(game: ESPNGame, market: WatchedMarket, secsLeft: number): Promise<void> {
    const now = Date.now();
    const lastCheck = this.lastFoulCheckAt.get(game.id) ?? 0;
    if (now - lastCheck < 2000) return;
    this.lastFoulCheckAt.set(game.id, now);

    let plays: ESPNPlay[];
    try {
      plays = await fetchPlayByPlay(game.id);
    } catch {
      return;
    }

    for (const play of plays) {
      if (!play.id || this.seenFoulPlays.has(play.id)) continue;
      this.seenFoulPlays.add(play.id);
      if (this.seenFoulPlays.size > this.MAX_SEEN_PLAYS) {
        const arr = [...this.seenFoulPlays];
        this.seenFoulPlays = new Set(arr.slice(-3000));
      }

      const isCrunchTime = game.period >= 4 && secsLeft <= 300 && Math.abs(game.homeScore - game.awayScore) <= 6;

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
          const m = engineState.watchedMarkets.find(x => x.id === market.id || x.slug === market.slug);
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

  /**
   * Process a detected scoring event into an opportunity.
   */
  private processScoreEvent(
    game: ESPNGame,
    market: WatchedMarket,
    scoringTeam: 'home' | 'away',
    pointsScored: number,
    source: 'nba-cdn' | 'espn',
  ): Opportunity | null {
    const secondsRemaining = game.secondsRemaining;

    // Dedup: if we already detected this exact score state, skip
    if (!this.isNewDetection(game.id, game.homeScore, game.awayScore)) {
      return null;
    }

    // The scoring team's current token price
    const scoringTeamPrice = scoringTeam === 'home' ? market.yesPrice : market.noPrice;

    const info = this.calculateInformationValue(scoringTeamPrice, secondsRemaining, pointsScored);

    // Log cycle
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
      reason: `[${source}] ${scoringTeam === 'home' ? game.homeTeam : game.awayTeam} scored +${pointsScored} | Price: ${(scoringTeamPrice * 100).toFixed(1)}¢ → Fair: ${(info.fairPriceAfter * 100).toFixed(1)}¢ | InfoValue: ${(info.informationValue * 100).toFixed(1)}%`
    });

    // Log to disk
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

    // Snapshot at t=0 and schedule reactions
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

    if (!info.tradeable) {
      addMessage({
        text: `⚪ [${source}] ${scoringTeam === 'home' ? game.homeTeam : game.awayTeam} scored +${pointsScored} — price ${(scoringTeamPrice * 100).toFixed(0)}¢, info value ${(info.informationValue * 100).toFixed(1)}%, net ${(info.netProfit * 100).toFixed(1)}% (need ≥2%). Skipping.`,
        type: 'info'
      });
      return null;
    }

    // TRADEABLE
    const side: 'yes' | 'no' = scoringTeam === 'home' ? 'yes' : 'no';
    const tokenId = side === 'yes' ? market.yesTokenId : market.noTokenId;

    addMessage({
      text: `🎯 [${source}] ${scoringTeam === 'home' ? game.homeTeam : game.awayTeam} SCORED +${pointsScored}! ` +
        `${game.awayTeam} @ ${game.homeTeam} (${game.awayScore}-${game.homeScore} Q${game.period} ${game.clock}) | ` +
        `BUY ${side.toUpperCase()} @ ${(scoringTeamPrice * 100).toFixed(1)}¢ → fair ${(info.fairPriceAfter * 100).toFixed(1)}¢ | ` +
        `Info value: ${(info.informationValue * 100).toFixed(1)}% | Net: ${(info.netProfit * 100).toFixed(1)}% | ` +
        `Sizing: ${(info.sizing * 100).toFixed(0)}%`,
      type: 'action'
    });

    return {
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
    };
  }

  async detect(markets: WatchedMarket[]): Promise<Opportunity[]> {
    if (markets.length === 0) return [];

    // ── Fetch ESPN scoreboard, then refresh NBA CDN mapping ──
    const allGames = await fetchNBAScoreboard();
    await this.refreshNBAScoreboard(allGames);

    const liveGames = getLiveGames(allGames);
    const upcomingGames = getUpcomingGames(allGames);

    if (this.status !== 'paused') {
      this.status = liveGames.length > 0 ? 'active' : 'idle';
    }

    // ── Narration ──
    const now = Date.now();
    if (now - this.lastNarrationTime > this.narrationCooldownMs) {
      if (liveGames.length > 0) {
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
          const nbaId = this.espnToNbaId.get(bestGame.id);

          addMessage({
            text: `🏀 ${liveGames.length} live | CDN: ${this.nbaGameMap.size} tracked | FOCUS: ${bestGame.awayTeam} @ ${bestGame.homeTeam} (${bestGame.awayScore}-${bestGame.homeScore} Q${bestGame.period} ${bestGame.clock}) — Market: ${(mktPrice * 100).toFixed(0)}¢ | Info value/basket: ${(info.informationValue * 100).toFixed(1)}% | Net: ${(info.netProfit * 100).toFixed(1)}% | ${info.tradeable ? 'TRADEABLE' : 'watching'}${nbaId ? ' | CDN✓' : ' | CDN✗'}`,
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

    // ── SOURCE 1: NBA CDN play-by-play (faster, primary) ──
    const nbaScoringPlays = await this.pollNBACDN(liveGames);
    for (const play of nbaScoringPlays) {
      // Find the ESPN game that matches this NBA CDN play
      let matchedEspnGame: ESPNGame | null = null;
      for (const [espnId, nbaId] of this.espnToNbaId) {
        if (nbaId === play.gameId) {
          matchedEspnGame = liveGames.find(g => g.id === espnId) ?? null;
          break;
        }
      }
      if (!matchedEspnGame) continue;

      const market = matchGameToMarket(matchedEspnGame, markets);
      if (!market) continue;

      // Update ESPN game scores from CDN data (CDN is fresher)
      matchedEspnGame.homeScore = play.scoreHome;
      matchedEspnGame.awayScore = play.scoreAway;

      const scoringTeam: 'home' | 'away' = play.isHome ? 'home' : 'away';
      const opp = this.processScoreEvent(matchedEspnGame, market, scoringTeam, play.points, 'nba-cdn');
      if (opp) opportunities.push(opp);
    }

    // ── SOURCE 2: ESPN score-diff (fallback) ──
    for (const game of liveGames) {
      const market = matchGameToMarket(game, markets);
      if (!market) continue;

      const secondsRemaining = game.secondsRemaining;

      // Detect scoring via score diff
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
      }

      this.prevScores.set(game.id, {
        home: game.homeScore,
        away: game.awayScore,
        clock: game.clock
      });

      if (scoringTeam) {
        const opp = this.processScoreEvent(game, market, scoringTeam, pointsScored, 'espn');
        if (opp) opportunities.push(opp);
      }

      // Foul detection (fire and forget)
      this.checkForFouls(game, market, secondsRemaining).catch(() => {});
    }

    return opportunities;
  }
}
