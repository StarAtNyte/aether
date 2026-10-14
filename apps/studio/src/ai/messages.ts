/**
 * Plain-language explanations for connection failures (fallback notices,
 * setup hints). Bridge error codes are mapped to an action the user can take.
 */
import type { FallbackNotice } from '@aether/agent';

const ACTIONS: Readonly<Record<string, string>> = {
  bridge_offline: 'the local bridge is not running. Start it with "npx aether start" and pair it in Settings → AI connection',
  unauthorized: 'the bridge pairing expired (the bridge restarted). Pair again in Settings → AI connection',
  not_logged_in: 'it is not signed in on this computer. Run "codex login" or start "claude" once to sign in',
  cli_missing: 'its command-line tool is not installed on this computer',
  rate_limited: "your subscription's usage limit is reached for now. Try again later or pick another model",
  timeout: 'it took too long to answer. Try a faster model or lower effort',
  busy: 'the bridge is busy with other requests',
  tool_violation: 'the run was stopped because the model tried to use a tool (tools are never allowed)',
  forbidden_origin: 'the bridge does not allow this site yet. Restart it with --origin set to this address',
  invalid_url: 'the bridge address is not a local address',
  webllm_error: 'the on-device model failed',
  webllm_context: 'this request is too long for the small on-device model. Try a shorter prompt, start from a smaller world, or use the local bridge',
};

/** Notice shown when a run falls back to the offline planner. */
export function fallbackText(label: string, n: FallbackNotice): string {
  const action = (n.reason && ACTIONS[n.reason]) ?? (n.code === 'network' ? 'it could not be reached' : n.code === 'auth' ? 'it rejected the credentials' : n.message);
  return `${label} could not answer: ${action}. Finished with the offline planner instead.`.slice(0, 600);
}

/** True for a loopback studio origin (`http://localhost:…`, `http://127.0.0.1:…`). */
export function isLocalOrigin(origin: string): boolean {
  return /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin);
}

/**
 * Browser-specific limits on reaching the local bridge from a hosted (HTTPS)
 * copy of the studio, or null when there is nothing to warn about.
 *
 * - Safari (and every iOS browser) treats `http://127.0.0.1` as mixed content on HTTPS pages and
 *   blocks it, so the bridge only works from a locally served studio there.
 * - Chromium may ask for permission to reach devices on the local network
 *   the first time; the request fails until the visitor allows it.
 */
export function hostedBridgeNote(origin: string, userAgent: string): { tone: 'warn' | 'info'; text: string } | null {
  if (isLocalOrigin(origin) || !origin.startsWith('https:')) return null;
  // iOS browsers (CriOS, FxiOS…) are WebKit underneath, so they match the Safari branch.
  const chromium = /(?:Chrome|Chromium|Edg)\//.test(userAgent);
  const firefox = /Firefox\//.test(userAgent);
  if (!chromium && !firefox && /Safari\//.test(userAgent)) {
    return { tone: 'warn', text: 'Safari blocks hosted pages from reaching services on this computer. Use Chrome, Edge or Firefox here, or run Aether locally (npx aether start) and use it there.' };
  }
  if (chromium) return { tone: 'info', text: 'If the browser asks to access apps or devices on your local network, choose Allow: that is how this page reaches the bridge.' };
  return null;
}
