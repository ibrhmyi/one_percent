/**
 * Bart Torvik T-Rank — the gold standard for NCAAB predictions.
 *
 * Fetches team ratings JSON and computes head-to-head win probabilities
 * using the Log5 method with barthag values.
 *
 * barthag = probability of beating an average D1 team.
 * Log5(A beats B) = (barthag_A - barthag_A * barthag_B) /
 *                   (barthag_A + barthag_B - 2 * barthag_A * barthag_B)
 */

export interface TorvikTeam {
  rank: number;
  team: string;
  conference: string;
  record: string;
  barthag: number;     // Core metric: prob of beating average D1 team
  adjOE: number;       // Adjusted offensive efficiency
  adjDE: number;       // Adjusted defensive efficiency
  adjTempo: number;    // Adjusted tempo
}

export interface TorvikPrediction {
  homeTeam: string;
  awayTeam: string;
  homeWinProb: number;  // 0-1 scale
  awayWinProb: number;
  homeBarthag: number;
  awayBarthag: number;
  source: 'torvik';
}

// Column indices in Torvik JSON (array of arrays, positional)
// These are approximate — the exact positions may shift by year
// Key columns: 0=rank, 1=team, 2=conf, 3=record, 4=adjOE, 5=(adjOE rank),
// 6=adjDE, 7=(adjDE rank), 8=barthag, 9=(barthag rank)
const COL = {
  RANK: 0,
  TEAM: 1,
  CONF: 2,
  RECORD: 3,
  ADJOE: 4,
  ADJDE: 6,
  BARTHAG: 8,
  // Additional useful columns
  PROJ_W: 41,
  PROJ_L: 42,
};

let cachedTeams: Map<string, TorvikTeam> = new Map();
let lastFetchAt = 0;
const CACHE_DURATION_MS = 30 * 60 * 1000; // 30 minutes

/** Normalize team name for matching */
function normalize(name: string): string {
  return name.toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Fetch and cache all NCAAB team ratings */
export async function fetchTorvikRatings(): Promise<Map<string, TorvikTeam>> {
  const now = Date.now();
  if (cachedTeams.size > 0 && now - lastFetchAt < CACHE_DURATION_MS) {
    return cachedTeams;
  }

  const year = new Date().getFullYear();
  // Try current year, then previous year (season spans Dec-Apr)
  const urls = [
    `https://barttorvik.com/${year}_team_results.json`,
    `https://barttorvik.com/${year - 1}_team_results.json`,
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(15000),
        cache: 'no-store',
      });

      if (!res.ok) continue;

      const data: unknown[][] = await res.json();
      if (!Array.isArray(data) || data.length === 0) continue;

      const teams = new Map<string, TorvikTeam>();

      for (const row of data) {
        if (!Array.isArray(row) || row.length < 10) continue;

        const team: TorvikTeam = {
          rank: Number(row[COL.RANK]) || 0,
          team: String(row[COL.TEAM] ?? ''),
          conference: String(row[COL.CONF] ?? ''),
          record: String(row[COL.RECORD] ?? ''),
          barthag: Number(row[COL.BARTHAG]) || 0.5,
          adjOE: Number(row[COL.ADJOE]) || 100,
          adjDE: Number(row[COL.ADJDE]) || 100,
          adjTempo: 0, // Not critical for win prob
        };

        if (team.team && team.barthag > 0) {
          // Store under multiple keys for flexible matching
          const norm = normalize(team.team);
          teams.set(norm, team);

          // Also store under last word (mascot) for matching
          const words = norm.split(' ');
          if (words.length > 1) {
            const mascot = words[words.length - 1];
            if (mascot.length >= 4 && !teams.has(mascot)) {
              teams.set(mascot, team);
            }
          }
        }
      }

      console.log(`[Torvik] Loaded ${data.length} teams from ${url}`);
      cachedTeams = teams;
      lastFetchAt = now;
      return teams;
    } catch (err) {
      console.error(`[Torvik] Fetch error for ${url}:`, err instanceof Error ? err.message : err);
    }
  }

  return cachedTeams; // Return stale cache if fetch fails
}

/** Find a team in the Torvik data by name */
export function findTeam(name: string): TorvikTeam | null {
  const norm = normalize(name);

  // Exact match
  if (cachedTeams.has(norm)) return cachedTeams.get(norm)!;

  // Substring match
  for (const [key, team] of cachedTeams) {
    if (norm.includes(key) || key.includes(norm)) return team;
  }

  // Last word match
  const words = norm.split(' ');
  const lastWord = words[words.length - 1];
  if (lastWord && lastWord.length >= 4 && cachedTeams.has(lastWord)) {
    return cachedTeams.get(lastWord)!;
  }

  return null;
}

/**
 * Log5 method: predict head-to-head win probability from barthag values.
 * Includes home court advantage adjustment (+3.5% typical in NCAAB).
 */
export function predictMatchup(
  homeTeam: string,
  awayTeam: string,
  neutral: boolean = false
): TorvikPrediction | null {
  const home = findTeam(homeTeam);
  const away = findTeam(awayTeam);

  if (!home || !away) return null;

  let homeBarthag = home.barthag;
  let awayBarthag = away.barthag;

  // Home court advantage: ~3.5% in college basketball
  if (!neutral) {
    homeBarthag = Math.min(0.99, homeBarthag + 0.035);
  }

  // Log5 formula
  const num = homeBarthag - homeBarthag * awayBarthag;
  const den = homeBarthag + awayBarthag - 2 * homeBarthag * awayBarthag;

  const homeWinProb = den > 0 ? num / den : 0.5;

  return {
    homeTeam: home.team,
    awayTeam: away.team,
    homeWinProb: Math.max(0.01, Math.min(0.99, homeWinProb)),
    awayWinProb: Math.max(0.01, Math.min(0.99, 1 - homeWinProb)),
    homeBarthag: home.barthag,
    awayBarthag: away.barthag,
    source: 'torvik',
  };
}
