import { loadBotConfig } from './config.js';
import { MomentumDetector } from './momentum-detector.js';
import { createPolymarketClobSocket } from './polymarket-clob.js';
import { loadWatchlistFromPolymarket } from './market-loader.js';
import {
  logBotStartup,
  logMarketLoaded,
  logSignal,
  logOrderResult,
  logError,
  logInfo,
  logWarning,
} from './logger.js';
import { MomentumSignal, OrderResult, WatchedMarket } from './types.js';

let executeOnKalshi:
  | ((signal: MomentumSignal) => Promise<OrderResult>)
  | null = null;

async function initializeKalshiExecutor(): Promise<void> {
  try {
    // Dynamic import - will fail if module doesn't exist, which is expected during initial dev
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const mod = await (import('./kalshi-executor.js') as Promise<any>);
    if (mod?.executeOnKalshi) {
      executeOnKalshi = mod.executeOnKalshi as (
        signal: MomentumSignal
      ) => Promise<OrderResult>;
      logInfo('kalshi-executor loaded, live order execution available');
    }
  } catch {
    logWarning(
      'kalshi-executor not available, signals will be logged only (paper trading mode)'
    );
  }
}

async function handleMomentumSignal(signal: MomentumSignal): Promise<void> {
  logSignal(signal);

  if (!executeOnKalshi) {
    return;
  }

  try {
    const result = await executeOnKalshi(signal);
    logOrderResult(result);
  } catch (error) {
    logError('Failed to execute order on Kalshi', error);
  }
}

async function main(): Promise<void> {
  const config = loadBotConfig();

  logBotStartup({
    velocityThreshold: config.velocityThreshold,
    windowMs: config.windowMs,
    dryRun: config.dryRun,
  });

  await initializeKalshiExecutor();

  // Load initial watchlist
  let watchedMarkets: WatchedMarket[] = await loadWatchlistFromPolymarket();

  // Mutable lookup map — rebuilt whenever watchedMarkets changes
  const marketByConditionId = new Map<string, WatchedMarket>();
  const marketByTokenId = new Map<string, WatchedMarket>();

  function rebuildMarketMaps(markets: WatchedMarket[]): void {
    marketByConditionId.clear();
    marketByTokenId.clear();
    for (const m of markets) {
      marketByConditionId.set(m.polyConditionId, m);
      marketByTokenId.set(m.polyTokenId, m);
    }
  }

  rebuildMarketMaps(watchedMarkets);

  // Set up market refresh every 5 minutes — also rebuilds lookup maps
  const refreshInterval = setInterval(async () => {
    logInfo('Refreshing market watchlist...');
    watchedMarkets = await loadWatchlistFromPolymarket();
    rebuildMarketMaps(watchedMarkets);
  }, 5 * 60 * 1000);

  // Create momentum detector
  const detector = new MomentumDetector(config, handleMomentumSignal);

  // Create Polymarket CLOB socket
  const tokenIds = watchedMarkets.map((m) => m.polyTokenId);

  if (tokenIds.length === 0) {
    logError('No markets loaded, exiting');
    clearInterval(refreshInterval);
    process.exit(1);
  }

  logMarketLoaded(watchedMarkets.length);

  const clobSocket = createPolymarketClobSocket(tokenIds, {
    onOpen: () => {
      logInfo('Subscribed to Polymarket CLOB book updates');
    },
    onBook: (snapshot) => {
      // CLOB identifies by tokenId (asset_id) primarily; conditionId (market field) is secondary
      const market =
        marketByTokenId.get(snapshot.tokenId) ??
        marketByConditionId.get(snapshot.conditionId);
      if (market) {
        detector.processBookUpdate(snapshot, market);
      }
    },
    onPriceChange: (snapshot) => {
      const market =
        marketByTokenId.get(snapshot.tokenId) ??
        marketByConditionId.get(snapshot.conditionId);
      if (market) {
        detector.processBookUpdate(snapshot, market);
      }
    },
    onError: (error) => {
      logError('CLOB socket error', error);
    },
    onClose: () => {
      logInfo('CLOB socket closed');
    },
  });

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    logInfo('SIGINT received, shutting down gracefully...');
    clearInterval(refreshInterval);
    clobSocket.close();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    logInfo('SIGTERM received, shutting down gracefully...');
    clearInterval(refreshInterval);
    clobSocket.close();
    process.exit(0);
  });

  process.on('unhandledRejection', (reason, promise) => {
    logError('Unhandled rejection', reason);
  });
}

main().catch((error) => {
  logError('Fatal error', error);
  process.exit(1);
});
