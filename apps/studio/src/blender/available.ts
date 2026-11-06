/**
 * When the studio offers Blender: only with a local Aether server (never a
 * hosted page or the paired bridge) that reports Blender ready. Everything
 * else Blender is loaded from here on demand, so nothing reaches the first
 * download and a hosted page never calls `/api/local/blender/*`.
 */
import type { HostToolRunner } from '@aether/agent';
import type { AiConnectionState } from '../ai/connection';
import type { GlbImporter } from './host';

/** The label of every Blender control when Blender cannot be used here. */
export const BLENDER_LOCAL_ONLY = 'Local run only — run the Aether CLI with Blender installed';

/** Is Blender ready on this page's local server? */
export function blenderReady(s: Pick<AiConnectionState, 'server' | 'local'>): boolean {
  return s.server.local && s.local.blender === 'ready';
}

/** The agent's Blender tools, or null (hosted, no local server, Blender not ready). */
export async function blenderToolsFor(s: Pick<AiConnectionState, 'server' | 'local'>, assets: GlbImporter): Promise<HostToolRunner | null> {
  if (!blenderReady(s)) return null;
  try {
    return (await import('./host')).studioBlenderRunner(assets);
  } catch {
    return null;
  }
}
