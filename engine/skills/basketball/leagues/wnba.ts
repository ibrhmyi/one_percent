import type { LeagueConfig } from '../types';

export const WNBA_TEAMS: Record<string, string[]> = {
  'dream': ['atlanta dream', 'atl'],
  'sky': ['chicago sky', 'chi'],
  'sun': ['connecticut sun', 'conn'],
  'wings': ['dallas wings', 'dal'],
  'valkyries': ['golden state valkyries', 'gs'],
  'fever': ['indiana fever', 'ind'],
  'aces': ['las vegas aces', 'lv'],
  'sparks': ['los angeles sparks', 'la'],
  'lynx': ['minnesota lynx', 'min'],
  'liberty': ['new york liberty', 'ny'],
  'mercury': ['phoenix mercury', 'phx'],
  'storm': ['seattle storm', 'sea'],
  'mystics': ['washington mystics', 'wsh'],
};

export const WNBA_CONFIG: LeagueConfig = {
  id: 'wnba',
  name: 'WNBA',
  sportPath: 'basketball/wnba',
  modelParams: {
    K: 1.10,
    TIME_SCALE: 0.38,
    QUARTER_SECONDS: 600,   // 10 min quarters
    TOTAL_PERIODS: 4,
  },
  teams: WNBA_TEAMS,
  marketTag: 'wnba',
  gameSlugPrefix: 'wnba-',
};
