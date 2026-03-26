import { OddsAPIGame } from './types';
import type { WatchedMarket } from '@/lib/types';

// Common NCAAB name aliases
const TEAM_ALIASES: Record<string, string[]> = {
  'north carolina state wolfpack': ['nc state', 'wolfpack'],
  'connecticut huskies': ['uconn', 'huskies'],
  'southern california trojans': ['usc', 'trojans'],
  'louisiana state tigers': ['lsu', 'tigers'],
  'texas christian horned frogs': ['tcu', 'horned frogs'],
  'brigham young cougars': ['byu', 'cougars'],
  'mississippi rebels': ['ole miss', 'rebels'],
  'mississippi state bulldogs': ['miss state', 'mississippi st', 'bulldogs'],
  'virginia commonwealth rams': ['vcu', 'rams'],
  'southern methodist mustangs': ['smu', 'mustangs'],
  'central florida knights': ['ucf', 'knights'],
  'st johns red storm': ['st johns', 'saint johns', 'red storm'],
  'miami hurricanes': ['miami fl', 'hurricanes'],
  'pittsburgh panthers': ['pitt', 'panthers'],
  'california golden bears': ['cal', 'golden bears'],
  'alabama crimson tide': ['alabama', 'bama', 'crimson tide'],
  'michigan state spartans': ['mich state', 'mich st', 'spartans'],
  'florida state seminoles': ['fsu', 'seminoles'],
  'san diego state aztecs': ['sdsu', 'aztecs'],
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

function getMatchTerms(teamName: string): string[] {
  const norm = normalize(teamName);
  const terms = [norm];

  // Add aliases if found
  const aliases = TEAM_ALIASES[norm];
  if (aliases) terms.push(...aliases);

  // Add last word (mascot name) — e.g. "Chicago Bulls" → "bulls"
  const mascot = lastWord(teamName);
  if (mascot && !terms.includes(mascot)) terms.push(mascot);

  // Add city/state name — e.g. "Chicago Bulls" → "chicago"
  const parts = norm.split(/\s+/);
  if (parts.length > 1) {
    const city = parts[0];
    if (city && city.length > 2 && !terms.includes(city)) terms.push(city);
  }

  return terms;
}

function teamMatchesTitle(terms: string[], titleNorm: string): boolean {
  return terms.some(t => {
    // For short terms (<=3 chars like "lsu"), require word boundary match
    if (t.length <= 3) {
      const re = new RegExp(`\\b${t}\\b`);
      return re.test(titleNorm);
    }
    return titleNorm.includes(t);
  });
}

/**
 * Match an Odds API game to a Polymarket market.
 * Uses full name, mascot name, city name, and aliases for fuzzy matching.
 */
export function matchOddsGameToMarket(
  game: OddsAPIGame,
  markets: WatchedMarket[]
): WatchedMarket | null {
  const homeTerms = getMatchTerms(game.home_team);
  const awayTerms = getMatchTerms(game.away_team);

  for (const market of markets) {
    const titleNorm = normalize(market.title);
    const homeMatch = teamMatchesTitle(homeTerms, titleNorm);
    const awayMatch = teamMatchesTitle(awayTerms, titleNorm);
    if (homeMatch && awayMatch) return market;
  }

  return null;
}

/**
 * Determine which Polymarket token corresponds to which team.
 * The first team in "TeamA vs. TeamB" title maps to YES token.
 */
export function resolveTokenSides(
  market: WatchedMarket,
  homeTeam: string,
  _awayTeam: string
): { homeIsYes: boolean } {
  const titleNorm = normalize(market.title);

  const vsIdx = titleNorm.indexOf(' vs ') !== -1
    ? titleNorm.indexOf(' vs ')
    : titleNorm.indexOf(' against ');

  if (vsIdx < 0) return { homeIsYes: false };

  const beforeVs = titleNorm.slice(0, vsIdx);
  const homeTerms = getMatchTerms(homeTeam);

  // If any home team term appears before "vs", home is YES
  if (homeTerms.some(t => beforeVs.includes(t))) {
    return { homeIsYes: true };
  }

  return { homeIsYes: false };
}
