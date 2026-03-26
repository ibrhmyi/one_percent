import type { ESPNGame } from '@/lib/types';

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';

function parseClockToSeconds(displayClock: string): number {
  const parts = displayClock.split(':');
  if (parts.length === 2) {
    return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
  }
  return 0;
}

function calcSecondsRemaining(state: string, period: number, displayClock: string): number {
  if (state === 'post') return 0;
  if (state === 'pre') return 48 * 60;

  const QUARTER_SECONDS = 12 * 60;
  const currentPeriodSeconds = parseClockToSeconds(displayClock);

  if (period > 4) {
    // Overtime — just the remaining seconds in this OT period
    return currentPeriodSeconds;
  }

  const remainingFullPeriods = Math.max(0, 4 - period);
  return currentPeriodSeconds + remainingFullPeriods * QUARTER_SECONDS;
}

export async function fetchNBAScoreboard(): Promise<ESPNGame[]> {
  // Fetch the next 7 days so upcoming market start times are accurate.
  // ESPN scoreboard returns both live and scheduled games for each date.
  const now = new Date();
  const dates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now.getTime() + i * 86_400_000);
    return d.toISOString().substring(0, 10).replace(/-/g, '');
  });

  const allGames: ESPNGame[] = [];
  const seenIds = new Set<string>();

  for (const dateStr of dates) {
    try {
      const res = await fetch(`${ESPN_BASE}/scoreboard?dates=${dateStr}`, {
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
          const secondsRemaining = calcSecondsRemaining(state, period, displayClock);

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

export interface ESPNPlay {
  id: string;
  type: string;        // e.g. 'Personal Foul', 'Flagrant Foul', 'Free Throw'
  description: string;
  teamId: string;
  period: number;
  clock: string;
  homeScore: number;
  awayScore: number;
}

export async function fetchPlayByPlay(gameId: string): Promise<ESPNPlay[]> {
  try {
    const response = await fetch(
      `${ESPN_BASE}/summary?event=${gameId}`,
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
