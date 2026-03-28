/**
 * Canonical team name aliases.
 *
 * Different sources use different names for the same team:
 *   ESPN: "UConn Huskies", Pinnacle: "Connecticut", Polymarket: "Connecticut Huskies"
 *   ESPN: "SMU Mustangs", Pinnacle: "Southern Methodist"
 *
 * This map normalizes all variants to a single canonical form.
 * The canonical form is the most commonly used name.
 */

// Map from alias → canonical name (lowercase)
const ALIASES: Record<string, string> = {
  // NCAAB teams with name mismatches
  'uconn': 'connecticut',
  'uconn huskies': 'connecticut huskies',
  'conn': 'connecticut',
  'smu': 'southern methodist',
  'smu mustangs': 'southern methodist mustangs',
  'pitt': 'pittsburgh',
  'pitt panthers': 'pittsburgh panthers',
  'umass': 'massachusetts',
  'ole miss': 'mississippi',
  'ole miss rebels': 'mississippi rebels',
  'ucf': 'central florida',
  'ucf knights': 'central florida knights',
  'lsu': 'louisiana state',
  'lsu tigers': 'louisiana state tigers',
  'vcu': 'virginia commonwealth',
  'vcu rams': 'virginia commonwealth rams',
  'utep': 'texas el paso',
  'unlv': 'nevada las vegas',
  'unlv rebels': 'nevada las vegas rebels',
  'usc': 'southern california',
  'usc trojans': 'southern california trojans',
  'unc': 'north carolina',
  'unc tar heels': 'north carolina tar heels',
  'miami (fl)': 'miami',
  'miami (oh)': 'miami ohio',
  'st johns': 'st john\'s',

  // NBA teams — abbreviations and short names
  'okc': 'oklahoma city thunder',
  'okc thunder': 'oklahoma city thunder',
  'wolves': 'timberwolves',
  'twolves': 'timberwolves',
  'sixers': '76ers',
  'philly': 'philadelphia',
  'blazers': 'trail blazers',
  'clips': 'clippers',
};

/**
 * Normalize a team name: apply aliases, lowercase, strip punctuation.
 */
export function normalizeTeamName(name: string): string {
  let n = name.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();

  // Check full name alias
  if (ALIASES[n]) return ALIASES[n];

  // Check if any alias is a prefix or the name contains an alias
  for (const [alias, canonical] of Object.entries(ALIASES)) {
    if (n === alias || n.startsWith(alias + ' ') || n.endsWith(' ' + alias)) {
      return n.replace(alias, canonical);
    }
  }

  return n;
}

/**
 * Check if two team names refer to the same team.
 * Handles aliases (UConn = Connecticut), substrings, and mascot matching.
 */
export function teamsAreSame(a: string, b: string): boolean {
  const na = normalizeTeamName(a);
  const nb = normalizeTeamName(b);

  // Exact match after alias normalization
  if (na === nb) return true;

  // Substring match (e.g., "duke" in "duke blue devils")
  if (na.includes(nb) || nb.includes(na)) return true;

  // Last word (mascot) match — but avoid short words and common words
  const lastA = na.split(' ').pop() ?? '';
  const lastB = nb.split(' ').pop() ?? '';
  if (lastA.length >= 5 && lastA === lastB) return true; // Raised from 4 to 5 to avoid "nets" in "hornets"

  // First word match (city/school name) — handles "Duke" matching "Duke Blue Devils"
  const firstA = na.split(' ')[0] ?? '';
  const firstB = nb.split(' ')[0] ?? '';
  if (firstA.length >= 4 && firstA === firstB) return true;

  return false;
}
