/**
 * Fetch Polymarket CLOB orderbook and simulate fill prices.
 */

export interface OrderbookLevel {
  price: number;
  size: number;
}

export interface Orderbook {
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
}

export interface FillSimulation {
  avgFillPrice: number;
  totalCost: number;
  totalShares: number;
  slippage: number;
  levelsConsumed: number;
  wouldFill: boolean;
  liquidityWithin3Cents: number;
}

export async function fetchOrderbook(tokenId: string): Promise<Orderbook> {
  try {
    const resp = await fetch(`https://clob.polymarket.com/book?token_id=${tokenId}`, {
      signal: AbortSignal.timeout(5000),
    });

    if (!resp.ok) {
      console.error(`[Orderbook] HTTP ${resp.status} for ${tokenId}`);
      return { bids: [], asks: [] };
    }

    const data = await resp.json();

    return {
      bids: (data.bids || []).map((b: { price: string; size: string }) => ({
        price: parseFloat(b.price),
        size: parseFloat(b.size),
      })).sort((a: OrderbookLevel, b: OrderbookLevel) => b.price - a.price),

      asks: (data.asks || []).map((a: { price: string; size: string }) => ({
        price: parseFloat(a.price),
        size: parseFloat(a.size),
      })).sort((a: OrderbookLevel, b: OrderbookLevel) => a.price - b.price),
    };
  } catch (err) {
    console.error(`[Orderbook] Fetch error:`, err);
    return { bids: [], asks: [] };
  }
}

export function simulateBuy(asks: OrderbookLevel[], dollarAmount: number): FillSimulation {
  let remaining = dollarAmount;
  let totalShares = 0;
  let totalCost = 0;
  let levelsConsumed = 0;

  for (const level of asks) {
    if (remaining <= 0) break;
    levelsConsumed++;

    const availableCost = level.size * level.price;
    const spend = Math.min(remaining, availableCost);
    const shares = spend / level.price;

    totalCost += spend;
    totalShares += shares;
    remaining -= spend;
  }

  const bestPrice = asks.length > 0 ? asks[0].price : 0;
  const avgFillPrice = totalShares > 0 ? totalCost / totalShares : 0;

  const maxPrice = bestPrice + 0.03;
  const liquidityWithin3Cents = asks
    .filter(a => a.price <= maxPrice)
    .reduce((sum, a) => sum + a.size * a.price, 0);

  return {
    avgFillPrice,
    totalCost,
    totalShares,
    slippage: avgFillPrice - bestPrice,
    levelsConsumed,
    wouldFill: remaining <= 0,
    liquidityWithin3Cents,
  };
}
