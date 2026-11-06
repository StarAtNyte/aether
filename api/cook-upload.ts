/**
 * Publishing a cooked world from the editor: the serverless function that stores it on the public dataset
 * (api/_lib/cook-upload.ts has the protocol). The Hugging Face write token is the `HF_WRITE_TOKEN` environment variable
 * of the deployment; it never leaves this function.
 */
import { handleCookUpload, RateLimiter } from './_lib/cook-upload.js';

/** Per instance: the limits are soft (a cold start or a second instance starts its own counts). */
const limiter = new RateLimiter();

export async function POST(request: Request): Promise<Response> {
  const token = process.env['HF_WRITE_TOKEN']?.trim();
  if (!token) return new Response(JSON.stringify({ error: 'publishing cooked worlds is not configured on this deployment' }), { status: 503, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
  return handleCookUpload(request, { token, limiter, ...(process.env['COOK_SIGNING_SECRET'] ? { secret: process.env['COOK_SIGNING_SECRET'] } : {}) });
}

export function GET(): Response {
  return new Response(JSON.stringify({ error: 'use POST' }), { status: 405, headers: { 'content-type': 'application/json; charset=utf-8', allow: 'POST' } });
}
