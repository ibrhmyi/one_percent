import WebSocket from 'ws';
import { engineState } from './state';

/**
 * POLYMARKET CLOB WebSocket Price Feed
 *
 * Connects to Polymarket's real-time price stream.
 * Subscriptions are refreshed whenever the watched market list changes.
 *
 * On each price_change event:
 *   - Finds the market by yesTokenId or noTokenId
 *   - Updates yesPrice or noPrice in engineState in real-time
 *   - Marks lastUpdated so the frontend shows fresh data
 *
 * Falls back gracefully — if WS disconnects, the 15s CLOB REST
 * polling in brain.ts continues to update prices.
 */

const CLOB_WS_URL = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let connected = false;

// Exported so the API route can report WS status to the frontend
export function isPriceFeedConnected(): boolean {
  return connected;
}

function subscribe(): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  // Subscribe to ALL markets with token IDs — pre-game prices need updates too
  const tokenIds = engineState.watchedMarkets
    .flatMap(m => [m.yesTokenId, m.noTokenId])
    .filter(Boolean);

  if (tokenIds.length === 0) return;

  const msg = JSON.stringify({
    type: 'Market',
    assets_ids: tokenIds,
  });

  ws.send(msg);
}

function handleMessage(raw: Buffer | string): void {
  try {
    const data = JSON.parse(raw.toString());
    // CLOB sends arrays of events
    const events: Record<string, unknown>[] = Array.isArray(data) ? data : [data];

    for (const ev of events) {
      const eventType = String(ev.event_type ?? ev.type ?? '');
      const assetId = String(ev.asset_id ?? ev.market ?? '');
      const priceStr = String(ev.price ?? '');
      const price = parseFloat(priceStr);

      if (!assetId || isNaN(price) || price <= 0 || price >= 1) continue;

      // Skip non-price events
      if (eventType && !eventType.includes('price') && !eventType.includes('trade')) continue;

      for (const market of engineState.watchedMarkets) {
        if (market.yesTokenId === assetId) {
          market.yesPrice = price;
          market.lastUpdated = new Date().toISOString();
        } else if (market.noTokenId === assetId) {
          market.noPrice = price;
          market.lastUpdated = new Date().toISOString();
        }
      }
    }
  } catch {
    // Ignore parse errors — keep running
  }
}

function connect(): void {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;

  try {
    ws = new WebSocket(CLOB_WS_URL, {
      handshakeTimeout: 10_000,
    });

    ws.on('open', () => {
      connected = true;
      console.log('[PriceFeed] Connected to Polymarket CLOB WebSocket');
      subscribe();
    });

    ws.on('message', (data: Buffer) => {
      handleMessage(data);
    });

    ws.on('close', () => {
      connected = false;
      console.log('[PriceFeed] Disconnected — reconnecting in 5s');
      ws = null;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, 5_000);
    });

    ws.on('error', (err) => {
      console.error('[PriceFeed] WebSocket error:', err.message);
      ws?.terminate();
    });
  } catch (err) {
    console.error('[PriceFeed] Failed to connect:', err);
    reconnectTimer = setTimeout(connect, 10_000);
  }
}

/**
 * Start the price feed. Called once when the brain boots.
 */
export function startPriceFeed(): void {
  connect();
}

/**
 * Re-subscribe after watched markets change (called by brain after market refresh).
 */
export function resubscribePriceFeed(): void {
  if (ws?.readyState === WebSocket.OPEN) {
    subscribe();
  }
}
