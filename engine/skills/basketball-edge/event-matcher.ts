import { OddsAPIGame } from './types';
import type { WatchedMarket } from '@/lib/types';

// Common NCAAB name aliases
const TEAM_ALIASES: Record<string, string[]> = {
  'north carolina state wolfpack': ['nc state'],
  'connecticut huskies': ['uconn'],
  'southern california trojans': ['usc'],
  'louisiana state tigers': ['lsu'],
  'texas christian horned frogs': ['tcu'],
  'brigham young cougars': ['byu'],
  'mississippi rebels': ['ole miss'],
  'mississippi state bulldogs': ['miss state', 'mississippi st'],
  'virginia commonwealth rams': ['vcu'],
  'southern methodist mustangs': ['smu'],
  'central florida knights': ['ucf'],
  'st johns red storm': ['st johns', 'saint johns'],
  'miami hurricanes': ['miami fl'],
  'pittsburgh panthers': ['pitt'],
  'california golden bears': ['cal'],
  'alabama crimson tide': ['alabama', 'bama'],
  'michigan state spartans': ['mich state', 'mich st'],
  'florida state seminoles': ['fsu'],
  'san diego state aztecs': ['sdsu'],
};

function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
}

function lastWord(name: string): string | null {
  const parts = name.trim().split(/\s+/);
  const last = parts[parts.length - 1]?.toLowerCase();
  if (!last || ['state', 'city', 'university'].includes(last)) {
    return parts.length >= 2 ? parts[parts.length - 2]?.toLowerCase() ?? null : null;
  }
  return last;
}

function getAliases(teamName: string): string[] {
  const norm = normalize(teamName);
  const aliases = TEAM_ALIASES[norm];
  return aliases ? [norm, ...aliases] : [norm];
}

/**
 * Match an Odds API game to a Polymarket market using team names and aliases.
 */
export function matchOddsGameToMarket(
  game: OddsAPIGame,
  markets: WatchedMarket[]
): WatchedMarket | null {
  const homeAliases = getAliases(game.home_team);
  const awayAliases = getAliases(game.away_team);

  for (const market of markets) {
    const titleNorm = normalize(market.title);
    const homeMatch = homeAliases.some(a => titleNorm.includes(a));
    const awayMatch = awayAliases.some(a => titleNorm.includes(a));
    if (homeMatch && awayMatch) return market;
  }

  return null;
}

/**
 * Determine which Polymarket token corresponds to which team.
 * Uses title parsing to determine if home team is on YES side.
 *
 * Returns: { homeIsYes: boolean }
 */
export function resolveTokenSides(
  market: WatchedMarket,
  homeTeam: string,
  _awayTeam: string
): { homeIsYes: boolean } {
  const titleNorm = normalize(market.title);
  const homeNorm = normalize(homeTeam);

  const vsIdx = titleNorm.indexOf(' vs ') !== -1
    ? titleNorm.indexOf(' vs ')
    : titleNorm.indexOf(' against ');
  const homeIdx = titleNorm.indexOf(homeNorm);

  // If home team appears before "vs", it's the YES side
  if (homeIdx >= 0 && vsIdx >= 0 && homeIdx < vsIdx) {
    return { homeIsYes: true };
  }

  const homeLast = lastWord(homeTeam);
  if (homeLast) {
    const homeLastIdx = titleNorm.indexOf(homeLast);
    if (homeLastIdx >= 0 && vsIdx >= 0 && homeLastIdx < vsIdx) {
      return { homeIsYes: true };
    }
  }

  return { homeIsYes: false };
}
