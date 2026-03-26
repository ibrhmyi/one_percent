import { OddsAPIGame, WatchlistEntry } from './types';
import { calculateConsensus } from './consensus';
import { matchOddsGameToMarket, resolveTokenSides } from './event-matcher';
import type { WatchedMarket } from '@/lib/types';

/**
 * Build the ranked watchlist. Called every cycle.
 * Games without Polymarket markets get a "projected EV" assuming 50/50 open.
 * Games with markets get computed EV vs current price.
 */
export function buildWatchlist(
  oddsGames: OddsAPIGame[],
  markets: WatchedMarket[]
): WatchlistEntry[] {
  const entries: WatchlistEntry[] = [];

  for (const game of oddsGames) {
    const consensus = calculateConsensus(game);
    if (!consensus) continue;

    const minsUntil = (new Date(game.commence_time).getTime() - Date.now()) / 60000;
    if (minsUntil < 0) continue;

    const entry: WatchlistEntry = {
      oddsGameId: game.id,
      sportKey: game.sport_key,
      homeTeam: game.home_team,
      awayTeam: game.away_team,
      commenceTime: game.commence_time,
      homeFairValue: consensus.homeWinProb,
      awayFairValue: consensus.awayWinProb,
      consensus,
      polymarketMatched: false,
      bestSideEV: 0,
      bestSide: 'YES',
      projectedEV: Math.abs(consensus.homeWinProb - 0.50),
      status: 'waiting_for_market',
    };

    const market = matchOddsGameToMarket(game, markets);
    if (market) {
      const { homeIsYes } = resolveTokenSides(market, game.home_team, game.away_team);

      entry.polymarketMatched = true;
      entry.polymarketUrl = market.url || (market.slug ? `https://polymarket.com/event/${market.slug}` : undefined);
      entry.conditionId = market.conditionId;
      entry.yesTokenId = market.yesTokenId;
      entry.noTokenId = market.noTokenId;
      entry.currentYesPrice = market.yesPrice;
      entry.currentNoPrice = market.noPrice;
      entry.homeIsYes = homeIsYes;
      entry.status = 'active_opportunity';

      const yesFair = homeIsYes ? consensus.homeWinProb : consensus.awayWinProb;
      const noFair = homeIsYes ? consensus.awayWinProb : consensus.homeWinProb;
      const yesEV = yesFair - market.yesPrice;
      const noEV = noFair - market.noPrice;

      if (yesEV >= noEV && yesEV > 0) {
        entry.bestSideEV = yesEV;
        entry.bestSide = 'YES';
      } else if (noEV > 0) {
        entry.bestSideEV = noEV;
        entry.bestSide = 'NO';
      }
    }

    entries.push(entry);
  }

  // Sort: active opportunities by EV first, then waiting-for-market by projected EV
  entries.sort((a, b) => {
    if (a.polymarketMatched && !b.polymarketMatched) return -1;
    if (!a.polymarketMatched && b.polymarketMatched) return 1;
    const aEV = a.polymarketMatched ? a.bestSideEV : a.projectedEV;
    const bEV = b.polymarketMatched ? b.bestSideEV : b.projectedEV;
    return bEV - aEV;
  });

  return entries;
}
