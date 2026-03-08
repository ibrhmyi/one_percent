export function createRequestSpacer(minDelayMs: number) {
  let nextSlot = 0;

  return async function waitForTurn() {
    const now = Date.now();
    const waitMs = Math.max(0, nextSlot - now);

    nextSlot = Math.max(now, nextSlot) + minDelayMs;

    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  };
}
