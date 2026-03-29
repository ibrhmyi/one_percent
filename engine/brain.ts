import type { WatchedMarket, Opportunity, ESPNGame } from '@/lib/types';
import { engineState, addMessage, getOpenTrade, updateAccount } from './state';
import { registerSkill, getSkills } from './skill-registry';
import { enterPosition } from './trade-manager';
import { checkExits } from './exit-manager';
import { BasketballSkill } from './skills/basketball';
import { PreGameEdgeSkill } from './skills/basketball-edge/index';
import { parseTokenIds } from './skills/basketball/market-matcher';
import { startPriceFeed, resubscribePriceFeed } from './price-feed';
import { getOrders, placeExitOrder, updateOrder } from './order-manager';
import { syncToSupabase } from './supabase-sync';
import { refreshAllPredictions, getAllPredictions, getFairValue, updateBooksPrediction } from './predictions/aggregator';
import { startPolling as startSportsbookPoller } from './predictions/sportsbook-poller';
import { startInjuryMonitor, onInjuryUpdate } from './predictions/injury-monitor';
import { startPinnaclePoller } from './predictions/pinnacle';
import { startKambiPoller } from './predictions/kambi';

const GAMMA_EVENTS_API = 'https://gamma-api.polymarket.com/events';

// ─────────────────────────────────────────────
// Market Discovery — Basketball Events endpoint
// ─────────────────────────────────────────────
// Queries multiple tags (nba, ncaa, wnba) from Gamma API.
// Game events have slugs like nba-lal-ind-2026-03-25 or ncaa-duke-vermont-2026-03-27.

const BASKETBALL_TAGS = ['nba', 'ncaa-basketball', 'march-madness', 'wnba'];
// Match game slugs: prefix-team1-team2-YYYY-MM-DD (teams can be multi-word, prefix includes cbb)
const GAME_SLUG_RE = /^(nba|ncaa|wnba|march-madness|cbb)-[a-z]+(?:-[a-z]+)*-[a-z]+(?:-[a-z]+)*-\d{4}-\d{2}-\d{2}$/;

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
      url.searchParams.set('limit', '200');
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

  // Filter to game events only (ending within next 10 days), deduplicate
  const cutoff = Date.now() + 10 * 24 * 60 * 60 * 1000;
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
      category: eventSlug.startsWith('ncaa') || eventSlug.startsWith('march-madness') || eventSlug.startsWith('cbb') ? 'NCAA'
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

    // Enrich with actual ESPN start times — fetch today's scoreboard only (fast)
    try {
      const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports';
      const allGames: ESPNGame[] = [];

      // Fetch today's scoreboard for each league (1 call each, fast)
      const espnUrls = [
        { url: `${ESPN_BASE}/basketball/nba/scoreboard`, league: 'NBA' },
        { url: `${ESPN_BASE}/basketball/mens-college-basketball/scoreboard`, league: 'NCAA' },
      ];

      await Promise.all(espnUrls.map(async ({ url, league }) => {
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(5000), cache: 'no-store' });
          if (!res.ok) return;
          const data = await res.json();
          for (const event of data?.events ?? []) {
            const comp = event.competitions?.[0];
            if (!comp) continue;
            const home = comp.competitors?.find((c: any) => c.homeAway === 'home');
            const away = comp.competitors?.find((c: any) => c.homeAway === 'away');
            if (!home || !away) continue;
            const state = (event.status?.type?.state ?? 'pre') as 'pre' | 'in' | 'post';
            allGames.push({
              id: String(event.id),
              name: String(event.name ?? ''),
              homeTeam: String(home.team?.shortDisplayName || home.team?.displayName || ''),
              awayTeam: String(away.team?.shortDisplayName || away.team?.displayName || ''),
              homeAbbr: String(home.team?.abbreviation ?? '').toLowerCase(),
              awayAbbr: String(away.team?.abbreviation ?? '').toLowerCase(),
              homeScore: parseInt(home.score ?? '0', 10),
              awayScore: parseInt(away.score ?? '0', 10),
              period: event.status?.period ?? 1,
              clock: event.status?.displayClock ?? '',
              state,
              secondsRemaining: 0,
              scheduledStart: String(event.date ?? ''),
              league,
            });
          }
        } catch { /* skip */ }
      }));

      for (const market of markets) {
        // Strip league prefix from slug: nba-lal-ind-2026-03-25 → lal-ind-2026-03-25
        const slug = market.slug;
        const prefixMatch = slug.match(/^(nba|ncaa|wnba|march-madness|cbb)-/);
        const stripped = prefixMatch ? slug.slice(prefixMatch[0].length) : slug;
        const slugParts = stripped.split('-');
        const abbrA = slugParts[0] ?? '';
        const abbrB = slugParts[1] ?? '';
        // Slug date could be at various positions depending on team name length
        // e.g., "duke-vermont-2026-03-27" or "michigan-st-ohio-st-2026-03-27"
        const dateMatch = stripped.match(/(\d{4}-\d{2}-\d{2})$/);
        const slugDate = dateMatch ? dateMatch[1] : null;

        // Match against all leagues — multi-strategy matching
        const game = allGames.find(g => {
          // Strategy 1: Abbreviation match from slug (exact or 3-letter prefix)
          // ESPN uses "UTAH" but Polymarket slug uses "uta"
          const homeAbbrL = g.homeAbbr.toLowerCase();
          const awayAbbrL = g.awayAbbr.toLowerCase();
          const gameAbbrs = new Set([homeAbbrL, awayAbbrL, homeAbbrL.slice(0, 3), awayAbbrL.slice(0, 3)]);
          const abbrMatch = gameAbbrs.has(abbrA) && gameAbbrs.has(abbrB);

          if (!abbrMatch) {
            // Strategy 2: Team name matching (multiple approaches)
            const titleLower = market.title.toLowerCase();
            const slugLower = market.slug.toLowerCase();
            const homeWords = g.homeTeam.toLowerCase().split(/\s+/);
            const awayWords = g.awayTeam.toLowerCase().split(/\s+/);
            const homeLast = homeWords[homeWords.length - 1] ?? '';
            const awayLast = awayWords[awayWords.length - 1] ?? '';
            const homeFirst = homeWords[0] ?? '';
            const awayFirst = awayWords[0] ?? '';
            const homeAbbr = g.homeAbbr.toLowerCase();
            const awayAbbr = g.awayAbbr.toLowerCase();
            const homeFull = g.homeTeam.toLowerCase();
            const awayFull = g.awayTeam.toLowerCase();

            // Check title, slug, or full team name contains various forms
            const matchesHome = (
              titleLower.includes(homeLast) ||
              titleLower.includes(homeFull) ||
              slugLower.includes(homeAbbr) ||
              slugLower.includes(homeLast) ||
              slugLower.includes(homeFirst) ||
              // NCAA: slug might have condensed names like "stjohn" → match "john"
              (homeLast.length >= 4 && slugLower.includes(homeLast.replace(/[^a-z]/g, '')))
            );
            const matchesAway = (
              titleLower.includes(awayLast) ||
              titleLower.includes(awayFull) ||
              slugLower.includes(awayAbbr) ||
              slugLower.includes(awayLast) ||
              slugLower.includes(awayFirst) ||
              (awayLast.length >= 4 && slugLower.includes(awayLast.replace(/[^a-z]/g, '')))
            );
            if (!matchesHome || !matchesAway) return false;
          }
          // Date filter with 1-day tolerance (games crossing midnight UTC)
          if (slugDate && g.scheduledStart) {
            const slugTime = new Date(slugDate + 'T12:00:00Z').getTime();
            const gameTime = new Date(g.scheduledStart).getTime();
            return Math.abs(gameTime - slugTime) < 36 * 60 * 60 * 1000; // within 36 hours
          }
          return true;
        });
        if (game?.scheduledStart) {
          market.gameStartTime = game.scheduledStart;
          if (game.state === 'in') {
            market.status = 'live';
            market.gameData = {
              homeTeam: game.homeTeam,
              awayTeam: game.awayTeam,
              homeScore: game.homeScore,
              awayScore: game.awayScore,
              period: `Q${game.period}`,
              clock: game.clock,
              league: game.league ?? 'NBA',
            };
          }
          // Mark finished games so they can be filtered out
          if (game.state === 'post') {
            (market as any).gameFinished = true;
          }
        }
      }
    } catch { /* ESPN errors don't block market discovery */ }

    // Enrich with CLOB bid-ask spreads
    try {
      await enrichWithClobSpreads(markets);
    } catch { /* CLOB errors don't block market discovery */ }

    // Refresh prediction sources (BPI every 5min, Torvik every 30min — internally throttled)
    try {
      await refreshAllPredictions();
    } catch { /* Prediction errors don't block market discovery */ }

    // Enrich markets with aggregated fair values
    for (const market of markets) {
      const gameDate = market.gameStartTime ? new Date(market.gameStartTime).toISOString().slice(0, 10) : undefined;
      const prediction = getFairValue(market.homeTeam, market.awayTeam, gameDate);
      if (prediction) {
        market.aiEstimate = prediction.fairHomeWinProb;
        // Calculate edge vs Polymarket price
        // If fair value for YES side > yes price, there's a YES edge
        const yesEdge = prediction.fairHomeWinProb - market.yesPrice;
        const noEdge = prediction.fairAwayWinProb - market.noPrice;
        market.edge = Math.max(yesEdge, noEdge);
      }
    }

    // Keep live games + games starting within 7 days
    const now = Date.now();
    const H36 = 7 * 24 * 60 * 60 * 1000;
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
// Dry-run fill simulation — checks resting orders against market prices
// ─────────────────────────────────────────────

async function simulateDryRunFills(): Promise<void> {
  const isDryRun = process.env.DRY_RUN !== 'false' || !process.env.POLY_PRIVATE_KEY;
  if (!isDryRun) return;

  const orders = getOrders();
  const markets = engineState.watchedMarkets;

  for (const order of orders) {
    // Find matching market to update current price
    const market = markets.find(m => m.conditionId === order.conditionId);
    if (market) {
      const newPrice = order.tokenSide === 'YES' ? market.yesPrice : market.noPrice;
      if (newPrice !== order.currentPrice) {
        await updateOrder(order.orderId, { currentPrice: newPrice });
      }
    }

    // Simulate entry fill: taker orders fill immediately at market price
    if (order.status === 'resting' && order.orderId.startsWith('sim-')) {
      if (!market) continue;
      const currentPrice = order.tokenSide === 'YES' ? market.yesPrice : market.noPrice;
      // Taker: fill immediately at current market price (not waiting for limit)
      const fillPrice = currentPrice > 0 ? currentPrice : order.price;
      await updateOrder(order.orderId, {
        status: 'filled',
        filledSize: order.size,
        avgFillPrice: fillPrice,
        exitOrderStatus: 'resting',
      });

      addMessage({
        text: `[DRY-RUN FILL] ${order.homeTeam} vs ${order.awayTeam} | ${order.tokenSide} filled @ ${(fillPrice * 100).toFixed(1)}¢ ($${order.size.toFixed(0)}) | Exit @ ${(order.fairValue * 100).toFixed(0)}¢`,
        type: 'success',
      });
    }

    // Simulate exit fill: filled position exits when price reaches fair value
    if (order.status === 'filled' && order.exitOrderStatus === 'resting' && order.orderId.startsWith('sim-')) {
      if (order.currentPrice >= order.exitPrice) {
        const pnl = (order.exitPrice - order.avgFillPrice) * (order.size / order.avgFillPrice);
        await updateOrder(order.orderId, { exitOrderStatus: 'filled' });

        addMessage({
          text: `[DRY-RUN EXIT] ${order.awayTeam} @ ${order.homeTeam} | ${order.tokenSide} exit filled @ ${(order.exitPrice * 100).toFixed(0)}¢ | P&L ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`,
          type: 'success',
        });
      }
    }
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

  // Simulate fills for dry-run orders
  await simulateDryRunFills();

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
    await syncToSupabase();
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
  await syncToSupabase();

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

  // Start Pinnacle poller — sharpest odds in the world, free, no geo-blocking
  startPinnaclePoller();

  // Start Kambi/Unibet poller — second independent book source
  startKambiPoller();

  // DK/FD scraper disabled — geo-blocked from all IPs
  // Pinnacle + Kambi provide better data anyway
  // startSportsbookPoller();

  // Start injury monitor (polls ESPN every 2 min, triggers edge recalc on status changes)
  startInjuryMonitor();
  onInjuryUpdate((updates) => {
    const significant = updates.filter(u => u.isSignificant);
    if (significant.length > 0) {
      // Injury news = immediate edge recalculation
      console.log(`[Brain] ${significant.length} significant injury changes — triggering immediate edge scan`);
      const edgeSkill = getSkills().find(s => s.id === 'basketball-edge');
      if (edgeSkill && edgeSkill.status !== 'paused') {
        edgeSkill.detect(engineState.watchedMarkets).catch(() => {});
      }
    }
  });

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
  initialLoadPromise = (async () => {
    await refreshMarkets();
    console.log(`[Brain] Initial load: ${engineState.watchedMarkets.length} markets`);

    // Immediately run basketball-edge detect so watchlist is populated on first request
    const edgeSkill = getSkills().find(s => s.id === 'basketball-edge');
    if (edgeSkill) {
      try {
        await edgeSkill.detect(engineState.watchedMarkets);
        console.log(`[Brain] Initial detect complete`);
      } catch (err) {
        console.error('[Brain] Initial detect failed:', err);
      }
    }
    initialLoadDone = true;
  })().catch(err => {
    initialLoadDone = true;
    console.error('[Brain] Initial load failed:', err);
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
