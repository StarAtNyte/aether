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
import { mergeIntoCatalog } from './creatures';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { NodeIO, type Document, type Material } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { Catalog, type CatalogEntryInput, type CatalogPack } from '../../packages/assets/src/schema';
import { pickRoles } from '../../packages/assets/src/info';
import { readSources, SOURCE_DIR, type PolyhavenRecord } from './fetch';
import { colliderFor, kebab, prettyName, tagsFor } from './describe';
import { hullPoints, isAnimated, normaliseAndMerge, normaliseAnimated, sceneBounds, scenePositions, simplifyDocument } from './process';
import { SELECTION, type ItemSel, type PackSel } from './selection';
import { EXISTING_FACTS, INTERIOR } from './selection-interior';
import { spawnSync } from 'node:child_process';
import { liteHdr } from './hdri';
import { reencodedTextures } from './textures';
import { buildPhotoFinishes, type PhotoFinish } from './materials';

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
async function prepare(nio: NodeIO, path: string, pack: PackSel, opts: NonNullable<ItemSel[2]>, lodRatio: number | null, keepTextures = false): Promise<{ doc: Document; tris: number; size: [number, number, number]; animated: boolean }> {
  const doc = await nio.read(path);
  for (const tex of doc.getRoot().listTextures()) {
    const name = basename(tex.getURI());
    const re = TEXTURES.get(name);
    if (re) {
      const png = re[0] === 0x89;
      tex.setImage(re).setMimeType(png ? 'image/png' : 'image/jpeg').setURI(name.replace(/\.(png|jpe?g)$/i, png ? '.png' : '.jpg'));
    }
  }
  if (opts.rot) {
    // Turn the model so its front faces +Z: a wrapper node carries the rotation into the baked transforms.
    const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]!;
    const half = (opts.rot * Math.PI) / 360;
    const wrap = doc.createNode('turn').setRotation([0, Math.sin(half), 0, Math.cos(half)]);
    for (const child of scene.listChildren()) {
      scene.removeChild(child);
      wrap.addChild(child);
    }
    scene.addChild(wrap);
  }
  if (pack.legacyColors) fixLegacyMaterials(doc);
  if (opts.paint) {
    // The material with the most triangles is the upholstery or paint: name it so entities can recolour it.
    const used = new Map<unknown, number>();
    for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) used.set(p.getMaterial(), (used.get(p.getMaterial()) ?? 0) + (p.getIndices()?.getCount() ?? 0));
    const lead = [...used.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] as Material | null | undefined;
    lead?.setName('paint');
  }
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
    if (!keepTextures) {
      for (const m of doc.getRoot().listMaterials()) m.setBaseColorTexture(null).setNormalTexture(null).setMetallicRoughnessTexture(null).setOcclusionTexture(null).setEmissiveTexture(null);
      for (const t of doc.getRoot().listTextures()) t.dispose();
    }
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

/** Write one photo finish's maps into the library and describe it as a catalog entry. */
function photoFinishEntry(pf: PhotoFinish): Built {
  const id = `finish-${pf.finish}`;
  const albedo = writeLib('x', pf.finish, '.albedo', 'webp', pf.albedo);
  const orm = writeLib('x', pf.finish, '.orm', 'webp', pf.orm);
  const normal = writeLib('x', pf.finish, '.normal', 'webp', pf.normal);
  const albedoLow = writeLib('x', pf.finish, '.albedo.256', 'webp', pf.albedoLow);
  const ormLow = writeLib('x', pf.finish, '.orm.256', 'webp', pf.ormLow);
  const normalLow = writeLib('x', pf.finish, '.normal.256', 'webp', pf.normalLow);
  const thumb = writeLib('t', id, '', 'webp', pf.thumb);
  const label = pf.finish.replace(/-/g, ' ');
  return {
    entry: {
      id,
      name: `${label.charAt(0).toUpperCase()}${label.slice(1)} (photo)`,
      kind: 'material',
      category: 'materials',
      tags: tagsFor(id, label, 'materials', 'pbr texture surface finish', 'realistic'),
      style: 'realistic',
      pack: 'ambientcg',
      size: [0, 0, 0],
      tris: 0,
      bytes: albedo.bytes + orm.bytes + normal.bytes,
      lods: [],
      thumb: thumb.path,
      collider: { type: 'box' },
      placement: 'floor',
      facing: '+z',
      material: { finish: pf.finish, tile: pf.tile, maps: { albedo: albedo.path, orm: orm.path, normal: normal.path }, small: { albedo: albedoLow.path, orm: ormLow.path, normal: normalLow.path } },
      source: pf.source,
    },
    files: [albedo, orm, normal, albedoLow, ormLow, normalLow, thumb],
    source: { archive: pf.source, path: pf.source },
  };
}

/**
 * `--photo-only`: convert the downloaded photo finishes and merge them into the existing catalog and
 * manifest (entries with the same id are replaced; every other asset is left untouched). Needs only
 * `fetch.ts --only=ambientcg`, not the model packs.
 */
async function buildPhotoOnly(): Promise<void> {
  const sources = readSources();
  const photos = (await buildPhotoFinishes(sources.ambientcg)).map(photoFinishEntry);
  const catalogPath = join(OUT, 'catalog.json');
  const manifestPath = join(OUT, 'manifest.json');
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as { entries: CatalogEntryInput[] };
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { sources: Array<{ id: string }>; assets: Array<{ id: string }> };
  const ids = new Set(photos.map((p) => p.entry.id));
  catalog.entries = [...catalog.entries.filter((e) => !ids.has(e.id)), ...photos.map((p) => p.entry)];
  catalog.entries.sort((a, b) => (a.category === b.category ? (a.id < b.id ? -1 : 1) : (a.category ?? '') < (b.category ?? '') ? -1 : 1));
  Catalog.parse(catalog);
  manifest.assets = [...manifest.assets.filter((a) => !ids.has(a.id)), ...photos.map((b) => ({ id: b.entry.id, pack: b.entry.pack, licence: 'CC0-1.0', authors: b.entry.authors ?? null, source: b.source, files: b.files }))];
  const srcIds = new Set((sources.ambientcg?.materials ?? []).map((m) => `ambientcg-${m.id}`));
  manifest.sources = [
    ...manifest.sources.filter((s) => !srcIds.has(s.id)),
    ...(sources.ambientcg?.materials ?? []).map((m) => ({ id: `ambientcg-${m.id}`, provider: 'ambientCG', title: m.id, version: '1K-JPG', author: 'ambientCG (Lennart Demes)', licence: 'CC0-1.0', licenceUrl: 'https://docs.ambientcg.com/license/', page: `https://ambientcg.com/view?id=${m.id}`, archive: `https://ambientcg.com/get?file=${m.id}_1K-JPG.zip`, sha256: m.sha256 ?? null, retrieved: '2026-10-15', usedFor: `finish "${m.finish}"` })),
  ];
  writeFileSync(catalogPath, `${JSON.stringify(catalog)}\n`);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 1)}\n`);
  console.log(`${photos.length} photo finishes merged into the catalog`);
}

/**
 * `--hdri-lite`: add the half-resolution copy to every sky in the existing library (the Poly Haven sources are not
 * needed: the shipped full-size files are the input). Catalog and manifest are patched in place.
 */
function buildHdriLite(): void {
  const catalogPath = join(OUT, 'catalog.json');
  const manifestPath = join(OUT, 'manifest.json');
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as { entries: CatalogEntryInput[] };
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { assets: Array<{ id: string; files: Array<{ path: string; sha256: string; bytes: number }> }> };
  for (const e of catalog.entries) {
    if (e.kind !== 'hdri' || !e.file) continue;
    const lite = writeLib('h', e.id, '.512', 'hdr', liteHdr(readFileSync(join(LIB, e.file))));
    if (e.lite && e.lite !== lite.path) rmSync(join(LIB, e.lite), { force: true });
    e.lite = lite.path;
    const a = manifest.assets.find((x) => x.id === e.id);
    if (a) a.files = [...a.files.filter((f) => !/\.512\./.test(f.path)), lite];
    console.log(`${e.id}: lite ${(lite.bytes / 1024) | 0} KB`);
  }
  Catalog.parse(catalog);
  writeFileSync(catalogPath, `${JSON.stringify(catalog)}\n`);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 1)}\n`);
}

/** Interior models: a triangle budget for the main file and the share of it the one distance level keeps. */
interface Tune {
  budget: number;
  lod: number;
}

async function buildModel(nio: NodeIO, pack: PackSel, item: ItemSel, srcPath: string, archive: string, phAuthors: string[] | undefined, tune?: Tune): Promise<Built> {
  const [file, idOpt, o = {}] = item;
  const id = idOpt ?? kebab(file);
  let main = await prepare(nio, srcPath, pack, o, null);
  const sourceTris = main.tris;
  // Over budget: simplify the main file too (textures kept), so a 170k-triangle plant ships as a plant, not a mesh.
  if (tune && main.tris > tune.budget) main = await prepare(nio, srcPath, pack, o, tune.budget / main.tris, true);
  const lodRatios = tune ? [Math.min(1, (main.tris * tune.lod) / sourceTris)] : LOD_RATIOS;
  const positions = scenePositions(main.doc);
  const clips = main.doc.getRoot().listAnimations().map((a, i) => a.getName() || `clip-${i + 1}`);
  const glb = await encode(nio, main.doc);
  if (glb.byteLength > MAX_MODEL_BYTES) throw new Error(`${id}: ${glb.byteLength} bytes exceeds the per-model cap`);
  const files = [writeLib('m', id, '', 'glb', glb)];
  const lods: Array<{ file: string; tris: number }> = [];
  if (!main.animated && main.tris > (tune ? 1500 : LOD_MIN_TRIS)) {
    let previous = main.tris;
    for (let i = 0; i < lodRatios.length; i++) {
      const lod = await prepare(nio, srcPath, pack, o, lodRatios[i]!);
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
  rmSync(join(LIB, 'x'), { recursive: true, force: true });
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
    const lite = writeLib('h', assetId, '.512', 'hdr', liteHdr(data));
    built.push({
      entry: {
        id: assetId,
        name: rec.name,
        kind: 'hdri',
        category: 'sky',
        // Categories only: Poly Haven's free-form tags describe what is in the photo (chairs, cars…).
        tags: tagsFor(assetId, rec.name, 'sky', ['hdri', 'environment', 'sky', ...rec.categories].join(' '), 'realistic'),
        style: 'realistic',
        pack: 'polyhaven',
        authors: rec.authors,
        size: [0, 0, 0],
        tris: 0,
        bytes: f.bytes,
        file: f.path,
        lite: lite.path,
        lods: [],
        collider: { type: 'box' },
        placement: 'floor',
        source: relative(SOURCE_DIR, src),
      },
      files: [f, lite],
      source: { archive: `polyhaven:${id}`, path: relative(SOURCE_DIR, src) },
    });
  }
  // Photo finishes (ambientCG) for `material.finish` surfaces.
  for (const pf of await buildPhotoFinishes(sources.ambientcg)) built.push(photoFinishEntry(pf));
  const entries = built.map((b) => b.entry);
  assignVariants(entries);
  for (const [id, type, styles] of EXISTING_FACTS) {
    const e = entries.find((x) => x.id === id);
    if (e) e.interior = { type, styles: styles.split(' '), colors: [], rgb: [128, 128, 128] };
  }
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
    { id: 'ambientcg', title: 'ambientCG', author: 'ambientCG (Lennart Demes)', licence: 'CC0-1.0', licenceUrl: 'https://docs.ambientcg.com/license/', url: 'https://ambientcg.com', version: '2026-10-15' },
    { id: 'aether-forge', title: 'Aether forge originals', author: 'Aether (procedural code written with an AI model)', licence: 'MIT', licenceUrl: 'https://opensource.org/license/mit', url: 'https://opensource.org/license/mit', version: '1' },
  ];
  const catalog = Catalog.parse({ version: 1, base: '/assets/lib/', packs, entries: entries.sort((a, b) => (a.category === b.category ? (a.id < b.id ? -1 : 1) : a.category < b.category ? -1 : 1)) });
  writeFileSync(join(OUT, 'catalog.json'), `${JSON.stringify(catalog)}\n`);
  const manifest = {
    $comment: 'Provenance of every shipped library file. Generated by scripts/assets/build.ts — do not edit.',
    licencePolicy: 'Only CC0-1.0 and CC-BY-4.0 assets are accepted; NC, ND, editorial-only, personal-use-only or unclear licences are never shipped.',
    sources: [
      ...sources.packs.map((p) => ({ id: p.id, provider: 'Kenney', title: p.title, version: p.version, author: p.author, licence: p.licence, licenceUrl: p.licenceUrl, page: p.page, archive: p.url, sha256: p.sha256, retrieved: p.retrieved })),
      ...(sources.ambientcg?.materials ?? []).map((m) => ({ id: `ambientcg-${m.id}`, provider: 'ambientCG', title: m.id, version: '1K-JPG', author: 'ambientCG (Lennart Demes)', licence: 'CC0-1.0', licenceUrl: 'https://docs.ambientcg.com/license/', page: `https://ambientcg.com/view?id=${m.id}`, archive: `https://ambientcg.com/get?file=${m.id}_1K-JPG.zip`, sha256: m.sha256 ?? null, retrieved: '2026-10-15', usedFor: `finish "${m.finish}"` })),
      { id: 'polyhaven', provider: 'Poly Haven', title: 'Poly Haven models and HDRIs', author: 'see per-asset authors', licence: 'CC0-1.0', licenceUrl: 'https://polyhaven.com/license', page: 'https://polyhaven.com', archive: 'https://api.polyhaven.com (per-file MD5 verified)', retrieved: '2026-10-14' },
    ],
    assets: built.map((b) => ({ id: b.entry.id, pack: b.entry.pack, licence: 'CC0-1.0', authors: b.entry.authors ?? null, source: b.source, files: b.files })),
  };
  writeFileSync(join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 1)}\n`);
  const total = built.reduce((s, b) => s + b.files.reduce((t, f) => t + f.bytes, 0), 0);
  // First-party and vendored model sets built by their own scripts (animals, vehicles) survive a library rebuild.
  for (const f of ['creatures.json', 'vehicles.json', 'living.json', 'interior.json']) {
    const file = join(OUT, f);
    if (existsSync(file)) mergeIntoCatalog(JSON.parse(readFileSync(file, 'utf8')) as Parameters<typeof mergeIntoCatalog>[0]);
  }
  console.log(`${entries.length} assets, ${(total / 1024 / 1024).toFixed(1)} MB → ${relative(ROOT, LIB)}`);
}

/** Texture tiers for the interior models are resized by `tex_tiers.py` (Pillow) and cached next to the sources. */
const TIER_CACHE = join(SOURCE_DIR, 'polyhaven', 'tiers');
const TIER_SCRIPT = join(ROOT, 'scripts', 'assets', 'tex_tiers.py');

/** Run the Python tier script on a job file; returns its colour report. */
function runTiers(spec: { jobs: Array<{ src: string; dst: string; side: number; quality: number }>; colors: string[]; factors: Record<string, number[]> }): Record<string, { rgb: [number, number, number]; names: string[] }> {
  const jobFile = join(TIER_CACHE, 'job.json');
  mkdirSync(TIER_CACHE, { recursive: true });
  writeFileSync(jobFile, JSON.stringify(spec));
  const r = spawnSync('python3', ['-I', TIER_SCRIPT, jobFile], { encoding: 'utf8', timeout: 120_000, maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`tex_tiers.py failed: ${r.stderr}`);
  return (JSON.parse(r.stdout) as { colors: Record<string, { rgb: [number, number, number]; names: string[] }> }).colors;
}

/** Types whose main surface can be recoloured (upholstery, cushions): the build names that material "paint". */
/** Triangles an interior model's main file may have. */
const INTERIOR_TRIS = 20_000;
/** Large visible pieces keep 1024 px textures; everything else ships 512. */
const BIG_TEXTURE_TYPES: ReadonlySet<string> = new Set(['sofa', 'bed', 'table', 'desk', 'wardrobe', 'armchair', 'sideboard', 'bookshelf', 'dresser']);
const RECOLOUR_TYPES: ReadonlySet<string> = new Set(['sofa', 'armchair', 'ottoman', 'pillow']);

const linToSrgb = (c: number): number => Math.round(255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055));

/**
 * `--interior`: build the Poly Haven interior set (selection-interior.ts) into `assets/interior.json` and merge it into the
 * catalog. Each model ships a main file (512 or 1024 px textures by size, meshopt, LODs) and a `lite` file (256 px
 * textures, simplified) for the low quality tiers. Colour names come from the model's dominant base-colour texture.
 */
async function buildInterior(): Promise<void> {
  const nio = await io();
  const phRecords: PolyhavenRecord[] = JSON.parse(readFileSync(join(SOURCE_DIR, 'polyhaven', 'provenance.json'), 'utf8')) as PolyhavenRecord[];
  const phById = new Map(phRecords.map((r) => [r.id, r]));
  const entries: CatalogEntryInput[] = [];
  const assets: Array<{ id: string; pack: string; licence: string; authors: string[] | null; source: { archive: string; path: string }; files: Built['files'] }> = [];
  const existing = (JSON.parse(readFileSync(join(OUT, 'catalog.json'), 'utf8')) as { entries: CatalogEntryInput[] }).entries;
  const taken = new Set(existing.filter((e) => !e.interior).map((e) => e.id));
  for (const row of INTERIOR) if (taken.has(row[1])) throw new Error(`interior id ${row[1]} clashes with an existing asset`);
  const only = process.argv.find((a) => a.startsWith('--ids='))?.slice(6).split(',');
  if (!only) rmSync(join(LIB, 'i'), { recursive: true, force: true });
  if (only) console.log('partial run: interior.json is not rewritten');
  for (const [phId, id, type, category, styles, name, o = {}] of INTERIOR) {
    if (only && !only.includes(id)) continue;
    const rec = phById.get(phId);
    const src = join(SOURCE_DIR, 'polyhaven', 'models', phId, `${phId}.gltf`);
    if (!rec || !existsSync(src)) throw new Error(`${phId}: not downloaded (npm run assets:fetch -- --only=polyhaven)`);
    const doc = await nio.read(src);
    const b = sceneBounds(doc);
    const big = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) > 1.2;
    const side = o.tex ?? (big && BIG_TEXTURE_TYPES.has(type) ? 1024 : 512);
    // Dominant material: the one with the most triangles; its base-colour texture (or factor) gives the colour names.
    const area = new Map<unknown, number>();
    for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) area.set(p.getMaterial(), (area.get(p.getMaterial()) ?? 0) + (p.getIndices()?.getCount() ?? 0));
    const lead = [...area.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] as Material | null | undefined;
    const texDir = join(SOURCE_DIR, 'polyhaven', 'models', phId);
    const jobs: Parameters<typeof runTiers>[0]['jobs'] = [];
    const files = new Map<string, string>();
    for (const t of doc.getRoot().listTextures()) {
      const uri = decodeURIComponent(t.getURI());
      const from = join(texDir, uri);
      files.set(basename(uri), from);
      for (const [tier, px] of [[`main${side}`, side], ['lite', 256]] as const) jobs.push({ src: from, dst: join(TIER_CACHE, tier, phId, basename(uri).replace(/\.\w+$/, '.img')), side: px, quality: px === 256 ? 70 : 78 });
    }
    const leadTex = lead?.getBaseColorTexture();
    const colorKey = leadTex ? files.get(basename(decodeURIComponent(leadTex.getURI()))) : undefined;
    const f = lead?.getBaseColorFactor() ?? [0.5, 0.5, 0.5, 1];
    const report = runTiers({ jobs, colors: colorKey ? [colorKey] : [], factors: colorKey ? {} : { lead: [linToSrgb(f[0]!), linToSrgb(f[1]!), linToSrgb(f[2]!)] } });
    const look = report[colorKey ?? 'lead'] ?? { rgb: [128, 128, 128] as [number, number, number], names: ['grey'] };
    // The Python script writes `.jpg` or `.png` after checking transparency; find what it wrote.
    const tierTextures = (tier: string): Map<string, Uint8Array> => {
      const m = new Map<string, Uint8Array>();
      for (const base of files.keys()) {
        const stem = join(TIER_CACHE, tier, phId, base.replace(/\.\w+$/, '.img'));
        m.set(base, readFileSync(stem));
      }
      return m;
    };
    const paint = RECOLOUR_TYPES.has(type) && !!lead;
    const pack: PackSel = { pack: 'polyhaven', scale: 1, style: 'realistic', category, collider: o.collider ?? 'box', items: [] };
    TEXTURES = tierTextures(`main${side}`);
    const built = await buildModel(nio, pack, [phId, id, { name, cat: category, tags: `${type} ${o.tags ?? ''} ${styles}`, ...(o.place ? { place: o.place } : {}), ...(o.collider ? { collider: o.collider } : {}), ...(o.h ? { h: o.h } : {}), ...(o.rot ? { rot: o.rot } : {}), ...(paint ? { paint: true } : {}) }], src, `polyhaven:${phId}`, rec.authors, { budget: INTERIOR_TRIS, lod: 0.4 });
    TEXTURES = tierTextures('lite');
    // The light copy: a quarter of the main budget at most, 256 px textures.
    const probe = await prepare(nio, src, pack, { ...(o.h ? { h: o.h } : {}), ...(o.rot ? { rot: o.rot } : {}), ...(paint ? { paint: true } : {}) }, null);
    const lite = probe.tris > INTERIOR_TRIS / 4 ? await prepare(nio, src, pack, { ...(o.h ? { h: o.h } : {}), ...(o.rot ? { rot: o.rot } : {}), ...(paint ? { paint: true } : {}) }, INTERIOR_TRIS / 4 / probe.tris, true) : probe;
    const liteFile = writeLib('i', id, '.lite', 'glb', await encode(nio, lite.doc));
    // buildModel writes under `m/`, which a full rebuild clears: move the interior files to `i/`.
    const moved = built.files.map((x) => relocate(x));
    const e = built.entry;
    e.file = moved[0]!.path;
    e.lods = (e.lods ?? []).map((l, k) => ({ ...l, file: moved[k + 1]!.path }));
    e.lite = liteFile.path;
    e.interior = { type, styles: styles.split(' ').slice(0, 6), colors: look.names.slice(0, 4), rgb: look.rgb, ...(paint ? { paint: true } : {}) };
    e.bytes = moved.reduce((s, x) => s + x.bytes, 0);
    entries.push(e);
    assets.push({ id, pack: 'polyhaven', licence: 'CC0-1.0', authors: rec.authors, source: built.source, files: [...moved, liteFile] });
    console.log(`${id}: ${e.tris} tris, ${(e.bytes / 1024) | 0} KB main, ${(liteFile.bytes / 1024) | 0} KB lite, ${look.names.join('/')}`);
  }
  // Variants: the other models of the same interior type (up to 12).
  for (const e of entries) e.variants = entries.filter((x) => x !== e && x.interior!.type === e.interior!.type).map((x) => x.id).slice(0, 12);
  if (entries.length === 0) throw new Error('no interior entries built');
  const file = {
    packs: [] as Array<Record<string, unknown>>,
    sources: [] as Array<{ id: string }>,
    entries,
    assets,
  };
  // Models dropped from the selection since the last run leave the catalog and the manifest too.
  if (!only && existsSync(join(OUT, 'interior.json'))) {
    const now = new Set(entries.map((e) => e.id));
    const stale = new Set((JSON.parse(readFileSync(join(OUT, 'interior.json'), 'utf8')) as { entries: Array<{ id: string }> }).entries.map((e) => e.id).filter((id) => !now.has(id)));
    if (stale.size > 0) {
      const cp = join(OUT, 'catalog.json');
      const mp = join(OUT, 'manifest.json');
      const cat = JSON.parse(readFileSync(cp, 'utf8')) as { entries: Array<{ id: string }> };
      const man = JSON.parse(readFileSync(mp, 'utf8')) as { assets: Array<{ id: string }> };
      cat.entries = cat.entries.filter((e) => !stale.has(e.id));
      man.assets = man.assets.filter((a) => !stale.has(a.id));
      writeFileSync(cp, `${JSON.stringify(cat)}\n`);
      writeFileSync(mp, `${JSON.stringify(man, null, 1)}\n`);
    }
  }
  if (!only) writeFileSync(join(OUT, 'interior.json'), `${JSON.stringify(file)}\n`);
  mergeIntoCatalog(file);
  // Earlier realistic models get the same facts, so the finder ranks them with the new ones.
  const cat = JSON.parse(readFileSync(join(OUT, 'catalog.json'), 'utf8')) as { entries: CatalogEntryInput[] };
  for (const [id, type, styles] of EXISTING_FACTS) {
    const e = cat.entries.find((x) => x.id === id);
    if (e) e.interior = { type, styles: styles.split(' '), colors: [], rgb: [128, 128, 128] };
  }
  Catalog.parse(cat);
  writeFileSync(join(OUT, 'catalog.json'), `${JSON.stringify(cat)}\n`);
}

/** Move a file written to `m/` into `i/` (same name and hash). */
function relocate(f: { path: string; sha256: string; bytes: number }): { path: string; sha256: string; bytes: number } {
  const to = `i/${f.path.slice(2)}`;
  mkdirSync(join(LIB, 'i'), { recursive: true });
  renameSync(join(LIB, f.path), join(LIB, to));
  return { ...f, path: to };
}

(process.argv.includes('--interior') ? buildInterior() : process.argv.includes('--hdri-lite') ? Promise.resolve(buildHdriLite()) : process.argv.includes('--photo-only') ? buildPhotoOnly() : main()).catch((err: unknown) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});
