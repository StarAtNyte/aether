/**
 * Generation lane (module worker, trusted code only): the off-main-thread half of procedural geometry.
 *
 * - `gen`: run a built-in generator.
 * - `post`: validate a custom generator's raw output from the locked-down sandbox (the page never scans it).
 * - `lookup`: read the persistent cache only.
 * - `cook` (configuration, no reply): a cooked package to read before generating, and the cook's "keep everything" switch
 *   (cook/format.ts `LaneCookConfig`).
 *
 * Every output is validated, its render-ready streams are prepared (metre UVs, 16-bit indices, bounds; see
 * buffer-geometry.ts `preparePart`), it is stored in the generated-geometry cache (ddc.ts) when it was worth
 * generating, and it goes back to the page with zero-copy transfers. `gen` and `post` look the cache up first.
 */
import { generateBuiltinSync, outputBytes, validateOutput } from '@aether/procgen';
import type { GeneratorOutput } from '../types';
import { prepareOutputParts, preparePart } from './buffer-geometry';
import { prepareSoft } from './soften';
import { Ddc, ddcKey, encodeOutput, type EncodedOutput } from './ddc';
import { checkOutputShape, outputTransfer, parseGenRequest, type GenReply, type LaneTimes } from './gen-protocol';
import { LaneCookSource } from '../cook/lane-source';
import type { LaneCookConfig } from '../cook/format';

interface Scope {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
  location: { href: string };
}
const scope = self as unknown as Scope;
const ddc = Ddc.available() ? new Ddc(scope.location.href) : null;

/** Outputs cheaper than this to make, and smaller than {@link STORE_MIN_BYTES}, are not worth a cache entry. */
const STORE_MIN_MS = 4;
const STORE_MIN_BYTES = 256 * 1024;

function message(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 300);
}

/** The cooked package of the world being loaded (null: none), and whether every output is kept (a cook records the world). */
let cook: LaneCookSource | null = null;
let keepAll = false;

/** Apply a `cook` configuration message (validated loosely: a malformed index only means misses). */
function configure(cfg: LaneCookConfig): void {
  keepAll = cfg.keepAll === true;
  const index = cfg.index;
  cook = index && Array.isArray(index.packs) && index.packs.every((u) => typeof u === 'string') && typeof index.entries === 'object' && index.entries !== null ? new LaneCookSource(index) : null;
}

/**
 * A stored output: the persistent cache first, then the cooked package (whose entry then seeds the cache). Entries are
 * written only by these lanes, after validation; a read checks the shape (array types and lengths) and deletes an entry
 * that does not match. `from.cooked` is set when the package served it.
 */
async function cached(key: string, t: LaneTimes, from?: { cooked: boolean }): Promise<GeneratorOutput | null> {
  const t0 = performance.now();
  if (ddc) {
    const out = await ddc.get(key);
    if (out) {
      t.read += performance.now() - t0;
      if (checkOutputShape(out)) return out;
      await ddc.remove(key);
    }
  }
  if (cook?.has(key)) {
    const entry = await cook.get(key);
    t.read += performance.now() - t0;
    if (entry && checkOutputShape(entry.output)) {
      if (from) from.cooked = true;
      // Seeded behind the reply; skipped while writes are backed up (the package's HTTP cache still serves a later visit).
      if (ddc && writeBacklog <= MAX_WRITE_BACKLOG) queueWrite(ddc, key, { blob: new Blob([entry.encoded as Uint8Array<ArrayBuffer>]), bytes: entry.encoded.byteLength });
      return entry.output;
    }
    return null;
  }
  t.read += performance.now() - t0;
  return null;
}

/** Write an entry after the reply, one at a time per lane, behind a bounded backlog. */
function queueWrite(store: Ddc, key: string, e: EncodedOutput): void {
  writeBacklog += e.bytes;
  writes = writes.then(() => store.put(key, e)).finally(() => {
    writeBacklog -= e.bytes;
  });
}

function reply(msg: GenReply, out?: GeneratorOutput): void {
  scope.postMessage(msg, out ? outputTransfer(out) : []);
}

async function finish(id: number, key: string | null, out: GeneratorOutput, ms: number, t: LaneTimes, always = false): Promise<void> {
  let t0 = performance.now();
  prepareOutputParts(out.parts);
  for (const part of out.parts) prepareSoft(part, preparePart);
  t.prepare += performance.now() - t0;
  // The entry is encoded before the buffers are transferred away: a Blob holds its own copy of the bytes, so this is the
  // only copy kept, and it is written after the reply, so the page never waits on the cache.
  const bytes = outputBytes(out);
  let entry: EncodedOutput | null = null;
  if (ddc && key && (always || keepAll || ms >= STORE_MIN_MS || bytes >= STORE_MIN_BYTES)) {
    // Bounded backlog of entries waiting for storage: wait for the writes first rather than pile up memory.
    if (writeBacklog > MAX_WRITE_BACKLOG) await writes;
    t0 = performance.now();
    try {
      entry = encodeOutput(out);
    } catch {
      entry = null;
    }
    t.encode += performance.now() - t0;
  }
  reply({ type: 'result', id, ok: true, output: out, hit: false, times: t }, out);
  if (entry && ddc && key) queueWrite(ddc, key, entry);
}

/** Encoded entries waiting to be written, in bytes, and the chain of writes (one at a time per lane). */
let writeBacklog = 0;
let writes: Promise<void> = Promise.resolve();
const MAX_WRITE_BACKLOG = 16 * 1024 * 1024;

scope.onmessage = (e: MessageEvent): void => {
  const data = e.data as { type?: unknown; config?: unknown } | null;
  if (data && data.type === 'cook') {
    if (typeof data.config === 'object' && data.config !== null) configure(data.config as LaneCookConfig);
    return;
  }
  const req = parseGenRequest(e.data);
  if (!req) return;
  void (async () => {
    const t: LaneTimes = { read: 0, generate: 0, validate: 0, prepare: 0, encode: 0 };
    try {
      const key = req.key ? await ddcKey(req.key) : null;
      if (key && (req.type === 'lookup' || req.type === 'gen')) {
        const from = { cooked: false };
        const hit = await cached(key, t, from);
        if (hit) {
          reply({ type: 'result', id: req.id, ok: true, output: hit, hit: true, ...(from.cooked ? { cooked: true } : {}), times: t }, hit);
          return;
        }
        if (req.type === 'lookup') {
          reply({ type: 'result', id: req.id, ok: true, output: null, hit: false, times: t });
          return;
        }
      }
      if (req.type === 'gen') {
        let t0 = performance.now();
        const raw = generateBuiltinSync(req.generator, req.params, req.seed);
        const ms = performance.now() - t0;
        t.generate += ms;
        t0 = performance.now();
        const v = validateOutput(raw);
        t.validate += performance.now() - t0;
        if (!v.ok) throw new Error(`invalid generator output: ${v.error}`);
        await finish(req.id, key, v.output, ms, t);
        return;
      }
      if (req.type === 'post') {
        const t0 = performance.now();
        const v = validateOutput(req.raw);
        t.validate += performance.now() - t0;
        if (!v.ok) throw new Error(`generator returned invalid output: ${v.error}`);
        // Always kept: a miss on a later visit would start a sandbox worker just for it.
        await finish(req.id, key, v.output, v.output.stats.ms, t, true);
        return;
      }
    } catch (err) {
      reply({ type: 'result', id: req.id, ok: false, error: message(err) });
    }
  })();
};
scope.postMessage({ type: 'ready' }, []);
