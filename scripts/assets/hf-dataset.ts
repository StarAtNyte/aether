/**
 * Export the library's models as Aether's own Hugging Face dataset (`assets/hub.json` names it), structured like the
 * SimReady datasets: one folder per model, an index with provenance and hashes, a dataset card.
 *
 *   npm run assets:hf -- build  [--stage=<dir>] [--max-main=1200000]   write the staging folder
 *   npm run assets:hf -- verify [--stage=<dir>] [--remote]            re-hash, audit licences, validate the indexes
 *   npm run assets:hf -- upload [--stage=<dir>] [--public] [--message=...] [--pin]   create the repo (PRIVATE unless --public), upload in batches
 *
 * Only CC0-1.0 and CC-BY-4.0 models go in; every other licence (and first-party MIT content) is dropped. The token is read
 * by huggingface_hub from its own cache or HF_TOKEN; this script never reads, prints or logs it.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { gzipSync } from 'node:zlib';
import { join, resolve } from 'node:path';
import { CatalogEntry, type Catalog } from '../../packages/assets/src/schema';
import { synonymsOf } from '../../packages/assets/src/synonyms';
import { tokenize } from '../../packages/assets/src/search';
import { importUserAsset } from '../../packages/assets/src/user';
import { ImportedAsset } from '../../packages/assets/src/imported';
import {
  HUB_LICENCE_URLS, hubLicenceAllowed, HUB_MAX_MAIN_BYTES, HubConfig, HubEmbeddingsHeader, HubIndex, HubMinIndex, HubRow, hubCreditText, hubModelPath, hubSourceLabel, toMinIndex, type HubLicence,
} from '../../packages/assets/src/hub';

const ROOT = resolve(import.meta.dirname, '../..');
const LIB = join(ROOT, 'assets', 'lib');
const DEFAULT_STAGE = join(homedir(), '.local', 'share', 'aether', 'hf-assets-stage');
const IMPORT_DIR = process.env['AETHER_IMPORT_DIR'] ?? join(homedir(), '.local', 'share', 'aether', 'imported');
const BULK_DIR = process.env['AETHER_BULK_DIR'] ?? join(homedir(), '.local', 'share', 'aether', 'simready-bulk');
const BULK_OUT = join(BULK_DIR, 'out');
const TOKEN_FILE = join(homedir(), '.config', 'aether', 'hf-write.token');
const VENV_PY = join(homedir(), '.local', 'share', 'aether', 'simready', 'venv', 'bin', 'python');

const arg = (name: string): string | undefined => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = (name: string): boolean => process.argv.includes(`--${name}`);
const stageDir = (): string => resolve(arg('stage') ?? DEFAULT_STAGE);
const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
const readJson = (p: string): unknown => JSON.parse(readFileSync(p, 'utf8'));

interface Sources {
  simready: { packages: Array<{ id: string; dataset: string; revision: string; package: string; title: string; usd: string; sha256: string; packageHash: string; page: string }> };
}

function config(): HubConfig {
  return HubConfig.parse(readJson(join(ROOT, 'assets', 'hub.json')));
}

/** Words that name the object, for `aliases`: the synonyms of the name's words that the tags list. */
function aliasesOf(e: CatalogEntry): string[] {
  const own = new Set([...tokenize(e.name), ...tokenize(e.id.replace(/-/g, ' '))]);
  const tags = new Set(e.tags.map((t) => t.toLowerCase()));
  const out: string[] = [];
  const add = (w: string): void => {
    if (w && !own.has(w) && !out.includes(w) && /^[a-z0-9-]{2,40}$/.test(w)) out.push(w);
  };
  for (const w of own) for (const s of synonymsOf(w)) if (!s.includes(' ') && tags.has(s)) add(s);
  if (e.interior) add(e.interior.type);
  return out.slice(0, 12);
}

interface Candidate {
  entry: CatalogEntry;
  /** Wall models: pivot height above the floor (ceiling models 0); not part of the catalog schema, so it is read from the raw entry. */
  mountY?: number;
  /** Directory the entry's library files live in (`assets/lib`, or an import record). */
  dir: string;
  licence: HubLicence;
  author: string;
  source: HubRow['source'];
  converted: string;
  srcId?: string;
  /** Provenance written as is (bulk SimReady imports record it themselves). */
  provenance?: Record<string, unknown>;
}

const DROP = { licence: 0, kind: 0, bytes: 0, noThumb: 0, noFile: 0, characters: 0, empty: 0, dup: 0 };

const mountOf = (raw: unknown): { mountY?: number } => {
  const y = (raw as { mountY?: unknown }).mountY;
  return typeof y === 'number' && Number.isFinite(y) ? { mountY: y } : {};
};

function candidates(max: number): Candidate[] {
  const cat = readJson(join(ROOT, 'assets', 'catalog.json')) as Catalog;
  const sources = readJson(join(ROOT, 'assets', 'sources.json')) as Sources;
  const sim = new Map(sources.simready.packages.map((p) => [`${p.dataset}/${p.revision}/${p.package}`, p]));
  const packs = new Map(cat.packs.map((p) => [p.id, p]));
  const out: Candidate[] = [];
  for (const raw of cat.entries) {
    const e = CatalogEntry.parse(raw);
    const pack = packs.get(e.pack);
    if (e.kind !== 'model' || !e.file) { DROP.kind++; continue; }
    if (!pack || !hubLicenceAllowed(pack.licence)) { DROP.licence++; continue; }
    if (e.category === 'characters') { DROP.characters++; continue; }
    if (e.bytes > max) { DROP.bytes++; continue; }
    if (e.tris <= 0 || e.size.every((v) => v === 0)) { DROP.empty++; continue; }
    if (!e.thumb || !existsSync(join(LIB, e.thumb))) { DROP.noThumb++; continue; }
    if (!existsSync(join(LIB, e.file))) { DROP.noFile++; continue; }
    const author = e.authors?.join(', ') ?? pack.author;
    let source: HubRow['source'] = { name: pack.title, url: pack.url, path: e.source };
    let converted = 'Re-exported by Aether: scaled to real metres, base on y = 0, textures resized, geometry and textures compressed (meshopt). Not otherwise altered.';
    const m = /^simready\/([^/]+\/[^/]+)\/([0-9a-f]{40})\/([^/]+)\//.exec(e.source);
    if (m) {
      const p = sim.get(`${m[1]}/${m[2]}/${m[3]}`);
      source = { name: `NVIDIA SimReady Central, Hugging Face dataset ${m[1]}`, url: p?.page ?? pack.url, dataset: m[1] as string, revision: m[2] as string, path: `${m[3]}/${p?.usd ?? ''}`.replace(/\/$/, '') };
      converted = 'Converted by Aether from OpenUSD to GLB (world transforms baked, triangulated, welded, Z-up to Y-up, metres), reduced in triangles and textures and compressed (meshopt). Modified from the source package; not NVIDIA-validated.';
    }
    out.push({ entry: e, ...mountOf(raw), dir: LIB, licence: pack.licence as HubLicence, author, source, converted });
  }
  // Bulk SimReady imports (`assets:simready -- bulk`): one folder per accepted model under the bulk output.
  const known = new Set(out.map((c) => c.entry.id));
  if (existsSync(BULK_OUT)) {
    for (const d of readdirSync(BULK_OUT).sort()) {
      const rec = join(BULK_OUT, d, 'record.json');
      if (!existsSync(rec)) continue;
      const r = readJson(rec) as { entry: unknown; licence: string; author: string; source: HubRow['source']; converted: string; provenance: Record<string, unknown> };
      const e = CatalogEntry.parse(r.entry);
      if (!hubLicenceAllowed(r.licence)) { DROP.licence++; continue; }
      if (known.has(e.id)) { DROP.dup++; continue; }
      if (e.bytes > max) { DROP.bytes++; continue; }
      known.add(e.id);
      out.push({ entry: e, ...mountOf(existsSync(join(BULK_OUT, d, 'entry.json')) ? readJson(join(BULK_OUT, d, 'entry.json')) : r.entry), dir: join(BULK_OUT, d, 'lib'), licence: r.licence, author: r.author, source: r.source, converted: r.converted, provenance: r.provenance });
    }
  }
  // Imports of the local server that the library does not hold yet (they need a thumbnail to be listed).
  const have = new Set(out.map((c) => c.entry.id));
  if (existsSync(IMPORT_DIR)) {
    for (const d of readdirSync(IMPORT_DIR)) {
      const rec = join(IMPORT_DIR, d, 'imported.json');
      if (!existsSync(rec)) continue;
      const parsed = ImportedAsset.safeParse(readJson(rec));
      if (!parsed.success) continue;
      const a = parsed.data;
      const lic = a.credit.licence;
      if (!hubLicenceAllowed(lic)) { DROP.licence++; continue; }
      if (have.has(a.id) || [...have].some((i) => a.provenance.package && i.includes(a.provenance.package.toLowerCase().replace(/[^a-z0-9]+/g, '-')))) { DROP.dup++; continue; }
      if (!a.entry.file || a.entry.bytes > max) { DROP.bytes++; continue; }
      DROP.noThumb++; // server imports render no thumbnail: they join the hub through the library build (assets:thumbs)
    }
  }
  return out;
}

function nameAliasTags(e: CatalogEntry): { aliases: string[]; tags: string[] } {
  const tags = [...new Set(e.tags.map((t) => t.toLowerCase()).filter((t) => /^[a-z0-9-]{1,32}$/.test(t)))].slice(0, 32);
  return { aliases: aliasesOf(e), tags };
}

function stage(c: Candidate, dest: string): HubRow {
  const e = c.entry;
  const dir = join(dest, 'models', e.id);
  mkdirSync(dir, { recursive: true });
  const put = (from: string, name: string): { path: string; bytes: number; sha256: string } => {
    const buf = readFileSync(join(c.dir, from));
    writeFileSync(join(dir, name), buf);
    return { path: `models/${e.id}/${name}`, bytes: buf.byteLength, sha256: sha(buf) };
  };
  const main = put(e.file as string, `${e.id}.glb`);
  const lod1 = e.lods[0] ? { ...put(e.lods[0].file, `${e.id}.lod1.glb`), triangles: e.lods[0].tris } : undefined;
  const lite = e.lite ? put(e.lite, `${e.id}.lite.glb`) : undefined;
  const thumb = put(e.thumb as string, 'thumb.webp');
  const { aliases, tags } = nameAliasTags(e);
  const row: HubRow = {
    id: e.id,
    name: e.name,
    aliases,
    tags,
    category: e.category,
    style: e.style === 'realistic' ? 'realistic' : 'stylized',
    size: e.size,
    triangles: e.tris,
    bytes: main.bytes,
    licence: c.licence,
    licenceUrl: HUB_LICENCE_URLS[c.licence],
    author: c.author,
    credit: hubCreditText({ name: e.name, author: c.author, licence: c.licence, source: hubSourceLabel(c.source.name), modified: true }),
    source: c.source,
    converted: c.converted,
    modified: true,
    placement: e.placement,
    // Wall models: the height of the pivot (their back-centre mount point) above the floor; ceiling models: 0 (pivot at the top).
    ...(c.mountY !== undefined ? { mountY: c.mountY } : {}),
    facing: e.facing,
    collider: e.collider,
    ...(e.anims && e.anims.clips.length > 0 ? { animated: true } : {}),
    files: { main, ...(lod1 ? { lod1 } : {}), ...(lite ? { lite } : {}), thumb },
  };
  if (c.provenance) writeFileSync(join(dir, 'provenance.json'), `${JSON.stringify(c.provenance, null, 2)}\n`);
  else if (c.source.dataset) {
    // Provenance of a SimReady-derived model: the pinned source package. Not a SimReady package and not NVIDIA-validated.
    const sources = readJson(join(ROOT, 'assets', 'sources.json')) as Sources;
    const p = sources.simready.packages.find((x) => x.dataset === c.source.dataset && x.revision === c.source.revision && c.source.path.startsWith(`${x.package}/`));
    writeFileSync(join(dir, 'provenance.json'), `${JSON.stringify({ derivedFrom: { dataset: c.source.dataset, revision: c.source.revision, package: p?.package ?? null, usd: p?.usd ?? null, usdSha256: p?.sha256 ?? null, packageHash: p?.packageHash ?? null }, note: 'A derivative: the package was converted to a browser-sized GLB by Aether. It is not a SimReady package and has not been validated by NVIDIA.' }, null, 2)}\n`);
  }
  return row;
}

/**
 * Int8 CLIP image embeddings of every staged thumbnail (the same tower as the photo perception layer). Embeddings are cached by
 * the thumbnail's SHA-256, so a rebuild only embeds new thumbnails. When the CLIP weights cannot be loaded, the library's
 * `assets/clip-index.json` covers the models it knows.
 */
async function embed(rows: HubRow[], dest: string): Promise<{ have: number }> {
  const cachePath = join(BULK_DIR, 'emb-cache.json');
  const cache: Record<string, string> = existsSync(cachePath) ? (readJson(cachePath) as Record<string, string>) : {};
  const fallback = readJson(join(ROOT, 'assets', 'clip-index.json')) as { dim: number; ids: string[]; emb: string };
  const fbBin = Buffer.from(fallback.emb, 'base64');
  const fbAt = new Map(fallback.ids.map((id, i) => [id, i]));
  const dim = fallback.dim;
  let model: { embed(r: { width: number; height: number; data: Uint8ClampedArray }, c: Array<{ box: [number, number, number, number] }>): Promise<Float32Array[]>; dispose(): Promise<void> } | null = null;
  let tried = false;
  const clip = async (): Promise<typeof model> => {
    if (!tried) {
      tried = true;
      try {
        const { loadClip } = await import('../../packages/agent/src/photo/perception/clip');
        const l = await loadClip();
        if (l.ok) model = l.model as unknown as typeof model;
        else console.error(`CLIP not loaded (${l.reason}); using assets/clip-index.json where it has the model`);
      } catch (e) {
        console.error(`CLIP not loaded (${e instanceof Error ? e.message : 'failed'})`);
      }
    }
    return model;
  };
  const ids: string[] = [];
  const parts: Buffer[] = [];
  let fresh = 0;
  for (const r of rows) {
    const key = r.files.thumb.sha256;
    let v = cache[key];
    if (!v) {
      const m = await clip();
      if (m) {
        const dec = spawnSync('ffmpeg', ['-v', 'error', '-i', join(dest, r.files.thumb.path), '-vf', 'scale=224:224:flags=area', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'], { maxBuffer: 1 << 26 });
        if (dec.status === 0 && dec.stdout.length === 224 * 224 * 4) {
          const raster = { width: 224, height: 224, data: new Uint8ClampedArray(dec.stdout.buffer, dec.stdout.byteOffset, dec.stdout.length) };
          const [emb] = await m.embed(raster, [{ box: [0, 0, 1, 1] }]);
          if (emb) {
            v = Buffer.from(Int8Array.from(emb, (x) => Math.round(x * 127)).buffer).toString('base64');
            cache[key] = v;
            fresh++;
          }
        }
      }
    }
    if (!v) {
      const i = fbAt.get(r.id);
      if (i === undefined) continue;
      v = fbBin.subarray(i * dim, (i + 1) * dim).toString('base64');
    }
    ids.push(r.id);
    parts.push(Buffer.from(v, 'base64'));
  }
  if (fresh > 0) {
    mkdirSync(BULK_DIR, { recursive: true });
    writeFileSync(cachePath, JSON.stringify(cache));
  }
  const m = model as { dispose(): Promise<void> } | null;
  if (m) await m.dispose();
  const all = Buffer.concat(parts);
  writeFileSync(join(dest, 'embeddings.bin'), all);
  const header = HubEmbeddingsHeader.parse({ version: 1, model: 'openai/clip-vit-base-patch32 vision tower (MIT), int8 x127 of the unit vector, embeddings of thumb.webp', dim, count: ids.length, ids, sha256: sha(all) });
  writeFileSync(join(dest, 'embeddings.json'), `${JSON.stringify(header)}\n`);
  return { have: ids.length };
}

const mb = (n: number): string => `${(n / 1e6).toFixed(1)} MB`;

/** One row per asset: the whole attribution table as a file (the README links it when the table would be huge). */
function credits(index: HubIndex): string {
  const q = (v: string): string => `"${v.replace(/"/g, '""')}"`;
  const head = 'id,name,author,licence,credit,source,source_url,dataset,revision,path';
  return `${[head, ...index.rows.map((r) => [r.id, r.name, r.author, r.licence, r.credit, r.source.name, r.source.url, r.source.dataset ?? '', r.source.revision ?? '', r.source.path].map(q).join(','))].join('\n')}\n`;
}

/** Above this many CC BY rows the README links credits.csv instead of listing them. */
const README_TABLE_MAX = 150;

function card(index: HubIndex, cfg: HubConfig): string {
  const by = (l: HubLicence): HubRow[] => index.rows.filter((r) => r.licence === l);
  const bySource = new Map<string, { n: number; licence: string; url: string }>();
  for (const r of index.rows) {
    const s = bySource.get(r.source.name) ?? { n: 0, licence: r.licence, url: r.source.url };
    s.n++;
    bySource.set(r.source.name, s);
  }
  const cats = new Map<string, number>();
  for (const r of index.rows) cats.set(r.category, (cats.get(r.category) ?? 0) + 1);
  const total = index.rows.reduce((n, r) => n + Object.values(r.files).reduce((m, f) => m + f.bytes, 0), 0);
  const ccBy = by('CC-BY-4.0');
  const esc = (s: string): string => s.replace(/\|/g, '\\|');
  return `---
pretty_name: Aether assets
license: other
license_name: per-asset
license_link: https://github.com/StarAtNyte/aether/blob/main/docs/THIRD_PARTY.md
task_categories:
- text-to-3d
- image-to-3d
tags:
- 3d
- glb
- gltf
- assets
- props
- cc0
- cc-by
size_categories:
- ${index.count < 1000 ? 'n<1K' : '1K<n<10K'}
configs:
- config_name: default
  data_files: index.json
---

# Aether assets

${index.count} small, textured 3D models (GLB, real-world metres, base on y = 0, meshopt-compressed) for browser games and scenes, with a search index. They are the browser-sized models of the [Aether](https://github.com/StarAtNyte/aether) asset library, published so that any world can find and load one lazily, without a local server.

## Licences

**This dataset has no single licence. Each asset keeps the licence of its source, shown in the \`licence\` column of \`index.json\`.** Only two licences are accepted: CC0-1.0 (${by('CC0-1.0').length} assets) and CC-BY-4.0 (${ccBy.length} assets). Nothing non-commercial, no-derivatives, share-alike or unlabelled is included.

- **CC0 1.0** ([legal code](${HUB_LICENCE_URLS['CC0-1.0']})): no rights reserved. A credit is given anyway.
- **CC BY 4.0** ([legal code](${HUB_LICENCE_URLS['CC-BY-4.0']})): use freely, **credit the author, link the licence, and say that changes were made**. Every CC BY asset below was modified (converted, reduced and recompressed by Aether); the \`credit\` field of each row is a ready attribution line.

## Sources

| Source | Assets | Licence |
|---|---|---|
${[...bySource].map(([name, s]) => `| [${esc(name)}](${s.url}) | ${s.n} | ${s.licence} |`).join('\n')}

Models derived from [NVIDIA SimReady Central](https://huggingface.co/spaces/nvidia/simready-central) packages were converted by Aether from OpenUSD to GLB (world transforms baked, triangulated, welded, Z-up to Y-up, in metres), reduced in triangles and textures, and compressed. They are derivatives of the pinned source package (dataset, commit and file in \`source\`, with the source file's SHA-256 in \`models/<id>/provenance.json\`). They are not SimReady packages and have not been validated by NVIDIA.

## Layout

\`\`\`
models/<id>/<id>.glb         main model (at most ${(HUB_MAX_MAIN_BYTES / 1e6).toFixed(1)} MB)
models/<id>/<id>.lod1.glb    fewer triangles, same pivot and scale (when present)
models/<id>/<id>.lite.glb    smaller textures, for low-end devices (when present)
models/<id>/thumb.webp       192 px preview
models/<id>/provenance.json  pinned source package (SimReady-derived models)
index.json                   one row per asset: id, name, aliases, tags, category, style, size (m), triangles, bytes,
                             licence (SPDX), author, credit, source (dataset, revision, path), conversion note,
                             collider, SHA-256 of every file
index.min.json               the compact index the client loads (search only needs this)
credits.csv                  attribution table of every asset (author, licence, credit line, pinned source)
embeddings.bin + .json       int8 CLIP ViT-B/32 image embeddings of the thumbnails (similar-looking models)
\`\`\`

${index.count} models in ${cats.size} categories, ${mb(total)} in all. Categories: ${[...cats].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join(', ')}.

## Use

\`\`\`python
from huggingface_hub import hf_hub_download
import json
index = json.load(open(hf_hub_download("${cfg.dataset}", "index.json", repo_type="dataset")))
row = next(r for r in index["rows"] if "chair" in r["tags"])
glb = hf_hub_download("${cfg.dataset}", row["files"]["main"]["path"], repo_type="dataset")
\`\`\`

Check the file against \`files.main.sha256\` before use. In a browser, fetch \`https://huggingface.co/datasets/${cfg.dataset}/resolve/<commit>/index.min.json\` and search it locally; pin the commit.

## Attribution (CC BY 4.0 assets)

${ccBy.length === 0 ? 'None.' : ccBy.length > README_TABLE_MAX ? `${ccBy.length} CC BY 4.0 assets: the full table (asset, author, licence, ready-made credit line, source dataset and commit) is [credits.csv](credits.csv). \`index.json\` carries the same fields per asset.` : `| Asset | Author | Source |\n|---|---|---|\n${ccBy.map((r) => `| ${esc(r.name)} (\`${r.id}\`) | ${esc(r.author)} | [${esc(r.source.name)}](${r.source.url}) |`).join('\n')}`}

CC0 assets are listed in \`index.json\` with their author and source; the Kenney kits and Poly Haven models are public-domain dedications.

## Safety

The files are data. The index hashes (SHA-256) let a client check every download. Loaders should still validate the GLB and cap its size.
`;
}

async function build(): Promise<void> {
  const max = Number(arg('max-main') ?? HUB_MAX_MAIN_BYTES);
  const cfg = config();
  const dest = stageDir();
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  const cands = candidates(max);
  const rows = cands.map((c) => stage(c, dest)).sort((a, b) => a.id.localeCompare(b.id));
  const index = HubIndex.parse({ version: 1, dataset: cfg.dataset, generated: new Date().toISOString().slice(0, 10), count: rows.length, rows });
  // The schema does not know `mountY` yet (it would strip it): the file keeps the rows as staged.
  writeFileSync(join(dest, 'index.json'), `${JSON.stringify({ ...index, rows }, null, 1)}\n`);
  const min = toMinIndex(index);
  HubMinIndex.parse(min);
  writeFileSync(join(dest, 'index.min.json'), JSON.stringify(min));
  const e = await embed(index.rows, dest);
  writeFileSync(join(dest, 'credits.csv'), credits(index));
  writeFileSync(join(dest, 'README.md'), card(index, cfg));
  const total = rows.reduce((n, r) => n + Object.values(r.files).reduce((m, f) => m + f.bytes, 0), 0);
  const per = (l: HubLicence): number => rows.filter((r) => r.licence === l).length;
  console.log(`staged ${rows.length} models in ${dest}: ${mb(total)} (main files ${mb(rows.reduce((n, r) => n + r.bytes, 0))}), CC0 ${per('CC0-1.0')}, CC-BY ${per('CC-BY-4.0')}, ${e.have} embeddings`);
  console.log(`dropped: ${JSON.stringify(DROP)}`);
}

/** Collect every file under a directory (relative paths). */
function walk(dir: string, rel = ''): string[] {
  return readdirSync(join(dir, rel), { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(dir, `${rel}${d.name}/`) : [`${rel}${d.name}`]));
}

async function verify(): Promise<void> {
  const dest = stageDir();
  const errors: string[] = [];
  const err = (m: string): void => void (errors.length < 40 && errors.push(m));
  const index = HubIndex.parse(readJson(join(dest, 'index.json')));
  const min = HubMinIndex.parse(readJson(join(dest, 'index.min.json')));
  if (JSON.stringify(min) !== JSON.stringify(toMinIndex(index))) err('index.min.json differs from index.json');
  const known = new Set(['index.json', 'index.min.json', 'embeddings.bin', 'embeddings.json', 'README.md', 'credits.csv']);
  const ids = new Set<string>();
  let total = 0;
  for (const r of index.rows) {
    HubRow.parse(r);
    if (ids.has(r.id)) err(`duplicate id ${r.id}`);
    ids.add(r.id);
    if (!hubLicenceAllowed(r.licence)) err(`${r.id}: licence ${r.licence} is not allowed`);
    if (r.licenceUrl !== HUB_LICENCE_URLS[r.licence]) err(`${r.id}: licence URL`);
    if (!r.credit || !r.author || !r.source.url || !r.source.name) err(`${r.id}: missing credit or source`);
    if (r.licence === 'CC-BY-4.0' && !r.modified) err(`${r.id}: CC BY needs the modification notice`);
    if (r.source.dataset && !/^[0-9a-f]{40}$/.test(r.source.revision ?? '')) err(`${r.id}: source revision is not a pinned commit`);
    if (r.credit !== hubCreditText({ name: r.name, author: r.author, licence: r.licence, source: hubSourceLabel(r.source.name), modified: true })) err(`${r.id}: credit text`);
    if (r.bytes > HUB_MAX_MAIN_BYTES) err(`${r.id}: main file too big`);
    if (r.files.main.path !== hubModelPath(r.id)) err(`${r.id}: main path`);
    for (const f of Object.values(r.files)) {
      known.add(f.path);
      const p = join(dest, f.path);
      if (!existsSync(p)) { err(`${f.path}: missing`); continue; }
      const buf = readFileSync(p);
      total += buf.byteLength;
      if (buf.byteLength !== f.bytes) err(`${f.path}: size`);
      if (sha(buf) !== f.sha256) err(`${f.path}: hash`);
      if (f.path.endsWith('.glb') && buf.toString('latin1', 0, 4) !== 'glTF') err(`${f.path}: not a GLB`);
      // The studio stores a hub model like a dropped file: the main file must pass the same validator.
      if (f.path === r.files.main.path) {
        const v = await importUserAsset(new Uint8Array(buf), `${r.id}.glb`);
        if (!v.ok) err(`${f.path}: the GLB validator refuses it (${v.error})`);
      }
      if (f.path.endsWith('.webp') && buf.toString('latin1', 8, 12) !== 'WEBP') err(`${f.path}: not a WebP`);
    }
    if (r.source.dataset) known.add(`models/${r.id}/provenance.json`);
  }
  for (const f of walk(dest)) if (!known.has(f)) err(`${f}: not in the index`);
  const emb = HubEmbeddingsHeader.parse(readJson(join(dest, 'embeddings.json')));
  const bin = readFileSync(join(dest, 'embeddings.bin'));
  if (bin.byteLength !== emb.count * emb.dim || sha(bin) !== emb.sha256) err('embeddings.bin does not match its header');
  for (const id of emb.ids) if (!ids.has(id)) err(`embeddings: unknown id ${id}`);
  const readme = readFileSync(join(dest, 'README.md'), 'utf8');
  if (/hackathon|judg|competition|deadline/i.test(readme)) err('README mentions a forbidden word');
  const per = (l: HubLicence): number => index.rows.filter((r) => r.licence === l).length;
  const sizeLimit = statSync(join(dest, 'index.min.json')).size;
  const gz = gzipSync(readFileSync(join(dest, 'index.min.json'))).byteLength;
  if (gz > 400_000) err(`index.min.json is ${gz} bytes gzipped: shard it`);
  if (!existsSync(join(dest, 'credits.csv'))) err('credits.csv missing');
  if (flag('remote')) remoteCheck(index);
  if (errors.length > 0) {
    console.error(`verify failed:\n  ${errors.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`verify ok: ${index.count} models, ${mb(total)}, CC0 ${per('CC0-1.0')}, CC-BY ${per('CC-BY-4.0')}, index.min.json ${sizeLimit} bytes (${gz} gzipped), ${emb.count} embeddings`);
}

/** Python prelude: the write token comes from the private token file first, else HF_TOKEN (a shell's HF_TOKEN may be a read-only one), straight into huggingface_hub (never printed). */
const TOKEN_PY = `import os
def _tok():
    p = os.path.expanduser('~/.config/aether/hf-write.token')
    if os.path.exists(p):
        return open(p).read().strip()
    t = os.environ.get('HF_TOKEN')
    return t.strip() if t else None
`;

/** Python helper run with the venv (huggingface_hub reads the token itself; it is never passed on a command line). */
function py(script: string, args: string[]): { status: number; out: string } {
  const py3 = existsSync(VENV_PY) ? VENV_PY : 'python3';
  const r = spawnSync(py3, ['-I', '-c', script, ...args], { encoding: 'utf8', maxBuffer: 1 << 26, env: { ...process.env } });
  return { status: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
}

function remoteCheck(index: HubIndex): void {
  const cfg = config();
  const r = py(
    `${TOKEN_PY}import sys, json\nfrom huggingface_hub import HfApi\napi = HfApi(token=_tok())\nrepo, rev = sys.argv[1], sys.argv[2]\ninfo = api.dataset_info(repo, revision=rev, files_metadata=True)\nprint(json.dumps({'private': info.private, 'sha': info.sha, 'files': {s.rfilename: [s.size, getattr(getattr(s, 'lfs', None), 'sha256', None)] for s in info.siblings}}))`,
    [cfg.dataset, cfg.revision === 'main' ? 'main' : cfg.revision],
  );
  if (r.status !== 0) { console.error(`remote check failed: ${r.out.split('\n').slice(-1)[0]}`); process.exit(1); }
  const remote = JSON.parse(r.out.split('\n').slice(-1)[0] as string) as { private: boolean; sha: string; files: Record<string, [number, string | null]> };
  const bad: string[] = [];
  for (const row of index.rows) for (const f of Object.values(row.files)) {
    const got = remote.files[f.path];
    if (!got) bad.push(`${f.path}: not on the hub`);
    else if (got[0] !== f.bytes) bad.push(`${f.path}: size ${got[0]} != ${f.bytes}`);
    else if (got[1] && got[1] !== f.sha256) bad.push(`${f.path}: sha256`);
  }
  for (const n of ['index.json', 'index.min.json', 'embeddings.bin', 'embeddings.json', 'README.md', 'credits.csv']) if (!remote.files[n]) bad.push(`${n}: not on the hub`);
  if (bad.length > 0) { console.error(`remote check failed:\n  ${bad.slice(0, 20).join('\n  ')}`); process.exit(1); }
  console.log(`remote ok: ${Object.keys(remote.files).length} files at ${remote.sha.slice(0, 12)}, ${remote.private ? 'private' : 'public'}`);
}

function upload(): void {
  const cfg = config();
  const dest = stageDir();
  if (!existsSync(join(dest, 'index.json'))) throw new Error('nothing staged: run build first');
  const message = arg('message') ?? 'Add models';
  const script = `${TOKEN_PY}
import sys, os, json
from huggingface_hub import HfApi
repo, stage, msg, public, only = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4] == '1', sys.argv[5]
api = HfApi(token=_tok())
if not api.repo_exists(repo, repo_type='dataset'):
    api.create_repo(repo, repo_type='dataset', private=True)
    print('created private repo')
models = sorted(os.listdir(os.path.join(stage, 'models')))
if only:
    want = set(json.load(open(only)))
    models = [m for m in models if m in want]
BATCH = 120
for i in range(0, len(models), BATCH):
    part = models[i:i + BATCH]
    api.upload_folder(repo_id=repo, repo_type='dataset', folder_path=stage, allow_patterns=[f'models/{m}/*' for m in part], commit_message=f'{msg} ({i + 1}-{i + len(part)} of {len(models)})')
    print('batch', i // BATCH + 1, 'of', (len(models) + BATCH - 1) // BATCH)
# The index goes last, so a half-finished upload never points at missing files.
top = ['index.json', 'index.min.json', 'embeddings.bin', 'embeddings.json', 'README.md', 'credits.csv']
ci = api.upload_folder(repo_id=repo, repo_type='dataset', folder_path=stage, allow_patterns=top, commit_message=f'{msg}: index and dataset card')
if public:
    api.update_repo_settings(repo, repo_type='dataset', private=False)
info = api.dataset_info(repo)
print(json.dumps({'sha': info.sha, 'private': info.private}))
`;
  const r = py(script, [cfg.dataset, dest, message, flag('public') ? '1' : '0', arg('only') ?? '']);
  console.log(r.out.split('\n').filter((l) => !/token|hf_[A-Za-z0-9]{8}/i.test(l)).slice(-12).join('\n'));
  if (r.status !== 0) process.exit(1);
  const last = r.out.split('\n').filter((l) => l.startsWith('{')).pop();
  if (last && flag('pin')) {
    const j = JSON.parse(last) as { sha: string; private: boolean };
    const idxHash = sha(readFileSync(join(dest, 'index.min.json')));
    writeFileSync(join(ROOT, 'assets', 'hub.json'), `${JSON.stringify({ ...cfg, revision: j.sha, visibility: j.private ? 'private' : 'public', indexSha256: idxHash }, null, 2)}\n`);
    console.log(`pinned assets/hub.json at ${j.sha.slice(0, 12)}`);
  }
}

const cmd = process.argv.slice(2).find((a) => !a.startsWith('--'));
try {
  if (cmd === 'build') await build();
  else if (cmd === 'verify') await verify();
  else if (cmd === 'upload') upload();
  else {
    console.error('usage: assets:hf -- build | verify [--remote] | upload [--public] [--pin] [--only=<json list of ids>]   (--stage=<dir>)');
    process.exit(1);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
