/**
 * Cooperative yielding for long headless loops (verification) that run on a
 * UI thread: hands control back to the event loop so rendering and input are
 * not frozen. Uses `scheduler.yield` where available (Chromium), `setImmediate`
 * in Node, and `setTimeout(0)` elsewhere. DOM-free on purpose.
 */
export function yieldToHost(): Promise<void> {
  const g = globalThis as { scheduler?: { yield?: () => Promise<void> } };
  const scheduler = g.scheduler;
  if (scheduler && typeof scheduler.yield === 'function') return scheduler.yield();
  if (typeof setImmediate === 'function') return new Promise((resolve) => setImmediate(resolve));
  return new Promise((resolve) => setTimeout(resolve, 0));
}
