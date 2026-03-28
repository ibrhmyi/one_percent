export async function register() {
  // Only run on the server, not during build
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Start the brain engine on server boot
    const { startBrain } = await import('./engine/brain');
    console.log('[Instrumentation] Starting brain engine...');
    await startBrain();
    console.log('[Instrumentation] Brain started.');
  }
}
