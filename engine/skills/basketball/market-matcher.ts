import type { ESPNGame, WatchedMarket } from '@/lib/types';
import type { LeagueConfig } from './types';

/**
 * Normalize a raw team name to a canonical key using the league's team map.
 */
export function normalizeTeamName(raw: string, teams: Record<string, string[]>): string | null {
  const lower = raw.toLowerCase().trim();
  for (const [canonical, aliases] of Object.entries(teams)) {
    if (lower.includes(canonical) || aliases.some(a => lower.includes(a))) {
      return canonical;
    }
  }
  return null;
}

/**
 * Get all aliases for a canonical team name.
 */
function getTeamAliases(canonical: string, teams: Record<string, string[]>): string[] {
  const base = [canonical, ...(teams[canonical] || [])];
  return base.map(s => s.toLowerCase());
}

/**
 * Match an ESPN game to a Polymarket watched market using league-specific team data.
 */
export function matchGameToMarket(
  game: ESPNGame,
  markets: WatchedMarket[],
  league: LeagueConfig
): WatchedMarket | null {
  const homeAliases = getTeamAliases(game.homeTeam.toLowerCase(), league.teams);
  const awayAliases = getTeamAliases(game.awayTeam.toLowerCase(), league.teams);

  // If no aliases found in the league team map, fall back to raw name matching
  const homeSearch = homeAliases.length > 0 ? homeAliases : [game.homeTeam.toLowerCase()];
  const awaySearch = awayAliases.length > 0 ? awayAliases : [game.awayTeam.toLowerCase()];

  for (const market of markets) {
    const title = market.title.toLowerCase();
    const hasHome = homeSearch.some(a => title.includes(a));
    const hasAway = awaySearch.some(a => title.includes(a));
    if (hasHome && hasAway) return market;
  }
  return null;
}

// Parse clobTokenIds — can be JSON string or array
export function parseTokenIds(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as string[];
    } catch {
      return [];
    }
  }
  return [];
}
