/**
 * Cooperative yielding for long headless loops (verification): hands control
 * back to the event loop so rendering, input and (inside a Worker) cancel
 * messages are processed. Uses `scheduler.yield` where available (Chromium),
 * `setImmediate` in Node, a `MessageChannel` round trip in other browsers and
 * workers (not clamped to 4 ms like nested timers), and `setTimeout(0)` as
 * the last resort. DOM-free on purpose.
 */
let channel: MessageChannel | null = null;
const waiting: Array<() => void> = [];

function viaChannel(): Promise<void> {
  if (!channel) {
    channel = new MessageChannel();
    channel.port1.onmessage = () => {
      const resolve = waiting.shift();
      resolve?.();
    };
  }
  const port = channel.port2;
  return new Promise((resolve) => {
    waiting.push(resolve);
    port.postMessage(0);
  });
}

/** Resolve on a later turn of the event loop. */
export function yieldToHost(): Promise<void> {
  const g = globalThis as { scheduler?: { yield?: () => Promise<void> } };
  const scheduler = g.scheduler;
  if (scheduler && typeof scheduler.yield === 'function') return scheduler.yield();
  if (typeof setImmediate === 'function') return new Promise((resolve) => setImmediate(resolve));
  if (typeof MessageChannel === 'function') return viaChannel();
  return new Promise((resolve) => setTimeout(resolve, 0));
}
