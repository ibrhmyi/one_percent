/**
 * Pinnacle Guest API — sharpest sportsbook odds, FREE, no auth, no geo-blocking.
 *
 * Pinnacle is the gold standard for odds accuracy:
 * - 2-3% vig (vs 5-8% at DraftKings/FanDuel)
 * - Doesn't ban winners → lines are bet into efficiency by the best bettors
 * - Highest limits → real money conviction behind every line
 *
 * De-vigged Pinnacle odds are the closest thing to "true probability" in sports betting.
 */

import { updateBooksPrediction } from './aggregator';
import { addMessage } from '../state';

const PINNACLE_BASE = 'https://guest.api.arcadia.pinnacle.com/0.1';

// League IDs
const LEAGUES: Record<string, { id: number; sport: string }> = {
  NBA: { id: 487, sport: 'basketball_nba' },
  NCAAB: { id: 493, sport: 'basketball_ncaab' },
  WNBA: { id: 578, sport: 'basketball_wnba' },
};

const POLL_INTERVAL_MS = 60_000; // 60 seconds — respectful, Pinnacle is free
let pollTimer: ReturnType<typeof setInterval> | null = null;
let lastPollAt = 0;
let lastOddsSnapshot: Map<string, number> = new Map();

interface PinnacleMatchup {
  id: number;
  participants: Array<{
    name: string;
    alignment: 'home' | 'away';
  }>;
  startTime: string;
  status?: string;
}

interface PinnacleMarket {
  matchupId: number;
  type: string;
  period: number;
  prices: Array<{
    designation: 'home' | 'away' | 'over' | 'under';
    price: number; // American odds
    points?: number;
  }>;
  status?: string;
}

/** Convert American odds to implied probability */
function americanToImplied(odds: number): number {
  if (odds > 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

/** Remove vig from two-way market */
function devig(homeImplied: number, awayImplied: number): { home: number; away: number } {
  const total = homeImplied + awayImplied;
  return {
    home: homeImplied / total,
    away: awayImplied / total,
  };
}

/** Fetch matchups and markets for a league */
async function fetchLeague(leagueName: string, leagueId: number): Promise<Array<{
  homeTeam: string;
  awayTeam: string;
  startTime: string;
  homeWinProb: number;
  awayWinProb: number;
  homeOdds: number;
  awayOdds: number;
}>> {
  const results: Array<{
    homeTeam: string;
    awayTeam: string;
    startTime: string;
    homeWinProb: number;
    awayWinProb: number;
    homeOdds: number;
    awayOdds: number;
  }> = [];

  try {
    // Fetch matchups and markets in parallel
    const [matchupsRes, marketsRes] = await Promise.all([
      fetch(`${PINNACLE_BASE}/leagues/${leagueId}/matchups`, {
        signal: AbortSignal.timeout(10000),
        headers: { 'Accept': 'application/json' },
      }),
      fetch(`${PINNACLE_BASE}/leagues/${leagueId}/markets/straight`, {
        signal: AbortSignal.timeout(10000),
        headers: { 'Accept': 'application/json' },
      }),
    ]);

    if (!matchupsRes.ok || !marketsRes.ok) {
      console.log(`[Pinnacle] ${leagueName}: matchups=${matchupsRes.status}, markets=${marketsRes.status}`);
      return results;
    }

    const matchups: PinnacleMatchup[] = await matchupsRes.json();
    const markets: PinnacleMarket[] = await marketsRes.json();

    // Build matchup map
    const matchupMap = new Map<number, PinnacleMatchup>();
    for (const m of matchups) {
      if (m.participants && m.participants.length >= 2) {
        matchupMap.set(m.id, m);
      }
    }

    // Find full-game moneyline markets
    for (const market of markets) {
      if (market.type !== 'moneyline' || market.period !== 0) continue;
      if (market.status && market.status !== 'open') continue;

      const matchup = matchupMap.get(market.matchupId);
      if (!matchup) continue;

      const homeParticipant = matchup.participants.find(p => p.alignment === 'home');
      const awayParticipant = matchup.participants.find(p => p.alignment === 'away');
      if (!homeParticipant || !awayParticipant) continue;

      const homePrice = market.prices?.find(p => p.designation === 'home');
      const awayPrice = market.prices?.find(p => p.designation === 'away');
      if (!homePrice || !awayPrice) continue;

      const homeImplied = americanToImplied(homePrice.price);
      const awayImplied = americanToImplied(awayPrice.price);
      const fair = devig(homeImplied, awayImplied);

      results.push({
        homeTeam: homeParticipant.name,
        awayTeam: awayParticipant.name,
        startTime: matchup.startTime,
        homeWinProb: fair.home,
        awayWinProb: fair.away,
        homeOdds: homePrice.price,
        awayOdds: awayPrice.price,
      });
    }
  } catch (err) {
    console.error(`[Pinnacle] ${leagueName} error:`, err instanceof Error ? err.message : err);
  }

  return results;
}

/** Poll all basketball leagues and feed into aggregator */
export async function pollPinnacle(): Promise<{ gamesUpdated: number }> {
  let totalUpdated = 0;
  let oddsShifts = 0;

  for (const [leagueName, config] of Object.entries(LEAGUES)) {
    const games = await fetchLeague(leagueName, config.id);

    for (const game of games) {
      const key = `${game.homeTeam.toLowerCase()}::${game.awayTeam.toLowerCase()}`;
      const prevProb = lastOddsSnapshot.get(key);
      const newProb = game.homeWinProb;

      // Detect significant odds movement (>2% shift)
      if (prevProb !== undefined) {
        const shift = Math.abs(newProb - prevProb);
        if (shift > 0.02) {
          const direction = newProb > prevProb ? '↑' : '↓';
          addMessage({
            text: `⚡ PINNACLE MOVE: ${game.awayTeam} @ ${game.homeTeam} | ${game.homeTeam} ${direction} ${(prevProb * 100).toFixed(1)}% → ${(newProb * 100).toFixed(1)}% (vig-free)`,
            type: 'warning',
          });
          oddsShifts++;
        }
      }

      lastOddsSnapshot.set(key, newProb);

      // Determine league for aggregator
      const league = leagueName === 'NCAAB' ? 'NCAAB' :
                     leagueName === 'WNBA' ? 'WNBA' : 'NBA';

      // Extract game date from startTime
      const gameDate = game.startTime ? new Date(game.startTime).toISOString().slice(0, 10) : undefined;

      // Feed into aggregator — Pinnacle counts as "Books" source with highest credibility
      updateBooksPrediction(
        game.homeTeam,
        game.awayTeam,
        game.homeWinProb,
        game.awayWinProb,
        1, // numBooks = 1 (Pinnacle alone, but it's the sharpest)
        'high', // Pinnacle is always high confidence
        league,
        gameDate
      );

      totalUpdated++;
    }

    if (games.length > 0) {
      console.log(`[Pinnacle] ${leagueName}: ${games.length} games with moneyline odds`);
    }
  }

  if (oddsShifts > 0) {
    console.log(`[Pinnacle] ${oddsShifts} significant odds movements detected`);
  }

  lastPollAt = Date.now();
  return { gamesUpdated: totalUpdated };
}

/** Start polling Pinnacle every 60s */
export function startPinnaclePoller(): void {
  if (pollTimer) return;

  console.log('[Pinnacle] Starting poller — every 60s, sharpest odds in the world');

  // First poll immediately
  pollPinnacle().then(r => {
    if (r.gamesUpdated > 0) {
      addMessage({
        text: `Pinnacle connected: ${r.gamesUpdated} games with sharp odds`,
        type: 'success',
      });
    }
  });

  pollTimer = setInterval(() => {
    pollPinnacle();
  }, POLL_INTERVAL_MS);
}

export function stopPinnaclePoller(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

export function getPinnacleStatus(): {
  isRunning: boolean;
  lastPollAt: number;
  trackedGames: number;
} {
  return {
    isRunning: pollTimer !== null,
    lastPollAt,
    trackedGames: lastOddsSnapshot.size,
  };
}
