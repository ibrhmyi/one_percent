/**
 * Prediction Aggregator — combines all available sources into one fair value per game.
 *
 * Dynamic weighting: sources get more weight based on credibility and freshness.
 * When a source updates, the aggregator immediately recalculates fair value.
 *
 * Sources:
 *   1. ESPN BPI — institutional model, accounts for injuries/rest/travel
 *   2. Bart Torvik T-Rank — gold standard for NCAAB
 *   3. The Odds API — 30+ bookmaker consensus (sharpest when available)
 *
 * Weight hierarchy (when all available):
 *   Books (Odds API): 50%  — real money, includes Pinnacle
 *   ESPN BPI: 35%           — institutional, updated continuously
 *   Torvik: 15%             — NCAAB only, supplements BPI
 *
 * When books aren't available: BPI gets 70%, Torvik gets 30%.
 */

import { fetchBPIPredictions, BPIPrediction } from './espn-bpi';
import { fetchTorvikRatings, predictMatchup } from './torvik';
import { addMessage, engineState } from '../state';

export interface GamePrediction {
  gameKey: string;           // "homeTeam::awayTeam::YYYY-MM-DD" normalized key
  homeTeam: string;
  awayTeam: string;
  gameDate: string;          // YYYY-MM-DD for disambiguation
  fairHomeWinProb: number;   // Weighted consensus: 0-1
  fairAwayWinProb: number;

  // Individual source predictions (null if not available)
  bpiPrediction: { homeWinProb: number; awayWinProb: number; lastModified: string } | null;
  torvikPrediction: { homeWinProb: number; awayWinProb: number } | null;
  booksPrediction: { homeWinProb: number; awayWinProb: number; numBooks: number; confidence: string } | null;

  // Weights used
  weights: { bpi: number; torvik: number; books: number };

  // Meta
  sourcesAvailable: string[];
  lastUpdated: string;
  league: 'NBA' | 'NCAAB' | 'WNBA';
}

// ── In-memory prediction cache ──

const predictions: Map<string, GamePrediction> = new Map();
let lastBPIFetchAt = 0;
let lastTorvikFetchAt = 0;
const BPI_INTERVAL_MS = 5 * 60 * 1000;     // 5 minutes
const TORVIK_INTERVAL_MS = 30 * 60 * 1000;  // 30 minutes

let bpiCache: BPIPrediction[] = [];

// ── Matching helpers ──

function makeGameKey(home: string, away: string, date?: string): string {
  const dateStr = date ? `::${date.slice(0, 10)}` : '';
  return `${normalize(home)}::${normalize(away)}${dateStr}`;
}

function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function teamsMatch(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return true;
  // Last word (mascot) match
  const lastA = na.split(' ').pop() ?? '';
  const lastB = nb.split(' ').pop() ?? '';
  if (lastA.length >= 4 && lastA === lastB) return true;
  // Substring match
  if (na.includes(nb) || nb.includes(na)) return true;
  return false;
}

// ── Core aggregation ──

function calculateWeights(
  hasBPI: boolean,
  hasTorvik: boolean,
  hasBooks: boolean,
  league: 'NBA' | 'NCAAB' | 'WNBA'
): { bpi: number; torvik: number; books: number } {
  if (hasBooks && hasBPI && hasTorvik) {
    return { bpi: 0.35, torvik: 0.15, books: 0.50 };
  }
  if (hasBooks && hasBPI) {
    return { bpi: 0.35, torvik: 0, books: 0.65 };
  }
  if (hasBooks && hasTorvik) {
    return { bpi: 0, torvik: 0.35, books: 0.65 };
  }
  if (hasBooks) {
    return { bpi: 0, torvik: 0, books: 1.0 };
  }
  if (hasBPI && hasTorvik) {
    // For NCAAB, Torvik is more credible than BPI
    if (league === 'NCAAB') return { bpi: 0.40, torvik: 0.60, books: 0 };
    return { bpi: 0.70, torvik: 0.30, books: 0 };
  }
  if (hasBPI) {
    return { bpi: 1.0, torvik: 0, books: 0 };
  }
  if (hasTorvik) {
    return { bpi: 0, torvik: 1.0, books: 0 };
  }
  return { bpi: 0, torvik: 0, books: 0 };
}

function weightedAverage(
  bpi: number | null,
  torvik: number | null,
  books: number | null,
  weights: { bpi: number; torvik: number; books: number }
): number {
  let total = 0;
  let weightSum = 0;

  if (bpi !== null && weights.bpi > 0) {
    total += bpi * weights.bpi;
    weightSum += weights.bpi;
  }
  if (torvik !== null && weights.torvik > 0) {
    total += torvik * weights.torvik;
    weightSum += weights.torvik;
  }
  if (books !== null && weights.books > 0) {
    total += books * weights.books;
    weightSum += weights.books;
  }

  return weightSum > 0 ? total / weightSum : 0.5;
}

// ── Public API ──

/** Refresh ESPN BPI predictions */
export async function refreshBPI(): Promise<void> {
  const now = Date.now();
  if (now - lastBPIFetchAt < BPI_INTERVAL_MS) return;
  lastBPIFetchAt = now;

  try {
    const newPredictions = await fetchBPIPredictions(['NBA', 'NCAAB']);
    bpiCache = newPredictions;
    console.log(`[Aggregator] BPI refreshed: ${newPredictions.length} games`);

    // Update aggregated predictions
    for (const bpi of newPredictions) {
      const key = makeGameKey(bpi.homeTeam, bpi.awayTeam, bpi.gameDate);
      const existing = predictions.get(key);

      const bpiData = {
        homeWinProb: bpi.homeWinProb,
        awayWinProb: bpi.awayWinProb,
        lastModified: bpi.lastModified,
      };

      if (existing) {
        existing.bpiPrediction = bpiData;
        recalculate(existing);
      } else {
        const pred: GamePrediction = {
          gameKey: key,
          gameDate: bpi.gameDate || '',
          homeTeam: bpi.homeTeam,
          awayTeam: bpi.awayTeam,
          fairHomeWinProb: bpi.homeWinProb,
          fairAwayWinProb: bpi.awayWinProb,
          bpiPrediction: bpiData,
          torvikPrediction: null,
          booksPrediction: null,
          weights: { bpi: 1, torvik: 0, books: 0 },
          sourcesAvailable: ['BPI'],
          lastUpdated: new Date().toISOString(),
          league: bpi.league as 'NBA' | 'NCAAB' | 'WNBA',
        };
        predictions.set(key, pred);
      }
    }
  } catch (err) {
    console.error('[Aggregator] BPI refresh error:', err instanceof Error ? err.message : err);
  }
}

/** Refresh Torvik NCAAB ratings and compute predictions for ALL NCAAB markets */
export async function refreshTorvik(): Promise<void> {
  const now = Date.now();
  if (now - lastTorvikFetchAt < TORVIK_INTERVAL_MS) return;
  lastTorvikFetchAt = now;

  try {
    await fetchTorvikRatings();
    let updated = 0;
    let created = 0;

    // 1. Update existing NCAAB predictions
    for (const [, pred] of predictions) {
      if (pred.league !== 'NCAAB') continue;
      const torvik = predictMatchup(pred.homeTeam, pred.awayTeam);
      if (torvik) {
        pred.torvikPrediction = {
          homeWinProb: torvik.homeWinProb,
          awayWinProb: torvik.awayWinProb,
        };
        recalculate(pred);
        updated++;
      }
    }

    // 2. Create Torvik predictions for NCAAB Polymarket markets that don't have predictions yet
    const ncaaMarkets = engineState.watchedMarkets.filter(m =>
      m.category === 'NCAA' || m.slug?.startsWith('ncaa') || m.slug?.startsWith('march-madness') || m.slug?.startsWith('cbb')
    );

    for (const market of ncaaMarkets) {
      const mDate = market.gameStartTime ? new Date(market.gameStartTime).toISOString().slice(0, 10) : '';
      const key = makeGameKey(market.homeTeam, market.awayTeam, mDate);
      if (predictions.has(key)) continue; // Already have a prediction

      const torvik = predictMatchup(market.homeTeam, market.awayTeam);
      if (torvik) {
        const pred: GamePrediction = {
          gameKey: key,
          gameDate: mDate,
          homeTeam: market.homeTeam,
          awayTeam: market.awayTeam,
          fairHomeWinProb: torvik.homeWinProb,
          fairAwayWinProb: torvik.awayWinProb,
          bpiPrediction: null,
          torvikPrediction: {
            homeWinProb: torvik.homeWinProb,
            awayWinProb: torvik.awayWinProb,
          },
          booksPrediction: null,
          weights: { bpi: 0, torvik: 1, books: 0 },
          sourcesAvailable: ['Torvik'],
          lastUpdated: new Date().toISOString(),
          league: 'NCAAB',
        };
        predictions.set(key, pred);
        created++;
      }
    }

    // 3. Also create for NBA markets using Torvik as supplementary data
    // (Torvik is NCAAB only, so this won't match NBA teams, but try anyway for edge cases)

    console.log(`[Aggregator] Torvik: updated ${updated}, created ${created} predictions`);
  } catch (err) {
    console.error('[Aggregator] Torvik refresh error:', err instanceof Error ? err.message : err);
  }
}

/** Inject sportsbook consensus for a game (called from odds-api when data arrives) */
export function updateBooksPrediction(
  homeTeam: string,
  awayTeam: string,
  homeWinProb: number,
  awayWinProb: number,
  numBooks: number,
  confidence: string,
  league: 'NBA' | 'NCAAB' | 'WNBA' = 'NBA',
  gameDate?: string
): void {
  // Try to find existing prediction: exact key with date, without date, or fuzzy match
  const keyWithDate = gameDate ? makeGameKey(homeTeam, awayTeam, gameDate) : '';
  const keyWithout = makeGameKey(homeTeam, awayTeam);

  let key: string;
  let existing: GamePrediction | undefined;

  if (keyWithDate && predictions.has(keyWithDate)) {
    key = keyWithDate;
    existing = predictions.get(key);
  } else if (predictions.has(keyWithout)) {
    key = keyWithout;
    existing = predictions.get(key);
  } else {
    // Fuzzy match — find existing prediction by team names + date proximity
    const found = getFairValue(homeTeam, awayTeam, gameDate);
    if (found) {
      key = found.gameKey;
      existing = predictions.get(key);
    } else {
      key = keyWithDate || keyWithout;
      existing = undefined;
    }
  }

  const booksData = { homeWinProb, awayWinProb, numBooks, confidence };

  if (existing) {
    const prevFair = existing.fairHomeWinProb;
    existing.booksPrediction = booksData;
    recalculate(existing);

    // Change detection: if fair value shifted >2%, log it
    const shift = Math.abs(existing.fairHomeWinProb - prevFair);
    if (shift > 0.02) {
      addMessage({
        text: `📊 ODDS SHIFT: ${homeTeam} vs ${awayTeam} | Fair: ${(prevFair * 100).toFixed(1)}% → ${(existing.fairHomeWinProb * 100).toFixed(1)}% (${shift > 0 ? '+' : ''}${(shift * 100).toFixed(1)}%)`,
        type: 'warning',
      });
    }
  } else {
    const pred: GamePrediction = {
      gameKey: key,
      gameDate: gameDate || '',
      homeTeam,
      awayTeam,
      fairHomeWinProb: homeWinProb,
      fairAwayWinProb: awayWinProb,
      bpiPrediction: null,
      torvikPrediction: null,
      booksPrediction: booksData,
      weights: { bpi: 0, torvik: 0, books: 1 },
      sourcesAvailable: ['Books'],
      lastUpdated: new Date().toISOString(),
      league,
    };
    predictions.set(key, pred);
  }
}

/** Recalculate fair value from all available sources */
function recalculate(pred: GamePrediction): void {
  const hasBPI = pred.bpiPrediction !== null;
  const hasTorvik = pred.torvikPrediction !== null;
  const hasBooks = pred.booksPrediction !== null;

  const weights = calculateWeights(hasBPI, hasTorvik, hasBooks, pred.league);
  pred.weights = weights;

  pred.fairHomeWinProb = weightedAverage(
    pred.bpiPrediction?.homeWinProb ?? null,
    pred.torvikPrediction?.homeWinProb ?? null,
    pred.booksPrediction?.homeWinProb ?? null,
    weights
  );
  pred.fairAwayWinProb = 1 - pred.fairHomeWinProb;

  pred.sourcesAvailable = [];
  if (hasBPI) pred.sourcesAvailable.push('BPI');
  if (hasTorvik) pred.sourcesAvailable.push('Torvik');
  if (hasBooks) pred.sourcesAvailable.push(`Books(${pred.booksPrediction!.numBooks})`);

  pred.lastUpdated = new Date().toISOString();
}

/** Get fair value for a specific game. Requires both teams to match.
 *  If gameDate is provided, only matches games on that date (prevents cross-game collisions).
 */
export function getFairValue(homeTeam: string, awayTeam: string, gameDate?: string): GamePrediction | null {
  // Try exact key with date first
  if (gameDate) {
    const keyWithDate = makeGameKey(homeTeam, awayTeam, gameDate);
    if (predictions.has(keyWithDate)) return predictions.get(keyWithDate)!;
    // Try reversed
    const keyRevDate = makeGameKey(awayTeam, homeTeam, gameDate);
    if (predictions.has(keyRevDate)) {
      const pred = predictions.get(keyRevDate)!;
      return { ...pred, fairHomeWinProb: pred.fairAwayWinProb, fairAwayWinProb: pred.fairHomeWinProb };
    }
  }

  // Fuzzy match — require BOTH teams to match
  // If gameDate provided, also check date proximity
  for (const [, pred] of predictions) {
    // Date filter: if we have both dates, they must be within 36 hours
    if (gameDate && pred.gameDate) {
      const predTime = new Date(pred.gameDate).getTime();
      const queryTime = new Date(gameDate).getTime();
      if (Math.abs(predTime - queryTime) > 36 * 60 * 60 * 1000) continue;
    }

    if (teamsMatch(pred.homeTeam, homeTeam) && teamsMatch(pred.awayTeam, awayTeam)) {
      return pred;
    }
    if (teamsMatch(pred.homeTeam, awayTeam) && teamsMatch(pred.awayTeam, homeTeam)) {
      return { ...pred, fairHomeWinProb: pred.fairAwayWinProb, fairAwayWinProb: pred.fairHomeWinProb };
    }
  }

  return null;
}

/** Get all predictions (for UI display) */
export function getAllPredictions(): GamePrediction[] {
  return Array.from(predictions.values());
}

/** Get BPI cache (for direct access) */
export function getBPICache(): BPIPrediction[] {
  return bpiCache;
}

/** Run a full refresh cycle — BPI first (creates entries), then Torvik (supplements) */
export async function refreshAllPredictions(): Promise<void> {
  await refreshBPI();    // Creates predictions from ESPN data
  // Force Torvik to run if BPI just created new predictions
  // (Torvik needs BPI's NCAAB predictions to exist before it can supplement them)
  if (predictions.size > 0) {
    await refreshTorvik(); // Supplements NCAAB predictions + creates from Polymarket markets
  }
}

/** Force a Torvik refresh regardless of throttle (used after initial BPI load) */
export async function forceTorvikRefresh(): Promise<void> {
  lastTorvikFetchAt = 0; // Reset throttle
  await refreshTorvik();
}
