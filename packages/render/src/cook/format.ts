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

/** Format of the manifest and of every file it names. */
export const COOK_FORMAT = 2;
/** Packs are cut at about this size (an entry larger than this gets a pack of its own). */
export const PACK_TARGET_BYTES = 4 * 1024 * 1024;
/** Largest manifest a viewer reads. */
export const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
/** Largest program set file a viewer reads (as fetched), and largest total of the sources it decodes to. */
export const MAX_PROGRAM_SET_BYTES = 32 * 1024 * 1024;
export const MAX_PROGRAM_SOURCE_CHARS = 64 * 1024 * 1024;
/**
 * Format of a line-deduplicated program set file ({@link encodeProgramSetFile}). Format 2 files (sources as plain strings,
 * JSON) are still read.
 */
export const PROGRAM_SET_FORMAT = 3;

/** How a published world starts (next to the IR's `opening`). */
export type StartMode = 'play' | 'walkthrough' | 'orbit';
export const START_MODES: readonly StartMode[] = ['play', 'walkthrough', 'orbit'];
/** Publish kinds: profiles on one cook (only recorded today; the publish UI for kinds is later work). */
export type CookProfile = 'game' | 'walkthrough' | 'showcase' | 'vr';
export const COOK_PROFILES: readonly CookProfile[] = ['game', 'walkthrough', 'showcase', 'vr'];
const TIERS: readonly RenderTier[] = ['low', 'medium', 'high', 'ultra'];

/** One grid cell of the cook. */
export interface CookCell {
  /** `cellKey(level, ix, iz)` of streaming/cell-grid.ts, or `p` (persistent: whole-world pieces, unplaced outputs). */
  key: string;
  /** XZ bounds of the entity positions in it: `[minX, minZ, maxX, maxZ]` (null for the persistent layer). */
  bounds: [number, number, number, number] | null;
  /** Geometry entries and their bytes. */
  entries: number;
  bytes: number;
  /** Indices into {@link CookManifest.packs}. */
  packs: number[];
}

/** A file of the cook, relative to its folder. */
export interface CookFile {
  file: string;
  bytes: number;
}

/** The manifest of a cooked world. */
export interface CookManifest {
  format: typeof COOK_FORMAT;
  /** SHA-256 hex of the world IR ({@link worldIrHash}): a different IR means the cook is stale. */
  irHash: string;
  /** The geometry code version of the build that cooked it (`DDC_CODE_VERSION`: `__AETHER_GEN_VERSION__` plus the preparation version). */
  genVersion: string;
  /** Folder of the cook's files, relative to the manifest (`<id>/`). */
  dir: string;
  /** ISO time of the cook. */
  cookedAt: string;
  world: { id: string; name: string; entities: number };
  /** The view the world opens on (the IR's own `opening`, or the one the renderer computed when cooking). */
  opening: { position: [number, number, number]; target: [number, number, number]; fov?: number } | null;
  startMode: StartMode;
  /** The publish profile it was cooked for (game, arch walkthrough, scene showcase, VR). */
  profile: CookProfile;
  /** The world's grid (streaming/cell-grid.ts `partitionFor`), null when nothing is placed. */
  partition: { cellSize: number; origin: [number, number] } | null;
  cells: CookCell[];
  packs: CookFile[];
  /** Geometry-cache key (64 hex) to `[pack, byte offset, byte length, cell]`. */
  entries: Record<string, [number, number, number, number]>;
  /** Program set per tier ({@link CookedProgramSet}). */
  programs: Partial<Record<RenderTier, CookFile & { programs: number }>>;
  /** A bundled baked lightmap folder (lightmap-controller `staticBase`, relative to the cook folder), when there is one. */
  lightmap: { base: string } | null;
}

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

// --- Validation (untrusted input) -----------------------------------------------------------------------------------

const HEX64 = /^[0-9a-f]{64}$/;
/** A relative path inside the cook: no `..`, no leading slash, no scheme. */
const REL = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]{1,160}$/;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function nat(v: unknown, max = Number.MAX_SAFE_INTEGER): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max;
}
function fin(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
function vec3(v: unknown): v is [number, number, number] {
  return Array.isArray(v) && v.length === 3 && v.every(fin);
}
function file(v: unknown): CookFile | null {
  return isObj(v) && typeof v.file === 'string' && REL.test(v.file) && nat(v.bytes) ? { file: v.file, bytes: v.bytes } : null;
}

/** Result of {@link parseCookManifest}. */
export type ManifestResult = { ok: true; manifest: CookManifest } | { ok: false; error: string };

/** Validate an untrusted manifest. Never throws. */
export function parseCookManifest(v: unknown): ManifestResult {
  const bad = (error: string): ManifestResult => ({ ok: false, error });
  if (!isObj(v)) return bad('not an object');
  if (v.format !== COOK_FORMAT) return bad(`unknown format ${String(v.format).slice(0, 20)}`);
  if (typeof v.irHash !== 'string' || !HEX64.test(v.irHash)) return bad('bad irHash');
  if (typeof v.genVersion !== 'string' || !/^[A-Za-z0-9._-]{1,80}$/.test(v.genVersion)) return bad('bad genVersion');
  if (typeof v.dir !== 'string' || !REL.test(v.dir)) return bad('bad dir');
  const w = v.world;
  if (!isObj(w) || typeof w.id !== 'string' || typeof w.name !== 'string' || !nat(w.entities)) return bad('bad world');
  let opening: CookManifest['opening'] = null;
  if (v.opening !== null && v.opening !== undefined) {
    const o = v.opening;
    if (!isObj(o) || !vec3(o.position) || !vec3(o.target) || (o.fov !== undefined && !(fin(o.fov) && o.fov >= 20 && o.fov <= 100))) return bad('bad opening');
    opening = { position: [...o.position], target: [...o.target], ...(o.fov !== undefined ? { fov: o.fov as number } : {}) };
  }
  if (!START_MODES.includes(v.startMode as StartMode)) return bad('bad startMode');
  if (!COOK_PROFILES.includes(v.profile as CookProfile)) return bad('bad profile');
  let partition: CookManifest['partition'] = null;
  if (v.partition !== null && v.partition !== undefined) {
    const p = v.partition;
    if (!isObj(p) || !fin(p.cellSize) || p.cellSize <= 0 || !Array.isArray(p.origin) || p.origin.length !== 2 || !p.origin.every(fin)) return bad('bad partition');
    partition = { cellSize: p.cellSize, origin: [p.origin[0] as number, p.origin[1] as number] };
  }
  if (!Array.isArray(v.packs) || v.packs.length > 100_000) return bad('bad packs');
  const packs: CookFile[] = [];
  for (const p of v.packs) {
    const f = file(p);
    if (!f) return bad('bad pack');
    packs.push(f);
  }
  if (!Array.isArray(v.cells) || v.cells.length > 100_000) return bad('bad cells');
  const cells: CookCell[] = [];
  for (const c of v.cells) {
    if (!isObj(c) || typeof c.key !== 'string' || c.key.length > 40 || !nat(c.entries) || !nat(c.bytes) || !Array.isArray(c.packs) || !c.packs.every((i) => nat(i, packs.length - 1))) return bad('bad cell');
    const b = c.bounds;
    if (b !== null && !(Array.isArray(b) && b.length === 4 && b.every(fin))) return bad('bad cell bounds');
    cells.push({ key: c.key, bounds: b === null ? null : [b[0], b[1], b[2], b[3]] as [number, number, number, number], entries: c.entries, bytes: c.bytes, packs: [...(c.packs as number[])] });
  }
  if (!isObj(v.entries)) return bad('bad entries');
  const entries: CookManifest['entries'] = {};
  for (const [k, e] of Object.entries(v.entries)) {
    if (!HEX64.test(k) || !Array.isArray(e) || e.length !== 4) return bad('bad entry');
    const [pack, off, len, cell] = e as unknown[];
    if (!nat(pack, packs.length - 1) || !nat(off) || !nat(len) || !nat(cell, Math.max(0, cells.length - 1)) || off % 8 !== 0 || len < 8 || off + len > (packs[pack] as CookFile).bytes) return bad('entry out of range');
    entries[k] = [pack, off, len, cell];
  }
  if (!isObj(v.programs)) return bad('bad programs');
  const programs: CookManifest['programs'] = {};
  for (const [tier, p] of Object.entries(v.programs)) {
    const f = file(p);
    if (!TIERS.includes(tier as RenderTier) || !f || !isObj(p) || !nat(p.programs)) return bad('bad program set');
    programs[tier as RenderTier] = { ...f, programs: p.programs };
  }
  let lightmap: CookManifest['lightmap'] = null;
  if (v.lightmap !== null && v.lightmap !== undefined) {
    if (!isObj(v.lightmap) || typeof v.lightmap.base !== 'string' || !REL.test(v.lightmap.base)) return bad('bad lightmap');
    lightmap = { base: v.lightmap.base };
  }
  return {
    ok: true,
    manifest: {
      format: COOK_FORMAT,
      irHash: v.irHash,
      genVersion: v.genVersion,
      dir: v.dir,
      cookedAt: typeof v.cookedAt === 'string' ? v.cookedAt.slice(0, 40) : '',
      world: { id: w.id.slice(0, 80), name: w.name.slice(0, 120), entities: w.entities },
      opening,
      startMode: v.startMode as StartMode,
      profile: v.profile as CookProfile,
      partition,
      cells,
      packs,
      entries,
      programs,
      lightmap,
    },
  };
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
