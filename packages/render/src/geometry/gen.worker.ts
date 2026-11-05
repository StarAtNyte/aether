/**
 * Generation lane (module worker, trusted code only): the off-main-thread half of procedural geometry.
 *
 * - `gen`: run a built-in generator.
 * - `post`: validate a custom generator's raw output from the locked-down sandbox (the page never scans it).
 * - `lookup`: read the persistent cache only.
 *
 * Every output is validated, its render-ready streams are prepared (metre UVs, 16-bit indices, bounds; see
 * buffer-geometry.ts `preparePart`), it is stored in the generated-geometry cache (ddc.ts) when it was worth
 * generating, and it goes back to the page with zero-copy transfers. `gen` and `post` look the cache up first.
 */
import { generateBuiltinSync, outputBytes, validateOutput } from '@aether/procgen';
import type { GeneratorOutput } from '../types';
import { prepareOutputParts, preparePart } from './buffer-geometry';
import { prepareSoft } from './soften';
import { Ddc, ddcKey, encodeOutput } from './ddc';
import { checkOutputShape, outputTransfer, parseGenRequest, type GenReply, type LaneTimes } from './gen-protocol';

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

/**
 * A stored output. Entries are written only by these lanes, after validation; a read checks the shape (array types
 * and lengths) and deletes an entry that does not match.
 */
async function cached(key: string, t: LaneTimes): Promise<GeneratorOutput | null> {
  if (!ddc) return null;
  const t0 = performance.now();
  const out = await ddc.get(key);
  t.read += performance.now() - t0;
  if (!out) return null;
  if (checkOutputShape(out)) return out;
  await ddc.remove(key);
  return null;
}

function reply(msg: GenReply, out?: GeneratorOutput): void {
  scope.postMessage(msg, out ? outputTransfer(out) : []);
}

async function finish(id: number, key: string | null, out: GeneratorOutput, ms: number, t: LaneTimes, always = false): Promise<void> {
  let t0 = performance.now();
  prepareOutputParts(out.parts);
  for (const part of out.parts) prepareSoft(part, preparePart);
  t.prepare += performance.now() - t0;
  // A plain copy is taken before the buffers are transferred away (a memory copy); it is encoded and written after the
  // reply, so the page never waits on the cache.
  const bytes = outputBytes(out);
  let copy: GeneratorOutput | null = null;
  if (ddc && key && (always || ms >= STORE_MIN_MS || bytes >= STORE_MIN_BYTES)) {
    // Bounded backlog of copies waiting for storage: wait for the writes first rather than pile up memory.
    if (writeBacklog > MAX_WRITE_BACKLOG) await writes;
    t0 = performance.now();
    copy = copyOf(out, new Map()) as GeneratorOutput;
    t.encode += performance.now() - t0;
  }
  reply({ type: 'result', id, ok: true, output: out, hit: false, times: t }, out);
  if (copy && ddc && key) {
    const entry = copy;
    const store = ddc;
    const k = key;
    writeBacklog += bytes;
    writes = writes.then(() => store.put(k, encodeOutput(entry))).finally(() => {
      writeBacklog -= bytes;
    });
  }
}

/**
 * Deep copy of plain output data; typed arrays are copied with `slice` (a memory copy, several times faster than
 * `structuredClone` here) and arrays shared by reference stay shared.
 */
function copyOf(v: unknown, seen: Map<unknown, unknown>): unknown {
  if (v === null || typeof v !== 'object') return v;
  const done = seen.get(v);
  if (done !== undefined) return done;
  let c: unknown;
  if (ArrayBuffer.isView(v)) c = (v as unknown as { slice(): unknown }).slice();
  else if (Array.isArray(v)) c = v.map((x) => copyOf(x, seen));
  else {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) o[k] = copyOf(x, seen);
    c = o;
  }
  seen.set(v, c);
  return c;
}

/** Copies waiting to be written, in bytes, and the chain of writes (one at a time per lane). */
let writeBacklog = 0;
let writes: Promise<void> = Promise.resolve();
const MAX_WRITE_BACKLOG = 48 * 1024 * 1024;

scope.onmessage = (e: MessageEvent): void => {
  const req = parseGenRequest(e.data);
  if (!req) return;
  void (async () => {
    const t: LaneTimes = { read: 0, generate: 0, validate: 0, prepare: 0, encode: 0 };
    try {
      const key = req.key ? await ddcKey(req.key) : null;
      if (key && (req.type === 'lookup' || req.type === 'gen')) {
        const hit = await cached(key, t);
        if (hit) {
          reply({ type: 'result', id: req.id, ok: true, output: hit, hit: true, times: t }, hit);
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
