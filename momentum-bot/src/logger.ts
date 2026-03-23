import { MomentumSignal, BookSnapshot, OrderResult } from './types.js';

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
};

function timestamp(): string {
  return new Date().toISOString();
}

export function logBotStartup(config: {
  velocityThreshold: number;
  windowMs: number;
  dryRun: boolean;
}): void {
  console.log(`${colors.cyan}[${timestamp()}]${colors.reset} ${colors.bright}🚀 Bot Starting${colors.reset}`);
  console.log(
    `${colors.dim}  DRY_RUN: ${config.dryRun ? 'ON (paper trading)' : 'OFF (live trading)'} | Velocity Threshold: ${config.velocityThreshold}/sec | Window: ${config.windowMs}ms${colors.reset}`
  );
}

export function logMarketLoaded(count: number): void {
  console.log(
    `${colors.cyan}[${timestamp()}]${colors.reset} ${colors.bright}📊 Loaded ${count} markets${colors.reset}`
  );
}

export function logBookUpdate(snapshot: BookSnapshot, title?: string): void {
  console.log(
    `${colors.yellow}[${timestamp()}]${colors.reset} ${colors.dim}book${colors.reset} ${title || snapshot.conditionId} | bid=${snapshot.yesBid.toFixed(4)} ask=${snapshot.yesAsk.toFixed(4)}`
  );
}

export function logSignal(signal: MomentumSignal): void {
  console.log(
    `\n${colors.green}[${timestamp()}]${colors.reset} ${colors.bright}🔥 MOMENTUM SIGNAL${colors.reset}`
  );
  console.log(
    `${colors.green}  Market:${colors.reset} ${signal.title}`
  );
  console.log(
    `${colors.green}  Confidence:${colors.reset} ${signal.confidence.toUpperCase()}`
  );
  console.log(
    `${colors.green}  Velocity:${colors.reset} ${(signal.velocity * 100).toFixed(2)}¢/sec`
  );
  console.log(
    `${colors.green}  Price:${colors.reset} ${signal.yesBid.toFixed(4)} / ${signal.yesAsk.toFixed(4)}`
  );
  console.log(
    `${colors.green}  History:${colors.reset} ${signal.priceHistory.length} points over ${Math.round((signal.timestamp - signal.priceHistory[0]?.timestamp) / 1000)}s\n`
  );
}

export function logOrderResult(result: OrderResult): void {
  if (result.success) {
    console.log(
      `${colors.green}[${timestamp()}]${colors.reset} ${colors.bright}✓ Order Executed${colors.reset}`
    );
    console.log(
      `${colors.green}  Ticker:${colors.reset} ${result.kalshiTicker} | Side: ${result.side} | Size: $${result.sizeUsd} | Fill: ${result.fillPrice?.toFixed(4)}`
    );
  } else {
    console.log(
      `${colors.red}[${timestamp()}]${colors.reset} ${colors.bright}✗ Order Failed${colors.reset}`
    );
    console.log(`${colors.red}  Error:${colors.reset} ${result.errorMessage}`);
  }
  if (result.dryRun) {
    console.log(`${colors.dim}  (dry run mode)${colors.reset}`);
  }
}

export function logError(message: string, error?: unknown): void {
  console.error(
    `${colors.red}[${timestamp()}]${colors.reset} ${colors.bright}❌ ERROR${colors.reset} ${message}`
  );
  if (error) {
    console.error(`${colors.dim}${String(error)}${colors.reset}`);
  }
}

export function logInfo(message: string, details?: string): void {
  console.log(
    `${colors.cyan}[${timestamp()}]${colors.reset} ${colors.bright}ℹ${colors.reset} ${message}`
  );
  if (details) {
    console.log(`${colors.dim}${details}${colors.reset}`);
  }
}

export function logWarning(message: string): void {
  console.log(
    `${colors.yellow}[${timestamp()}]${colors.reset} ${colors.bright}⚠ WARNING${colors.reset} ${message}`
  );
}
