/**
 * Lightmap worker (module worker): unwraps the building's surfaces and path-traces their lightmap off the main thread
 * (seconds to a minute of CPU for a house). Runs only our own bake code; requests are validated, progress is reported
 * every ~200 ms and the atlas comes back as a transferred buffer. Cancelling is terminating the worker.
 *
 * `{ type: 'pause', on }` parks the bake between two of its slices (the page's worker scheduler gives the core to more
 * urgent work, or the view moves) and resumes it; the bake looks at its messages every {@link YIELD_MS}.
 */
import { TraceScene } from './light-volume';
import { LightmapBaker, unwrapLightmap, type ProxyBox } from './lightmap';
import { parseLightmapRequest, type LightmapReply } from './lightmap-protocol';

interface WorkerScope {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

/** Milliseconds of tracing between two looks at the message queue (a pause comes in through it). */
const YIELD_MS = 400;
let paused = false;
let resume: (() => void) | null = null;

const nextTask = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

scope.onmessage = async (e: MessageEvent): Promise<void> => {
  const msg = e.data as { type?: unknown; on?: unknown } | null;
  if (msg && msg.type === 'pause') {
    paused = msg.on === true;
    if (!paused && resume) {
      const r = resume;
      resume = null;
      r();
    }
    return;
  }
  const req = parseLightmapRequest(e.data);
  if (!req) {
    const id: unknown = (e.data as { id?: unknown } | null)?.id;
    if (typeof id === 'number' && Number.isSafeInteger(id)) scope.postMessage({ type: 'lightmap', id, ok: false, error: 'invalid lightmap request' } satisfies LightmapReply);
    return;
  }
  try {
    const layout = unwrapLightmap(req.meshes, req.maxSize, req.density);
    if (!layout) {
      scope.postMessage({ type: 'lightmap', id: req.id, ok: false, error: 'no surface could be unwrapped' } satisfies LightmapReply);
      return;
    }
    const scene = new TraceScene({ positions: req.positions, albedo: req.albedo, twoSided: req.twoSided });
    const proxies: ProxyBox[] = [];
    for (let i = 0; i + 6 < req.proxies.length; i += 7) {
      const p = req.proxies;
      proxies.push({ lo: [p[i]!, p[i + 1]!, p[i + 2]!], hi: [p[i + 3]!, p[i + 4]!, p[i + 5]!], tri: p[i + 6]! });
    }
    const baker = new LightmapBaker({ scene, proxies, meshes: req.meshes, layout, grid: req.grid, volume: req.volume, sun: req.sun, ambient: req.ambient, ground: req.ground, lamps: req.lamps, samples: req.samples });
    let last = performance.now();
    let looked = last;
    while (!baker.step(100)) {
      const now = performance.now();
      if (now - last > 200) {
        last = now;
        scope.postMessage({ type: 'progress', id: req.id, value: baker.progress } satisfies LightmapReply);
      }
      if (now - looked > YIELD_MS) {
        await nextTask();
        while (paused) await new Promise<void>((r) => (resume = r));
        looked = performance.now();
      }
    }
    const out = baker.output!;
    scope.postMessage(
      { type: 'lightmap', id: req.id, ok: true, size: out.size, scale: out.scale, density: layout.density, charts: layout.charts, texels: out.texels, rays: out.rays, rgba: out.rgba, uv: layout.uv } satisfies LightmapReply,
      [out.rgba.buffer, ...layout.uv.filter((u): u is Float32Array => u !== null).map((u) => u.buffer)],
    );
  } catch (err) {
    scope.postMessage({ type: 'lightmap', id: req.id, ok: false, error: (err instanceof Error ? err.message : String(err)).slice(0, 300) } satisfies LightmapReply);
  }
};
