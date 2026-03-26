import type { ESPNGame, WatchedMarket } from '@/lib/types';
import { getTeamAliases, NBA_TEAMS } from './team-data';

// Match an ESPN game to a Polymarket watched market
export function matchGameToMarket(
  game: ESPNGame,
  markets: WatchedMarket[]
): WatchedMarket | null {
  const homeAliases = getTeamAliases(game.homeTeam.toLowerCase());
  const awayAliases = getTeamAliases(game.awayTeam.toLowerCase());

  for (const market of markets) {
    const title = market.title.toLowerCase();
    const hasHome = homeAliases.some(a => title.includes(a));
    const hasAway = awayAliases.some(a => title.includes(a));
    if (hasHome && hasAway) return market;
  }
  return null;
}

// Filter markets to NBA-related ones
export function isNBAMarket(market: { title?: string; question?: string; tags?: Array<{ label?: string }> }): boolean {
  const title = (market.question || market.title || '').toLowerCase();
  const tags = Array.isArray(market.tags)
    ? market.tags.map(t => (t.label ?? '').toLowerCase())
    : [];

  const hasNBATag = tags.some(t => t.includes('nba') || t.includes('basketball'));
  const titleHasNBA = title.includes('nba') || title.includes('basketball');

  // Count how many NBA teams appear in title
  const matchedTeams = Object.keys(NBA_TEAMS).filter((team: string) => {
    const aliases = [team, ...(NBA_TEAMS[team] as string[])];
    return aliases.some((alias: string) => title.includes(alias));
  });

  return (hasNBATag || titleHasNBA) && matchedTeams.length >= 2;
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
