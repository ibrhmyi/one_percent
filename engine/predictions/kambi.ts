/**
 * Kambi API (via Unibet) — free, no auth, no geo-blocking.
 *
 * Second sportsbook source alongside Pinnacle.
 * Kambi is used by Unibet, 888sport, BetRivers, and others.
 * Semi-sharp European book — independent pricing from Pinnacle.
 *
 * Two books agreeing = high confidence in the fair value.
 * Two books disagreeing = market uncertainty, wider edge thresholds needed.
 */

import { updateBooksPrediction } from './aggregator';
import { addMessage } from '../state';

const KAMBI_BASE = 'https://eu-offering-api.kambicdn.com/offering/v2018/ub';

const POLL_INTERVAL_MS = 60_000; // 60 seconds
let pollTimer: ReturnType<typeof setInterval> | null = null;
let lastPollAt = 0;

interface KambiEvent {
  event: {
    id: number;
    name: string;       // "Team A - Team B" or "Team A @ Team B"
    homeName: string;
    awayName: string;
    start: string;       // ISO datetime
    sport: string;
    path: Array<{ name: string }>;
  };
  betOffers?: Array<{
    betOfferType: { name: string };
    outcomes: Array<{
      label: string;
      odds: number;       // Decimal odds × 1000 (e.g., 2950 = 2.95)
      type: string;       // "OT_ONE" (home), "OT_TWO" (away)
      participant?: string;
    }>;
  }>;
}

/** Convert Kambi odds (×1000) to fair probability */
function kambiToImplied(oddsX1000: number): number {
  const decimal = oddsX1000 / 1000;
  return 1 / decimal;
}

function devig(homeImplied: number, awayImplied: number): { home: number; away: number } {
  const total = homeImplied + awayImplied;
  return { home: homeImplied / total, away: awayImplied / total };
}

async function fetchKambiBasketball(path: string, league: string): Promise<Array<{
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
    const url = `${KAMBI_BASE}/listView/${path}.json?lang=en_GB&market=GB`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: { 'Accept': 'application/json' },
    });

    if (!res.ok) {
      console.log(`[Kambi] ${league} returned ${res.status}`);
      return results;
    }

    const data = await res.json();
    const events: KambiEvent[] = data.events ?? [];

    for (const evt of events) {
      if (!evt.event || !evt.betOffers) continue;

      const homeName = evt.event.homeName ?? '';
      const awayName = evt.event.awayName ?? '';
      if (!homeName || !awayName) continue;

      // Find moneyline bet offer
      const mlOffer = evt.betOffers.find(bo =>
        bo.betOfferType?.name?.toLowerCase().includes('match') ||
        bo.betOfferType?.name?.toLowerCase().includes('moneyline') ||
        bo.betOfferType?.name?.toLowerCase().includes('winner')
      );

      if (!mlOffer || !mlOffer.outcomes || mlOffer.outcomes.length < 2) continue;

      // Find home and away outcomes
      const homeOutcome = mlOffer.outcomes.find(o =>
        o.type === 'OT_ONE' || o.label === homeName || o.participant === homeName
      );
      const awayOutcome = mlOffer.outcomes.find(o =>
        o.type === 'OT_TWO' || o.label === awayName || o.participant === awayName
      );

      if (!homeOutcome?.odds || !awayOutcome?.odds) continue;

      const homeImplied = kambiToImplied(homeOutcome.odds);
      const awayImplied = kambiToImplied(awayOutcome.odds);
      const fair = devig(homeImplied, awayImplied);

      results.push({
        homeTeam: homeName,
        awayTeam: awayName,
        startTime: evt.event.start,
        homeWinProb: fair.home,
        awayWinProb: fair.away,
        homeOdds: homeOutcome.odds / 1000,
        awayOdds: awayOutcome.odds / 1000,
      });
    }
  } catch (err) {
    console.error(`[Kambi] ${league} error:`, err instanceof Error ? err.message : err);
  }

  return results;
}

export async function pollKambi(): Promise<{ gamesUpdated: number }> {
  let totalUpdated = 0;

  // Fetch NBA and NCAAB
  const leagues = [
    { path: 'basketball/nba', name: 'NBA', league: 'NBA' as const },
    { path: 'basketball/ncaa', name: 'NCAAB', league: 'NCAAB' as const },
  ];

  for (const { path, name, league } of leagues) {
    const games = await fetchKambiBasketball(path, name);

    for (const game of games) {
      const gameDate = game.startTime ? new Date(game.startTime).toISOString().slice(0, 10) : undefined;

      // Feed into aggregator — Kambi data merges with Pinnacle
      // When both Pinnacle + Kambi are available, the aggregator sees numBooks=2
      // which increases confidence
      updateBooksPrediction(
        game.homeTeam,
        game.awayTeam,
        game.homeWinProb,
        game.awayWinProb,
        2, // Signal that we now have 2 independent book sources
        'high',
        league,
        gameDate
      );

      totalUpdated++;
    }

    if (games.length > 0) {
      console.log(`[Kambi] ${name}: ${games.length} games with odds`);
    }
  }

  lastPollAt = Date.now();
  return { gamesUpdated: totalUpdated };
}

export function startKambiPoller(): void {
  if (pollTimer) return;

  console.log('[Kambi] Starting poller — Unibet odds via Kambi, every 60s');

  pollKambi().then(r => {
    if (r.gamesUpdated > 0) {
      addMessage({
        text: `Kambi/Unibet connected: ${r.gamesUpdated} games`,
        type: 'success',
      });
    }
  });

  pollTimer = setInterval(() => {
    pollKambi();
  }, POLL_INTERVAL_MS);
}

export function stopKambiPoller(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
