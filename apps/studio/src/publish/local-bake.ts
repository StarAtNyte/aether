/**
 * The publish bake on this computer, when the studio is served by the local server (`aether start`): the bake job goes to
 * `/api/local/bake/lightmap` (apps/server local-bake.ts: Cycles on the GPU, else the threaded CPU baker, as the Node cook
 * bakes) and the `.lmap` comes back. Elsewhere (a hosted studio, a static build) there is none and the page's workers bake.
 */
import { encodeBakeJob } from '@aether/render';
import type { PublishLightBakeOptions } from './cook-publish';

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])$/i;

/** The local baker, or null when this page has none (asked once per publish, quickly). */
export async function localLightmapBake(fetchImpl: typeof fetch = (u, i) => fetch(u, i), host: string = typeof location !== 'undefined' ? location.hostname : ''): Promise<NonNullable<PublishLightBakeOptions['outside']> | null> {
  if (!LOCAL_HOST.test(host)) return null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetchImpl('/api/local/bake/status', { credentials: 'same-origin', signal: ctrl.signal }).finally(() => clearTimeout(t));
    if (!res.ok) return null;
    const st = (await res.json()) as { available?: unknown };
    if (st.available !== true) return null;
  } catch {
    return null;
  }
  return async (job, signal) => {
    const body = encodeBakeJob(job);
    const res = await fetchImpl('/api/local/bake/lightmap', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/octet-stream' }, body: body as Uint8Array<ArrayBuffer>, ...(signal ? { signal } : {}) });
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  };
}
