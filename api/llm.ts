/**
 * The hosted model: proxies the studio's completion requests to Claude with the deployment's `ANTHROPIC_API_KEY`
 * (api/_lib/llm.ts has the limits). Without the variable it answers 503 and `/api/health` reports no server model.
 */
import { anthropicCreate, handleLlm, KEY_ENV, RateLimiter, type CreateMessage } from './_lib/llm.js';

/** Per instance: the limits are soft (a cold start or a second instance starts its own counts). */
const limiter = new RateLimiter();
let client: { key: string; create: CreateMessage } | null = null;

export async function POST(request: Request): Promise<Response> {
  const key = process.env[KEY_ENV]?.trim();
  if (!key) return new Response(JSON.stringify({ error: 'mock-mode', message: 'No hosted model is configured on this deployment.' }), { status: 503, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
  if (client?.key !== key) client = { key, create: anthropicCreate(key) };
  return handleLlm(request, { limiter, create: client.create });
}

export function GET(): Response {
  return new Response(JSON.stringify({ error: 'use POST' }), { status: 405, headers: { 'content-type': 'application/json; charset=utf-8', allow: 'POST' } });
}
