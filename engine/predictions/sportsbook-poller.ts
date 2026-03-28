/**
 * Sportsbook Poller — fetches DraftKings + FanDuel odds and feeds into aggregator.
 *
 * Strategy:
 *   1. Try fetching DK/FD DIRECTLY (works if running in US or from US IP)
 *   2. Fall back to Vercel /api/odds/scrape endpoint (US servers bypass geo-block)
 *
 * Polls every 30s to balance speed vs Vercel function invocation limits.
 * (~86K calls/month vs 100K free tier limit)
 */

import { updateBooksPrediction } from './aggregator';
import { addMessage } from '../state';

const POLL_INTERVAL_MS = 30_000; // 30 seconds — balances speed vs Vercel limits
const VERCEL_ODDS_URL = process.env.VERCEL_ODDS_URL || 'https://onepercentmarkets.vercel.app/api/odds/scrape';
const LOCAL_SCRAPE_URL = 'http://localhost:3000/api/odds/scrape'; // Try local first

let pollTimer: ReturnType<typeof setInterval> | null = null;
let lastPollAt = 0;
let consecutiveFailures = 0;
let lastOddsSnapshot: Map<string, number> = new Map(); // key -> homeWinProb for change detection

interface ScrapedGame {
  homeTeam: string;
  awayTeam: string;
  startDate: string;
  league: string;
  sources: Array<{
    book: string;
    homeWinProb: number;
    awayWinProb: number;
    homeOdds: number;
    awayOdds: number;
  }>;
  consensus: {
    homeWinProb: number;
    awayWinProb: number;
    numBooks: number;
  };
}

interface ScrapeResponse {
  draftkings: number;
  fanduel: number;
  games: ScrapedGame[];
  elapsed: number;
  timestamp: string;
}

/** Fetch odds — try local server first, then fall back to Vercel */
async function fetchOdds(): Promise<ScrapeResponse | null> {
  // Try local first (if running Next.js locally, this hits the same scraper code without Vercel limits)
  const urls = [LOCAL_SCRAPE_URL, VERCEL_ODDS_URL];

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(12000),
        headers: { 'Accept': 'application/json' },
      });

      if (!res.ok) {
        console.log(`[SportsbookPoller] ${url} returned ${res.status}, trying next...`);
        continue;
      }

      const data = await res.json();
      if (data.games && data.games.length > 0) {
        return data;
      }
      // Got response but no games — might be geo-blocked, try next
      console.log(`[SportsbookPoller] ${url} returned 0 games, trying next...`);
    } catch {
      // Connection refused (not running locally) or timeout — try next
      continue;
    }
  }

  console.error('[SportsbookPoller] All sources failed');
  return null;
}

/** Process scraped odds and feed into aggregator */
function processOdds(data: ScrapeResponse): void {
  let updated = 0;
  let oddsShifts = 0;

  for (const game of data.games) {
    if (game.consensus.numBooks === 0) continue;

    const key = `${game.homeTeam.toLowerCase()}::${game.awayTeam.toLowerCase()}`;
    const prevProb = lastOddsSnapshot.get(key);
    const newProb = game.consensus.homeWinProb;

    // Detect significant odds movement (>2% shift)
    if (prevProb !== undefined) {
      const shift = Math.abs(newProb - prevProb);
      if (shift > 0.02) {
        const direction = newProb > prevProb ? '↑' : '↓';
        addMessage({
          text: `⚡ ODDS MOVE: ${game.awayTeam} @ ${game.homeTeam} | ${game.homeTeam} ${direction} ${(prevProb * 100).toFixed(1)}% → ${(newProb * 100).toFixed(1)}% (${game.consensus.numBooks} books)`,
          type: 'warning',
        });
        oddsShifts++;
      }
    }

    lastOddsSnapshot.set(key, newProb);

    // Determine league
    const league = game.league === 'NCAAB' ? 'NCAAB' :
                   game.league === 'WNBA' ? 'WNBA' : 'NBA';

    // Feed into aggregator
    updateBooksPrediction(
      game.homeTeam,
      game.awayTeam,
      game.consensus.homeWinProb,
      game.consensus.awayWinProb,
      game.consensus.numBooks,
      game.consensus.numBooks >= 2 ? 'high' : 'medium',
      league
    );

    updated++;
  }

  if (updated > 0 || oddsShifts > 0) {
    console.log(`[SportsbookPoller] Updated ${updated} games from ${data.draftkings} DK + ${data.fanduel} FD events (${oddsShifts} shifts detected) in ${data.elapsed}ms`);
  }
}

/** Single poll cycle */
export async function pollOnce(): Promise<{ gamesUpdated: number; success: boolean }> {
  const data = await fetchOdds();

  if (!data) {
    consecutiveFailures++;
    if (consecutiveFailures >= 5) {
      addMessage({
        text: `⚠️ Sportsbook scraper offline — ${consecutiveFailures} consecutive failures`,
        type: 'warning',
      });
    }
    return { gamesUpdated: 0, success: false };
  }

  consecutiveFailures = 0;
  lastPollAt = Date.now();
  processOdds(data);

  return { gamesUpdated: data.games.length, success: true };
}

/** Start polling loop */
export function startPolling(): void {
  if (pollTimer) return; // Already running

  console.log(`[SportsbookPoller] Starting — polling ${VERCEL_ODDS_URL} every ${POLL_INTERVAL_MS / 1000}s`);

  // First poll immediately
  pollOnce();

  pollTimer = setInterval(() => {
    pollOnce();
  }, POLL_INTERVAL_MS);
}

/** Stop polling */
export function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
    console.log('[SportsbookPoller] Stopped');
  }
}

/** Get status for UI */
export function getPollerStatus(): {
  isRunning: boolean;
  lastPollAt: number;
  consecutiveFailures: number;
  trackedGames: number;
  url: string;
} {
  return {
    isRunning: pollTimer !== null,
    lastPollAt,
    consecutiveFailures,
    trackedGames: lastOddsSnapshot.size,
    url: VERCEL_ODDS_URL,
  };
}
