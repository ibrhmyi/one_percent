import type { WatchedMarket, Opportunity } from '@/lib/types';
import { engineState, addMessage, getOpenTrade, updateAccount } from './state';
import { registerSkill, getSkills } from './skill-registry';
import { enterPosition } from './trade-manager';
import { checkExits } from './exit-manager';
import { NBALiveEdge } from './skills/nba-live-edge';
import { parseTokenIds } from './skills/nba-live-edge/market-matcher';

const GAMMA_EVENTS_API = 'https://gamma-api.polymarket.com/events';

// ─────────────────────────────────────────────
// Market Discovery — NBA Events endpoint
// ─────────────────────────────────────────────
// Queries /events?tag_slug=nba which returns events WITH their nested markets.
// Game events have slugs like nba-lal-ind-2026-03-25.
// Each game event contains a moneyline market (question = "Team A vs. Team B")
// plus spread/totals props. We only care about the moneyline.

const GAME_SLUG_RE = /^nba-[a-z]{2,4}-[a-z]{2,4}-\d{4}-\d{2}-\d{2}$/;

function estimateGameStart(marketEndTime: string): string {
  // Estimate game start = market close - 2.5 hours
  const end = new Date(marketEndTime).getTime();
  return new Date(end - 2.5 * 60 * 60 * 1000).toISOString();
}

function parseTeamNames(title: string): { homeTeam: string; awayTeam: string } {
  // Title format: "Lakers vs. Pacers" or "Lakers vs Pacers"
  const sep = title.includes(' vs. ') ? ' vs. ' : ' vs ';
  const parts = title.split(sep);
  return {
    homeTeam: (parts[0] ?? title).trim(),
    awayTeam: (parts[1] ?? '').trim(),
  };
}

async function fetchNBAMarkets(): Promise<WatchedMarket[]> {
  const markets: WatchedMarket[] = [];

  const url = new URL(GAMMA_EVENTS_API);
  url.searchParams.set('active', 'true');
  url.searchParams.set('closed', 'false');
  url.searchParams.set('tag_slug', 'nba');
  url.searchParams.set('limit', '100');
  url.searchParams.set('order', 'endDate');
  url.searchParams.set('ascending', 'true');

  let events: Record<string, unknown>[];
  try {
    const res = await fetch(url.toString(), { cache: 'no-store' });
    if (!res.ok) return markets;
    events = await res.json();
  } catch {
    return markets;
  }

  if (!Array.isArray(events)) return markets;

  // Filter to game events only (ending within next 24 hours)
  const cutoff = Date.now() + 24 * 60 * 60 * 1000;
  const gameEvents = events.filter(ev => {
    const slug = String(ev.slug ?? '');
    const endDate = String(ev.endDate ?? '');
    const endMs = new Date(endDate).getTime();
    return GAME_SLUG_RE.test(slug) && endMs <= cutoff;
  });

  for (const ev of gameEvents) {
    const eventSlug = String(ev.slug ?? '');
    const eventEndTime = String(ev.endDate ?? '');
    const eventTitle = String(ev.title ?? '');
    const nestedMarkets = Array.isArray(ev.markets) ? ev.markets as Record<string, unknown>[] : [];

    // Find the moneyline market — simplest title with "vs"
    const moneyline = nestedMarkets.find(m => {
      const q = String(m.question ?? '').toLowerCase();
      return (q.includes(' vs. ') || q.includes(' vs ')) &&
        !q.includes('spread') &&
        !q.includes('o/u') &&
        !q.includes('1h') &&
        !q.includes('quarter') &&
        !q.includes('half') &&
        !q.includes('points') &&
        !q.includes('rebounds') &&
        !q.includes('assists');
    });

    if (!moneyline) continue;

    const title = String(moneyline.question ?? eventTitle);
    const { homeTeam, awayTeam } = parseTeamNames(title);
    const volume = Number(moneyline.volumeNum ?? moneyline.volume ?? ev.volume ?? 0);
    const tokenIds = parseTokenIds(moneyline.clobTokenIds);

    let outcomePrices: string[] = ['0.5', '0.5'];
    try {
      const raw = moneyline.outcomePrices;
      outcomePrices = typeof raw === 'string' ? JSON.parse(raw) : (raw as string[]) ?? ['0.5', '0.5'];
    } catch { /* keep default */ }

    const yesPrice = Number(outcomePrices[0] ?? 0.5);
    const noPrice = Number(outcomePrices[1] ?? 0.5);
    const id = String(moneyline.id ?? eventSlug);
    const conditionId = String(moneyline.conditionId ?? id);

    markets.push({
      id,
      conditionId,
      title,
      homeTeam,
      awayTeam,
      slug: eventSlug,
      yesPrice,
      noPrice,
      volume,
      category: 'NBA',
      url: `https://polymarket.com/event/${eventSlug}`,
      yesTokenId: tokenIds[0] ?? '',
      noTokenId: tokenIds[1] ?? '',
      status: 'upcoming',
      edge: null,
      aiEstimate: null,
      spread: null,
      gameData: null,
      gameStartTime: estimateGameStart(eventEndTime),
      marketEndTime: eventEndTime,
      lastUpdated: new Date().toISOString(),
    });
  }

  return markets;
}

// ─────────────────────────────────────────────
// CLOB spread enrichment
// ─────────────────────────────────────────────

const CLOB_BOOK_URL = 'https://clob.polymarket.com/book';

async function fetchClobSpread(tokenId: string, midPrice: number): Promise<number | null> {
  if (!tokenId) return null;
  try {
    const res = await fetch(`${CLOB_BOOK_URL}?token_id=${encodeURIComponent(tokenId)}`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const data = await res.json() as {
      bids?: Array<{ price: string }>;
      asks?: Array<{ price: string }>;
    };

    // Polymarket CLOB: bids descending (best=first), asks ascending (best=first)
    const bids = (data.bids ?? []).map(b => parseFloat(b.price)).filter(p => !isNaN(p) && p > 0);
    const asks = (data.asks ?? []).map(a => parseFloat(a.price)).filter(p => !isNaN(p) && p > 0);
    if (!bids.length || !asks.length) return null;

    // Use Math.max/min to be safe regardless of server-side sort order
    const bestBid = Math.max(...bids);
    const bestAsk = Math.min(...asks);

    // Sanity: spread must be positive and < 40¢ (pre-game books can be wide)
    if (bestAsk <= bestBid) return null;
    if ((bestAsk - bestBid) > 0.40) return null;

    return Math.round((bestAsk - bestBid) * 1000) / 10; // cents, 1dp
  } catch {
    return null;
  }
}

async function enrichWithClobSpreads(markets: WatchedMarket[]): Promise<void> {
  await Promise.all(
    markets.map(async m => {
      if (!m.yesTokenId) return;
      const clobSpread = await fetchClobSpread(m.yesTokenId, m.yesPrice);
      if (clobSpread !== null) {
        m.spread = clobSpread;
      } else {
        // Fallback: implied spread from outcomePrices (yesPrice + noPrice - 1.0)
        // Both sides priced together cost slightly more than $1 — that delta is the book spread
        const implied = (m.yesPrice + m.noPrice - 1.0) * 100;
        m.spread = implied > 0.1 ? Math.round(implied * 10) / 10 : null;
      }
    })
  );
}

// ─────────────────────────────────────────────
// Market refresh — runs every 15s
// ─────────────────────────────────────────────

export async function refreshMarkets(): Promise<void> {
  try {
    const markets = await fetchNBAMarkets();

    // Enrich with actual ESPN start times
    try {
      const { fetchNBAScoreboard } = await import('./skills/nba-live-edge/espn-api');
      const games = await fetchNBAScoreboard();
      for (const market of markets) {
        // Match by abbrevs in slug, e.g. nba-lal-ind-2026-03-25
        const slugParts = market.slug.replace(/^nba-/, '').split('-');
        const homeAbbr = slugParts[0] ?? '';
        const awayAbbr = slugParts[1] ?? '';
        const game = games.find(g =>
          (g.homeAbbr === homeAbbr || g.awayAbbr === awayAbbr) ||
          (g.homeAbbr === awayAbbr || g.awayAbbr === homeAbbr)
        );
        if (game?.scheduledStart) {
          market.gameStartTime = game.scheduledStart;
          if (game.state === 'in') market.status = 'live';
          if (game.state === 'post') market.status = 'upcoming'; // resolved
        }
      }
    } catch { /* ESPN errors don't block market discovery */ }

    // Enrich with CLOB bid-ask spreads
    try {
      await enrichWithClobSpreads(markets);
    } catch { /* CLOB errors don't block market discovery */ }

    // Only keep markets where game hasn't started yet OR is live right now
    const now = Date.now();
    const relevant = markets.filter(m => {
      if (m.status === 'live' || m.status === 'edge_detected' || m.status === 'position_open') return true;
      if (!m.gameStartTime) return true;
      return new Date(m.gameStartTime).getTime() > now;
    });

    engineState.watchedMarkets = relevant;

    // Pick focused market: live game first, then earliest upcoming
    const liveMarket = relevant.find(m =>
      m.status === 'live' || m.status === 'edge_detected' || m.status === 'position_open'
    );
    const nextMarket = relevant
      .filter(m => m.gameStartTime)
      .sort((a, b) => new Date(a.gameStartTime!).getTime() - new Date(b.gameStartTime!).getTime())[0];
    const focused = liveMarket ?? nextMarket ?? null;
    engineState.focusedMarketId = focused?.id ?? null;

    if (relevant.length > 0) {
      addMessage({
        text: `Watching ${relevant.length} markets — focused on ${focused?.title ?? 'none'}`,
        type: 'info',
      });
    }
  } catch (err) {
    addMessage({
      text: `Market refresh error: ${err instanceof Error ? err.message : String(err)}`,
      type: 'warning',
    });
  }
}

// ─────────────────────────────────────────────
// Main brain cycle — runs every 1s
// ─────────────────────────────────────────────

let lastNarrationAt = 0;
const NARRATION_THROTTLE_MS = 5_000; // narrate at most once per 5s to avoid spam

export async function runCycle(): Promise<void> {
  const skills = getSkills();
  if (skills.length === 0) return;

  const markets = engineState.watchedMarkets;

  // Only scan the focused market — no point watching games hours away
  const focused = markets.find(m => m.id === engineState.focusedMarketId);
  const scanTargets = focused ? [focused] : markets.slice(0, 1);

  const allOpportunities: Opportunity[] = [];

  for (const skill of skills) {
    try {
      const opps = await skill.detect(scanTargets);
      allOpportunities.push(...opps);

      // Update market status based on opportunities
      for (const opp of opps) {
        const market = markets.find(m => m.id === opp.marketId);
        if (market) {
          market.edge = opp.edge;
          market.aiEstimate = opp.modelProbability;
          market.status = 'edge_detected';
          market.lastUpdated = new Date().toISOString();
          if (opp.gameData) {
            market.gameData = opp.gameData;
            market.status = 'live';
            if (opp.ev > 0) market.status = 'edge_detected';
          }
        }
      }
    } catch {
      // Skill errors don't crash the brain
    }
  }

  engineState.lastCycleAt = new Date().toISOString();

  // Only one open position at a time
  const openTrade = getOpenTrade();
  if (openTrade) {
    // Narrate occasionally while holding
    const now = Date.now();
    if (now - lastNarrationAt > NARRATION_THROTTLE_MS) {
      const market = markets.find(m => m.id === openTrade.marketId);
      const currentPrice = openTrade.side === 'yes'
        ? market?.yesPrice
        : market?.noPrice;
      if (currentPrice !== undefined) {
        addMessage({
          text: `Holding ${openTrade.marketTitle.substring(0, 35)} — ${openTrade.side.toUpperCase()} at $${currentPrice.toFixed(2)} (entry: $${openTrade.entryPrice.toFixed(2)})`,
          type: 'info',
        });
      }
      lastNarrationAt = now;
    }
    return;
  }

  // No open position — find best opportunity by EV
  if (allOpportunities.length === 0) {
    const now = Date.now();
    if (now - lastNarrationAt > NARRATION_THROTTLE_MS * 6) {
      const liveSkills = skills.filter(s => s.status === 'active');
      if (liveSkills.length === 0) {
        addMessage({ text: 'No live games right now. Waiting for action...', type: 'idle' });
      } else {
        addMessage({ text: `Scanning ${markets.length} markets — no positive-EV opportunities yet`, type: 'idle' });
      }
      lastNarrationAt = now;
    }
    return;
  }

  // Sort by EV descending, pick best
  allOpportunities.sort((a, b) => b.ev - a.ev);
  const best = allOpportunities[0];

  const edgePct = (best.edge * 100).toFixed(1);
  addMessage({
    text: `Edge detected! ${best.gameData.homeTeam} vs ${best.gameData.awayTeam} ${best.gameData.period} ${best.gameData.clock} — Model: ${(best.modelProbability * 100).toFixed(0)}% vs Market: ${(best.marketPrice * 100).toFixed(0)}%. Edge: +${edgePct}%`,
    type: 'warning',
  });

  await enterPosition(best);

  // Update market status
  const market = markets.find(m => m.id === best.marketId);
  if (market) market.status = 'position_open';
}

// ─────────────────────────────────────────────
// Boot
// ─────────────────────────────────────────────

let started = false;

export function startBrain() {
  if (started) return;
  started = true;
  engineState.isRunning = true;

  registerSkill(new NBALiveEdge());

  // Main cycle: every 1s
  setInterval(async () => {
    try {
      await runCycle();
    } catch (err) {
      addMessage({
        text: `Brain cycle error: ${err instanceof Error ? err.message : String(err)}`,
        type: 'warning',
      });
    }
  }, 1_000);

  // Exit monitor: every 2s
  setInterval(async () => {
    try {
      await checkExits();
    } catch {
      // Silent
    }
  }, 2_000);

  // Market refresh: every 15s for near-instant price updates
  setInterval(async () => {
    await refreshMarkets();
  }, 15_000);

  // Initial market load
  refreshMarkets();

  addMessage({
    text: 'OnePercent AI brain started. Scanning for NBA opportunities...',
    type: 'info',
  });
}
