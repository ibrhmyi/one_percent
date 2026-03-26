import type { ESPNGame } from '@/lib/types';

const ESPN_URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';

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
  const res = await fetch(ESPN_URL, {
    next: { revalidate: 0 },
    headers: { 'Accept': 'application/json' },
  });

  if (!res.ok) throw new Error(`ESPN API error: ${res.status}`);

  const data = await res.json();
  const events = data?.events ?? [];
  const games: ESPNGame[] = [];

  for (const event of events) {
    try {
      const competition = event.competitions?.[0];
      if (!competition) continue;

      const status = event.status;
      const state = status?.type?.state ?? 'pre';
      const period: number = status?.period ?? 1;
      const displayClock: string = status?.displayClock ?? '12:00';

      const competitors: Array<{ homeAway: string; team: { shortDisplayName: string; abbreviation: string }; score: string }> =
        competition.competitors ?? [];

      const home = competitors.find((c) => c.homeAway === 'home');
      const away = competitors.find((c) => c.homeAway === 'away');

      if (!home || !away) continue;

      const homeScore = parseInt(home.score ?? '0', 10);
      const awayScore = parseInt(away.score ?? '0', 10);
      const secondsRemaining = calcSecondsRemaining(state, period, displayClock);

      games.push({
        id: event.id,
        name: event.name,
        homeTeam: home.team.shortDisplayName,
        awayTeam: away.team.shortDisplayName,
        homeAbbr: (home.team.abbreviation ?? '').toLowerCase(),
        awayAbbr: (away.team.abbreviation ?? '').toLowerCase(),
        homeScore,
        awayScore,
        period,
        clock: displayClock,
        state: state as 'pre' | 'in' | 'post',
        secondsRemaining,
        scheduledStart: String(event.date ?? new Date().toISOString()),
      });
    } catch {
      // Skip malformed game entries
    }
  }

  return games;
}
