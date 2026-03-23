import { createSign, constants } from 'node:crypto';
import { logError, logWarning, logInfo } from './logger.js';

const BASE_URL = 'https://api.elections.kalshi.com/trade-api/rest/v2';

function normalizePrivateKey(privateKey: string): string {
  return privateKey.replace(/\\n/g, '\n');
}

function buildKalshiSignature(
  timestamp: string,
  method: string,
  path: string,
  privateKey: string
): string {
  const message = `${timestamp}${method}${path}`;
  const signer = createSign('RSA-SHA256');
  signer.update(message);
  signer.end();

  return signer
    .sign({
      key: normalizePrivateKey(privateKey),
      padding: constants.RSA_PKCS1_PSS_PADDING,
      saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
    })
    .toString('base64');
}

interface KalshiRequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  body?: Record<string, unknown>;
}

async function makeKalshiRequest<T>(options: KalshiRequestOptions): Promise<T> {
  const apiKeyId = process.env.KALSHI_API_KEY_ID?.trim();
  const privateKey = process.env.KALSHI_PRIVATE_KEY?.trim();

  if (!apiKeyId || !privateKey) {
    throw new Error(
      'Kalshi credentials missing. Set KALSHI_API_KEY_ID and KALSHI_PRIVATE_KEY env vars.'
    );
  }

  const timestamp = Date.now().toString();
  const signature = buildKalshiSignature(timestamp, options.method, options.path, privateKey);

  const url = new URL(options.path, BASE_URL);
  const fetchUrl = url.toString();

  const headers: Record<string, string> = {
    'KALSHI-ACCESS-KEY': apiKeyId,
    'KALSHI-ACCESS-SIGNATURE': signature,
    'KALSHI-ACCESS-TIMESTAMP': timestamp,
    'Content-Type': 'application/json',
  };

  try {
    const response = await fetch(fetchUrl, {
      method: options.method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Kalshi API error (${response.status}): ${errorText || response.statusText}`
      );
    }

    const data = (await response.json()) as T;
    return data;
  } catch (error) {
    logError(`Kalshi REST request failed (${options.method} ${options.path})`, error);
    throw error;
  }
}

/**
 * Get current account balance
 */
export async function getBalance(): Promise<{ availableBalance: number }> {
  const dryRun = process.env.DRY_RUN !== 'false';
  if (dryRun) {
    logInfo('[kalshi-rest] DRY_RUN: getBalance() (returning mock balance)');
    return { availableBalance: 1000 }; // Mock balance for dry run
  }

  try {
    const response = await makeKalshiRequest<{
      balance: number;
      available_balance: number;
    }>({
      method: 'GET',
      path: '/portfolio',
    });
    return { availableBalance: response.available_balance };
  } catch (error) {
    logError('getBalance failed', error);
    throw error;
  }
}

/**
 * Get market details by ticker
 */
export async function getMarket(
  ticker: string
): Promise<{
  ticker: string;
  title: string;
  status: string;
  yesAsk: number;
  yesBid: number;
  volume: number;
} | null> {
  const dryRun = process.env.DRY_RUN !== 'false';
  if (dryRun) {
    logInfo(`[kalshi-rest] DRY_RUN: getMarket(${ticker}) (returning mock market)`);
    return {
      ticker,
      title: `Mock market for ${ticker}`,
      status: 'open',
      yesAsk: 50,
      yesBid: 48,
      volume: 10000,
    };
  }

  try {
    const response = await makeKalshiRequest<{
      markets: Array<{
        ticker: string;
        title: string;
        status: string;
        yes_ask: number;
        yes_bid: number;
        volume: number;
      }>;
    }>({
      method: 'GET',
      path: `/markets?ticker=${encodeURIComponent(ticker)}`,
    });

    const market = response.markets?.[0];
    if (!market) {
      return null;
    }

    return {
      ticker: market.ticker,
      title: market.title,
      status: market.status,
      yesAsk: market.yes_ask,
      yesBid: market.yes_bid,
      volume: market.volume,
    };
  } catch (error) {
    logError(`getMarket failed for ${ticker}`, error);
    throw error;
  }
}

/**
 * Place a limit order
 */
export async function placeOrder(params: {
  ticker: string;
  side: 'yes' | 'no';
  count: number;
  limitCents: number;
  clientOrderId?: string;
}): Promise<{
  orderId: string;
  status: string;
  ticker: string;
  side: string;
  count: number;
  price: number;
}> {
  const dryRun = process.env.DRY_RUN !== 'false';

  const requestBody = {
    ticker: params.ticker,
    side: params.side,
    count: params.count,
    limit_cents: params.limitCents,
    client_order_id: params.clientOrderId || `order-${Date.now()}`,
  };

  if (dryRun) {
    logInfo(
      `[kalshi-rest] DRY_RUN: placeOrder(${params.ticker} ${params.side} ${params.count}@${params.limitCents}¢)`
    );
    return {
      orderId: `dry-run-${Date.now()}`,
      status: 'pending',
      ticker: params.ticker,
      side: params.side,
      count: params.count,
      price: params.limitCents / 100,
    };
  }

  try {
    const response = await makeKalshiRequest<{
      order_id: string;
      status: string;
      ticker: string;
      side: string;
      count: number;
      limit_cents: number;
    }>({
      method: 'POST',
      path: '/portfolio/orders',
      body: requestBody,
    });

    return {
      orderId: response.order_id,
      status: response.status,
      ticker: response.ticker,
      side: response.side,
      count: response.count,
      price: response.limit_cents / 100,
    };
  } catch (error) {
    logError(`placeOrder failed for ${params.ticker}`, error);
    throw error;
  }
}

/**
 * Get open orders
 */
export async function getOpenOrders(): Promise<
  Array<{
    orderId: string;
    ticker: string;
    side: string;
    status: string;
    price: number;
    count: number;
  }>
> {
  const dryRun = process.env.DRY_RUN !== 'false';
  if (dryRun) {
    logInfo('[kalshi-rest] DRY_RUN: getOpenOrders() (returning empty)');
    return [];
  }

  try {
    const response = await makeKalshiRequest<{
      orders: Array<{
        order_id: string;
        ticker: string;
        side: string;
        status: string;
        limit_cents: number;
        count: number;
      }>;
    }>({
      method: 'GET',
      path: '/portfolio/orders',
    });

    return (response.orders || []).map((order) => ({
      orderId: order.order_id,
      ticker: order.ticker,
      side: order.side,
      status: order.status,
      price: order.limit_cents / 100,
      count: order.count,
    }));
  } catch (error) {
    logError('getOpenOrders failed', error);
    throw error;
  }
}
