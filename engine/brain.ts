import type { WatchedMarket, Opportunity, ESPNGame } from '@/lib/types';
import { engineState, addMessage, getOpenTrade, updateAccount } from './state';
import { registerSkill, getSkills } from './skill-registry';
import { enterPosition } from './trade-manager';
import { checkExits } from './exit-manager';
import { BasketballSkill } from './skills/basketball';
import { PreGameEdgeSkill } from './skills/basketball-edge/index';
import { parseTokenIds } from './skills/basketball/market-matcher';
import { startPriceFeed, resubscribePriceFeed } from './price-feed';

const GAMMA_EVENTS_API = 'https://gamma-api.polymarket.com/events';

// ─────────────────────────────────────────────
// Market Discovery — Basketball Events endpoint
// ─────────────────────────────────────────────
// Queries multiple tags (nba, ncaa, wnba) from Gamma API.
// Game events have slugs like nba-lal-ind-2026-03-25 or ncaa-duke-vermont-2026-03-27.

const BASKETBALL_TAGS = ['nba', 'ncaa-basketball', 'march-madness', 'wnba'];
// Match game slugs: prefix-team1-team2-YYYY-MM-DD (teams can be multi-word like san-diego-state)
const GAME_SLUG_RE = /^(nba|ncaa|wnba|march-madness)-[a-z]+(?:-[a-z]+)*-[a-z]+(?:-[a-z]+)*-\d{4}-\d{2}-\d{2}$/;

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
  const seenIds = new Set<string>();

  // Fetch from all basketball tags in parallel
  const allEvents: Record<string, unknown>[] = [];
  await Promise.all(BASKETBALL_TAGS.map(async (tag) => {
    try {
      const url = new URL(GAMMA_EVENTS_API);
      url.searchParams.set('active', 'true');
      url.searchParams.set('closed', 'false');
      url.searchParams.set('tag_slug', tag);
      url.searchParams.set('limit', '100');
      url.searchParams.set('order', 'endDate');
      url.searchParams.set('ascending', 'true');

      const res = await fetch(url.toString(), { cache: 'no-store' });
      if (!res.ok) {
        console.error(`[Brain] Gamma API ${tag}: HTTP ${res.status}`);
        return;
      }
      const data = await res.json();
      if (Array.isArray(data)) {
        console.log(`[Brain] Gamma API ${tag}: ${data.length} events`);
        allEvents.push(...data);
      }
    } catch (err) {
      console.error(`[Brain] Gamma API ${tag} error:`, err instanceof Error ? err.message : err);
    }
  }));

  // Filter to game events only (ending within next 7 days), deduplicate
  const cutoff = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const gameEvents = allEvents.filter(ev => {
    const slug = String(ev.slug ?? '');
    const endDate = String(ev.endDate ?? '');
    const endMs = new Date(endDate).getTime();
    // Accept game slugs matching the pattern, or any event with "vs" in title
    const title = String(ev.title ?? '').toLowerCase();
    const isGameEvent = GAME_SLUG_RE.test(slug) || (title.includes(' vs') && endMs > Date.now());
    if (!isGameEvent || endMs > cutoff) return false;
    // Deduplicate by slug
    if (seenIds.has(slug)) return false;
    seenIds.add(slug);
    return true;
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
      category: eventSlug.startsWith('ncaa') || eventSlug.startsWith('march-madness') ? 'NCAA'
              : eventSlug.startsWith('wnba') ? 'WNBA' : 'NBA',
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

    // Enrich with actual ESPN start times — fetch all leagues
    try {
      const { fetchScoreboard } = await import('./skills/basketball/espn-api');
      const espnPaths = [
        { path: 'basketball/nba', league: 'NBA', prefix: 'nba' },
        { path: 'basketball/mens-college-basketball', league: 'NCAA', prefix: 'ncaa' },
        { path: 'basketball/wnba', league: 'WNBA', prefix: 'wnba' },
      ];
      const allGames: ESPNGame[] = [];
      for (const { path, league } of espnPaths) {
        try {
          const g = await fetchScoreboard(path, league);
          allGames.push(...g);
        } catch { /* skip failed league */ }
      }

      for (const market of markets) {
        // Strip league prefix from slug: nba-lal-ind-2026-03-25 → lal-ind-2026-03-25
        const slug = market.slug;
        const prefixMatch = slug.match(/^(nba|ncaa|wnba|march-madness)-/);
        const stripped = prefixMatch ? slug.slice(prefixMatch[0].length) : slug;
        const slugParts = stripped.split('-');
        const abbrA = slugParts[0] ?? '';
        const abbrB = slugParts[1] ?? '';
        const slugDate = slugParts.length >= 5
          ? `${slugParts[2]}-${slugParts[3]}-${slugParts[4]}`
          : null;

        // Match against all leagues
        const game = allGames.find(g => {
          const gameAbbrs = new Set([g.homeAbbr.toLowerCase(), g.awayAbbr.toLowerCase()]);
          if (!gameAbbrs.has(abbrA) || !gameAbbrs.has(abbrB)) {
            // Also try team name substring match for NCAA
            const titleLower = market.title.toLowerCase();
            const homeName = g.homeTeam.toLowerCase().split(' ').pop() ?? '';
            const awayName = g.awayTeam.toLowerCase().split(' ').pop() ?? '';
            if (!titleLower.includes(homeName) || !titleLower.includes(awayName)) return false;
          }
          if (slugDate && g.scheduledStart) {
            return g.scheduledStart.substring(0, 10) === slugDate;
          }
          return true;
        });
        if (game?.scheduledStart) {
          market.gameStartTime = game.scheduledStart;
          if (game.state === 'in') market.status = 'live';
          if (game.state === 'post') market.status = 'upcoming';
        }
      }
    } catch { /* ESPN errors don't block market discovery */ }

    // Enrich with CLOB bid-ask spreads
    try {
      await enrichWithClobSpreads(markets);
    } catch { /* CLOB errors don't block market discovery */ }

    // Keep live games + games starting within 36h (enough for upcoming tab's 24h view)
    const now = Date.now();
    const H36 = 36 * 60 * 60 * 1000;
    const relevant = markets.filter(m => {
      if (m.status === 'live' || m.status === 'edge_detected' || m.status === 'position_open') return true;
      if (!m.gameStartTime) return false;
      const diff = new Date(m.gameStartTime).getTime() - now;
      return diff > -4 * 60 * 60 * 1000 && diff < H36;
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

    const liveCount = relevant.filter(m =>
      m.status === 'live' || m.status === 'edge_detected' || m.status === 'position_open'
    ).length;
    // Re-subscribe WS price feed to new set of token IDs
    resubscribePriceFeed();
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
let lastQuickScanAt = 0;
const QUICK_SCAN_INTERVAL_MS = 10_000; // quickScan every 10s when no live games
let lastPreGameDetectAt = 0;
const PRE_GAME_DETECT_INTERVAL_MS = 60_000; // full detect() for pre-game skill every 60s

export async function runCycle(): Promise<void> {
  const skills = getSkills();
  if (skills.length === 0) return;

  const markets = engineState.watchedMarkets;
  const liveMarkets = markets.filter(m =>
    m.status === 'live' || m.status === 'edge_detected' || m.status === 'position_open'
  );
  const openTrade = getOpenTrade();

  // No live games and no open position — skip Basketball (live skill),
  // but run Basketball Edge: quickScan every 10s, full detect() every 60s.
  if (liveMarkets.length === 0 && !openTrade) {
    const now = Date.now();
    for (const skill of skills) {
      if (skill.status === 'paused') continue;
      if (skill.id === 'basketball-edge' && 'quickScan' in skill) {
        try {
          // Full detect (odds fetch, watchlist, allocation) every 60s
          if (now - lastPreGameDetectAt >= PRE_GAME_DETECT_INTERVAL_MS) {
            lastPreGameDetectAt = now;
            await skill.detect(markets);
          }
          // Quick market scan every 10s
          else if (now - lastQuickScanAt >= QUICK_SCAN_INTERVAL_MS) {
            lastQuickScanAt = now;
            await (skill as PreGameEdgeSkill).quickScan(markets);
          }
        } catch {
          // Skill errors don't crash the brain
        }
      }
    }
    // Still count this as a cycle even when no live games
    engineState.lastCycleAt = new Date().toISOString();
    return;
  }

  const focused = markets.find(m => m.id === engineState.focusedMarketId);
  const scanTargets = liveMarkets.length > 0
    ? liveMarkets
    : focused ? [focused] : markets.slice(0, 1);

  const allOpportunities: Opportunity[] = [];

  for (const skill of skills) {
    if (skill.status === 'paused') continue;
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
let initialLoadDone = false;
let initialLoadPromise: Promise<void> | null = null;

export async function startBrain() {
  if (started) return;
  started = true;
  engineState.isRunning = true;

  registerSkill(new BasketballSkill());
  registerSkill(new PreGameEdgeSkill());

  // Start real-time WebSocket price feed
  startPriceFeed();

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

  addMessage({
    text: 'OnePercent AI brain started. Scanning for basketball opportunities...',
    type: 'info',
  });

  // Initial market load — AWAIT so first API response has data
  initialLoadPromise = refreshMarkets().then(() => {
    initialLoadDone = true;
    console.log(`[Brain] Initial load complete: ${engineState.watchedMarkets.length} markets`);
  }).catch(err => {
    initialLoadDone = true;
    console.error('[Brain] Initial market load failed:', err);
  });
  await initialLoadPromise;
}

/** Wait for initial market data to be available (max 8s) */
export async function waitForInitialLoad(): Promise<void> {
  if (initialLoadDone) return;
  if (initialLoadPromise) {
    await Promise.race([
      initialLoadPromise,
      new Promise<void>(resolve => setTimeout(resolve, 8000)),
    ]);
  }
}
