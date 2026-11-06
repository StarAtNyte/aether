/**
 * The manifest of a cooked package (cook/format.ts has the rest of the format): its types, limits and the check of an
 * untrusted manifest. This module has no runtime imports, so the upload function (api/cook-upload.ts) runs it as is.
 */
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
  /**
   * The world itself, for a world published from the editor (short share links carry no world): {@link WORLD_FILE} in the
   * cook folder, the share payload as gzipped JSON, with its byte size and SHA-256. Absent (null) in a template's cook.
   */
  ir?: (CookFile & { sha256: string }) | null;
}

/** File name of the world in a cook folder ({@link CookManifest.ir}). */
export const WORLD_FILE = 'world.json.gz';

// --- Validation (untrusted input) -----------------------------------------------------------------------------------

const HEX64 = /^[0-9a-f]{64}$/;
/** A relative path inside the cook: no `..`, no leading slash, no scheme. */
const REL = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]{1,160}$/;

export function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
export function nat(v: unknown, max = Number.MAX_SAFE_INTEGER): v is number {
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
  let ir: CookManifest['ir'] = null;
  if (v.ir !== null && v.ir !== undefined) {
    const f = file(v.ir);
    if (!f || !isObj(v.ir) || typeof v.ir.sha256 !== 'string' || !HEX64.test(v.ir.sha256)) return bad('bad ir');
    ir = { ...f, sha256: v.ir.sha256 };
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
      ...(ir ? { ir } : {}),
    },
  };
}

/** The files of a cook, relative to its `<id>/` folder: every pack and program set the manifest names, and the world file. */
export function cookFiles(m: CookManifest): string[] {
  return [...m.packs.map((p) => p.file), ...Object.values(m.programs).map((p) => p!.file), ...(m.ir ? [m.ir.file] : [])];
}
