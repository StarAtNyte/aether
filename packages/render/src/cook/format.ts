/**
 * The cooked package of a published world (docs/ARCHITECTURE-STREAMING.md, "Cooked package format"): everything a viewer
 * would otherwise generate or record on its first visit, made once at publish by `scripts/cook.ts` in the real renderer.
 *
 * ```
 * cooked/<slug>/manifest.json            this file's {@link CookManifest}; revalidated (small)
 * cooked/<slug>/<id>/packs/<n>.bin       generated geometry, entries in the geometry cache's encoding (geometry/ddc.ts)
 * cooked/<slug>/<id>/programs/<tier>.bin  the tier's program set, as gpu/program-cache.ts records it ({@link CookedProgramSet}),
 *                                          line-deduplicated and gzipped ({@link encodeProgramSetFile}; older cooks: `<tier>.json`)
 * ```
 *
 * `<id>` is {@link cookPackageId} of the IR hash and the geometry code version, so the files under it never change under the
 * same name (served immutable). A pack is the concatenation of entries, each 8-byte aligned; an entry is found by its
 * geometry-cache key (the SHA-256 hex of `ddcKey`) in {@link CookManifest.entries}. Packs are grouped by grid cell
 * (streaming/cell-grid.ts), nearest the opening view first, and kept under {@link PACK_TARGET_BYTES} so a viewer can fetch
 * a cell at a time (cell streaming is later work: today the whole set is offered at load).
 *
 * Everything read here is untrusted until {@link parseCookManifest} / {@link parseCookedProgramSet} accept it.
 */
import { stableStringify } from '@aether/core';
import type { RenderTier } from '../gpu/finishing';

export * from './manifest';
import { COOK_FORMAT, isObj, nat, PROGRAM_SET_FORMAT, MAX_PROGRAM_SET_BYTES, MAX_PROGRAM_SOURCE_CHARS } from './manifest';

/**
 * A tier's program set: pairs of source hashes (`sourceHash` of gpu/program-cache.ts) and the sources. The first `boot` pairs
 * are those the load used before its first picture (linked first by a viewer); the rest came later (play, the orbit).
 */
export interface CookedProgramSet {
  /** Format of the file it was read from: 2 (plain JSON) or {@link PROGRAM_SET_FORMAT}. */
  format: number;
  tier: RenderTier;
  boot: number;
  pairs: Array<[string, string]>;
  sources: Record<string, string>;
}

/** SHA-256 hex of a string. */
export async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  let hex = '';
  for (const b of new Uint8Array(digest)) hex += b.toString(16).padStart(2, '0');
  return hex;
}

/**
 * The IR hash of a world: SHA-256 of its canonical JSON (sorted keys) after parsing. The `opening` and `startMode` a
 * cooked load fills in are taken out, so a world and its cooked copy hash alike.
 */
export function worldIrHash(world: object): Promise<string> {
  const { opening: _o, startMode: _s, ...rest } = world as Record<string, unknown>;
  return sha256Hex(stableStringify(rest));
}

/** The folder name of a cook: 16 hex of SHA-256 of the IR hash and the geometry code version. */
export async function cookPackageId(irHash: string, genVersion: string): Promise<string> {
  return (await sha256Hex(`${irHash}\u0000${genVersion}`)).slice(0, 16);
}

/**
 * The line-deduplicated form of a program set (format {@link PROGRAM_SET_FORMAT}): three's sources share most of their lines
 * (the lighting and shadow functions, the uniform blocks), across programs and tiers. `lines` holds every distinct line once,
 * in order of first use; a source is runs of consecutive lines, `[start, count, start, count, …]` into it, joined by `\n`.
 */
export interface ProgramSetLines {
  format: typeof PROGRAM_SET_FORMAT;
  tier: RenderTier;
  boot: number;
  pairs: Array<[string, string]>;
  lines: string[];
  sources: Record<string, number[]>;
}

/** The line-deduplicated form of `set` (not compressed; the cook gzips its JSON, {@link encodeProgramSetFile}). */
export function programSetLines(set: Pick<CookedProgramSet, 'tier' | 'boot' | 'pairs' | 'sources'>): ProgramSetLines {
  const index = new Map<string, number>();
  const lines: string[] = [];
  const sources: Record<string, number[]> = {};
  for (const [h, code] of Object.entries(set.sources)) {
    const runs: number[] = [];
    for (const line of code.split('\n')) {
      let i = index.get(line);
      if (i === undefined) {
        index.set(line, (i = lines.length));
        lines.push(line);
      }
      const n = runs.length;
      if (n > 0 && runs[n - 2]! + runs[n - 1]! === i) runs[n - 1]!++;
      else runs.push(i, 1);
    }
    sources[h] = runs;
  }
  return { format: PROGRAM_SET_FORMAT, tier: set.tier, boot: set.boot, pairs: set.pairs, lines, sources };
}

/** Gzip magic: a program set file in format {@link PROGRAM_SET_FORMAT} is gzipped JSON. */
export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

async function streamBytes(bytes: Uint8Array<ArrayBuffer>, stream: { readable: ReadableStream<Uint8Array<ArrayBuffer>>; writable: WritableStream<BufferSource> }, max: number): Promise<Uint8Array<ArrayBuffer>> {
  const writer = stream.writable.getWriter();
  void writer.write(bytes).then(() => writer.close()).catch(() => undefined);
  const reader = stream.readable.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      void reader.cancel().catch(() => undefined);
      throw new Error('too large');
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

/** A program set file's bytes: gzipped JSON of {@link programSetLines} (`DecompressionStream` reads it in every browser). */
export async function encodeProgramSetFile(set: Pick<CookedProgramSet, 'tier' | 'boot' | 'pairs' | 'sources'>): Promise<Uint8Array<ArrayBuffer>> {
  return streamBytes(new TextEncoder().encode(JSON.stringify(programSetLines(set))), new CompressionStream('gzip'), Number.MAX_SAFE_INTEGER);
}

/**
 * The JSON of a fetched program set file: gzipped (format {@link PROGRAM_SET_FORMAT}, unless the host already took the
 * gzip off) or plain (format 2). Throws on a file that does not decode or exceeds the limits.
 */
export async function readProgramSetFile(bytes: Uint8Array<ArrayBuffer>): Promise<unknown> {
  if (bytes.byteLength > MAX_PROGRAM_SET_BYTES) throw new Error('too large');
  const raw = isGzip(bytes) ? await streamBytes(bytes, new DecompressionStream('gzip'), MAX_PROGRAM_SOURCE_CHARS) : bytes;
  return JSON.parse(new TextDecoder().decode(raw));
}

/** Validate an untrusted program set file of `tier` (format 2, or {@link PROGRAM_SET_FORMAT} with its sources rebuilt). Null when it does not hold. */
export function parseCookedProgramSet(v: unknown, tier: RenderTier): CookedProgramSet | null {
  if (!isObj(v) || (v.format !== COOK_FORMAT && v.format !== PROGRAM_SET_FORMAT) || v.tier !== tier || !Array.isArray(v.pairs) || !isObj(v.sources)) return null;
  const sources: Record<string, string> = {};
  const lines: unknown[] | null = v.format === PROGRAM_SET_FORMAT ? (Array.isArray(v.lines) ? v.lines : []) : null;
  if (lines && (!Array.isArray(v.lines) || !lines.every((l) => typeof l === 'string'))) return null;
  let chars = 0;
  for (const [h, code] of Object.entries(v.sources)) {
    if (!/^[0-9a-f]{16,40}$/.test(h)) return null;
    let text: string;
    if (lines) {
      const runs = code;
      if (!Array.isArray(runs) || runs.length % 2 !== 0) return null;
      const out: string[] = [];
      for (let i = 0; i < runs.length; i += 2) {
        const start = runs[i], n = runs[i + 1];
        if (!nat(start) || !nat(n) || start + n > lines.length) return null;
        for (let k = 0; k < n; k++) out.push(lines[start + k] as string);
      }
      text = out.join('\n');
      // The hash ends in the source's length (sourceHash): a source that does not rebuild to it is refused.
      if (parseInt(h.slice(16), 16) !== text.length) return null;
    } else if (typeof code === 'string') text = code;
    else return null;
    chars += text.length;
    if (chars > MAX_PROGRAM_SOURCE_CHARS) return null;
    sources[h] = text;
  }
  const pairs: Array<[string, string]> = [];
  for (const p of v.pairs) {
    if (!Array.isArray(p) || p.length !== 2 || typeof p[0] !== 'string' || typeof p[1] !== 'string' || !(p[0] in sources) || !(p[1] in sources)) return null;
    pairs.push([p[0], p[1]]);
  }
  const boot = nat(v.boot, pairs.length) ? v.boot : 0;
  return { format: v.format, tier, boot, pairs, sources };
}

/** Index of a cooked package's geometry as the generation lanes get it (gen.worker.ts): absolute pack URLs and the entries. */
export interface LaneCookIndex {
  packs: string[];
  entries: Record<string, [number, number, number, number]>;
}

/** What the page tells each generation lane about cooking (gen-pool.ts `setCook`). */
export interface LaneCookConfig {
  /** Store every output in the geometry cache, however cheap (the cook records the whole world). */
  keepAll?: boolean;
  /** A cooked package to read from before generating. */
  index?: LaneCookIndex | null;
  /** Write geometry-cache entries compressed (ddc-codec.ts; `__AETHER_GEOMETRY_COMPRESS`, default true). */
  compress?: boolean;
  /** Properties kept lossless in compressed entries (`__AETHER_GEOMETRY_LOSSLESS`, e.g. `['normals']`; diagnostics). */
  lossless?: string[];
}
