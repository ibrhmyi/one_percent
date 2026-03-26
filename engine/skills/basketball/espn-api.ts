import type { ESPNGame } from '@/lib/types';
import type { ESPNPlay } from './types';

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports';

function parseClockToSeconds(displayClock: string): number {
  const parts = displayClock.split(':');
  if (parts.length === 2) {
    return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
  }
  return 0;
}

function calcSecondsRemaining(
  state: string,
  period: number,
  displayClock: string,
  quarterSeconds: number,
  totalPeriods: number
): number {
  if (state === 'post') return 0;
  if (state === 'pre') return quarterSeconds * totalPeriods;

  const currentPeriodSeconds = parseClockToSeconds(displayClock);

  if (period > totalPeriods) {
    // Overtime — just the remaining seconds in this OT period
    return currentPeriodSeconds;
  }

  const remainingFullPeriods = Math.max(0, totalPeriods - period);
  return currentPeriodSeconds + remainingFullPeriods * quarterSeconds;
}

/**
 * Fetch scoreboard from ESPN for any basketball league.
 * @param sportPath - e.g. 'basketball/nba', 'basketball/mens-college-basketball'
 * @param league - league identifier to tag on returned games, e.g. 'NBA', 'NCAAB'
 * @param quarterSeconds - seconds per regulation period (720 for NBA, 1200 for NCAA)
 * @param totalPeriods - regulation periods (4 for NBA, 2 for NCAA)
 */
export async function fetchScoreboard(
  sportPath: string,
  league: string,
  quarterSeconds: number = 720,
  totalPeriods: number = 4
): Promise<ESPNGame[]> {
  // Fetch the next 7 days so upcoming market start times are accurate.
  const now = new Date();
  const dates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now.getTime() + i * 86_400_000);
    return d.toISOString().substring(0, 10).replace(/-/g, '');
  });

  const allGames: ESPNGame[] = [];
  const seenIds = new Set<string>();

  for (const dateStr of dates) {
    try {
      const res = await fetch(`${ESPN_BASE}/${sportPath}/scoreboard?dates=${dateStr}`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(5000),
        headers: { 'Accept': 'application/json' },
      });

      if (!res.ok) continue;

      const data = await res.json();
      const events = data?.events ?? [];

      for (const event of events) {
        try {
          const gameId = String(event.id ?? '');
          if (seenIds.has(gameId)) continue;
          seenIds.add(gameId);

          const competition = event.competitions?.[0];
          if (!competition) continue;

          const status = event.status;
          const state = (status?.type?.state ?? 'pre') as 'pre' | 'in' | 'post';
          const period: number = status?.period ?? 1;
          const displayClock: string = status?.displayClock ?? '12:00';

          const competitors: Array<{
            homeAway: string;
            team: { shortDisplayName: string; displayName: string; name: string; abbreviation: string };
            score: string;
          }> = competition.competitors ?? [];

          const home = competitors.find((c) => c.homeAway === 'home');
          const away = competitors.find((c) => c.homeAway === 'away');

          if (!home || !away) continue;

          const homeScore = parseInt(home.score ?? '0', 10);
          const awayScore = parseInt(away.score ?? '0', 10);
          const secondsRemaining = calcSecondsRemaining(state, period, displayClock, quarterSeconds, totalPeriods);

          allGames.push({
            id: gameId,
            name: String(event.name ?? ''),
            homeTeam: String(home.team.shortDisplayName || home.team.displayName || home.team.name || ''),
            awayTeam: String(away.team.shortDisplayName || away.team.displayName || away.team.name || ''),
            homeAbbr: (home.team.abbreviation ?? '').toLowerCase(),
            awayAbbr: (away.team.abbreviation ?? '').toLowerCase(),
            homeScore,
            awayScore,
            period,
            clock: displayClock,
            state,
            secondsRemaining,
            scheduledStart: String(event.date ?? new Date().toISOString()),
            league,
          });
        } catch {
          // Skip malformed game entries
        }
      }
    } catch {
      // Skip failed date fetch
    }
  }

  return allGames;
}

export function getLiveGames(games: ESPNGame[]): ESPNGame[] {
  return games.filter(g => g.state === 'in');
}

export function getUpcomingGames(games: ESPNGame[]): ESPNGame[] {
  return games.filter(g => g.state === 'pre');
}

/**
 * Fetch play-by-play for foul detection.
 * @param sportPath - e.g. 'basketball/nba'
 * @param gameId - ESPN game ID
 */
export async function fetchPlayByPlay(sportPath: string, gameId: string): Promise<ESPNPlay[]> {
  try {
    const response = await fetch(
      `${ESPN_BASE}/${sportPath}/summary?event=${gameId}`,
      { cache: 'no-store', signal: AbortSignal.timeout(3000) }
    );
    if (!response.ok) return [];

    const data = await response.json();
    const rawPlays: Record<string, unknown>[] = data?.plays ?? data?.recentPlays ?? [];

    const plays: ESPNPlay[] = [];
    for (const p of rawPlays) {
      const typeText = String((p?.type as Record<string, unknown>)?.text ?? '');
      const lower = typeText.toLowerCase();
      if (!lower.includes('foul') && !lower.includes('free throw')) continue;

      plays.push({
        id: String(p?.id ?? ''),
        type: typeText,
        description: String(p?.text ?? ''),
        teamId: String((p?.team as Record<string, unknown>)?.id ?? ''),
        period: parseInt(String((p?.period as Record<string, unknown>)?.number ?? '0'), 10),
        clock: String((p?.clock as Record<string, unknown>)?.displayValue ?? '0:00'),
        homeScore: parseInt(String(p?.homeScore ?? '0'), 10),
        awayScore: parseInt(String(p?.awayScore ?? '0'), 10)
      });
    }
    return plays;
  } catch {
    return [];
  }
}
