/**
 * Build the asset library from the downloaded sources (see `fetch.ts`):
 *
 *   npm run assets:fetch   # once: download + verify the CC0 sources
 *   npm run assets:build   # normalise, merge, LOD, compress, colliders, catalog
 *   npm run assets:thumbs  # render thumbnails (one headless Chromium)
 *
 * Output (all tracked):
 * - `assets/lib/m/<id>.<hash>.glb` (+ `.lod1` / `.lod2`), `assets/lib/h/<id>.<hash>.hdr`
 * - `assets/catalog.json` — what the app reads (schema: @aether/assets `Catalog`)
 * - `assets/manifest.json` — provenance: source archive + checksum, file
 *   inside it, licence, authors and output checksums for every asset.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { NodeIO, type Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { Catalog, type CatalogEntryInput, type CatalogPack } from '../../packages/assets/src/schema';
import { pickRoles } from '../../packages/assets/src/info';
import { readSources, SOURCE_DIR, type PolyhavenRecord } from './fetch';
import { colliderFor, kebab, prettyName, tagsFor } from './describe';
import { hullPoints, isAnimated, normaliseAndMerge, normaliseAnimated, sceneBounds, scenePositions, simplifyDocument } from './process';
import { SELECTION, type ItemSel, type PackSel } from './selection';
import { reencodedTextures } from './textures';

/** Re-encoded realistic textures by source basename (see textures.ts). */
let TEXTURES = new Map<string, Uint8Array>();

const ROOT = resolve(import.meta.dirname, '../..');
const OUT = join(ROOT, 'assets');
const LIB = join(OUT, 'lib');
/** Models above this many triangles get LOD files. */
const LOD_MIN_TRIS = 3000;
const LOD_RATIOS: readonly number[] = [0.5, 0.15];
/** Refuse to ship a single model above this size. */
const MAX_MODEL_BYTES = 6 * 1024 * 1024;

const sha = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex');

function findFile(dir: string, name: string): string | null {
  if (!existsSync(dir)) return null;
  const stack = [dir];
  const hits: string[] = [];
  while (stack.length > 0) {
    const d = stack.pop()!;
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) stack.push(p);
      else if (f === name) hits.push(p);
    }
  }
  hits.sort((a, b) => a.length - b.length || (a < b ? -1 : 1));
  return hits[0] ?? null;
}

interface Built {
  entry: CatalogEntryInput;
  files: Array<{ path: string; sha256: string; bytes: number }>;
  source: { archive: string; path: string };
}

async function io(): Promise<NodeIO> {
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
}

/** Read, normalise and (optionally) simplify one source model. */
async function prepare(nio: NodeIO, path: string, pack: PackSel, opts: NonNullable<ItemSel[2]>, lodRatio: number | null): Promise<{ doc: Document; tris: number; size: [number, number, number]; animated: boolean }> {
  const doc = await nio.read(path);
  for (const tex of doc.getRoot().listTextures()) {
    const name = basename(tex.getURI());
    const re = TEXTURES.get(name);
    if (re) tex.setImage(re).setMimeType('image/jpeg').setURI(name.replace(/\.png$/i, '.jpg'));
  }
  if (pack.legacyColors) fixLegacyMaterials(doc);
  const b = sceneBounds(doc);
  const sx = b.max[0] - b.min[0];
  const sy = b.max[1] - b.min[1];
  const sz = b.max[2] - b.min[2];
  let scale = pack.scale;
  if (opts.h !== undefined && sy > 1e-6) scale = opts.h / sy;
  else if (opts.w !== undefined && Math.max(sx, sz) > 1e-6) scale = opts.w / Math.max(sx, sz);
  const offset: [number, number, number] = [-((b.min[0] + b.max[0]) / 2) * scale, -b.min[1] * scale, -((b.min[2] + b.max[2]) / 2) * scale];
  const animated = isAnimated(doc);
  const flip = facesBackward(opts.cat ?? pack.category);
  let tris = animated ? normaliseAnimated(doc, scale, offset, flip) : normaliseAndMerge(doc, scale, offset, flip);
  if (lodRatio !== null && !animated) {
    tris = await simplifyDocument(doc, lodRatio);
    // LOD files are geometry only: the renderer reuses LOD 0's materials (same primitive order), so textures ship once.
    for (const m of doc.getRoot().listMaterials()) m.setBaseColorTexture(null).setNormalTexture(null).setMetallicRoughnessTexture(null).setOcclusionTexture(null).setEmissiveTexture(null);
    for (const t of doc.getRoot().listTextures()) t.dispose();
  }
  const r = (v: number): number => Math.round(v * scale * 1000) / 1000;
  return { doc, tris, size: [r(sx), r(sy), r(sz)], animated };
}

/** Short, descriptive ids for the HDR skies (Poly Haven names are long). */
const HDRI_IDS: Readonly<Record<string, string>> = {
  kloofendal_48d_partly_cloudy_puresky: 'sky-partly-cloudy',
  venice_sunset: 'sky-venice-sunset',
  lebombo: 'sky-sunny-interior',
  moonlit_golf: 'sky-moonlit',
  brown_photostudio_02: 'sky-photo-studio',
};

/** Movers (characters, animals, vehicles) are turned to face −Z, the engine's forward axis. */
const facesBackward = (category: string): boolean => category === 'characters' || category === 'animals' || category === 'vehicles';

const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** See `PackSel.legacyColors`. */
function fixLegacyMaterials(doc: Document): void {
  for (const m of doc.getRoot().listMaterials()) {
    if (m.getBaseColorTexture()) continue;
    const [r, g, b, a] = m.getBaseColorFactor();
    m.setBaseColorFactor([srgbToLinear(r), srgbToLinear(g), srgbToLinear(b), a]);
    const metal = /metal|chrome|steel|iron|silver/i.test(m.getName());
    m.setMetallicFactor(metal ? 0.65 : 0).setRoughnessFactor(metal ? 0.4 : /glass/i.test(m.getName()) ? 0.15 : 0.85);
  }
}

async function encode(nio: NodeIO, doc: Document): Promise<Uint8Array> {
  const plain = await nio.writeBinary(doc);
  try {
    const copy = await nio.readBinary(plain);
    copy.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
    const packed = await nio.writeBinary(copy);
    return packed.byteLength < plain.byteLength ? packed : plain;
  } catch {
    // A few source files have index layouts meshopt cannot encode: ship those uncompressed.
    return plain;
  }
}

function writeLib(dir: string, id: string, suffix: string, ext: string, data: Uint8Array): { path: string; sha256: string; bytes: number } {
  const h = sha(data);
  const rel = `${dir}/${id}${suffix}.${h.slice(0, 8)}.${ext}`;
  mkdirSync(join(LIB, dir), { recursive: true });
  writeFileSync(join(LIB, rel), data);
  return { path: rel, sha256: h, bytes: data.byteLength };
}

async function buildModel(nio: NodeIO, pack: PackSel, item: ItemSel, srcPath: string, archive: string, phAuthors: string[] | undefined): Promise<Built> {
  const [file, idOpt, o = {}] = item;
  const id = idOpt ?? kebab(file);
  const main = await prepare(nio, srcPath, pack, o, null);
  const positions = scenePositions(main.doc);
  const clips = main.doc.getRoot().listAnimations().map((a, i) => a.getName() || `clip-${i + 1}`);
  const glb = await encode(nio, main.doc);
  if (glb.byteLength > MAX_MODEL_BYTES) throw new Error(`${id}: ${glb.byteLength} bytes exceeds the per-model cap`);
  const files = [writeLib('m', id, '', 'glb', glb)];
  const lods: Array<{ file: string; tris: number }> = [];
  if (!main.animated && main.tris > LOD_MIN_TRIS) {
    let previous = main.tris;
    for (let i = 0; i < LOD_RATIOS.length; i++) {
      const lod = await prepare(nio, srcPath, pack, o, LOD_RATIOS[i]!);
      // A level that barely simplifies is not worth a download.
      if (lod.tris > previous * 0.8) break;
      const f = writeLib('m', id, `.lod${i + 1}`, 'glb', await encode(nio, lod.doc));
      files.push(f);
      lods.push({ file: f.path, tris: lod.tris });
      previous = lod.tris;
    }
  }
  const category = o.cat ?? pack.category;
  const kind = o.collider ?? pack.collider;
  const name = o.name ?? prettyName(file);
  const entry: CatalogEntryInput = {
    id,
    name,
    kind: 'model',
    category,
    tags: tagsFor(id, name, category, o.tags ?? '', pack.style),
    style: pack.style,
    pack: pack.pack,
    size: main.size,
    tris: main.tris,
    bytes: files.reduce((s, f) => s + f.bytes, 0),
    file: files[0]!.path,
    lods,
    collider: colliderFor(kind, positions, hullPoints),
    placement: o.place ?? 'floor',
    facing: facesBackward(category) ? '-z' : '+z',
    source: relative(SOURCE_DIR, srcPath),
  };
  if (phAuthors) entry.authors = phAuthors;
  if (clips.length > 0) entry.anims = { ...pickRoles(clips), clips: clips.slice(0, 48) };
  return { entry, files, source: { archive, path: relative(SOURCE_DIR, srcPath) } };
}

/** Group look-alike ids (same first word, same category) as variants of each other. */
function assignVariants(entries: CatalogEntryInput[]): void {
  const families = new Map<string, CatalogEntryInput[]>();
  for (const e of entries) {
    if (e.kind !== 'model') continue;
    const key = `${e.category}|${e.id.split('-')[0]}`;
    const list = families.get(key) ?? [];
    list.push(e);
    families.set(key, list);
  }
  for (const list of families.values()) {
    if (list.length < 2) continue;
    for (const e of list) e.variants = list.filter((x) => x !== e).map((x) => x.id).slice(0, 12);
  }
}

/** Hero generator records written by forge-heroes.ts (empty when none were made). */
function readHeroes(): Array<{ id: string; name: string; category: CatalogEntryInput['category']; keywords: string[]; size: [number, number, number]; thumb: string }> {
  const path = join(OUT, 'heroes.json');
  if (!existsSync(path)) return [];
  const raw = JSON.parse(readFileSync(path, 'utf8')) as { heroes?: unknown };
  return Array.isArray(raw.heroes) ? (raw.heroes as ReturnType<typeof readHeroes>) : [];
}

async function main(): Promise<void> {
  const sources = readSources();
  const nio = await io();
  rmSync(join(LIB, 'm'), { recursive: true, force: true });
  rmSync(join(LIB, 'h'), { recursive: true, force: true });
  const phRecords: PolyhavenRecord[] = JSON.parse(readFileSync(join(SOURCE_DIR, 'polyhaven', 'provenance.json'), 'utf8')) as PolyhavenRecord[];
  const phById = new Map(phRecords.map((r) => [r.id, r]));
  const phTextures: string[] = [];
  for (const pack of SELECTION) {
    if (pack.pack !== 'polyhaven') continue;
    for (const [file] of pack.items) {
      const dir = join(SOURCE_DIR, 'polyhaven', 'models', file, 'textures');
      if (existsSync(dir)) for (const f of readdirSync(dir)) if (/\.(jpe?g|png)$/i.test(f)) phTextures.push(join(dir, f));
    }
  }
  TEXTURES = await reencodedTextures(phTextures);
  const built: Built[] = [];
  const ids = new Set<string>();
  for (const pack of SELECTION) {
    const meta = sources.packs.find((p) => p.id === pack.pack);
    for (const item of pack.items) {
      const [file, idOpt] = item;
      const id = idOpt ?? kebab(file);
      if (ids.has(id)) throw new Error(`duplicate asset id ${id}`);
      ids.add(id);
      let path: string | null;
      let archive: string;
      let authors: string[] | undefined;
      if (pack.pack === 'polyhaven') {
        const rec = phById.get(file);
        if (!rec) throw new Error(`${file}: not downloaded`);
        path = join(SOURCE_DIR, 'polyhaven', 'models', file, `${file}.gltf`);
        archive = `polyhaven:${file}`;
        authors = rec.authors;
      } else {
        if (!meta) throw new Error(`${pack.pack}: not in sources.json`);
        path = findFile(join(SOURCE_DIR, 'kenney', pack.pack.replace(/^kenney-/, '')), `${file}.glb`);
        archive = meta.url;
      }
      if (!path || !existsSync(path)) throw new Error(`${pack.pack}/${file}: source file not found`);
      const b = await buildModel(nio, pack, item, path, archive, authors);
      built.push(b);
      process.stdout.write(`${b.entry.id} (${b.entry.tris} tris, ${(b.entry.bytes ?? 0) / 1024 | 0} KB)\n`);
    }
  }
  // HDRIs.
  for (const id of sources.polyhaven.hdris) {
    const rec = phById.get(id);
    if (!rec) throw new Error(`${id}: HDRI not downloaded`);
    const src = join(SOURCE_DIR, 'polyhaven', 'hdris', rec.files[0]!.path);
    const data = readFileSync(src);
    const assetId = HDRI_IDS[id] ?? `sky-${kebab(id)}`.slice(0, 64);
    const f = writeLib('h', assetId, '', 'hdr', data);
    built.push({
      entry: {
        id: assetId,
        name: rec.name,
        kind: 'hdri',
        category: 'sky',
        tags: tagsFor(assetId, rec.name, 'sky', [...rec.categories, ...rec.tags].join(' '), 'realistic'),
        style: 'realistic',
        pack: 'polyhaven',
        authors: rec.authors,
        size: [0, 0, 0],
        tris: 0,
        bytes: f.bytes,
        file: f.path,
        lods: [],
        collider: { type: 'box' },
        placement: 'floor',
        source: relative(SOURCE_DIR, src),
      },
      files: [f],
      source: { archive: `polyhaven:${id}`, path: relative(SOURCE_DIR, src) },
    });
  }
  const entries = built.map((b) => b.entry);
  assignVariants(entries);
  // Hero generators made with the asset forge (scripts/assets/forge-heroes.ts).
  for (const h of readHeroes()) {
    if (ids.has(h.id)) throw new Error(`duplicate asset id ${h.id}`);
    entries.push({
      id: h.id,
      name: h.name,
      kind: 'generator',
      category: h.category,
      tags: tagsFor(h.id, h.name, h.category, h.keywords.join(' '), 'stylised'),
      style: 'stylised',
      pack: 'aether-forge',
      size: h.size,
      tris: 0,
      bytes: 0,
      lods: [],
      ...(existsSync(join(LIB, h.thumb)) ? { thumb: h.thumb } : {}),
      collider: { type: 'box' },
      placement: 'floor',
      facing: '+z',
      generator: { id: h.id, params: {} },
      source: `packages/procgen/library/${h.id}.json`,
    });
  }
  // Keep thumbnails from a previous thumbnail pass when the model is unchanged.
  const previous = existsSync(join(OUT, 'catalog.json')) ? (JSON.parse(readFileSync(join(OUT, 'catalog.json'), 'utf8')) as { entries?: Array<{ id: string; file?: string; thumb?: string }> }) : {};
  const prevThumb = new Map((previous.entries ?? []).filter((e) => e.thumb && e.file).map((e) => [`${e.id}|${e.file}`, e.thumb!]));
  for (const e of entries) {
    const t = prevThumb.get(`${e.id}|${e.file}`);
    if (t && existsSync(join(LIB, t))) e.thumb = t;
  }
  const packs: CatalogPack[] = [
    ...sources.packs.map((p) => ({ id: p.id, title: `Kenney ${p.title}`, author: p.author, licence: 'CC0-1.0' as const, licenceUrl: p.licenceUrl, url: p.page, version: p.version })),
    { id: 'polyhaven', title: 'Poly Haven', author: 'Poly Haven contributors', licence: 'CC0-1.0', licenceUrl: 'https://polyhaven.com/license', url: 'https://polyhaven.com', version: '2026-10-14' },
    { id: 'aether-forge', title: 'Aether forge originals', author: 'Aether (procedural code written with an AI model)', licence: 'MIT', licenceUrl: 'https://opensource.org/license/mit', url: 'https://opensource.org/license/mit', version: '1' },
  ];
  const catalog = Catalog.parse({ version: 1, base: '/assets/lib/', packs, entries: entries.sort((a, b) => (a.category === b.category ? (a.id < b.id ? -1 : 1) : a.category < b.category ? -1 : 1)) });
  writeFileSync(join(OUT, 'catalog.json'), `${JSON.stringify(catalog)}\n`);
  const manifest = {
    $comment: 'Provenance of every shipped library file. Generated by scripts/assets/build.ts — do not edit.',
    licencePolicy: 'Only CC0-1.0 and CC-BY-4.0 assets are accepted; NC, ND, editorial-only, personal-use-only or unclear licences are never shipped.',
    sources: [
      ...sources.packs.map((p) => ({ id: p.id, provider: 'Kenney', title: p.title, version: p.version, author: p.author, licence: p.licence, licenceUrl: p.licenceUrl, page: p.page, archive: p.url, sha256: p.sha256, retrieved: p.retrieved })),
      { id: 'polyhaven', provider: 'Poly Haven', title: 'Poly Haven models and HDRIs', author: 'see per-asset authors', licence: 'CC0-1.0', licenceUrl: 'https://polyhaven.com/license', page: 'https://polyhaven.com', archive: 'https://api.polyhaven.com (per-file MD5 verified)', retrieved: '2026-10-14' },
    ],
    assets: built.map((b) => ({ id: b.entry.id, pack: b.entry.pack, licence: 'CC0-1.0', authors: b.entry.authors ?? null, source: b.source, files: b.files })),
  };
  writeFileSync(join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 1)}\n`);
  const total = built.reduce((s, b) => s + b.files.reduce((t, f) => t + f.bytes, 0), 0);
  console.log(`${entries.length} assets, ${(total / 1024 / 1024).toFixed(1)} MB → ${relative(ROOT, LIB)}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});
