/**
 * /api/odds/scrape — Scrapes DraftKings + FanDuel odds from Vercel's US servers.
 *
 * This runs on Vercel (US IP) to bypass the geo-blocking that DK/FD enforce.
 * The local bot polls this endpoint every 30-60s to get fresh sportsbook odds.
 *
 * Returns: { draftkings: DKEvent[], fanduel: FDEvent[], timestamp: string }
 */

import { NextResponse } from 'next/server';

// ── DraftKings ──

const DK_BASE = 'https://sportsbook.draftkings.com/sites/US-SB/api/v5/eventgroups';
const DK_LEAGUES: Record<string, number> = {
  NBA: 42648,
  NCAAB: 92483,
};

interface DKOutcome {
  label: string;
  oddsAmerican: string;
  oddsDecimal: number;
  participant?: string;
}

interface DKOffer {
  label: string;
  outcomes: DKOutcome[];
}

interface DKEvent {
  eventId: number;
  name: string;          // "Team A @ Team B"
  startDate: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  moneyline?: {
    home: { odds: number; implied: number };
    away: { odds: number; implied: number };
  };
  spread?: {
    home: { line: number; odds: number };
    away: { line: number; odds: number };
  };
  total?: {
    line: number;
    over: number;
    under: number;
  };
}

async function fetchDraftKings(): Promise<DKEvent[]> {
  const allEvents: DKEvent[] = [];

  for (const [league, groupId] of Object.entries(DK_LEAGUES)) {
    try {
      const url = `${DK_BASE}/${groupId}?format=json`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        console.log(`[DK] ${league} returned ${res.status}`);
        continue;
      }

      const data = await res.json();
      const events = parseDKResponse(data, league);
      allEvents.push(...events);
    } catch (err) {
      console.error(`[DK] ${league} error:`, err instanceof Error ? err.message : err);
    }
  }

  return allEvents;
}

function parseDKResponse(data: any, league: string): DKEvent[] {
  const events: DKEvent[] = [];

  try {
    // DK structure: eventGroup.offerCategories[].offerSubcategoryDescriptors[].offerSubcategory.offers[][]
    const eventGroup = data?.eventGroup;
    if (!eventGroup) return events;

    // Build event map from the events list
    const eventMap = new Map<number, any>();
    for (const evt of eventGroup.events ?? []) {
      eventMap.set(evt.eventId, evt);
    }

    // Extract offers
    const categories = eventGroup.offerCategories ?? [];

    for (const cat of categories) {
      for (const subDesc of cat.offerSubcategoryDescriptors ?? []) {
        const offers: DKOffer[][] = subDesc.offerSubcategory?.offers ?? [];

        for (const offerGroup of offers) {
          for (const offer of offerGroup) {
            if (!offer.outcomes || offer.outcomes.length < 2) continue;

            const eventId = (offer as any).eventId;
            const evt = eventMap.get(eventId);
            if (!evt) continue;

            // Parse event name "Away @ Home"
            const nameParts = (evt.name ?? '').split(' @ ');
            const awayTeam = nameParts[0]?.trim() ?? '';
            const homeTeam = nameParts[1]?.trim() ?? '';

            // Find or create the event entry
            let entry = events.find(e => e.eventId === eventId);
            if (!entry) {
              entry = {
                eventId,
                name: evt.name ?? '',
                startDate: evt.startDate ?? '',
                homeTeam,
                awayTeam,
                league,
              };
              events.push(entry);
            }

            // Parse by offer type
            const offerLabel = (offer.label ?? '').toLowerCase();

            if (offerLabel.includes('moneyline') || offerLabel.includes('money line')) {
              const homeOutcome = offer.outcomes.find((o: any) =>
                o.participant === homeTeam || o.label === homeTeam
              );
              const awayOutcome = offer.outcomes.find((o: any) =>
                o.participant === awayTeam || o.label === awayTeam
              );

              if (homeOutcome && awayOutcome) {
                entry.moneyline = {
                  home: {
                    odds: homeOutcome.oddsDecimal,
                    implied: 1 / homeOutcome.oddsDecimal,
                  },
                  away: {
                    odds: awayOutcome.oddsDecimal,
                    implied: 1 / awayOutcome.oddsDecimal,
                  },
                };
              }
            }

            if (offerLabel.includes('spread') || offerLabel.includes('point spread')) {
              const homeOutcome = offer.outcomes.find((o: any) =>
                o.participant === homeTeam || o.label?.includes(homeTeam)
              );
              const awayOutcome = offer.outcomes.find((o: any) =>
                o.participant === awayTeam || o.label?.includes(awayTeam)
              );

              if (homeOutcome && awayOutcome) {
                entry.spread = {
                  home: { line: (homeOutcome as any).line ?? 0, odds: homeOutcome.oddsDecimal },
                  away: { line: (awayOutcome as any).line ?? 0, odds: awayOutcome.oddsDecimal },
                };
              }
            }

            if (offerLabel.includes('total') || offerLabel.includes('over/under')) {
              const overOutcome = offer.outcomes.find((o: any) =>
                o.label?.toLowerCase().includes('over')
              );
              const underOutcome = offer.outcomes.find((o: any) =>
                o.label?.toLowerCase().includes('under')
              );

              if (overOutcome && underOutcome) {
                entry.total = {
                  line: (overOutcome as any).line ?? 0,
                  over: overOutcome.oddsDecimal,
                  under: underOutcome.oddsDecimal,
                };
              }
            }
          }
        }
      }
    }
  } catch (err) {
    console.error(`[DK] Parse error for ${league}:`, err);
  }

  return events;
}

// ── FanDuel ──

interface FDEvent {
  eventId: string;
  name: string;
  startDate: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  moneyline?: {
    home: { odds: number; implied: number };
    away: { odds: number; implied: number };
  };
  spread?: {
    home: { line: number; odds: number };
    away: { line: number; odds: number };
  };
}

const FD_STATES = ['il', 'nj', 'pa', 'co', 'mi'];

async function fetchFanDuel(): Promise<FDEvent[]> {
  const allEvents: FDEvent[] = [];

  // Try multiple state subdomains until one works
  for (const state of FD_STATES) {
    try {
      const url = `https://sbapi.${state}.sportsbook.fanduel.com/api/content-managed-page?page=CUSTOM&customPageId=nba&_ak=FhMFpcPWXMeyZxOx`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) continue;

      const data = await res.json();
      const events = parseFDResponse(data, 'NBA');
      if (events.length > 0) {
        allEvents.push(...events);
        break; // Got data, stop trying states
      }
    } catch {
      continue;
    }
  }

  // Also try NCAAB
  for (const state of FD_STATES) {
    try {
      const url = `https://sbapi.${state}.sportsbook.fanduel.com/api/content-managed-page?page=CUSTOM&customPageId=college-basketball&_ak=FhMFpcPWXMeyZxOx`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) continue;

      const data = await res.json();
      const events = parseFDResponse(data, 'NCAAB');
      if (events.length > 0) {
        allEvents.push(...events);
        break;
      }
    } catch {
      continue;
    }
  }

  return allEvents;
}

function parseFDResponse(data: any, league: string): FDEvent[] {
  const events: FDEvent[] = [];

  try {
    // FanDuel response has attachments.events and attachments.markets
    const attachments = data?.attachments ?? {};
    const rawEvents = attachments.events ?? {};
    const rawMarkets = attachments.markets ?? {};

    for (const [eventId, evt] of Object.entries(rawEvents) as [string, any][]) {
      const name = evt.name ?? '';
      // FD format: "Team A @ Team B" or "Team A v Team B"
      const parts = name.split(/\s+(?:@|v|vs\.?)\s+/i);
      if (parts.length < 2) continue;

      const entry: FDEvent = {
        eventId,
        name,
        startDate: evt.openDate ?? '',
        awayTeam: parts[0]?.trim() ?? '',
        homeTeam: parts[1]?.trim() ?? '',
        league,
      };

      // Find markets for this event
      for (const [, mkt] of Object.entries(rawMarkets) as [string, any][]) {
        if (String(mkt.eventId) !== String(eventId)) continue;

        const marketType = (mkt.marketType ?? '').toLowerCase();
        const runners = mkt.runners ?? [];

        if (marketType.includes('moneyline') || marketType.includes('match betting')) {
          const homeRunner = runners.find((r: any) =>
            r.runnerName === entry.homeTeam
          );
          const awayRunner = runners.find((r: any) =>
            r.runnerName === entry.awayTeam
          );

          if (homeRunner?.winRunnerOdds?.decimalDisplayPrice && awayRunner?.winRunnerOdds?.decimalDisplayPrice) {
            const homeOdds = homeRunner.winRunnerOdds.decimalDisplayPrice;
            const awayOdds = awayRunner.winRunnerOdds.decimalDisplayPrice;
            entry.moneyline = {
              home: { odds: homeOdds, implied: 1 / homeOdds },
              away: { odds: awayOdds, implied: 1 / awayOdds },
            };
          }
        }

        if (marketType.includes('spread') || marketType.includes('handicap')) {
          const homeRunner = runners.find((r: any) =>
            r.runnerName?.includes(entry.homeTeam)
          );
          const awayRunner = runners.find((r: any) =>
            r.runnerName?.includes(entry.awayTeam)
          );

          if (homeRunner && awayRunner) {
            entry.spread = {
              home: {
                line: homeRunner.handicap ?? 0,
                odds: homeRunner.winRunnerOdds?.decimalDisplayPrice ?? 0,
              },
              away: {
                line: awayRunner.handicap ?? 0,
                odds: awayRunner.winRunnerOdds?.decimalDisplayPrice ?? 0,
              },
            };
          }
        }
      }

      if (entry.moneyline) {
        events.push(entry);
      }
    }
  } catch (err) {
    console.error(`[FD] Parse error for ${league}:`, err);
  }

  return events;
}

// ── Helpers ──

function decimalToVigFreeProb(homeDecimal: number, awayDecimal: number): { home: number; away: number } {
  const homeImplied = 1 / homeDecimal;
  const awayImplied = 1 / awayDecimal;
  const total = homeImplied + awayImplied;
  return {
    home: homeImplied / total,
    away: awayImplied / total,
  };
}

// ── Route handler ──

export async function GET() {
  const start = Date.now();

  const [dkEvents, fdEvents] = await Promise.all([
    fetchDraftKings().catch(err => {
      console.error('[Odds Scrape] DK failed:', err);
      return [] as DKEvent[];
    }),
    fetchFanDuel().catch(err => {
      console.error('[Odds Scrape] FD failed:', err);
      return [] as FDEvent[];
    }),
  ]);

  // Combine into a unified format with vig-free probabilities
  const combined: Array<{
    homeTeam: string;
    awayTeam: string;
    startDate: string;
    league: string;
    sources: Array<{
      book: string;
      homeWinProb: number;
      awayWinProb: number;
      homeOdds: number;
      awayOdds: number;
    }>;
    consensus: {
      homeWinProb: number;
      awayWinProb: number;
      numBooks: number;
    };
  }> = [];

  // Index by game key for dedup
  const gameMap = new Map<string, typeof combined[0]>();

  function getKey(home: string, away: string): string {
    return `${home.toLowerCase().trim()}::${away.toLowerCase().trim()}`;
  }

  // Add DraftKings
  for (const evt of dkEvents) {
    if (!evt.moneyline) continue;
    const key = getKey(evt.homeTeam, evt.awayTeam);
    const prob = decimalToVigFreeProb(evt.moneyline.home.odds, evt.moneyline.away.odds);

    let entry = gameMap.get(key);
    if (!entry) {
      entry = {
        homeTeam: evt.homeTeam,
        awayTeam: evt.awayTeam,
        startDate: evt.startDate,
        league: evt.league,
        sources: [],
        consensus: { homeWinProb: 0, awayWinProb: 0, numBooks: 0 },
      };
      gameMap.set(key, entry);
    }

    entry.sources.push({
      book: 'DraftKings',
      homeWinProb: prob.home,
      awayWinProb: prob.away,
      homeOdds: evt.moneyline.home.odds,
      awayOdds: evt.moneyline.away.odds,
    });
  }

  // Add FanDuel
  for (const evt of fdEvents) {
    if (!evt.moneyline) continue;
    const key = getKey(evt.homeTeam, evt.awayTeam);
    const prob = decimalToVigFreeProb(evt.moneyline.home.odds, evt.moneyline.away.odds);

    let entry = gameMap.get(key);
    if (!entry) {
      entry = {
        homeTeam: evt.homeTeam,
        awayTeam: evt.awayTeam,
        startDate: evt.startDate,
        league: evt.league,
        sources: [],
        consensus: { homeWinProb: 0, awayWinProb: 0, numBooks: 0 },
      };
      gameMap.set(key, entry);
    }

    entry.sources.push({
      book: 'FanDuel',
      homeWinProb: prob.home,
      awayWinProb: prob.away,
      homeOdds: evt.moneyline.home.odds,
      awayOdds: evt.moneyline.away.odds,
    });
  }

  // Calculate consensus for each game
  for (const [, game] of gameMap) {
    if (game.sources.length === 0) continue;
    const totalHome = game.sources.reduce((sum, s) => sum + s.homeWinProb, 0);
    const totalAway = game.sources.reduce((sum, s) => sum + s.awayWinProb, 0);
    game.consensus = {
      homeWinProb: totalHome / game.sources.length,
      awayWinProb: totalAway / game.sources.length,
      numBooks: game.sources.length,
    };
    combined.push(game);
  }

  return NextResponse.json({
    draftkings: dkEvents.length,
    fanduel: fdEvents.length,
    games: combined,
    elapsed: Date.now() - start,
    timestamp: new Date().toISOString(),
  });
}
