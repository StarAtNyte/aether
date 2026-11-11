/**
 * What the studio probes on load (apps/studio/src/ai/connection.ts): `mode: 'live'` when this deployment has a hosted
 * model (`ANTHROPIC_API_KEY` set), so visitors can use the agent without their own key; `mock` otherwise.
 * Kept free of the SDK so the probe stays a cheap cold start.
 */
const KEY_ENV = 'ANTHROPIC_API_KEY';

export function GET(): Response {
  const live = (process.env[KEY_ENV]?.trim() ?? '') !== '';
  const body = { ok: true, mode: live ? 'live' : 'mock', providers: live ? ['anthropic'] : ['mock'], byok: false, local: false, imageTo3d: false, assetImport: false };
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}
