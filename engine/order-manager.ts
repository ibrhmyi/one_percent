import { PreGameOrder } from './skills/basketball-edge/types';
import { createClient } from '@supabase/supabase-js';

// ── In-memory store (primary) + Supabase persistence (durable) ──

const orders: Map<string, PreGameOrder> = new Map();

// Supabase client for persistence
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
const supabase = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

let ordersLoaded = false;

// ── Persistence: Supabase ──

async function loadOrders(): Promise<void> {
  if (ordersLoaded) return;
  ordersLoaded = true;

  if (!supabase) {
    console.log('[OrderManager] No Supabase — orders are in-memory only');
    return;
  }

  try {
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) {
      console.error('[OrderManager] Supabase load error:', error.message);
      return;
    }

    if (data) {
      for (const row of data) {
        const order = rowToOrder(row);
        orders.set(order.orderId, order);
      }
      console.log(`[OrderManager] Loaded ${orders.size} orders from Supabase`);
    }
  } catch (err) {
    console.error('[OrderManager] Failed to load orders:', err);
  }
}

function rowToOrder(row: Record<string, unknown>): PreGameOrder {
  return {
    orderId: String(row.order_id ?? ''),
    conditionId: String(row.condition_id ?? ''),
    tokenId: String(row.token_id ?? ''),
    side: 'BUY' as const,
    tokenSide: String(row.token_side ?? 'YES') as 'YES' | 'NO',
    price: Number(row.price ?? 0),
    size: Number(row.size ?? 0),
    filledSize: Number(row.filled_size ?? 0),
    avgFillPrice: Number(row.avg_fill_price ?? 0),
    status: String(row.status ?? 'resting') as PreGameOrder['status'],
    strategy: 'pre-game-edge' as const,
    sportKey: String(row.sport_key ?? ''),
    homeTeam: String(row.home_team ?? ''),
    awayTeam: String(row.away_team ?? ''),
    commenceTime: String(row.commence_time ?? ''),
    fairValue: Number(row.fair_value ?? 0),
    edge: Number(row.edge ?? 0),
    exitPrice: Number(row.exit_price ?? 0),
    exitOrderStatus: String(row.exit_order_status ?? 'pending') as PreGameOrder['exitOrderStatus'],
    currentPrice: Number(row.current_price ?? 0),
    spread: Number(row.spread ?? 0),
    slug: String(row.slug ?? ''),
    createdAt: String(row.created_at ?? new Date().toISOString()),
    updatedAt: String(row.updated_at ?? new Date().toISOString()),
  };
}

async function saveOrder(order: PreGameOrder): Promise<void> {
  if (!supabase) return;

  try {
    const { error } = await supabase.from('orders').upsert({
      order_id: order.orderId,
      condition_id: order.conditionId,
      token_id: order.tokenId,
      side: order.side,
      token_side: order.tokenSide,
      price: order.price,
      size: order.size,
      filled_size: order.filledSize,
      avg_fill_price: order.avgFillPrice,
      status: order.status,
      strategy: order.strategy,
      sport_key: order.sportKey,
      home_team: order.homeTeam,
      away_team: order.awayTeam,
      commence_time: order.commenceTime,
      fair_value: order.fairValue,
      edge: order.edge,
      exit_price: order.exitPrice,
      exit_order_status: order.exitOrderStatus,
      current_price: order.currentPrice,
      spread: order.spread,
      slug: order.slug,
      created_at: order.createdAt,
      updated_at: order.updatedAt,
    }, { onConflict: 'order_id' });

    if (error) {
      console.error('[OrderManager] Save error:', error.message);
    }
  } catch (err) {
    console.error('[OrderManager] Save failed:', err);
  }
}

// Load on first access
loadOrders();

// ── Singleton ClobClient ──

let clobClient: any = null;

async function getClobClient() {
  if (clobClient) return clobClient;

  const { ClobClient } = await import(/* webpackIgnore: true */ '@polymarket/clob-client' as any);
  const { Wallet } = await import(/* webpackIgnore: true */ '@ethersproject/wallet' as any);

  const signer = new Wallet(process.env.POLY_PRIVATE_KEY!);
  const creds = await new ClobClient('https://clob.polymarket.com', 137, signer).createOrDeriveApiKey();

  clobClient = new ClobClient(
    'https://clob.polymarket.com', 137, signer, creds,
    parseInt(process.env.POLY_SIGNATURE_TYPE || '1'),
    process.env.POLY_FUNDER_ADDRESS
  );

  return clobClient;
}

// ── Capital Tracking ──

function getTotalDeployed(): number {
  let total = 0;
  for (const order of orders.values()) {
    if (order.status === 'resting') {
      total += order.size; // Full order size still at risk
    } else if (order.status === 'partially_filled') {
      total += order.size; // Full size committed (unfilled portion + filled portion)
    } else if (order.status === 'filled') {
      total += order.filledSize; // Capital is deployed in this position until exit
    }
  }
  return total;
}

// ── Public API ──

export async function placeOrder(params: {
  conditionId: string;
  tokenId: string;
  tokenSide: 'YES' | 'NO';
  price: number;
  size: number;
  sportKey: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  fairValue: number;
  edge: number;
  spread?: number;
  slug?: string;
}): Promise<PreGameOrder | null> {
  const bankroll = parseFloat(process.env.BANKROLL || '10000');
  const maxTotalDeployed = bankroll * 0.40;

  if (getTotalDeployed() + params.size > maxTotalDeployed) {
    console.log(`[OrderManager] Skipping — would exceed 40% deployment cap`);
    return null;
  }

  const isDryRun = process.env.DRY_RUN === 'true' || !process.env.POLY_PRIVATE_KEY;

  const order: PreGameOrder = {
    orderId: isDryRun ? `sim-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` : '',
    conditionId: params.conditionId,
    tokenId: params.tokenId,
    side: 'BUY',
    tokenSide: params.tokenSide,
    price: params.price,
    size: params.size,
    filledSize: 0,
    avgFillPrice: 0,
    status: 'resting',
    strategy: 'pre-game-edge',
    sportKey: params.sportKey,
    homeTeam: params.homeTeam,
    awayTeam: params.awayTeam,
    commenceTime: params.commenceTime,
    fairValue: params.fairValue,
    edge: params.edge,
    exitPrice: params.fairValue,  // Exit at fair value
    exitOrderStatus: 'pending',   // Exit order placed after entry fills
    currentPrice: params.price,
    spread: params.spread ?? 0,
    slug: params.slug ?? '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  if (!isDryRun) {
    try {
      const client = await getClobClient();
      const { OrderType, Side } = await import(/* webpackIgnore: true */ '@polymarket/clob-client' as any);

      const result = await client.createAndPostOrder(
        { tokenID: params.tokenId, price: params.price, side: Side.BUY, size: params.size },
        { tickSize: '0.01', negRisk: false },
        OrderType.GTC
      );

      order.orderId = result.orderID;
    } catch (err) {
      console.error('[OrderManager] LIVE order failed:', err);
      return null;
    }
  }

  orders.set(order.orderId, order);
  await saveOrder(order);
  return order;
}

export async function cancelOrder(orderId: string): Promise<boolean> {
  const order = orders.get(orderId);
  if (!order) return false;

  const isDryRun = process.env.DRY_RUN === 'true' || !process.env.POLY_PRIVATE_KEY;

  if (!isDryRun) {
    try {
      const client = await getClobClient();
      await client.cancelOrder(orderId);
    } catch (err) {
      console.error('[OrderManager] Cancel failed:', err);
      return false;
    }
  }

  order.status = 'cancelled';
  order.updatedAt = new Date().toISOString();
  await saveOrder(order);
  return true;
}

/** Place exit (sell) order after entry fills */
export async function placeExitOrder(orderId: string): Promise<boolean> {
  const order = orders.get(orderId);
  if (!order || order.status !== 'filled') return false;

  const isDryRun = process.env.DRY_RUN === 'true' || !process.env.POLY_PRIVATE_KEY;

  if (!isDryRun) {
    try {
      const client = await getClobClient();
      const { OrderType, Side } = await import(/* webpackIgnore: true */ '@polymarket/clob-client' as any);

      // Sell shares at fair value (maker order, 0% fee)
      const shares = order.filledSize / order.avgFillPrice;
      await client.createAndPostOrder(
        { tokenID: order.tokenId, price: order.exitPrice, side: Side.SELL, size: shares },
        { tickSize: '0.01', negRisk: false },
        OrderType.GTC
      );
    } catch (err) {
      console.error('[OrderManager] Exit order failed:', err);
      return false;
    }
  }

  order.exitOrderStatus = 'resting';
  order.updatedAt = new Date().toISOString();
  await saveOrder(order);
  return true;
}

export function getOrders(): PreGameOrder[] {
  return Array.from(orders.values());
}

export function getOrdersForGame(homeTeam: string, awayTeam: string): PreGameOrder[] {
  return Array.from(orders.values()).filter(
    o => o.homeTeam === homeTeam && o.awayTeam === awayTeam && o.status !== 'cancelled'
  );
}

export function getActiveOrderGameIds(): Set<string> {
  const ids = new Set<string>();
  for (const order of orders.values()) {
    if (order.status === 'resting' || order.status === 'partially_filled') {
      ids.add(`${order.homeTeam}-${order.awayTeam}`);
    }
  }
  return ids;
}

/** Update an order in memory and persist */
export async function updateOrder(orderId: string, updates: Partial<PreGameOrder>): Promise<void> {
  const order = orders.get(orderId);
  if (!order) return;
  Object.assign(order, updates, { updatedAt: new Date().toISOString() });
  await saveOrder(order);
}
