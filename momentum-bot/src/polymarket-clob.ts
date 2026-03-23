import WebSocket from 'ws';
import { BookSnapshot } from './types.js';
import { logError, logInfo } from './logger.js';

export interface ClobHandlers {
  onBook: (snapshot: BookSnapshot) => void;
  onPriceChange: (snapshot: BookSnapshot) => void;
  onError?: (error: Error) => void;
  onClose?: () => void;
  onOpen?: () => void;
}

interface PriceLevel {
  price: string | number;
  size?: string | number;
}

interface PolymarketBook {
  event_type: string;       // "book" | "price_change" | "last_trade_price" | "tick_size_change"
  asset_id: string;
  market: string;
  // Full book messages have bids/asks arrays sorted best-first
  bids?: PriceLevel[];
  asks?: PriceLevel[];
  // price_change messages may include these
  price?: string | number;
  // price_change batched format
  price_changes?: Array<{
    asset_id?: string;
    best_bid?: PriceLevel | { price?: string | number };
    best_ask?: PriceLevel | { price?: string | number };
    price?: string | number;
  }>;
  // Some convenience fields
  best_bid?: PriceLevel | { price?: string | number };
  best_ask?: PriceLevel | { price?: string | number };
}

function normalizePrice(price: string | number | undefined | null): number {
  if (price === undefined || price === null) return 0;
  const num = typeof price === 'string' ? parseFloat(price) : price;
  if (!Number.isFinite(num)) return 0;
  // Polymarket prices come as 0-1 decimals (e.g. ".48")
  return num > 1 ? num / 100 : num;
}

function extractBestPrice(
  levels: PriceLevel[] | undefined,
  fallback: PriceLevel | { price?: string | number } | undefined
): number {
  // Prefer explicit best_bid/best_ask if present
  if (fallback?.price !== undefined) return normalizePrice(fallback.price);
  // Otherwise use first element of sorted bids/asks array
  if (levels && levels.length > 0 && levels[0].price !== undefined) {
    return normalizePrice(levels[0].price);
  }
  return 0;
}

// Maximum assets per socket connection (Polymarket limit)
const MAX_ASSETS_PER_SOCKET = 180;
// Heartbeat interval (ms) — server expects PING to keep connection alive
const HEARTBEAT_INTERVAL_MS = 9_000;

export function createPolymarketClobSocket(
  tokenIds: string[],
  handlers: ClobHandlers
): WebSocket {
  const sockets: WebSocket[] = [];
  const heartbeatTimers: NodeJS.Timeout[] = [];
  let isIntentionallyClosed = false;

  // Split token IDs into chunks (Polymarket has a per-connection limit)
  const chunks: string[][] = [];
  for (let i = 0; i < tokenIds.length; i += MAX_ASSETS_PER_SOCKET) {
    chunks.push(tokenIds.slice(i, i + MAX_ASSETS_PER_SOCKET));
  }

  function handleMessage(msg: unknown): void {
    if (!msg || typeof msg !== 'object') return;
    const message = msg as PolymarketBook;

    // Handle "book" events — full order book snapshot
    if (message.event_type === 'book' && typeof message.asset_id === 'string') {
      const yesBid = extractBestPrice(message.bids, message.best_bid);
      const yesAsk = extractBestPrice(message.asks, message.best_ask);

      const snapshot: BookSnapshot = {
        conditionId: message.market || '',
        tokenId: message.asset_id,
        yesBid,
        yesAsk,
        timestamp: Date.now(),
      };
      handlers.onBook(snapshot);
    }

    // Handle "price_change" events — batched or single
    if (message.event_type === 'price_change') {
      // Batched format: price_changes array
      if (Array.isArray(message.price_changes)) {
        for (const change of message.price_changes) {
          if (!change || typeof change !== 'object' || typeof change.asset_id !== 'string') continue;
          const yesBid = extractBestPrice(undefined, change.best_bid);
          const yesAsk = extractBestPrice(undefined, change.best_ask);

          const snapshot: BookSnapshot = {
            conditionId: message.market || '',
            tokenId: change.asset_id,
            yesBid,
            yesAsk,
            timestamp: Date.now(),
          };
          handlers.onPriceChange(snapshot);
        }
      }
      // Single asset format
      else if (typeof message.asset_id === 'string') {
        const yesBid = extractBestPrice(message.bids, message.best_bid);
        const yesAsk = extractBestPrice(message.asks, message.best_ask);

        const snapshot: BookSnapshot = {
          conditionId: message.market || '',
          tokenId: message.asset_id,
          yesBid,
          yesAsk,
          timestamp: Date.now(),
        };
        handlers.onPriceChange(snapshot);
      }
    }
  }

  function connectChunk(chunk: string[], chunkIndex: number): void {
    // Correct URL: /ws/market (NOT /ws/)
    const ws = new WebSocket('wss://ws-subscriptions-clob.polymarket.com/ws/market');

    ws.on('open', () => {
      logInfo(`Polymarket CLOB WebSocket [${chunkIndex}] connected (${chunk.length} assets)`);

      // Subscribe — no auth frame needed for public market data
      const subMsg = {
        assets_ids: chunk,
        type: 'market',
      };
      ws.send(JSON.stringify(subMsg));

      // Heartbeat to keep connection alive
      const heartbeat = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send('PING');
        }
      }, HEARTBEAT_INTERVAL_MS);
      heartbeatTimers.push(heartbeat);

      if (chunkIndex === 0) {
        handlers.onOpen?.();
      }
    });

    ws.on('message', (data: WebSocket.Data) => {
      const raw = data.toString();
      // Ignore PONG heartbeat responses
      if (raw === 'PONG') return;

      try {
        const parsed = JSON.parse(raw) as unknown;

        // Server can send arrays of messages
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            handleMessage(item);
          }
          return;
        }

        handleMessage(parsed);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        handlers.onError?.(err);
      }
    });

    ws.on('error', (error: Error) => {
      logError(`Polymarket CLOB WebSocket [${chunkIndex}] error`, error.message);
      handlers.onError?.(error);
    });

    ws.on('close', () => {
      if (!isIntentionallyClosed) {
        logInfo(`Polymarket CLOB WebSocket [${chunkIndex}] closed, reconnecting in 2s...`);
        setTimeout(() => connectChunk(chunk, chunkIndex), 2000);
      }
      handlers.onClose?.();
    });

    sockets.push(ws);
  }

  // Connect all chunks
  for (let i = 0; i < chunks.length; i++) {
    connectChunk(chunks[i], i);
  }

  logInfo(`Opening ${chunks.length} WebSocket connection(s) for ${tokenIds.length} assets`);

  // Return a wrapper that can close all sockets
  return {
    close: () => {
      isIntentionallyClosed = true;
      for (const timer of heartbeatTimers) {
        clearInterval(timer);
      }
      for (const socket of sockets) {
        socket.close();
      }
    },
  } as unknown as WebSocket;
}
