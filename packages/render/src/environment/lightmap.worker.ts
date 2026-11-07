/**
 * Lightmap worker (module worker): unwraps the building's surfaces and path-traces their lightmap off the main thread
 * (seconds to a minute of CPU for a house). Runs only our own bake code; requests are validated, progress is reported
 * every ~200 ms and the atlas layers come back as a transferred buffer. Cancelling is terminating the worker.
 *
 * `{ type: 'pause', on }` parks the bake between two of its slices (the page's worker scheduler gives the core to more
 * urgent work, or the view moves) and resumes it; the bake looks at its messages every {@link YIELD_MS}.
 */
import { TraceScene } from './light-volume';
import { LightmapBaker, LIGHTMAP_VERSION, unwrapLightmap, type LightmapBakeInput, type LightmapLayout, type ProxyBox } from './lightmap';
import { LIGHTMAP_MAX_ASSET_BYTES, packAsset, stackAtlas, type LightmapAssetMeta } from './lightmap-asset';
import { decodeImage, encodeImage } from './lightmap-codec';
import { parseFinish, parseLightmapRequest, parseShare, type LightmapReply, type LightmapRequest, type ShareReply } from './lightmap-protocol';

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

/**
 * A bake split over several workers (the publish bake, `view/publish-bake.ts`): each worker holds the job (`hold: true` on
 * the request: unwrapped and its trace scene built once), gathers the shares it is given (`{ type: 'share', index, count }`,
 * every `count`-th covered texel), and one of them finishes from all the shares (`{ type: 'finish' }`): denoise, encode and
 * the `.lmap` file itself, so the page's main thread never touches the atlas.
 */
let held: { id: number; req: LightmapRequest; layout: LightmapLayout; input: Omit<LightmapBakeInput, 'split'> } | null = null;

/** Run a baker in slices, posting progress and honouring pauses. */
async function drive(baker: LightmapBaker, id: number, index?: number): Promise<void> {
  let last = performance.now();
  let looked = last;
  while (!baker.step(100)) {
    const now = performance.now();
    if (now - last > 200) {
      last = now;
      scope.postMessage({ type: 'progress', id, value: baker.progress, ...(index !== undefined ? { index } : {}) });
    }
    if (now - looked > YIELD_MS) {
      await nextTask();
      while (paused) await new Promise<void>((r) => (resume = r));
      looked = performance.now();
    }
  }
}

/** The stacked atlas as a lossless image: WebP when it decodes back to the same bytes, else PNG, else raw. */
async function losslessImage(stacked: Uint8Array, size: number, rows: number): Promise<{ image: Uint8Array; kind: LightmapAssetMeta['image'] }> {
  const webp = await encodeImage(stacked, size, rows, 'webp', 1);
  if (webp && webp.byteLength < LIGHTMAP_MAX_ASSET_BYTES * 0.9) {
    const back = await decodeImage(webp, size, rows, 'webp');
    let same = back !== null && back.length === stacked.length;
    for (let i = 0; same && i < stacked.length; i++) if (back![i] !== stacked[i]) same = false;
    if (same) return { image: webp, kind: 'webp' };
  }
  const png = await encodeImage(stacked, size, rows, 'png', 1);
  if (png) return { image: png, kind: 'png' };
  return { image: stacked, kind: 'raw' };
}

async function onSplit(data: unknown): Promise<boolean> {
  const share = parseShare(data);
  if (share) {
    if (!held || held.id !== share.id) {
      scope.postMessage({ type: 'lightmap', id: share.id, ok: false, error: 'no job held for this share' } satisfies LightmapReply);
      return true;
    }
    try {
      const baker = new LightmapBaker({ ...held.input, split: { index: share.index, count: share.count } });
      await drive(baker, share.id, share.index);
      const g = baker.gathered();
      scope.postMessage({ type: 'share', id: share.id, index: share.index, count: share.count, vis: g.vis, bounce: g.bounce, bad: g.bad, rays: g.rays } satisfies ShareReply, [g.vis.buffer, g.bounce.buffer, g.bad.buffer]);
    } catch (err) {
      scope.postMessage({ type: 'lightmap', id: share.id, ok: false, error: (err instanceof Error ? err.message : String(err)).slice(0, 300) } satisfies LightmapReply);
    }
    return true;
  }
  const fin = parseFinish(data);
  if (fin) {
    if (!held || held.id !== fin.id) {
      scope.postMessage({ type: 'lightmap', id: fin.id, ok: false, error: 'no job held to finish' } satisfies LightmapReply);
      return true;
    }
    try {
      const { layout, req } = held;
      const res = new LightmapBaker(held.input).finishFrom(fin.shares);
      const rows = res.layers + 1;
      const { image, kind } = await losslessImage(stackAtlas(res.rgba, res.size, res.layers), res.size, rows);
      const meta: LightmapAssetMeta = {
        version: LIGHTMAP_VERSION,
        key: fin.meta.key,
        size: res.size,
        layers: res.layers,
        scales: Array.from(res.scales),
        keys: req.sunKeys.map((k) => [k[0], k[1], k[2]] as [number, number, number]),
        quality: fin.meta.quality,
        samples: req.samples,
        density: layout.density,
        charts: layout.charts,
        texels: res.texels,
        rays: res.rays,
        bakeMs: Math.round(fin.meta.bakeMs),
        tris: layout.uv.map((u, i) => (u ? (fin.meta.triCounts[i] as number) : -1)),
        image: kind,
      };
      const uv = layout.uv.map((u) => (u ? Uint16Array.from(u, (v) => Math.max(0, Math.min(65535, Math.round(v * 65535)))) : null));
      const bytes = packAsset(meta, uv, image);
      scope.postMessage({ type: 'file', id: fin.id, bytes, texels: res.texels, rays: res.rays, image: kind }, [bytes.buffer]);
    } catch (err) {
      scope.postMessage({ type: 'lightmap', id: fin.id, ok: false, error: (err instanceof Error ? err.message : String(err)).slice(0, 300) } satisfies LightmapReply);
    }
    held = null;
    return true;
  }
  return false;
}

scope.onmessage = async (e: MessageEvent): Promise<void> => {
  const msg = e.data as { type?: unknown; on?: unknown; hold?: unknown } | null;
  if (msg && msg.type === 'pause') {
    paused = msg.on === true;
    if (!paused && resume) {
      const r = resume;
      resume = null;
      r();
    }
    return;
  }
  if (msg && (msg.type === 'share' || msg.type === 'finish')) {
    await onSplit(e.data);
    return;
  }
  // A split bake's job from the worker that holds it (`relay`: copy it to the port; `hold-from`: take it from the port).
  const port = (msg as { port?: unknown } | null)?.port;
  if (msg && msg.type === 'relay' && port instanceof MessagePort) {
    if (held) port.postMessage({ ...held.req, hold: true });
    port.close();
    return;
  }
  if (msg && msg.type === 'hold-from' && port instanceof MessagePort) {
    port.onmessage = (m: MessageEvent) => {
      port.close();
      void onRequest(m.data);
    };
    return;
  }
  await onRequest(e.data);
};

async function onRequest(data: unknown): Promise<void> {
  const msg = data as { hold?: unknown } | null;
  const req = parseLightmapRequest(data);
  if (!req) {
    const id: unknown = (data as { id?: unknown } | null)?.id;
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
    const input = { scene, proxies, meshes: req.meshes, layout, grid: req.grid, field: req.field, stride: req.stride, codes: req.codes, sunKeys: req.sunKeys, ground: req.ground, lamps: req.lamps, samples: req.samples };
    if (msg?.hold === true) {
      held = { id: req.id, req, layout, input };
      scope.postMessage({ type: 'held', id: req.id });
      return;
    }
    const baker = new LightmapBaker(input);
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
      { type: 'lightmap', id: req.id, ok: true, size: out.size, layers: out.layers, scales: out.scales, density: layout.density, charts: layout.charts, texels: out.texels, rays: out.rays, rgba: out.rgba, uv: layout.uv } satisfies LightmapReply,
      [out.rgba.buffer, out.scales.buffer, ...layout.uv.filter((u): u is Float32Array => u !== null).map((u) => u.buffer)],
    );
  } catch (err) {
    scope.postMessage({ type: 'lightmap', id: req.id, ok: false, error: (err instanceof Error ? err.message : String(err)).slice(0, 300) } satisfies LightmapReply);
  }
}
