import { logWarning, logInfo } from './logger.js';

interface OpenPosition {
  ticker: string;
  sizeUsd: number;
  openedAt: number;
}

export class RiskManager {
  private openPositions: Map<string, OpenPosition> = new Map();
  private totalExposure: number = 0;
  private maxOpenPositions: number;
  private maxTotalExposureUsd: number;

  constructor(maxOpenPositions: number = 3, maxTotalExposureUsd: number = 150) {
    this.maxOpenPositions = maxOpenPositions;
    this.maxTotalExposureUsd = maxTotalExposureUsd;
  }

  /**
   * Check if a trade is allowed based on risk limits
   */
  canTrade(
    kalshiTicker: string
  ): {
    allowed: boolean;
    reason?: string;
  } {
    // Check if already trading this ticker
    if (this.openPositions.has(kalshiTicker)) {
      return {
        allowed: false,
        reason: `Already have open position on ${kalshiTicker}`,
      };
    }

    // Check max open positions
    if (this.openPositions.size >= this.maxOpenPositions) {
      return {
        allowed: false,
        reason: `Max open positions (${this.maxOpenPositions}) reached`,
      };
    }

    return { allowed: true };
  }

  /**
   * Record that a trade was executed
   */
  recordTrade(kalshiTicker: string, sizeUsd: number): void {
    if (this.openPositions.has(kalshiTicker)) {
      logWarning(
        `[risk-manager] Trade recorded for ${kalshiTicker} but position already exists`
      );
      return;
    }

    // Check if adding this position would exceed exposure limit
    const newTotalExposure = this.totalExposure + sizeUsd;
    if (newTotalExposure > this.maxTotalExposureUsd) {
      logWarning(
        `[risk-manager] Trade would exceed max exposure: ${newTotalExposure.toFixed(2)}USD > ${this.maxTotalExposureUsd}USD`
      );
      return;
    }

    this.openPositions.set(kalshiTicker, {
      ticker: kalshiTicker,
      sizeUsd,
      openedAt: Date.now(),
    });

    this.totalExposure = newTotalExposure;

    logInfo(
      `[risk-manager] Trade recorded: ${kalshiTicker} $${sizeUsd.toFixed(2)} | Exposure: $${this.totalExposure.toFixed(2)}/${this.maxTotalExposureUsd}`
    );
  }

  /**
   * Record that a position was closed
   */
  recordClose(kalshiTicker: string): void {
    const position = this.openPositions.get(kalshiTicker);
    if (!position) {
      logWarning(`[risk-manager] Tried to close non-existent position: ${kalshiTicker}`);
      return;
    }

    this.openPositions.delete(kalshiTicker);
    this.totalExposure -= position.sizeUsd;

    logInfo(
      `[risk-manager] Position closed: ${kalshiTicker} | Exposure: $${this.totalExposure.toFixed(2)}/${this.maxTotalExposureUsd}`
    );
  }

  /**
   * Get current risk status
   */
  getStatus(): {
    openPositions: number;
    totalExposureUsd: number;
    maxExposureUsd: number;
    positions: Array<{ ticker: string; sizeUsd: number; openedAtMs: number }>;
  } {
    return {
      openPositions: this.openPositions.size,
      totalExposureUsd: this.totalExposure,
      maxExposureUsd: this.maxTotalExposureUsd,
      positions: Array.from(this.openPositions.values()).map((p) => ({
        ticker: p.ticker,
        sizeUsd: p.sizeUsd,
        openedAtMs: p.openedAt,
      })),
    };
  }

  /**
   * Reset risk manager (for testing)
   */
  reset(): void {
    this.openPositions.clear();
    this.totalExposure = 0;
  }
}
