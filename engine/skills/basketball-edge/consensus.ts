import { OddsAPIGame, ConsensusResult, BookmakerProb } from './types';

// Book sharpness weights — sharp books are more accurate
const BOOK_WEIGHTS: Record<string, number> = {
  // Sharp books (2x weight)
  pinnacle: 2.0,
  betfair: 2.0,
  matchbook: 2.0,
  // Semi-sharp (1.5x)
  bet365: 1.5,
  williamhill: 1.5,
  betsson: 1.5,
  unibet: 1.5,
  // Recreational books (1x, default)
  draftkings: 1.0,
  fanduel: 1.0,
  betmgm: 1.0,
  pointsbet: 1.0,
  caesars: 1.0,
  betrivers: 1.0,
};

function getBookWeight(bookKey: string): number {
  return BOOK_WEIGHTS[bookKey] || 1.0;
}

/**
 * Calculate vig-removed consensus probability from multi-bookmaker odds.
 *
 * Steps:
 * 1. Convert decimal odds to implied probability: 1/odds
 * 2. Remove vig per bookmaker: prob / (homeImplied + awayImplied)
 * 3. Weight by book sharpness (Pinnacle 2x, sharps 1.5x, recreational 1x)
 * 4. Average across all bookmakers = consensus
 */
export function calculateConsensus(game: OddsAPIGame): ConsensusResult | null {
  const bookProbs: BookmakerProb[] = [];

  for (const book of game.bookmakers) {
    const h2h = book.markets.find(m => m.key === 'h2h');
    if (!h2h || h2h.outcomes.length < 2) continue;

    const homeOutcome = h2h.outcomes.find(o => o.name === game.home_team);
    const awayOutcome = h2h.outcomes.find(o => o.name === game.away_team);

    if (!homeOutcome || !awayOutcome) continue;
    if (homeOutcome.price <= 1 || awayOutcome.price <= 1) continue;

    const homeImplied = 1 / homeOutcome.price;
    const awayImplied = 1 / awayOutcome.price;
    const total = homeImplied + awayImplied;
    const homeProb = homeImplied / total;
    const awayProb = awayImplied / total;

    bookProbs.push({
      key: book.key,
      title: book.title,
      homeProb,
      awayProb,
    });
  }

  if (bookProbs.length === 0) return null;

  // WEIGHTED average across all books (sharp books count more)
  let weightedHomeSum = 0;
  let weightedAwaySum = 0;
  let totalWeight = 0;

  for (const bp of bookProbs) {
    const w = getBookWeight(bp.key);
    weightedHomeSum += bp.homeProb * w;
    weightedAwaySum += bp.awayProb * w;
    totalWeight += w;
  }

  const homeAvg = weightedHomeSum / totalWeight;
  const awayAvg = weightedAwaySum / totalWeight;

  // Measure bookmaker disagreement
  const homeProbs = bookProbs.map(b => b.homeProb);
  const spread = Math.max(...homeProbs) - Math.min(...homeProbs);

  const confidence: 'high' | 'medium' | 'low' =
    bookProbs.length >= 5 ? 'high' :
    bookProbs.length >= 3 ? 'medium' : 'low';

  return {
    homeWinProb: homeAvg,
    awayWinProb: awayAvg,
    numBookmakers: bookProbs.length,
    confidence,
    bookmakers: bookProbs,
    spread,
  };
}
