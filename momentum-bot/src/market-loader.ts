import { WatchedMarket } from './types.js';
import { logError, logInfo, logWarning } from './logger.js';

// Gamma API returns camelCase fields - these match the actual API response
interface GammaMarket {
  conditionId: string;
  question?: string;
  title?: string;
  active: boolean;
  closed: boolean;
  archived: boolean;
  acceptingOrders?: boolean;
  clobTokenIds: string | string[];   // sometimes JSON string, sometimes array
  outcomePrices: string | string[];  // JSON string like '["0.50","0.50"]' or array
  liquidityNum?: number;
  liquidity?: number;
  volumeNum?: number;
  volume?: number;
  endDate?: string;
  end_date?: string;
  gameStartTime?: string;
  startDate?: string;
}

const LOOKAHEAD_HOURS = 48;      // 48h lookahead window
const MIN_LIQUIDITY = 500;       // $500 minimum (relaxed from $1k)
const MIN_YES_PRICE = 0.03;      // 3% floor
const MAX_YES_PRICE = 0.85;      // 85% ceiling (relaxed from 75%)

async function fetchGammaMarkets(): Promise<GammaMarket[]> {
  const url = new URL('https://gamma-api.polymarket.com/markets');
  url.searchParams.append('active', 'true');
  url.searchParams.append('closed', 'false');
  url.searchParams.append('archived', 'false');
  url.searchParams.append('order', 'endDate');
  url.searchParams.append('limit', '500');

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(
      `Gamma API error: ${response.status} ${response.statusText}`
    );
  }

  // Gamma API returns a flat array, not { data: [] }
  const data = (await response.json()) as unknown;
  return Array.isArray(data) ? (data as GammaMarket[]) : [];
}

function parseStringArray(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch { return []; }
  }
  return [];
}

function isWithinWindow(market: GammaMarket): boolean {
  const raw = market.endDate ?? market.end_date;
  if (!raw) return false;
  const endMs = new Date(raw).getTime();
  const now = Date.now();
  const diffMs = endMs - now;
  // Accept markets ending within LOOKAHEAD_HOURS, or already started (live)
  return diffMs > -4 * 3600_000 && diffMs <= LOOKAHEAD_HOURS * 3600_000;
}

function isLikelyLive(market: GammaMarket): boolean {
  if (market.acceptingOrders === true) return true;
  const start = market.gameStartTime ?? market.startDate;
  if (!start) return false;
  const startMs = new Date(start).getTime();
  const now = Date.now();
  // Game started within the last 4 hours
  return now >= startMs && now <= startMs + 4 * 3600_000;
}

function getYesPrice(market: GammaMarket): number | null {
  const prices = parseStringArray(market.outcomePrices);
  if (prices.length === 0) return null;
  const raw = Number(prices[0]);
  if (!Number.isFinite(raw)) return null;
  return raw > 1 ? raw / 100 : raw;
}

function getLiquidity(market: GammaMarket): number {
  return market.liquidityNum ?? market.liquidity ?? 0;
}

function getTitle(market: GammaMarket): string {
  return market.question ?? market.title ?? 'Untitled';
}

export async function loadWatchlistFromPolymarket(): Promise<WatchedMarket[]> {
  try {
    logInfo('Fetching markets from Polymarket Gamma API...');
    const markets = await fetchGammaMarkets();
    logInfo(`Got ${markets.length} raw markets from Gamma API`);

    const watched: WatchedMarket[] = [];

    // Debug counters
    let noEndDate = 0;
    let outsideWindow = 0;
    let priceFail = 0;
    let liquidityFail = 0;
    let noTokenId = 0;

    for (const market of markets) {
      // Must have end date OR be live
      const withinWindow = isWithinWindow(market);
      const live = isLikelyLive(market);

      if (!withinWindow && !live) {
        outsideWindow++;
        continue;
      }

      // YES price in momentum range
      const yesPrice = getYesPrice(market);
      if (yesPrice === null || yesPrice < MIN_YES_PRICE || yesPrice > MAX_YES_PRICE) {
        priceFail++;
        continue;
      }

      // Minimum liquidity
      if (getLiquidity(market) < MIN_LIQUIDITY) {
        liquidityFail++;
        continue;
      }

      // Must have token ID and condition ID
      const tokenIds = parseStringArray(market.clobTokenIds);
      const yesTokenId = tokenIds[0];
      if (!yesTokenId || !market.conditionId) {
        noTokenId++;
        continue;
      }

      watched.push({
        polyConditionId: market.conditionId,
        polyTokenId: yesTokenId,
        title: getTitle(market),
        kalshiTicker: null,
        addedAt: Date.now(),
      });
    }

    // Log filter diagnostics
    logInfo(
      `Filter results: ${watched.length} passed | ` +
      `${outsideWindow} outside ${LOOKAHEAD_HOURS}h window | ` +
      `${priceFail} price outside ${MIN_YES_PRICE*100}-${MAX_YES_PRICE*100}% | ` +
      `${liquidityFail} low liquidity | ` +
      `${noTokenId} missing token/condition ID`
    );

    if (watched.length > 0) {
      // Log first few markets for verification
      const preview = watched.slice(0, 5);
      for (const m of preview) {
        logInfo(`  → ${m.title.substring(0, 60)}`);
      }
      if (watched.length > 5) {
        logInfo(`  → ... and ${watched.length - 5} more`);
      }
    }

    return watched;
  } catch (error) {
    logError('Failed to load watchlist from Polymarket', error);
    return [];
  }
}
