// NBA team canonical names and aliases for fuzzy matching
export const NBA_TEAMS: Record<string, string[]> = {
  'lakers': ['los angeles lakers', 'la lakers', 'lal'],
  'celtics': ['boston celtics', 'bos'],
  'warriors': ['golden state warriors', 'gsw', 'golden state'],
  'nets': ['brooklyn nets', 'bkn'],
  'knicks': ['new york knicks', 'nyk'],
  '76ers': ['philadelphia 76ers', 'sixers', 'phi', 'philly'],
  'raptors': ['toronto raptors', 'tor'],
  'bulls': ['chicago bulls', 'chi'],
  'cavaliers': ['cleveland cavaliers', 'cavs', 'cle'],
  'pistons': ['detroit pistons', 'det'],
  'pacers': ['indiana pacers', 'ind'],
  'bucks': ['milwaukee bucks', 'mil'],
  'hawks': ['atlanta hawks', 'atl'],
  'hornets': ['charlotte hornets', 'cha'],
  'heat': ['miami heat', 'mia'],
  'magic': ['orlando magic', 'orl'],
  'wizards': ['washington wizards', 'was'],
  'nuggets': ['denver nuggets', 'den'],
  'timberwolves': ['minnesota timberwolves', 'min', 'wolves'],
  'thunder': ['oklahoma city thunder', 'okc'],
  'trail blazers': ['portland trail blazers', 'por', 'blazers'],
  'jazz': ['utah jazz', 'uta'],
  'mavericks': ['dallas mavericks', 'dal', 'mavs'],
  'rockets': ['houston rockets', 'hou'],
  'grizzlies': ['memphis grizzlies', 'mem'],
  'pelicans': ['new orleans pelicans', 'nop'],
  'spurs': ['san antonio spurs', 'sas'],
  'suns': ['phoenix suns', 'phx'],
  'kings': ['sacramento kings', 'sac'],
  'clippers': ['la clippers', 'los angeles clippers', 'lac'],
};

// Get all aliases for a canonical team name
export function getTeamAliases(canonical: string): string[] {
  const base = [canonical, ...(NBA_TEAMS[canonical] || [])];
  return base.map(s => s.toLowerCase());
}

// Normalize a raw team name string to canonical key
export function normalizeTeamName(raw: string): string | null {
  const lower = raw.toLowerCase().trim();
  for (const [canonical, aliases] of Object.entries(NBA_TEAMS)) {
    if (lower.includes(canonical) || aliases.some(a => lower.includes(a))) {
      return canonical;
    }
  }
  return null;
}

// Extract both team canonical names from a market title
export function extractTeamsFromTitle(title: string): [string, string] | null {
  const lower = title.toLowerCase();
  const matched: string[] = [];
  for (const canonical of Object.keys(NBA_TEAMS)) {
    const aliases = getTeamAliases(canonical);
    if (aliases.some(a => lower.includes(a))) {
      matched.push(canonical);
    }
  }
  if (matched.length >= 2) return [matched[0], matched[1]];
  return null;
}
