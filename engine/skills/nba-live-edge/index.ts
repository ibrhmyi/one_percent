import type { Skill, WatchedMarket, Opportunity, SkillStats } from '@/lib/types';
import { fetchNBAScoreboard } from './espn-api';
import { calcWinProbability, calcEV, calcPolymarketFee } from './win-probability';
import { matchGameToMarket } from './market-matcher';
import { addCycleLog } from '@/engine/state';

export class NBALiveEdge implements Skill {
  id = 'nba-live-edge';
  name = 'NBA Live Edge';
  icon = '🏀';
  description =
    'Monitors live NBA games via ESPN API. Calculates win probability using logistic regression on score lead and time remaining. Compares model probability to Polymarket prices. Exploits the 15-45 second delay between ESPN score updates and TV broadcast viewers who make up most of Polymarket\'s liquidity.';
  category = 'NBA';
  status: 'active' | 'idle' | 'error' = 'idle';
  pollIntervalMs = 1000;
  stats: SkillStats = {
    trades: 0,
    wins: 0,
    losses: 0,
    totalPnl: 0,
  };

  async detect(markets: WatchedMarket[]): Promise<Opportunity[]> {
    const opportunities: Opportunity[] = [];

    let games;
    try {
      games = await fetchNBAScoreboard();
    } catch {
      this.status = 'error';
      return [];
    }

    const liveGames = games.filter(g => g.state === 'in');

    if (liveGames.length === 0) {
      this.status = 'idle';
      return [];
    }

    this.status = 'active';

    for (const game of liveGames) {
      const market = matchGameToMarket(game, markets);
      if (!market) continue;
      if (!market.yesPrice || !market.noPrice) continue;

      const modelProb = calcWinProbability(
        game.homeScore,
        game.awayScore,
        game.secondsRemaining
      );

      const periodLabel = game.period > 4 ? `OT${game.period - 4}` : `Q${game.period}`;

      const gameData = {
        homeTeam: game.homeTeam,
        awayTeam: game.awayTeam,
        homeScore: game.homeScore,
        awayScore: game.awayScore,
        period: periodLabel,
        clock: game.clock,
        secondsRemaining: game.secondsRemaining,
        league: 'NBA',
      };

      // Check YES side (home win)
      const yesEdge = modelProb - market.yesPrice;
      const yesEv = calcEV(modelProb, market.yesPrice);
      const yesFee = calcPolymarketFee(market.yesPrice);

      if (yesEv > 0) {
        opportunities.push({
          marketId: market.id,
          tokenId: market.yesTokenId,
          title: market.title,
          side: 'yes',
          modelProbability: modelProb,
          marketPrice: market.yesPrice,
          edge: yesEdge,
          ev: yesEv,
          fee: yesFee,
          confidence: Math.min(1, Math.abs(yesEdge) * 5),
          skillId: this.id,
          gameData,
        });
      }

      // Check NO side (away win)
      const noModelProb = 1 - modelProb;
      const noEdge = noModelProb - market.noPrice;
      const noEv = calcEV(noModelProb, market.noPrice);
      const noFee = calcPolymarketFee(market.noPrice);

      if (noEv > 0) {
        opportunities.push({
          marketId: market.id,
          tokenId: market.noTokenId,
          title: market.title,
          side: 'no',
          modelProbability: noModelProb,
          marketPrice: market.noPrice,
          edge: noEdge,
          ev: noEv,
          fee: noFee,
          confidence: Math.min(1, Math.abs(noEdge) * 5),
          skillId: this.id,
          gameData,
        });
      }

      // Log every cycle regardless of trade
      const bestOpp = yesEv > noEv
        ? { side: 'yes', ev: yesEv, edge: yesEdge, fee: yesFee, price: market.yesPrice, prob: modelProb }
        : { side: 'no', ev: noEv, edge: noEdge, fee: noFee, price: market.noPrice, prob: noModelProb };

      addCycleLog({
        timestamp: new Date().toISOString(),
        gameId: game.id,
        homeTeam: game.homeTeam,
        awayTeam: game.awayTeam,
        homeScore: game.homeScore,
        awayScore: game.awayScore,
        period: periodLabel,
        clock: game.clock,
        secondsRemaining: game.secondsRemaining,
        modelProbability: bestOpp.prob,
        marketPrice: bestOpp.price,
        edge: bestOpp.edge,
        ev: bestOpp.ev,
        fee: bestOpp.fee,
        kellySize: 0, // filled by trade-manager when entering
        action: bestOpp.ev > 0 ? 'enter' : 'skip',
        reason: bestOpp.ev > 0 ? `EV=${bestOpp.ev.toFixed(4)}` : `EV=${bestOpp.ev.toFixed(4)} negative`,
      });
    }

    return opportunities;
  }
}
