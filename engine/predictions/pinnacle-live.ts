/**
 * Pinnacle Live Odds — fetches real-time in-game moneyline for live NBA/NCAAB games.
 *
 * Instead of guessing probability from a logistic model, we use Pinnacle's
 * actual live moneyline (sharpest book in the world) as the "true" probability.
 *
 * The edge = Pinnacle live prob - Polymarket price.
 * If Polymarket is slower to react to score changes, this gap is our edge.
 */

const PINNACLE_BASE = 'https://guest.api.arcadia.pinnacle.com/0.1';

interface PinnacleLiveOdds {
  matchupId: number;
  homeTeam: string;
  awayTeam: string;
  homeWinProb: number;  // de-vigged
  awayWinProb: number;
  homeOdds: number;     // American
  awayOdds: number;
  isLive: boolean;
}

function americanToImplied(odds: number): number {
  if (odds > 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

/**
 * Fetch live moneyline odds for all live basketball games on Pinnacle.
 * Returns de-vigged probabilities for each live game.
 */
export async function fetchPinnacleLiveOdds(): Promise<PinnacleLiveOdds[]> {
  const results: PinnacleLiveOdds[] = [];

  try {
    // Fetch matchups and markets in parallel
    const [matchupsRes, marketsRes] = await Promise.all([
      fetch(`${PINNACLE_BASE}/sports/4/matchups?withSpecials=false`, {
        signal: AbortSignal.timeout(5000),
      }),
      fetch(`${PINNACLE_BASE}/sports/4/markets/straight`, {
        signal: AbortSignal.timeout(5000),
      }),
    ]);

    if (!matchupsRes.ok || !marketsRes.ok) return results;

    const matchups = await matchupsRes.json();
    const markets = await marketsRes.json();

    // Find live matchups
    const liveMatchups = new Map<number, { home: string; away: string }>();
    for (const m of matchups) {
      if (!m.isLive || !m.participants || m.participants.length < 2) continue;
      const home = m.participants.find((p: any) => p.alignment === 'home');
      const away = m.participants.find((p: any) => p.alignment === 'away');
      if (home && away) {
        liveMatchups.set(m.id, { home: home.name, away: away.name });
      }
    }

    if (liveMatchups.size === 0) return results;

    // Find moneyline markets for live matchups
    // Period 2 = second half (most relevant for live), period 0 = full game
    for (const mkt of markets) {
      if (!mkt.matchupId || !liveMatchups.has(mkt.matchupId)) continue;
      if (mkt.type !== 'moneyline') continue;
      // Prefer period 0 (full game) or period 2 (second half) for live
      if (mkt.period !== 0 && mkt.period !== 2) continue;

      const prices = mkt.prices ?? [];
      const homePrice = prices.find((p: any) => p.designation === 'home');
      const awayPrice = prices.find((p: any) => p.designation === 'away');
      if (!homePrice || !awayPrice) continue;

      const homeImplied = americanToImplied(homePrice.price);
      const awayImplied = americanToImplied(awayPrice.price);
      const total = homeImplied + awayImplied;

      const matchup = liveMatchups.get(mkt.matchupId)!;

      // Don't duplicate — prefer period 0 over period 2
      const existing = results.find(r => r.matchupId === mkt.matchupId);
      if (existing && mkt.period !== 0) continue;
      if (existing) {
        // Replace with period 0
        existing.homeWinProb = homeImplied / total;
        existing.awayWinProb = awayImplied / total;
        existing.homeOdds = homePrice.price;
        existing.awayOdds = awayPrice.price;
        continue;
      }

      results.push({
        matchupId: mkt.matchupId,
        homeTeam: matchup.home,
        awayTeam: matchup.away,
        homeWinProb: homeImplied / total,
        awayWinProb: awayImplied / total,
        homeOdds: homePrice.price,
        awayOdds: awayPrice.price,
        isLive: true,
      });
    }
  } catch (err) {
    console.error('[PinnacleLive] Error:', err instanceof Error ? err.message : err);
  }

  return results;
}

/**
 * Find Pinnacle live odds for a specific game by team name matching.
 */
export function matchPinnacleLive(
  liveOdds: PinnacleLiveOdds[],
  homeTeam: string,
  awayTeam: string
): PinnacleLiveOdds | null {
  const homeLower = homeTeam.toLowerCase();
  const awayLower = awayTeam.toLowerCase();

  for (const odds of liveOdds) {
    const pinHome = odds.homeTeam.toLowerCase();
    const pinAway = odds.awayTeam.toLowerCase();

    // Match by last word (mascot) or substring
    const homeMatch = pinHome.includes(homeLower.split(' ').pop() ?? '') ||
                      homeLower.includes(pinHome.split(' ').pop() ?? '');
    const awayMatch = pinAway.includes(awayLower.split(' ').pop() ?? '') ||
                      awayLower.includes(pinAway.split(' ').pop() ?? '');

    if (homeMatch && awayMatch) return odds;
    // Try reversed
    const homeMatchRev = pinHome.includes(awayLower.split(' ').pop() ?? '') ||
                         awayLower.includes(pinHome.split(' ').pop() ?? '');
    const awayMatchRev = pinAway.includes(homeLower.split(' ').pop() ?? '') ||
                         homeLower.includes(pinAway.split(' ').pop() ?? '');

    if (homeMatchRev && awayMatchRev) {
      // Reversed — swap probabilities
      return {
        ...odds,
        homeWinProb: odds.awayWinProb,
        awayWinProb: odds.homeWinProb,
        homeOdds: odds.awayOdds,
        awayOdds: odds.homeOdds,
      };
    }
  }

  return null;
}
