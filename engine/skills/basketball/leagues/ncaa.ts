import type { LeagueConfig } from '../types';

// NCAA teams — start with major programs, expand as needed.
// NCAA has hundreds of teams; we include the ones most likely to appear on Polymarket.
export const NCAA_TEAMS: Record<string, string[]> = {
  'duke': ['duke blue devils'],
  'unc': ['north carolina', 'tar heels', 'north carolina tar heels'],
  'kentucky': ['kentucky wildcats'],
  'kansas': ['kansas jayhawks'],
  'gonzaga': ['gonzaga bulldogs', 'zags'],
  'villanova': ['villanova wildcats'],
  'michigan': ['michigan wolverines'],
  'michigan st': ['michigan state', 'michigan state spartans', 'spartans'],
  'purdue': ['purdue boilermakers'],
  'houston': ['houston cougars'],
  'uconn': ['connecticut', 'connecticut huskies', 'huskies'],
  'alabama': ['alabama crimson tide'],
  'tennessee': ['tennessee volunteers', 'vols'],
  'auburn': ['auburn tigers'],
  'iowa st': ['iowa state', 'iowa state cyclones', 'cyclones'],
  'baylor': ['baylor bears'],
  'arizona': ['arizona wildcats'],
  'ucla': ['ucla bruins', 'bruins'],
  'creighton': ['creighton bluejays'],
  'marquette': ['marquette golden eagles'],
  'texas': ['texas longhorns'],
  'indiana': ['indiana hoosiers'],
  'arkansas': ['arkansas razorbacks'],
  'florida': ['florida gators'],
  'illinois': ['illinois fighting illini'],
};

export const NCAA_CONFIG: LeagueConfig = {
  id: 'ncaab',
  name: 'NCAA Basketball',
  sportPath: 'basketball/mens-college-basketball',
  modelParams: {
    K: 1.05,               // NCAA games tend to be more volatile
    TIME_SCALE: 0.42,      // Longer halves = different time dynamics
    QUARTER_SECONDS: 1200, // 20 min halves
    TOTAL_PERIODS: 2,
  },
  teams: NCAA_TEAMS,
  marketTag: 'ncaa-basketball',
  gameSlugPrefix: 'ncaab-',
};
