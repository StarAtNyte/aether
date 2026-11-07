/**
 * The publish bake in the page (docs/LIGHTING-BAKE.md, "Bake at publish"): the lightmap of a bake job
 * (`LightmapController.bakeJob`) gathered on several lightmap workers at once, as the Node cook's threaded bake splits it
 * (scripts/blender-bake.ts `cpuShares`), and finished in one of them into the `.lmap` file itself.
 *
 * - Each lane takes a `bake` token of the page's worker scheduler (@aether/core worker-scheduler) before its worker gets work,
 *   so the bake never takes the cores the first picture, a raycast or the cells in view need; the scheduler holds back a bake
 *   while the view moves or a drag runs, and a lane whose token is asked to yield parks its worker and gives the token back.
 * - The job is cut into more shares than lanes (every `count`-th covered texel, `LightmapBaker` `split`), so a lane that
 *   started late or was parked does not hold up the end.
 * - The main thread only posts messages and sums progress: the trace, the denoise, the encoding and the image are the
 *   workers'. The result is the same file format the Node cook writes (same unwrap, texels, parts and coding; a lossless image).
 */
import { workerBudget, workerScheduler, type WorkerScheduler, type WorkToken } from '@aether/core';
import { partCount } from '../environment/relight';
import { parseFileReply, parseShareReply, type LightmapRequest, type ShareReply } from '../environment/lightmap-protocol';
import type { LightmapWorkerLike } from './lightmap-controller';

/** A bake job as `LightmapController.bakeJob` makes it. */
export interface PublishBakeJob {
  key: string;
  request: LightmapRequest;
  triCounts: number[];
  quality: string;
}

export interface PublishBakeProgress {
  /** 0..1 of the whole bake. */
  fraction: number;
  /** Seconds left at the rate so far, or null until there is a rate. */
  etaSeconds: number | null;
  /** Lanes holding a token right now. */
  running: number;
  lanes: number;
}

export interface PublishBakeOptions {
  /** Lanes (workers): default the page's worker budget, `max(1, cores − 2)`. */
  lanes?: number;
  /** Shares the job is cut into: default three per lane. */
  shares?: number;
  signal?: AbortSignal;
  onProgress?(p: PublishBakeProgress): void;
  createWorker?: () => LightmapWorkerLike;
  scheduler?: WorkerScheduler;
  /** Clock (tests). */
  now?: () => number;
}

export interface PublishBakeResult {
  /** The `.lmap` file. */
  bytes: Uint8Array;
  ms: number;
  lanes: number;
  shares: number;
  texels: number;
  rays: number;
  image: 'webp' | 'png' | 'raw';
}

/** Every distinct buffer of the typed arrays in `v` (to transfer it). */
function buffersOf(v: unknown, out = new Set<ArrayBuffer>()): ArrayBuffer[] {
  if (ArrayBuffer.isView(v)) {
    if (v.buffer instanceof ArrayBuffer) out.add(v.buffer);
  } else if (Array.isArray(v)) for (const x of v) buffersOf(x, out);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) buffersOf(x, out);
  return [...out];
}

function defaultWorker(): LightmapWorkerLike {
  return new Worker(new URL('../environment/lightmap.worker.ts', import.meta.url), { type: 'module' }) as unknown as LightmapWorkerLike;
}

const abortError = (signal: AbortSignal | undefined): Error => (signal?.reason instanceof Error ? signal.reason : new DOMException('The bake was cancelled', 'AbortError'));

/** Bake `job`'s lightmap on several workers and return its `.lmap` file. Rejects when cancelled or a worker fails. */
export async function bakeLightmapSplit(job: PublishBakeJob, opts: PublishBakeOptions = {}): Promise<PublishBakeResult> {
  const signal = opts.signal;
  if (signal?.aborted) throw abortError(signal);
  const now = opts.now ?? (() => performance.now());
  const scheduler = opts.scheduler ?? workerScheduler();
  const lanes = Math.max(1, Math.min(64, Math.floor(opts.lanes ?? workerBudget())));
  const count = Math.max(1, Math.min(512, Math.floor(opts.shares ?? lanes * 3)));
  const make = opts.createWorker ?? defaultWorker;
  const parts = partCount(job.request.sunKeys.length);
  const t0 = now();
  const id = 1;

  const shares: Array<ShareReply | null> = new Array<ShareReply | null>(count).fill(null);
  const progress = new Float64Array(count);
  let next = 0;
  let running = 0;
  let firstWork = -1;
  let lastReport = 0;
  const workers: LightmapWorkerLike[] = [];
  const tokens = new Set<WorkToken>();
  let failed: Error | null = null;
  let holder: LightmapWorkerLike | null = null;

  const report = (force = false): void => {
    const t = now();
    if (!force && t - lastReport < 200) return;
    lastReport = t;
    let sum = 0;
    for (let i = 0; i < count; i++) sum += progress[i]!;
    // The gather is the bake; the finish (denoise, encode, image) is the last few per cent.
    const fraction = Math.min(0.96, (0.96 * sum) / count);
    const rate = firstWork >= 0 && sum > 0.02 * count ? (t - firstWork) / fraction : null;
    opts.onProgress?.({ fraction, etaSeconds: rate !== null ? Math.max(0, ((1 - fraction) * rate) / 1000) : null, running, lanes });
  };

  /** One message from `w` matching `pick`, progress folded in on the way. */
  const reply = <T>(w: LightmapWorkerLike, pick: (data: unknown) => T | null): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const onAbort = (): void => reject(abortError(signal));
      signal?.addEventListener('abort', onAbort, { once: true });
      const done = (): void => signal?.removeEventListener('abort', onAbort);
      w.onerror = () => {
        done();
        reject(new Error('a lightmap worker failed'));
      };
      w.onmessage = (e: MessageEvent) => {
        const d = e.data as { type?: unknown; id?: unknown; value?: unknown; index?: unknown; ok?: unknown; error?: unknown } | null;
        if (!d || d.id !== id) return;
        if (d.type === 'progress') {
          if (typeof d.index === 'number' && d.index >= 0 && d.index < count && typeof d.value === 'number') progress[d.index] = Math.max(0, Math.min(1, d.value));
          report();
          return;
        }
        if (d.type === 'lightmap' && d.ok === false) {
          done();
          reject(new Error(typeof d.error === 'string' ? d.error : 'the bake failed'));
          return;
        }
        const v = pick(e.data);
        if (v === null) return;
        done();
        resolve(v);
      };
    });

  /** The first worker has the job (the others get their copies from it). */
  let holderReady: Promise<unknown> | null = null;

  /** Take a token, or wait for one (rejects when cancelled). */
  const acquire = async (): Promise<WorkToken> => {
    const tok = await scheduler.acquire('bake', signal);
    tokens.add(tok);
    return tok;
  };
  const give = (tok: WorkToken): void => {
    tokens.delete(tok);
    tok.release();
  };

  const lane = async (): Promise<void> => {
    let w: LightmapWorkerLike | null = null;
    let tok: WorkToken | null = null;
    try {
      while (!failed && next < count) {
        if (!tok) tok = await acquire();
        if (failed || next >= count) break;
        if (!w) {
          w = make();
          workers.push(w);
          const ready = reply(w, (d) => ((d as { type?: unknown }).type === 'held' ? true : null));
          if (!holder) {
            // The first lane's worker is given the request itself (its buffers transferred, nothing copied here) ...
            holder = w;
            holderReady = ready;
            w.postMessage({ ...job.request, id, hold: true }, buffersOf(job.request));
          } else {
            // ... and copies it to every other lane's worker over a channel of their own, so the copies (tens of megabytes
            // each) are made on the first worker's thread, never on the page's.
            await holderReady;
            if (failed || signal?.aborted) break;
            const ch = new MessageChannel();
            holder.postMessage({ type: 'relay', port: ch.port1 }, [ch.port1]);
            w.postMessage({ type: 'hold-from', port: ch.port2 }, [ch.port2]);
          }
          await ready;
        }
        const index = next++;
        if (firstWork < 0) firstWork = now();
        running++;
        const got = reply(w, (d) => parseShareReply(d, parts));
        w.postMessage({ type: 'share', id, index, count });
        // Park the worker while the scheduler asks the bake to yield (the view moves, a drag, more urgent work).
        const ww = w;
        let parked = false;
        let settled = false;
        let held: WorkToken | null = tok;
        const watch = setInterval(() => {
          if (!parked && held?.yieldRequested) {
            parked = true;
            ww.postMessage({ type: 'pause', on: true });
            give(held);
            held = null;
            running--;
            void acquire().then(
              (t) => {
                if (settled) {
                  give(t);
                  return;
                }
                held = t;
                parked = false;
                running++;
                ww.postMessage({ type: 'pause', on: false });
              },
              () => undefined,
            );
          }
        }, 250);
        try {
          const share = await got;
          shares[share.index] = share;
          progress[share.index] = 1;
          report();
        } finally {
          settled = true;
          clearInterval(watch);
          if (!parked) running--;
          tok = held;
        }
        // Between shares the token goes back when more urgent work waits.
        if (tok?.yieldRequested) {
          give(tok);
          tok = null;
        }
      }
    } catch (e) {
      failed ??= e instanceof Error ? e : new Error(String(e));
    } finally {
      if (tok) give(tok);
      if (w && w !== holder) {
        w.terminate();
        const i = workers.indexOf(w);
        if (i >= 0) workers.splice(i, 1);
      }
    }
  };

  const stopAll = (): void => {
    for (const w of workers) w.terminate();
    workers.length = 0;
    for (const t of [...tokens]) give(t);
  };

  try {
    await Promise.all(Array.from({ length: Math.min(lanes, count) }, () => lane()));
    if (signal?.aborted) throw abortError(signal);
    if (failed) throw failed;
    const all = shares.filter((s): s is ShareReply => s !== null);
    if (all.length !== count || !holder) throw new Error('the bake lost a share');
    // The finish: one worker, one token, every share transferred to it.
    const tok = await acquire();
    try {
      const w = holder as LightmapWorkerLike;
      const got = reply(w, (d) => parseFileReply(d));
      const transfer: Transferable[] = [];
      for (const s of all) transfer.push(s.vis.buffer, s.bounce.buffer, s.bad.buffer);
      w.postMessage({ type: 'finish', id, shares: all.map((s) => ({ vis: s.vis, bounce: s.bounce, bad: s.bad, rays: s.rays })), meta: { key: job.key, quality: job.quality, bakeMs: now() - t0, triCounts: job.triCounts } }, transfer);
      const file = await got;
      opts.onProgress?.({ fraction: 1, etaSeconds: 0, running: 0, lanes });
      return { bytes: file.bytes, ms: now() - t0, lanes, shares: count, texels: file.texels, rays: file.rays, image: file.image };
    } finally {
      give(tok);
    }
  } finally {
    stopAll();
  }
}
