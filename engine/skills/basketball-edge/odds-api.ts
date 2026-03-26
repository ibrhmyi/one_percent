import { OddsAPIGame } from './types';

const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';

// Sport keys we monitor
export const BASKETBALL_SPORT_KEYS = [
  'basketball_nba',
  'basketball_ncaab',
  'basketball_wnba',
  'basketball_euroleague',
] as const;

// ── API Key Rotation ──

const API_KEYS: string[] = [
  process.env.ODDS_API_KEY_1,
  process.env.ODDS_API_KEY_2,
  process.env.ODDS_API_KEY_3,
].filter(Boolean) as string[];

let keyIndex = 0;
let totalRequestsUsed = 0;

function getNextKey(): string {
  if (API_KEYS.length === 0) throw new Error('[OddsAPI] No API keys configured');
  const key = API_KEYS[keyIndex % API_KEYS.length];
  keyIndex++;
  totalRequestsUsed++;
  return key;
}

export function getRequestStats() {
  return { totalRequestsUsed, totalBudget: API_KEYS.length * 500 };
}

// ── Fetch Odds ──

export async function fetchOdds(sportKey: string): Promise<OddsAPIGame[]> {
  const apiKey = getNextKey();

  try {
    const url = `${ODDS_API_BASE}/sports/${sportKey}/odds?apiKey=${apiKey}&regions=us,eu&markets=h2h&oddsFormat=decimal`;

    const response = await fetch(url, {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const remaining = response.headers.get('x-requests-remaining');
      const used = response.headers.get('x-requests-used');
      console.error(`[OddsAPI] HTTP ${response.status} for ${sportKey}. Used: ${used}, Remaining: ${remaining}`);
      return [];
    }

    const remaining = response.headers.get('x-requests-remaining');
    console.log(`[OddsAPI] ${sportKey}: fetched. Requests remaining on this key: ${remaining}`);

    const data: OddsAPIGame[] = await response.json();
    return data;
  } catch (err) {
    console.error(`[OddsAPI] Fetch error for ${sportKey}:`, err);
    return [];
  }
}

// ── Fetch All Basketball Odds ──

export async function fetchAllBasketballOdds(): Promise<OddsAPIGame[]> {
  const allGames: OddsAPIGame[] = [];

  for (const sportKey of BASKETBALL_SPORT_KEYS) {
    const games = await fetchOdds(sportKey);
    allGames.push(...games);
    await new Promise(r => setTimeout(r, 500));
  }

  return allGames;
}
