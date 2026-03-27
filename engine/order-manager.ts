import { PreGameOrder } from './skills/basketball-edge/types';
import { appendFileSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

// On Vercel serverless, filesystem is read-only except /tmp
const isVercel = !!process.env.VERCEL;
const ORDERS_FILE = isVercel ? '/tmp/pregame_orders.json' : 'data/pregame_orders.json';
const orders: Map<string, PreGameOrder> = new Map();

// ── Persistence ──

function ensureDir(filePath: string): void {
  try {
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  } catch {
    // Ignore directory creation errors
  }
}

function loadOrders(): void {
  if (!existsSync(ORDERS_FILE)) return;
  try {
    const data = JSON.parse(readFileSync(ORDERS_FILE, 'utf-8'));
    for (const order of data) {
      orders.set(order.orderId, order);
    }
    console.log(`[OrderManager] Loaded ${orders.size} orders from disk`);
  } catch (err) {
    console.error('[OrderManager] Failed to load orders:', err);
  }
}

function saveOrders(): void {
  try {
    ensureDir(ORDERS_FILE);
    writeFileSync(ORDERS_FILE, JSON.stringify(Array.from(orders.values()), null, 2));
  } catch (err) {
    console.error('[OrderManager] Failed to save orders:', err);
  }
}

// Load on module initialization
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
    if (order.status === 'resting' || order.status === 'partially_filled') {
      total += order.size - order.filledSize;
    }
  }
  return total;
}

// ── Public API ──

export async function placeOrder(params: {
  conditionId: string;
  tokenId: string;
  price: number;
  size: number;
  sportKey: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  fairValue: number;
  edge: number;
}): Promise<PreGameOrder | null> {
  const bankroll = parseFloat(process.env.BANKROLL || '400');
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
  saveOrders();
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
  saveOrders();
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
