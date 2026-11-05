/**
 * Amazon Berkeley Objects: 7,953 real products (furniture, lamps, rugs, decor) streamed from the web-optimised GLB pack
 * on Hugging Face (`codepawl/abo-glb`, CC BY 4.0). Nothing of the 12 GB pack ships with the studio: `assets/abo.json.gz`
 * (built by `scripts/assets/abo-index.ts`) is a compact index, and each product's files are fetched from the pinned
 * revision when a world shows it.
 *
 * A product is the asset id `abo-<lowercase ABO id>` (`abo-b0714qgc72`). {@link aboEntry} turns an index row into a
 * catalog entry, so every library reader (placement, size, physics, credits, the planner) takes it as it is; its file
 * paths keep the pack's layout (`objects_ktx2/<ID>/<ID>.glb`) and {@link aboUrl} resolves them. The levels:
 *
 * - LOD 0, near: `objects_ktx2/` (KTX2 textures up to 2048 px, all triangles);
 * - LOD 1, mid and far: `lods/…_lod2` (512 px, about 20 % of the triangles); LOD 2, far: `lods/…_lod3` (256 px, 6 %);
 * - light copy for the low tiers: `_lod2`; `objects/` (WebP textures, LOD 0) only where KTX2 cannot be read.
 *
 * The model loader picks the level a renderer can take ({@link aboLoadUrl}): the WebP copy without a KTX2 transcoder,
 * and never a file whose textures exceed the renderer's texture cap (512 px on integrated GPUs). Products are measured
 * in metres with Y up; {@link aboOffset} is the shift that puts a product's base on y = 0 and centres it on X/Z, like
 * every library model.
 *
 * Credit: 3D models by Amazon.com, Amazon Berkeley Objects (CC BY 4.0); web-optimised GLB by CodePawl.
 */
import { z } from 'zod';
import type { Catalog, CatalogEntry, CatalogPack } from './schema';
import { findModels, type ModelHit, type ModelQuery } from './interior';
import { tokenize } from './search';

export const ABO_REPO = 'codepawl/abo-glb';
/** Revision every URL is pinned to (immutable files, so a world always shows the same product). */
export const ABO_REVISION = 'c7c8293fed3b7ab122ef5d7896521a187e0962d7';
/** Where the pack is streamed from (CORS open; the files redirect to Hugging Face's CDN). */
export const ABO_REMOTE_BASE = `https://huggingface.co/datasets/${ABO_REPO}/resolve/${ABO_REVISION}/`;
export const ABO_PAGE = `https://huggingface.co/datasets/${ABO_REPO}`;
export const ABO_CREDIT = '3D models by Amazon.com, Amazon Berkeley Objects (CC BY 4.0); web-optimised GLB by CodePawl';
/** Pack id of ABO entries (`CatalogEntry.pack`). */
export const ABO_PACK_ID = 'abo';

export const ABO_PACK: CatalogPack = {
  id: ABO_PACK_ID,
  title: 'Amazon Berkeley Objects',
  author: 'Amazon.com (3D models); CodePawl (web-optimised GLB)',
  licence: 'CC-BY-4.0',
  licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
  url: ABO_PAGE,
  version: ABO_REVISION.slice(0, 7),
};

/** Category codes of an index row (position in this list). */
export const ABO_CATEGORIES = ['furniture', 'decor', 'lighting', 'plants', 'kitchen', 'props', 'street'] as const;
/** Placement codes of an index row. */
export const ABO_PLACEMENTS = ['floor', 'wall', 'ceiling', 'surface'] as const;

/** Largest texture edge of each level: LOD 0 (`objects_ktx2/`) and `lods/…_lod1` … `_lod3`. */
export const ABO_TEXTURE_PX: readonly [number, number, number, number] = [2048, 1024, 512, 256];

const Mm = z.number().int().min(-100_000).max(100_000);

/**
 * One product: `[id, name, type, category, placement, extra search words, styles, colours, rgb (0xRRGGBB, -1 none),
 * size mm [w, h, d], pivot offset mm [x, y, z] (0: none), triangles [lod0..lod3], KB [webp, lod0 ktx2, lod1, lod2, lod3]]`.
 */
export const AboRow = z.tuple([
  z.string().regex(/^[A-Z0-9]{10}$/),
  z.string().min(1).max(60),
  z.string().regex(/^[a-z][a-z0-9-]{1,23}$/),
  z.number().int().min(0).max(ABO_CATEGORIES.length - 1),
  z.number().int().min(0).max(ABO_PLACEMENTS.length - 1),
  z.string().max(240),
  z.string().max(120),
  z.string().max(80),
  z.number().int().min(-1).max(0xffffff),
  z.tuple([Mm, Mm, Mm]),
  z.union([z.literal(0), z.tuple([Mm, Mm, Mm])]),
  z.tuple([z.number().int().min(0), z.number().int().min(0), z.number().int().min(0), z.number().int().min(0)]),
  z.tuple([z.number().int().min(0), z.number().int().min(0), z.number().int().min(0), z.number().int().min(0), z.number().int().min(0)]),
]);
export type AboRow = z.infer<typeof AboRow>;

export const AboIndex = z.object({
  version: z.literal(1),
  repo: z.literal(ABO_REPO),
  revision: z.string().regex(/^[0-9a-f]{40}$/),
  licence: z.literal('CC-BY-4.0'),
  credit: z.string().max(200),
  items: z.array(AboRow).max(20_000),
});
export type AboIndex = z.infer<typeof AboIndex>;

/** Asset id of a product (`B0714QGC72` → `abo-b0714qgc72`). */
export const aboAssetId = (aboId: string): string => `abo-${aboId.toLowerCase()}`;
const ASSET_RE = /^abo-([a-z0-9]{10})$/;
/** True for an ABO asset id. */
export const isAboAssetId = (id: string): boolean => ASSET_RE.test(id);

/** Pack path of a product's file: `webp` (`objects/`), 0 (`objects_ktx2/`), 1-3 (`lods/`), or its thumbnail. */
export function aboPath(aboId: string, level: 'webp' | 'thumb' | 0 | 1 | 2 | 3): string {
  if (level === 'webp') return `objects/${aboId}/${aboId}.glb`;
  if (level === 'thumb') return `thumbs/${aboId}.webp`;
  if (level === 0) return `objects_ktx2/${aboId}/${aboId}.glb`;
  return `lods/${aboId}/${aboId}_lod${level}.glb`;
}

const PATH_RE = /^(?:(objects|objects_ktx2)\/([A-Z0-9]{10})\/([A-Z0-9]{10})\.glb|lods\/([A-Z0-9]{10})\/([A-Z0-9]{10})_lod([123])\.glb|thumbs\/([A-Z0-9]{10})\.webp)$/;

/** A pack file: the product and its level (`webp`, 0-3 or `thumb`), or null for anything else. */
export function parseAboPath(path: string): { id: string; level: 'webp' | 'thumb' | 0 | 1 | 2 | 3 } | null {
  const m = PATH_RE.exec(path);
  if (!m) return null;
  if (m[1]) return m[2] === m[3] ? { id: m[2]!, level: m[1] === 'objects' ? 'webp' : 0 } : null;
  if (m[4]) return m[4] === m[5] ? { id: m[4]!, level: Number(m[6]) as 1 | 2 | 3 } : null;
  return { id: m[7]!, level: 'thumb' };
}

/** True for a path of the pack's layout (library code hands these to {@link aboUrl}). */
export const isAboPath = (path: string): boolean => parseAboPath(path) !== null;

let base = ABO_REMOTE_BASE;

/**
 * Serve the pack from another base (a published game ships the files it uses next to its player, under
 * `assets/lib/`). Path segments only; `null` restores Hugging Face.
 */
export function setAboBase(b: string | null): void {
  base = b && /^(?:https:\/\/[a-z0-9.-]+)?\/(?:[A-Za-z0-9._~-]+\/)*$/.test(b) && !b.split('/').includes('..') ? b : ABO_REMOTE_BASE;
}

/** The base pack files are fetched from. */
export const aboBase = (): string => base;

/** URL of a pack file. */
export const aboUrl = (path: string): string => `${base}${path}`;

/** The pack file a URL names (under the current base or the pinned Hugging Face revision), or null. */
export function aboFileOf(url: string): { id: string; level: 'webp' | 'thumb' | 0 | 1 | 2 | 3; path: string } | null {
  for (const b of base === ABO_REMOTE_BASE ? [base] : [base, ABO_REMOTE_BASE]) {
    if (!url.startsWith(b)) continue;
    const path = url.slice(b.length);
    const p = parseAboPath(path);
    return p ? { ...p, path } : null;
  }
  return null;
}

/** True for a URL of a pack file at the pinned revision: the model loader may fetch it although it is cross-origin. */
export const isAboRemoteUrl = (url: string): boolean => url.startsWith(ABO_REMOTE_BASE) && parseAboPath(url.slice(ABO_REMOTE_BASE.length)) !== null;

// ---------------------------------------------------------------------------------------------------------------------
// The index.

let index: AboIndex | null = null;
let rows = new Map<string, AboRow>();
let loading: Promise<AboIndex | null> | null = null;
let entries: CatalogEntry[] | null = null;
const entryCache = new Map<string, CatalogEntry>();
let catalog: Catalog | null = null;

function install(i: AboIndex | null): AboIndex | null {
  index = i;
  rows = new Map((i?.items ?? []).map((r) => [r[0], r]));
  entries = null;
  entryCache.clear();
  catalog = null;
  return i;
}

/** Install an index (validated; tests and other hosts), or clear it with `null`. */
export function setAboIndex(v: unknown): AboIndex | null {
  loading = null;
  return install(v === null ? null : AboIndex.parse(v));
}

/** The installed index, or null before {@link loadAboIndex} resolved (or when there is none). */
export const getAboIndex = (): AboIndex | null => index;

/** Inflate gzip bytes (browsers and Node 18+ both have `DecompressionStream`); plain bytes pass through. */
async function inflate(bytes: Uint8Array): Promise<string> {
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return new TextDecoder().decode(bytes);
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

/** The gzipped index file: emitted next to the bundle by Vite (a hashed asset), a `file:` URL under Node. */
const INDEX_URL = new URL('../../../assets/abo.json.gz', import.meta.url);

async function readIndex(): Promise<Uint8Array> {
  if (INDEX_URL.protocol === 'file:') {
    const spec = 'node:fs/promises';
    const fs = (await import(/* @vite-ignore */ spec)) as { readFile(p: URL): Promise<Uint8Array> };
    return fs.readFile(INDEX_URL);
  }
  const res = await fetch(INDEX_URL.href);
  if (!res.ok) throw new Error(`ABO index: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Load (once) the bundled index (`assets/abo.json.gz`, about 0.4 MB, fetched on first use). Resolves null when it is
 * missing, so callers never fail; `loadCatalog` awaits it so that synchronous readers know the products a world names.
 */
export function loadAboIndex(): Promise<AboIndex | null> {
  if (index) return Promise.resolve(index);
  loading ??= readIndex()
    .then(inflate)
    .then((text) => install(AboIndex.parse(JSON.parse(text))))
    .catch(() => install(null));
  return loading;
}

/** The index row of an asset id (`abo-…`) or ABO id, or null. */
export function aboRow(id: string): AboRow | null {
  const m = ASSET_RE.exec(id);
  return rows.get(m ? m[1]!.toUpperCase() : id) ?? null;
}

const STYLE_RE = /^[a-z][a-z-]{1,23}$/;
const COLOUR_RE = /^[a-z][a-z-]{1,15}$/;

function toEntry(r: AboRow): CatalogEntry {
  const [id, name, type, cat, place, extra, styles, colours, rgb, size, , tris, kb] = r;
  const nameTags = name.toLowerCase().split(/[^a-z0-9-]+/).filter((t) => t.length > 1 && t.length <= 32 && !/^\d/.test(t));
  const tags = [...new Set([type, ...extra.split(' ').filter(Boolean), ...nameTags])].filter((t) => t.length <= 32).slice(0, 32);
  const st = styles.split(' ').filter((s) => STYLE_RE.test(s)).slice(0, 6);
  const co = colours.split(' ').filter((c) => COLOUR_RE.test(c)).slice(0, 4);
  const c = rgb >= 0 ? rgb : 0x8c8c8a;
  return {
    id: aboAssetId(id),
    name,
    kind: 'model',
    category: ABO_CATEGORIES[cat]!,
    tags,
    style: 'realistic',
    pack: ABO_PACK_ID,
    size: [size[0] / 1000, size[1] / 1000, size[2] / 1000],
    tris: tris[0],
    // What a standard tier downloads: LOD 0 (KTX2) and the two far levels.
    bytes: (kb[1] + kb[3] + kb[4]) * 1024,
    file: aboPath(id, 0),
    lods: [
      { file: aboPath(id, 2), tris: Math.max(1, tris[2]) },
      { file: aboPath(id, 3), tris: Math.max(1, tris[3]) },
    ],
    lite: aboPath(id, 2),
    interior: { type, styles: st, colors: co, rgb: [(c >> 16) & 255, (c >> 8) & 255, c & 255] },
    thumb: aboPath(id, 'thumb'),
    collider: { type: 'box' },
    placement: ABO_PLACEMENTS[place]!,
    facing: '+z',
    source: aboPath(id, 'webp'),
  };
}

/** The catalog entry of an ABO asset id, or null (unknown id, or the index is not loaded). */
export function aboEntry(id: string): CatalogEntry | null {
  const hit = entryCache.get(id);
  if (hit) return hit;
  if (!isAboAssetId(id)) return null;
  const r = aboRow(id);
  if (!r) return null;
  const e = toEntry(r);
  entryCache.set(id, e);
  return e;
}

/** Every product as a catalog entry (built once per index). */
export function aboEntries(): CatalogEntry[] {
  entries ??= (index?.items ?? []).map((r) => aboEntry(aboAssetId(r[0]))!);
  return entries;
}

/** The products as a catalog of their own, for `searchAssets` and `findModels`. */
export function aboCatalog(): Catalog {
  catalog ??= { version: 1, base: '/', packs: [ABO_PACK], entries: aboEntries() };
  return catalog;
}

/** Shift in metres that puts the product of a pack URL on y = 0, centred on X/Z (null: not a product, or none needed). */
export function aboOffset(url: string): [number, number, number] | null {
  const f = aboFileOf(url);
  if (!f || f.level === 'thumb') return null;
  const off = rows.get(f.id)?.[10];
  if (!off) return null;
  return [-off[0] / 1000, -off[1] / 1000, -off[2] / 1000];
}

/**
 * The file to load for a pack URL: the WebP copy (`objects/`) when KTX2 cannot be read here, else the URL itself, or a
 * lighter level when its textures exceed `textureCap` px (0: no cap). Null for a URL that is not a product file.
 */
export function aboLoadUrl(url: string, opts: { ktx2: boolean; textureCap: number }): string | null {
  const f = aboFileOf(url);
  if (!f || f.level === 'thumb') return null;
  const root = url.slice(0, url.length - f.path.length);
  if (!opts.ktx2) return `${root}${aboPath(f.id, 'webp')}`;
  let level = f.level === 'webp' ? 0 : f.level;
  const cap = opts.textureCap;
  if (cap > 0) while (level < 3 && ABO_TEXTURE_PX[level]! > cap) level++;
  return `${root}${aboPath(f.id, level as 0 | 1 | 2 | 3)}`;
}

/** Download size in bytes and triangles of one product as a standard tier loads it (all its levels). */
export function aboWeight(id: string): { bytes: number; tris: number } | null {
  const r = aboRow(id);
  if (!r) return null;
  return { bytes: (r[12][1] + r[12][3] + r[12][4]) * 1024, tris: r[11][0] };
}

/** Words that say how a product mounts ("floor lamp", "wall mirror"), checked against its placement. */
const MOUNT_WORDS: Readonly<Record<string, CatalogEntry['placement']>> = { floor: 'floor', standing: 'floor', wall: 'wall', sconce: 'wall', ceiling: 'ceiling', pendant: 'ceiling', chandelier: 'ceiling', hanging: 'ceiling', table: 'surface', desk: 'surface', tabletop: 'surface' };
const QUIET = new Set(['the', 'and', 'with', 'for', 'a', 'an', 'of', 'in', 'on', 'real', 'product', 'products', 'amazon', 'abo']);

/**
 * Products for a model query, best first: `findModels` over the products (type, style, colour, size), then the query's
 * other words ("velvet", "chesterfield", "mid-century", "floor") rank the products whose name or tags carry them first.
 */
export function findAboModels(q: ModelQuery): ModelHit[] {
  const cat = aboCatalog();
  if (cat.entries.length === 0) return [];
  const limit = Math.max(1, Math.min(30, q.limit ?? 6));
  const base = findModels(cat, { ...q, limit: 30 });
  const type = base[0]?.entry.interior?.type;
  const typeWords = new Set(type ? [type, ...type.split('-')] : []);
  const words = [...new Set(tokenize(q.text ?? ''))].filter((w) => w.length >= 3 && !QUIET.has(w) && !typeWords.has(w));
  if (words.length === 0) return base.slice(0, limit);
  const has = (e: CatalogEntry, w: string): boolean => {
    const mount = MOUNT_WORDS[w];
    if (mount && type === 'lamp') return e.placement === mount;
    return e.tags.some((t) => t === w || (w.length >= 4 && t.startsWith(w))) || tokenize(e.name).includes(w);
  };
  // The products of the type that carry at least one of the words, ranked again by the finder; the rest follow.
  const carrying = type ? cat.entries.filter((e) => e.interior?.type === type && words.some((w) => has(e, w))) : [];
  const ranked = carrying.length > 0 ? findModels({ ...cat, entries: carrying }, { ...q, limit: 30 }) : [];
  const score = (h: ModelHit): number => h.score + 30 * words.filter((w) => has(h.entry, w)).length;
  const seen = new Set<string>();
  const out: ModelHit[] = [];
  for (const h of [...ranked, ...base].sort((a, b) => score(b) - score(a) || a.entry.bytes - b.entry.bytes)) {
    if (seen.has(h.entry.id)) continue;
    seen.add(h.entry.id);
    const matched = words.filter((w) => has(h.entry, w));
    out.push(matched.length > 0 ? { ...h, score: score(h), notes: [`matches: ${matched.join(', ')}`, ...h.notes] } : h);
  }
  return out.slice(0, limit);
}

/** One line for the agent to judge a product by: id, name, size, type, placement, download and triangles. */
export function describeAboModel(h: ModelHit): string {
  const e = h.entry;
  const size = e.size.map((v) => Math.round(v * 100) / 100).join('x');
  const i = e.interior;
  const w = aboWeight(e.id);
  const bits = [
    `${size} m`,
    i?.type ?? e.category,
    i && i.styles.length > 0 ? `styles ${i.styles.join('/')}` : '',
    i && i.colors.length > 0 ? `colours ${i.colors.join('/')}` : '',
    e.placement !== 'floor' ? `goes on ${e.placement}` : '',
    w ? `${(w.bytes / 1048576).toFixed(1)} MB, ${Math.round(w.tris / 1000)}k triangles` : '',
    ...h.notes.slice(0, 2),
  ].filter(Boolean);
  return `${e.id} — ${e.name}: ${bits.join('; ')}`;
}
