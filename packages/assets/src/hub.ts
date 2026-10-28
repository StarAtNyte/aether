/**
 * The Aether asset hub: a Hugging Face dataset of browser-sized, licence-checked models (CC0 and CC BY 4.0 only) that any
 * world can search and load lazily, without the local server. This module is the contract both sides share: the index
 * schemas, the credit line, the file URLs, the hash check and the search. Pure (no Node, no DOM, `fetch` injected), so the
 * export tool, the studio, the agent and the tests use one implementation.
 *
 * Layout of the dataset (docs/ASSETS.md, "Hub dataset"):
 *   models/<id>/<id>.glb, <id>.lod1.glb, <id>.lite.glb, thumb.webp   index.json   index.min.json   embeddings.bin (+ .json)
 *
 * Everything fetched from the hub is untrusted data: the GLB must match the SHA-256 in the index (itself fetched from a
 * pinned commit), then goes through the same validation as a dropped file. This file is only reached through a dynamic
 * import (`@aether/assets/hub`), so it never joins the first-load chunk.
 */
import { z } from 'zod';
import { AssetCategory, AssetId, AssetPlacement, CatalogCollider, type Catalog, type CatalogEntry } from './schema';
import { searchAssets } from './search';

export const HUB_DATASET_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/;
export const HUB_REVISION_RE = /^[0-9a-f]{40}$/;

/** What `assets/hub.json` pins: which dataset, at which commit, and whether it is public yet. */
export const HubConfig = z.object({
  dataset: z.string().regex(HUB_DATASET_RE),
  /** A 40-hex commit (reproducible builds), or `main` while no commit is pinned yet. */
  revision: z.union([z.string().regex(HUB_REVISION_RE), z.literal('main')]),
  /** Browsers fetch the dataset directly only when it is public; private: dev proxy with a token, or nothing. */
  visibility: z.enum(['private', 'public']),
  /** SHA-256 of `index.min.json` at that revision (checked when set). */
  indexSha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
});
export type HubConfig = z.infer<typeof HubConfig>;

export const HubLicence = z.enum(['CC0-1.0', 'CC-BY-4.0']);
export type HubLicence = z.infer<typeof HubLicence>;
export const HUB_LICENCES: readonly HubLicence[] = ['CC0-1.0', 'CC-BY-4.0'];
/** The licence gate: only these two ever enter the dataset or the client. */
export const hubLicenceAllowed = (l: string): l is HubLicence => (HUB_LICENCES as readonly string[]).includes(l);
export const HUB_LICENCE_URLS: Readonly<Record<HubLicence, string>> = {
  'CC0-1.0': 'https://creativecommons.org/publicdomain/zero/1.0/',
  'CC-BY-4.0': 'https://creativecommons.org/licenses/by/4.0/',
};

/** Largest main GLB the hub carries (browser-sized). */
export const HUB_MAX_MAIN_BYTES = 1_200_000;
/** Largest GLB the client will download, whatever the index says. */
export const HUB_MAX_FETCH_BYTES = 4 * 1024 * 1024;

export const HubStyle = z.enum(['realistic', 'stylized']);
export type HubStyle = z.infer<typeof HubStyle>;

const Sha = z.string().regex(/^[0-9a-f]{64}$/);
const HubPath = z.string().regex(/^models\/[a-z0-9][a-z0-9_-]{0,63}\/[a-z0-9][a-z0-9_.-]{0,80}\.(glb|webp)$/);
export const HubFile = z.object({ path: HubPath, bytes: z.number().int().min(1), sha256: Sha });
export type HubFile = z.infer<typeof HubFile>;

/** One asset in `index.json`: everything a human or a tool needs to use and credit it. */
export const HubRow = z.object({
  id: AssetId,
  name: z.string().min(1).max(60),
  aliases: z.array(z.string().min(1).max(40)).max(12),
  tags: z.array(z.string().min(1).max(32)).max(32),
  category: AssetCategory,
  style: HubStyle,
  /** Bounding box in metres (width, height, depth), base on y = 0, centred. */
  size: z.tuple([z.number().min(0).max(500), z.number().min(0).max(500), z.number().min(0).max(500)]),
  triangles: z.number().int().min(0),
  /** Bytes of the main file. */
  bytes: z.number().int().min(1).max(HUB_MAX_MAIN_BYTES),
  licence: HubLicence,
  licenceUrl: z.string().url(),
  author: z.string().min(1).max(400),
  /** The credit line a CC BY licence needs (also given for CC0 as a courtesy). */
  credit: z.string().min(1).max(300),
  source: z.object({
    name: z.string().min(1).max(160),
    url: z.string().url().max(300),
    /** Source dataset and the commit it was taken at (Hugging Face sources). */
    dataset: z.string().max(200).optional(),
    revision: z.string().max(64).optional(),
    /** File or package inside the source. */
    path: z.string().max(300),
    /** SHA-256 of the source USD file and the package's own hash (bulk SimReady imports). */
    sha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
    packageHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  }),
  /** How the file was made from the source. */
  converted: z.string().min(1).max(300),
  /** CC BY 4.0 section 3(a)(1)(B): the notice that the material was modified. */
  modified: z.boolean(),
  placement: AssetPlacement,
  facing: z.enum(['+z', '-z']),
  collider: CatalogCollider,
  animated: z.boolean().optional(),
  files: z.object({
    main: HubFile,
    lod1: HubFile.extend({ triangles: z.number().int().min(1) }).optional(),
    lite: HubFile.optional(),
    thumb: HubFile,
  }),
});
export type HubRow = z.infer<typeof HubRow>;

export const HubIndex = z.object({
  version: z.literal(1),
  dataset: z.string().regex(HUB_DATASET_RE),
  generated: z.string().max(40),
  count: z.number().int().min(0),
  rows: z.array(HubRow).max(5000),
});
export type HubIndex = z.infer<typeof HubIndex>;

/**
 * The compact index the client fetches (about 90 bytes per asset after gzip): a row is
 * `[id, name, aliases, tags, category, style, w, h, d, triangles, bytes, licence, author, source, sha256]` with `aliases` and
 * `tags` space-joined and `licence` / `author` / `source` indexes into the tables.
 */
export const HUB_MIN_COLUMNS = ['id', 'name', 'aliases', 'tags', 'category', 'style', 'w', 'h', 'd', 'triangles', 'bytes', 'licence', 'author', 'source', 'sha256'] as const;
export const HubMinRow = z.tuple([
  AssetId,
  z.string().min(1).max(60),
  z.string().max(400),
  z.string().max(500),
  AssetCategory,
  z.union([z.literal(0), z.literal(1)]),
  z.number().min(0).max(500),
  z.number().min(0).max(500),
  z.number().min(0).max(500),
  z.number().int().min(0),
  z.number().int().min(1).max(HUB_MAX_MAIN_BYTES),
  z.number().int().min(0).max(1),
  z.number().int().min(0).max(4000),
  z.number().int().min(0).max(4000),
  Sha,
]);
export type HubMinRow = z.infer<typeof HubMinRow>;
export const HubMinIndex = z.object({
  version: z.literal(1),
  dataset: z.string().regex(HUB_DATASET_RE),
  count: z.number().int().min(0),
  columns: z.array(z.string()).length(HUB_MIN_COLUMNS.length),
  licences: z.array(HubLicence).max(2),
  authors: z.array(z.string().max(400)).max(4000),
  sources: z.array(z.string().max(160)).max(4000),
  rows: z.array(HubMinRow).max(5000),
});
export type HubMinIndex = z.infer<typeof HubMinIndex>;

/** Header of `embeddings.bin`: int8 image embeddings (x127 of a unit vector), one row per asset in index order. */
export const HubEmbeddingsHeader = z.object({
  version: z.literal(1),
  model: z.string().max(160),
  dim: z.number().int().min(8).max(2048),
  count: z.number().int().min(0),
  ids: z.array(AssetId).max(5000),
  sha256: Sha,
});
export type HubEmbeddingsHeader = z.infer<typeof HubEmbeddingsHeader>;

const LICENCE_NAME: Readonly<Record<HubLicence, string>> = { 'CC0-1.0': 'CC0 1.0', 'CC-BY-4.0': 'CC BY 4.0' };

/** Short source label for credit lines ("SimReady Central: owner/dataset"). */
export const hubSourceLabel = (name: string): string => name.replace(/^NVIDIA SimReady Central, Hugging Face dataset /, 'SimReady Central: ');

/** The credit line for a hub asset (at most 200 characters: the user-asset limit). Same function for the export and the client. */
export function hubCreditText(a: { name: string; author: string; licence: HubLicence; source: string; modified: boolean }): string {
  const tail = `${LICENCE_NAME[a.licence]}${a.modified && a.licence === 'CC-BY-4.0' ? ', modified (converted and reduced by Aether)' : ''}`;
  const head = `"${a.name}" by ${a.author} (${a.source}), ${tail}`;
  if (head.length <= 200) return head;
  const keep = Math.max(20, a.author.length - (head.length - 200) - 1);
  return `"${a.name}" by ${a.author.slice(0, keep)}… (${a.source.slice(0, 40)}), ${tail}`.slice(0, 200);
}

/** The min index of a full index (the exporter writes this; the tests check the two agree). */
export function toMinIndex(index: HubIndex): HubMinIndex {
  const authors: string[] = [];
  const sources: string[] = [];
  const at = (list: string[], v: string): number => {
    const i = list.indexOf(v);
    if (i >= 0) return i;
    list.push(v);
    return list.length - 1;
  };
  const rows = index.rows.map((r): HubMinRow => [
    r.id,
    r.name,
    r.aliases.join(' '),
    r.tags.join(' '),
    r.category,
    r.style === 'realistic' ? 0 : 1,
    r.size[0],
    r.size[1],
    r.size[2],
    r.triangles,
    r.bytes,
    r.licence === 'CC0-1.0' ? 0 : 1,
    at(authors, r.author),
    at(sources, r.source.name),
    r.files.main.sha256,
  ]);
  return { version: 1, dataset: index.dataset, count: rows.length, columns: [...HUB_MIN_COLUMNS], licences: ['CC0-1.0', 'CC-BY-4.0'], authors, sources, rows };
}

/** A min row as the object the studio and the agent work with. */
export interface HubItem {
  id: string;
  name: string;
  aliases: string[];
  tags: string[];
  category: AssetCategory;
  style: HubStyle;
  size: [number, number, number];
  triangles: number;
  bytes: number;
  licence: HubLicence;
  author: string;
  source: string;
  sha256: string;
  credit: string;
}

export function hubItems(min: HubMinIndex): HubItem[] {
  return min.rows.map((r) => {
    const licence = min.licences[r[11]] ?? 'CC0-1.0';
    const author = min.authors[r[12]] ?? 'Unknown';
    const source = min.sources[r[13]] ?? 'Aether asset hub';
    const item: HubItem = {
      id: r[0],
      name: r[1],
      aliases: r[2] === '' ? [] : r[2].split(' '),
      tags: r[3] === '' ? [] : r[3].split(' '),
      category: r[4],
      style: r[5] === 0 ? 'realistic' : 'stylized',
      size: [r[6], r[7], r[8]],
      triangles: r[9],
      bytes: r[10],
      licence,
      author,
      source,
      sha256: r[14],
      credit: '',
    };
    // Whether the work was modified is true for every hub file (converted and reduced); the credit says so.
    item.credit = hubCreditText({ name: item.name, author, licence, source: hubSourceLabel(source), modified: true });
    return item;
  });
}

/** URL of a dataset file at a pinned revision. `base` replaces the Hugging Face origin (the dev proxy). */
export function hubFileUrl(cfg: Pick<HubConfig, 'dataset' | 'revision'>, path: string, base = 'https://huggingface.co'): string {
  const clean = path.split('/').map(encodeURIComponent).join('/');
  return `${base}/datasets/${cfg.dataset}/resolve/${cfg.revision}/${clean}`;
}

export const hubModelPath = (id: string): string => `models/${id}/${id}.glb`;
export const hubThumbPath = (id: string): string => `models/${id}/thumb.webp`;

/** Lowercase hex SHA-256 (Web Crypto). */
async function sha256(data: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** True when `data` hashes to `expected`. */
export async function verifyHubBytes(data: Uint8Array, expected: string): Promise<boolean> {
  return /^[0-9a-f]{64}$/.test(expected) && (await sha256(data)) === expected;
}

export interface HubHit {
  item: HubItem;
  score: number;
}
export interface HubSearchOptions {
  limit?: number;
  style?: HubStyle;
  /** Skip assets whose main file is larger than this many bytes. */
  maxBytes?: number;
  category?: AssetCategory;
}

const catalogs = new WeakMap<HubItem[], Catalog>();

/** The items as a catalog, so the library's ranking (tokens, synonyms, prefixes, one typo) applies unchanged. */
function asCatalog(items: HubItem[]): Catalog {
  let c = catalogs.get(items);
  if (!c) {
    const entries = items.map((i): CatalogEntry => ({
      id: i.id,
      name: i.name,
      kind: 'model',
      category: i.category,
      // Aliases are searched as tags: "stove" finds the cooker.
      tags: [...new Set([...i.aliases, ...i.tags])].slice(0, 32).map((t) => t.slice(0, 32)),
      style: i.style === 'realistic' ? 'realistic' : 'stylised',
      pack: 'hub',
      size: i.size,
      tris: i.triangles,
      bytes: i.bytes,
      lods: [],
      collider: { type: 'box' },
      placement: 'floor',
      facing: '+z',
      source: i.source.slice(0, 200),
    }));
    c = { version: 1, base: '/', packs: [], entries };
    catalogs.set(items, c);
  }
  return c;
}

/** Ranked hub matches: every query word must match (name, alias, tag, synonym, prefix, or one typo). Empty query: smallest first. */
export function searchHubItems(items: HubItem[], query: string, o: HubSearchOptions = {}): HubHit[] {
  const limit = Math.max(1, Math.min(200, Math.floor(o.limit ?? 24)));
  const byId = new Map(items.map((i) => [i.id, i]));
  const ranked = searchAssets(asCatalog(items), { text: query, limit: 200, ...(o.category ? { category: o.category } : {}) });
  const out: HubHit[] = [];
  for (const h of ranked) {
    const item = byId.get(h.entry.id);
    if (!item) continue;
    if (o.style && item.style !== o.style) continue;
    if (o.maxBytes !== undefined && item.bytes > o.maxBytes) continue;
    out.push({ item, score: h.score });
    if (out.length >= limit) break;
  }
  return out;
}

/** Decode `embeddings.bin` (int8 rows) after checking its hash and header. Null when anything disagrees. */
export async function readHubEmbeddings(header: unknown, bin: Uint8Array): Promise<{ ids: string[]; dim: number; emb: Int8Array } | null> {
  const h = HubEmbeddingsHeader.safeParse(header);
  if (!h.success) return null;
  if (bin.byteLength !== h.data.count * h.data.dim || h.data.ids.length !== h.data.count) return null;
  if ((await sha256(bin)) !== h.data.sha256) return null;
  return { ids: h.data.ids, dim: h.data.dim, emb: new Int8Array(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength)) };
}

/** The assets that look most like `id` (cosine over the int8 image embeddings), best first. */
export function similarHubIds(emb: { ids: string[]; dim: number; emb: Int8Array }, id: string, limit = 8): Array<{ id: string; score: number }> {
  const at = emb.ids.indexOf(id);
  if (at < 0) return [];
  const { dim } = emb;
  const a = emb.emb.subarray(at * dim, (at + 1) * dim);
  const out: Array<{ id: string; score: number }> = [];
  for (let i = 0; i < emb.ids.length; i++) {
    if (i === at) continue;
    let dot = 0;
    for (let k = 0; k < dim; k++) dot += (a[k] as number) * (emb.emb[i * dim + k] as number);
    out.push({ id: emb.ids[i] as string, score: dot / (127 * 127) });
  }
  return out.sort((x, y) => y.score - x.score).slice(0, limit);
}
