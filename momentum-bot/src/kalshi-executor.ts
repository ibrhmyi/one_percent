import { MomentumSignal, OrderResult } from './types.js';
import { findKalshiMatch } from './market-matcher.js';
import { placeOrder, getMarket } from './kalshi-rest.js';
import { RiskManager } from './risk-manager.js';
import { logInfo, logWarning, logError } from './logger.js';

export class KalshiExecutor {
  private riskManager: RiskManager;
  private positionSizeUsd: number;
  private dryRun: boolean;

  constructor(positionSizeUsd: number = 25, dryRun: boolean = true) {
    this.positionSizeUsd = positionSizeUsd;
    this.dryRun = dryRun;

    const maxOpenPositions = parseInt(process.env.MAX_OPEN_POSITIONS || '3', 10);
    const maxExposureUsd = parseInt(process.env.MAX_TOTAL_EXPOSURE_USD || '150', 10);

    this.riskManager = new RiskManager(maxOpenPositions, maxExposureUsd);
  }

  /**
   * Execute a momentum signal on Kalshi
   */
  async executeOnKalshi(signal: MomentumSignal): Promise<OrderResult> {
    const dryRun = this.dryRun || process.env.DRY_RUN !== 'false';

    try {
      // Step 1: Find Kalshi market match
      const match = await findKalshiMatch(signal.polyConditionId, signal.title);
      if (!match) {
        return {
          success: false,
          kalshiTicker: 'UNKNOWN',
          side: 'yes',
          sizeUsd: this.positionSizeUsd,
          errorMessage: 'no Kalshi match found',
          dryRun,
          timestamp: Date.now(),
        };
      }

      const kalshiTicker = match.ticker;

      // Step 2: Risk check - can we trade this ticker?
      const riskCheck = this.riskManager.canTrade(kalshiTicker);
      if (!riskCheck.allowed) {
        return {
          success: false,
          kalshiTicker,
          side: 'yes',
          sizeUsd: this.positionSizeUsd,
          errorMessage: `risk limit: ${riskCheck.reason}`,
          dryRun,
          timestamp: Date.now(),
        };
      }

      // Step 3: Get current Kalshi market price
      let kalshiMarket;
      try {
        kalshiMarket = await getMarket(kalshiTicker);
      } catch (error) {
        logError(`Failed to fetch Kalshi market ${kalshiTicker}`, error);
        return {
          success: false,
          kalshiTicker,
          side: 'yes',
          sizeUsd: this.positionSizeUsd,
          errorMessage: `failed to fetch market: ${String(error).substring(0, 50)}`,
          dryRun,
          timestamp: Date.now(),
        };
      }

      if (!kalshiMarket) {
        return {
          success: false,
          kalshiTicker,
          side: 'yes',
          sizeUsd: this.positionSizeUsd,
          errorMessage: 'market not found on Kalshi',
          dryRun,
          timestamp: Date.now(),
        };
      }

      // Step 4: Sanity check - if already repriced, skip
      const kalshiYesAskCents = Math.round(kalshiMarket.yesAsk * 100);
      if (kalshiYesAskCents > 90) {
        return {
          success: false,
          kalshiTicker,
          side: 'yes',
          sizeUsd: this.positionSizeUsd,
          errorMessage: `already repriced (ask=${kalshiYesAskCents}¢ > 90¢)`,
          dryRun,
          timestamp: Date.now(),
        };
      }

      // Step 5: Calculate order size
      // count = number of contracts, each costs limitCents cents
      // We want to spend roughly positionSizeUsd
      const count = Math.floor((this.positionSizeUsd * 100) / kalshiYesAskCents);

      if (count < 1) {
        return {
          success: false,
          kalshiTicker,
          side: 'yes',
          sizeUsd: this.positionSizeUsd,
          errorMessage: `position too small for current price (count=${count})`,
          dryRun,
          timestamp: Date.now(),
        };
      }

      // Step 6: Place order at yesAsk + 2 cents to ensure fill
      const limitCents = Math.min(99, kalshiYesAskCents + 2); // Cap at 99 cents

      // Log the trade intent
      const actualSizeUsd = (count * limitCents) / 100;

      if (dryRun) {
        logInfo('[executor] DRY_RUN trade:');
        logInfo(`  Signal: "${signal.title}" velocity=${(signal.velocity * 100).toFixed(2)}¢/s confidence=${signal.confidence}`);
        logInfo(`  Kalshi match: ${kalshiTicker} (yes @ ${kalshiYesAskCents}¢)`);
        logInfo(`  Order: BUY ${count} YES contracts @ ${limitCents}¢ = ~$${actualSizeUsd.toFixed(2)} USD`);
        logInfo(`  (not placed - DRY_RUN=true)`);

        this.riskManager.recordTrade(kalshiTicker, actualSizeUsd);

        return {
          success: true,
          orderId: `dry-run-${Date.now()}`,
          kalshiTicker,
          side: 'yes',
          sizeUsd: actualSizeUsd,
          fillPrice: limitCents / 100,
          dryRun: true,
          timestamp: Date.now(),
        };
      }

      // Step 7: Place real order
      let orderResult;
      try {
        orderResult = await placeOrder({
          ticker: kalshiTicker,
          side: 'yes',
          count,
          limitCents,
          clientOrderId: `signal-${signal.polyConditionId}-${Date.now()}`,
        });
      } catch (error) {
        logError(`Failed to place order on ${kalshiTicker}`, error);
        return {
          success: false,
          kalshiTicker,
          side: 'yes',
          sizeUsd: actualSizeUsd,
          errorMessage: `order placement failed: ${String(error).substring(0, 50)}`,
          dryRun: false,
          timestamp: Date.now(),
        };
      }

      // Record the trade in risk manager
      this.riskManager.recordTrade(kalshiTicker, actualSizeUsd);

      logInfo(`[executor] Order placed: ${kalshiTicker} ${count}@${limitCents}¢ (ID: ${orderResult.orderId})`);

      return {
        success: true,
        orderId: orderResult.orderId,
        kalshiTicker,
        side: 'yes',
        sizeUsd: actualSizeUsd,
        fillPrice: limitCents / 100,
        dryRun: false,
        timestamp: Date.now(),
      };
    } catch (error) {
      logError('executeOnKalshi unexpected error', error);
      return {
        success: false,
        kalshiTicker: 'ERROR',
        side: 'yes',
        sizeUsd: this.positionSizeUsd,
        errorMessage: `unexpected error: ${String(error).substring(0, 50)}`,
        dryRun,
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Get current risk status
   */
  getRiskStatus() {
    return this.riskManager.getStatus();
  }

  /**
   * Close a position (marks it as closed in risk manager)
   */
  closePosition(kalshiTicker: string): void {
    this.riskManager.recordClose(kalshiTicker);
  }

  /**
   * Reset executor (for testing)
   */
  reset(): void {
    this.riskManager.reset();
  }
}

/**
 * Singleton instance for module-level use
 */
let executorInstance: KalshiExecutor | null = null;

export function initializeExecutor(
  positionSizeUsd?: number,
  dryRun?: boolean
): KalshiExecutor {
  const size = positionSizeUsd || parseInt(process.env.POSITION_SIZE_USD || '25', 10);
  const isDryRun = dryRun ?? process.env.DRY_RUN !== 'false';

  executorInstance = new KalshiExecutor(size, isDryRun);
  return executorInstance;
}

export function getExecutor(): KalshiExecutor {
  if (!executorInstance) {
    executorInstance = initializeExecutor();
  }
  return executorInstance;
}

/**
 * Execute signal using default executor instance
 */
export async function executeOnKalshi(signal: MomentumSignal): Promise<OrderResult> {
  const executor = getExecutor();
  return executor.executeOnKalshi(signal);
}
