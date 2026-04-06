/**
 * NBA.com CDN API — Parallel data source for faster scoring detection.
 *
 * NBA.com CDN updates ~2-5s faster than ESPN REST because it's the primary
 * data origin (ESPN aggregates from NBA + other sources).
 *
 * Endpoints (free, no auth, requires specific headers):
 *   - Scoreboard: cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json
 *   - Play-by-play: cdn.nba.com/static/json/liveData/playbyplay/playbyplay_{GAME_ID}.json
 *
 * Play-by-play gives individual plays with types, so we detect scoring by
 * play type (Made Shot) + play ID dedup, not by diffing totals.
 */

const NBA_CDN_BASE = 'https://cdn.nba.com/static/json/liveData';

const NBA_HEADERS: HeadersInit = {
  'Accept': 'application/json',
  'Referer': 'https://www.nba.com/',
  'Origin': 'https://www.nba.com',
};

export interface NBAPlay {
  actionNumber: number;       // Unique play ID within game
  clock: string;              // "PT04M30.00S" ISO 8601 duration
  period: number;
  teamTricode: string;        // "LAL", "BOS", etc.
  actionType: string;         // "2pt", "3pt", "freethrow", etc.
  subType: string;            // "Jump Shot", "Layup", etc.
  description: string;
  scoreHome: string;          // "45"
  scoreAway: string;          // "42"
  shotResult?: string;        // "Made" or "Missed"
  isFieldGoal: number;        // 1 = field goal attempt
  pointsTotal?: number;       // Player's total points
}

export interface NBAScoreboardGame {
  gameId: string;
  gameStatus: number;         // 1=pre, 2=live, 3=post
  period: number;
  gameClock: string;          // "PT04M30.00S" or ""
  homeTeam: {
    teamTricode: string;
    score: number;
  };
  awayTeam: {
    teamTricode: string;
    score: number;
  };
}

export interface ScoringPlay {
  playId: number;             // actionNumber — unique per game
  gameId: string;
  period: number;
  clock: string;
  teamTricode: string;
  isHome: boolean;
  points: number;             // 1, 2, or 3
  actionType: string;         // "2pt", "3pt", "freethrow"
  description: string;
  scoreHome: number;
  scoreAway: number;
  detectedAt: number;         // Date.now() when we first saw this play
}

/**
 * Fetch today's NBA scoreboard from CDN.
 * Returns live game IDs for play-by-play polling.
 */
export async function fetchNBACDNScoreboard(): Promise<NBAScoreboardGame[]> {
  try {
    const res = await fetch(`${NBA_CDN_BASE}/scoreboard/todaysScoreboard_00.json`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
      headers: NBA_HEADERS,
    });
    if (!res.ok) return [];

    const data = await res.json();
    const games = data?.scoreboard?.games ?? [];

    return games.map((g: Record<string, unknown>) => ({
      gameId: String(g.gameId ?? ''),
      gameStatus: Number(g.gameStatus ?? 1),
      period: Number(g.period ?? 1),
      gameClock: String(g.gameClock ?? ''),
      homeTeam: {
        teamTricode: String((g.homeTeam as Record<string, unknown>)?.teamTricode ?? ''),
        score: Number((g.homeTeam as Record<string, unknown>)?.score ?? 0),
      },
      awayTeam: {
        teamTricode: String((g.awayTeam as Record<string, unknown>)?.teamTricode ?? ''),
        score: Number((g.awayTeam as Record<string, unknown>)?.score ?? 0),
      },
    }));
  } catch {
    return [];
  }
}

/**
 * Fetch play-by-play for a specific game from NBA CDN.
 * Returns ALL plays — caller filters for new scoring plays.
 */
export async function fetchNBACDNPlayByPlay(gameId: string): Promise<NBAPlay[]> {
  try {
    const res = await fetch(`${NBA_CDN_BASE}/playbyplay/playbyplay_${gameId}.json`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
      headers: NBA_HEADERS,
    });
    if (!res.ok) return [];

    const data = await res.json();
    const actions = data?.game?.actions ?? [];

    return actions.map((a: Record<string, unknown>) => ({
      actionNumber: Number(a.actionNumber ?? 0),
      clock: String(a.clock ?? ''),
      period: Number(a.period ?? 1),
      teamTricode: String(a.teamTricode ?? ''),
      actionType: String(a.actionType ?? ''),
      subType: String(a.subType ?? ''),
      description: String(a.description ?? ''),
      scoreHome: String(a.scoreHome ?? '0'),
      scoreAway: String(a.scoreAway ?? '0'),
      shotResult: a.shotResult ? String(a.shotResult) : undefined,
      isFieldGoal: Number(a.isFieldGoal ?? 0),
      pointsTotal: a.pointsTotal ? Number(a.pointsTotal) : undefined,
    }));
  } catch {
    return [];
  }
}

/**
 * Extract new scoring plays from play-by-play data.
 * Uses actionNumber as unique play ID — only returns plays not in seenPlays.
 */
export function extractScoringPlays(
  plays: NBAPlay[],
  gameId: string,
  homeTricode: string,
  seenPlays: Set<string>,
): ScoringPlay[] {
  const newScoring: ScoringPlay[] = [];

  for (const play of plays) {
    const playKey = `${gameId}:${play.actionNumber}`;
    if (seenPlays.has(playKey)) continue;

    // Only care about made shots and made free throws
    const isMadeShot = play.isFieldGoal === 1 && play.shotResult === 'Made';
    const isMadeFT = play.actionType === 'freethrow' && play.shotResult === 'Made';

    if (!isMadeShot && !isMadeFT) continue;
    if (!play.teamTricode) continue;

    seenPlays.add(playKey);

    let points = 0;
    if (play.actionType === '3pt') points = 3;
    else if (play.actionType === '2pt') points = 2;
    else if (play.actionType === 'freethrow') points = 1;
    else points = 2; // fallback for unrecognized field goals

    newScoring.push({
      playId: play.actionNumber,
      gameId,
      period: play.period,
      clock: play.clock,
      teamTricode: play.teamTricode,
      isHome: play.teamTricode.toUpperCase() === homeTricode.toUpperCase(),
      points,
      actionType: play.actionType,
      description: play.description,
      scoreHome: parseInt(play.scoreHome, 10) || 0,
      scoreAway: parseInt(play.scoreAway, 10) || 0,
      detectedAt: Date.now(),
    });
  }

  return newScoring;
}

/**
 * Parse NBA clock format "PT04M30.00S" to seconds remaining in period.
 */
export function parseNBAClock(clock: string): number {
  if (!clock) return 0;
  const match = clock.match(/PT(\d+)M([\d.]+)S/);
  if (!match) return 0;
  return parseInt(match[1], 10) * 60 + parseFloat(match[2]);
}

/**
 * Calculate total seconds remaining in game from period + clock.
 */
export function calcNBASecsRemaining(period: number, clock: string): number {
  const QUARTER_SECONDS = 12 * 60;
  const periodSecs = parseNBAClock(clock);

  if (period > 4) {
    // Overtime — 5 min periods
    return periodSecs;
  }

  const remainingFullPeriods = Math.max(0, 4 - period);
  return periodSecs + remainingFullPeriods * QUARTER_SECONDS;
}
