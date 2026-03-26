import type { LeagueConfig } from '../types';

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

export const NBA_CONFIG: LeagueConfig = {
  id: 'nba',
  name: 'NBA',
  sportPath: 'basketball/nba',
  modelParams: {
    K: 1.15,              // Calibrated from real data (DEN@PHX, ORL@CLE, NO@NYK March 24 2026)
    TIME_SCALE: 0.38,     // Calibrated from real data
    QUARTER_SECONDS: 720, // 12 min quarters
    TOTAL_PERIODS: 4,
  },
  teams: NBA_TEAMS,
  marketTag: 'nba',
  gameSlugPrefix: 'nba-',
};
