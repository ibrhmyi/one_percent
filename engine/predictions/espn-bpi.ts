/**
 * ESPN BPI (Basketball Power Index) — free, no auth, institutional credibility.
 *
 * Fetches per-game win probabilities from ESPN's predictor endpoint.
 * Works for NBA and NCAAB. Updates continuously — we poll every 5 min.
 */

export interface BPIPrediction {
  eventId: string;
  name: string;           // "San Antonio Spurs at Milwaukee Bucks"
  homeTeam: string;
  awayTeam: string;
  homeWinProb: number;    // 0-1 scale (e.g., 0.831)
  awayWinProb: number;
  homePredPtDiff: number; // predicted point differential
  homeExpectedPts: number;
  awayExpectedPts: number;
  matchupQuality: number; // 0-100 competitiveness
  lastModified: string;   // ISO timestamp
  gameDate: string;        // YYYY-MM-DD for game disambiguation
  league: 'NBA' | 'NCAAB' | 'WNBA';
}

const SCOREBOARD_URLS: Record<string, string> = {
  NBA: 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard',
  NCAAB: 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard',
  WNBA: 'https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard',
};

const PREDICTOR_BASE: Record<string, string> = {
  NBA: 'https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/events',
  NCAAB: 'https://sports.core.api.espn.com/v2/sports/basketball/leagues/mens-college-basketball/events',
  WNBA: 'https://sports.core.api.espn.com/v2/sports/basketball/leagues/wnba/events',
};

interface ESPNEvent {
  id: string;
  name: string;
  date?: string; // ISO date string from scoreboard
  competitions: Array<{
    competitors: Array<{
      homeAway: string;
      team: { displayName: string };
    }>;
  }>;
}

interface PredictorStat {
  name: string;
  value: number;
}

interface PredictorResponse {
  name?: string;
  lastModified?: string;
  homeTeam?: { statistics?: PredictorStat[] };
  awayTeam?: { statistics?: PredictorStat[] };
}

function findStat(stats: PredictorStat[] | undefined, name: string): number {
  return stats?.find(s => s.name === name)?.value ?? 0;
}

/** Fetch all game IDs from ESPN scoreboard for a league */
async function fetchEventIds(league: 'NBA' | 'NCAAB' | 'WNBA', dates?: string): Promise<ESPNEvent[]> {
  const url = new URL(SCOREBOARD_URLS[league]);
  if (dates) url.searchParams.set('dates', dates);
  // For NCAAB, need to set groups and limit to get more games
  if (league === 'NCAAB') {
    url.searchParams.set('groups', '50'); // Top 25 + major conferences
    url.searchParams.set('limit', '100');
  }

  try {
    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(10000),
      cache: 'no-store',
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.events ?? []) as ESPNEvent[];
  } catch {
    return [];
  }
}

/** Fetch BPI predictor for a single game */
async function fetchPredictor(eventId: string, league: 'NBA' | 'NCAAB' | 'WNBA'): Promise<PredictorResponse | null> {
  const url = `${PREDICTOR_BASE[league]}/${eventId}/competitions/${eventId}/predictor`;

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return await res.json() as PredictorResponse;
  } catch {
    return null;
  }
}

// ── Season-level BPI ratings for fallback matchup computation ──

interface BPIRating {
  teamRef: string;
  bpi: number;
  bpiOffense: number;
  bpiDefense: number;
}

let seasonBPIRatings: Map<string, BPIRating> = new Map();
let lastSeasonBPIFetchAt = 0;
const SEASON_BPI_INTERVAL = 60 * 60 * 1000; // 1 hour

async function fetchSeasonBPIRatings(): Promise<void> {
  const now = Date.now();
  if (now - lastSeasonBPIFetchAt < SEASON_BPI_INTERVAL && seasonBPIRatings.size > 0) return;

  try {
    const res = await fetch(
      'https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/seasons/2026/powerindex?limit=50',
      { signal: AbortSignal.timeout(10000), cache: 'no-store' }
    );
    if (!res.ok) return;
    const data = await res.json();
    const items = data.items ?? [];

    for (const item of items) {
      const teamRef = item.team?.$ref ?? '';
      const stats = item.stats ?? [];
      const bpi = stats.find((s: any) => s.name === 'bpi')?.value ?? 0;
      const off = stats.find((s: any) => s.name === 'bpioffense')?.value ?? 0;
      const def = stats.find((s: any) => s.name === 'bpidefense')?.value ?? 0;

      // Extract team ID from ref URL
      const teamIdMatch = teamRef.match(/teams\/(\d+)/);
      if (teamIdMatch) {
        seasonBPIRatings.set(teamIdMatch[1], { teamRef, bpi, bpiOffense: off, bpiDefense: def });
      }
    }

    lastSeasonBPIFetchAt = now;
    console.log(`[BPI] Season ratings loaded: ${seasonBPIRatings.size} teams`);
  } catch {
    // Silent fail
  }
}

/** Get season BPI ratings map (for external use) */
export function getSeasonBPIRatings(): Map<string, BPIRating> {
  return seasonBPIRatings;
}

export { fetchSeasonBPIRatings };

/** Fetch BPI predictions for all games across leagues */
export async function fetchBPIPredictions(leagues: Array<'NBA' | 'NCAAB' | 'WNBA'> = ['NBA', 'NCAAB']): Promise<BPIPrediction[]> {
  // Also refresh season-level ratings for fallback
  await fetchSeasonBPIRatings();
  const predictions: BPIPrediction[] = [];

  for (const league of leagues) {
    // Fetch games for the next 7 days
    const allEvents: ESPNEvent[] = [];
    const dateStrings: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      dateStrings.push(d.toISOString().slice(0, 10).replace(/-/g, ''));
    }

    // Fetch in parallel batches of 3 days to be respectful
    for (let i = 0; i < dateStrings.length; i += 3) {
      const batch = dateStrings.slice(i, i + 3);
      const results = await Promise.all(batch.map(ds => fetchEventIds(league, ds)));
      for (let j = 0; j < results.length; j++) {
        // Tag each event with the date we fetched it for (ESPN date format: YYYYMMDD -> YYYY-MM-DD)
        const fetchDate = batch[j];
        const isoDate = `${fetchDate.slice(0,4)}-${fetchDate.slice(4,6)}-${fetchDate.slice(6,8)}`;
        for (const evt of results[j]) {
          if (!evt.date) evt.date = isoDate;
        }
        allEvents.push(...results[j]);
      }
      if (i + 3 < dateStrings.length) await new Promise(r => setTimeout(r, 200));
    }

    // Deduplicate by event ID
    const seen = new Set<string>();
    const uniqueEvents = allEvents.filter(e => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });

    console.log(`[BPI] ${league}: ${uniqueEvents.length} games found`);

    // Fetch predictors in parallel (batches of 5 to be respectful)
    for (let i = 0; i < uniqueEvents.length; i += 5) {
      const batch = uniqueEvents.slice(i, i + 5);
      const results = await Promise.all(
        batch.map(async (event) => {
          const predictor = await fetchPredictor(event.id, league);
          if (!predictor) return null;

          const homeComp = event.competitions?.[0]?.competitors?.find(c => c.homeAway === 'home');
          const awayComp = event.competitions?.[0]?.competitors?.find(c => c.homeAway === 'away');

          // ESPN predictor structure: stats are ONLY under awayTeam node.
          // awayTeam.statistics.gameProjection = the AWAY team's win probability
          // awayTeam.statistics.teamChanceLoss = the AWAY team's loss probability (= home win prob)
          // homeTeam has no inline statistics, only a team.$ref
          const awayStats = predictor.awayTeam?.statistics;
          const homeStats = predictor.homeTeam?.statistics;

          // Try awayTeam stats first (this is where ESPN puts them)
          let awayWinProb = findStat(awayStats, 'gameProjection') / 100;
          let homeWinProb = findStat(awayStats, 'teamChanceLoss') / 100;

          // Fallback: if homeTeam has stats instead
          if (awayWinProb === 0 && homeWinProb === 0 && homeStats) {
            homeWinProb = findStat(homeStats, 'gameProjection') / 100;
            awayWinProb = findStat(homeStats, 'teamChanceLoss') / 100;
          }

          // If still 0, skip
          if (homeWinProb === 0 && awayWinProb === 0) return null;

          // Normalize so they sum to 1
          if (homeWinProb + awayWinProb > 0) {
            const total = homeWinProb + awayWinProb;
            homeWinProb = homeWinProb / total;
            awayWinProb = awayWinProb / total;
          }

          return {
            eventId: event.id,
            name: predictor.name ?? event.name,
            homeTeam: homeComp?.team?.displayName ?? '',
            awayTeam: awayComp?.team?.displayName ?? '',
            homeWinProb,
            awayWinProb,
            homePredPtDiff: findStat(homeStats, 'teamPredPtDiff'),
            homeExpectedPts: findStat(homeStats, 'teamExpectedPts'),
            awayExpectedPts: findStat(awayStats, 'teamExpectedPts'),
            matchupQuality: findStat(homeStats, 'matchupQuality') || findStat(awayStats, 'matchupQuality'),
            lastModified: predictor.lastModified ?? new Date().toISOString(),
            gameDate: event.date ? new Date(event.date).toISOString().slice(0, 10) : '',
            league,
          } as BPIPrediction;
        })
      );

      for (const r of results) {
        if (r) predictions.push(r);
      }

      // Small delay between batches
      if (i + 5 < uniqueEvents.length) {
        await new Promise(r => setTimeout(r, 200));
      }
    }
  }

  return predictions;
}
