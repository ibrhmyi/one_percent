import { logInfo, logWarning } from './logger.js';

interface CachedMatch {
  ticker: string;
  side: 'yes' | 'no';
  confidence: number;
  foundAt: number;
}

// Manual mappings for markets we know match
const manualMappings = new Map<string, string>(); // polyConditionId -> kalshiTicker

// Cache for found matches (TTL: 10 minutes)
const matchCache = new Map<string, CachedMatch>();

const CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * Add a manual mapping between Polymarket and Kalshi
 */
export function addManualMapping(polyConditionId: string, kalshiTicker: string): void {
  manualMappings.set(polyConditionId, kalshiTicker);
  logInfo(`[market-matcher] Added manual mapping: ${polyConditionId} -> ${kalshiTicker}`);
}

/**
 * Get a manual mapping if it exists
 */
export function getManualMapping(polyConditionId: string): string | null {
  return manualMappings.get(polyConditionId) || null;
}

/**
 * Extract key terms from a title for matching
 */
function extractKeyTerms(title: string): Set<string> {
  const terms = new Set<string>();

  // Convert to lowercase and split by common delimiters
  const cleaned = title
    .toLowerCase()
    .replace(/[^a-z0-9\s\-]/g, '') // Remove special chars except dash
    .split(/\s+/);

  // Add individual terms
  for (const term of cleaned) {
    if (term.length >= 3) {
      // Only terms 3+ chars
      terms.add(term);
    }
  }

  // Extract team names (patterns like "NY Giants", "LA Lakers")
  const teamPattern = /([A-Z][a-z]+\s+[A-Z][a-z]+)/g;
  let match;
  while ((match = teamPattern.exec(title)) !== null) {
    terms.add(match[1].toLowerCase().replace(/\s/g, ''));
  }

  // Extract numbers (game times, odds, etc)
  const numberPattern = /\d+/g;
  while ((match = numberPattern.exec(title)) !== null) {
    terms.add(match[0]);
  }

  return terms;
}

/**
 * Calculate similarity score between two term sets
 */
function calculateSimilarity(polyTerms: Set<string>, kalshiTerms: Set<string>): number {
  if (polyTerms.size === 0 || kalshiTerms.size === 0) {
    return 0;
  }

  let matches = 0;
  for (const term of polyTerms) {
    if (kalshiTerms.has(term)) {
      matches++;
    }
  }

  // Jaccard similarity
  const union = new Set([...polyTerms, ...kalshiTerms]);
  return matches / union.size;
}

/**
 * Search Kalshi markets for a match by keyword
 */
async function findKalshiMarketByTitle(polyTitle: string): Promise<string | null> {
  try {
    const response = await fetch(
      'https://api.elections.kalshi.com/trade-api/rest/v2/markets?status=open&limit=200'
    );

    if (!response.ok) {
      logWarning(`[market-matcher] Failed to fetch Kalshi markets: ${response.statusText}`);
      return null;
    }

    const data = (await response.json()) as { markets: Array<{ ticker: string; title: string }> };
    const markets = data.markets || [];

    const polyTerms = extractKeyTerms(polyTitle);
    let bestMatch: { ticker: string; score: number } | null = null;

    for (const market of markets) {
      const kalshiTerms = extractKeyTerms(market.title);
      const similarity = calculateSimilarity(polyTerms, kalshiTerms);

      if (similarity > 0.6 && (!bestMatch || similarity > bestMatch.score)) {
        bestMatch = { ticker: market.ticker, score: similarity };
      }
    }

    if (bestMatch) {
      logInfo(
        `[market-matcher] Found Kalshi match for "${polyTitle}": ${bestMatch.ticker} (confidence: ${(bestMatch.score * 100).toFixed(0)}%)`
      );
      return bestMatch.ticker;
    }

    return null;
  } catch (error) {
    logWarning(`[market-matcher] Kalshi market search failed: ${String(error)}`);
    return null;
  }
}

/**
 * Find a Kalshi market match for a Polymarket signal
 */
export async function findKalshiMatch(
  polyConditionId: string,
  polyTitle: string
): Promise<{ ticker: string; side: 'yes' | 'no'; confidence: number } | null> {
  // Check cache first
  const cached = matchCache.get(polyConditionId);
  if (cached && Date.now() - cached.foundAt < CACHE_TTL_MS) {
    return {
      ticker: cached.ticker,
      side: cached.side,
      confidence: cached.confidence,
    };
  }

  // Check manual mappings
  const manual = getManualMapping(polyConditionId);
  if (manual) {
    const result = { ticker: manual, side: 'yes' as const, confidence: 1.0 };
    matchCache.set(polyConditionId, { ...result, foundAt: Date.now() });
    return result;
  }

  // Try keyword search on Kalshi
  const ticker = await findKalshiMarketByTitle(polyTitle);
  if (ticker) {
    const result = { ticker, side: 'yes' as const, confidence: 0.7 };
    matchCache.set(polyConditionId, { ...result, foundAt: Date.now() });
    return result;
  }

  // No match found
  logWarning(`[market-matcher] No Kalshi match found for "${polyTitle}"`);
  return null;
}

/**
 * Clear the match cache (useful for testing)
 */
export function clearMatchCache(): void {
  matchCache.clear();
}

/**
 * Get cache stats for debugging
 */
export function getMatchCacheStats(): { size: number; entries: Array<[string, CachedMatch]> } {
  return {
    size: matchCache.size,
    entries: Array.from(matchCache.entries()),
  };
}
