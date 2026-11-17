/**
 * The rugs and display furniture of the Rug Exhibition Hall, made procedurally (MIT, first-party): thirteen rugs whose
 * designs are painted knot by knot in Python (`designs.py`, `rugkit.py`) and modelled in Blender (`blender_build.py`),
 * plus an oak display table and an oak-topped display plinth.
 *
 *   npx tsx scripts/assets/rugs/build.ts              # textures + Blender + thumbnails, then library files and catalog
 *   npx tsx scripts/assets/rugs/build.ts --no-make    # only copy an existing work folder into the library
 *   npm run assets:ktx2 -- --only=models              # then the KTX2 twins (the hosted build ships the twins)
 *
 * Needs python3 with numpy, Pillow and scipy, and Blender 4.2 (`AETHER_BLENDER`, else ~/tools/blender-* or `blender`).
 * Everything runs on the CPU (CUDA_VISIBLE_DEVICES is emptied, Cycles renders the thumbnails on the CPU). The work
 * folder is `~/.cache/aether-asset-src/rugs` (`AETHER_RUGS_WORK` overrides it).
 *
 * Library frame: metres, Y up, base on y = 0, centred on X / Z. Rugs lie flat, width along X, length along Z, the
 * top of the design towards -Z (hang a rug with local +Z pointing down and it reads upright, its fringe at the bottom).
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { CatalogEntryInput } from '../../../packages/assets/src/schema';
import { mergeIntoCatalog } from '../creatures';

const ROOT = resolve(import.meta.dirname, '../../..');
const HERE = import.meta.dirname;
const LIB = join(ROOT, 'assets', 'lib');
const WORK = process.env['AETHER_RUGS_WORK'] ?? join(homedir(), '.cache', 'aether-asset-src', 'rugs');
const PACK = 'aether-rugs';
const SOURCE = 'scripts/assets/rugs/build.ts';

interface Item {
  id: string;
  name: string;
  category: 'decor' | 'furniture';
  tags: string[];
  type: string;
  styles: string[];
  colors: string[];
}

/**
 * Catalog facts of every asset (the ids, sizes and design notes live in specs.py / designs.py). The interior types are
 * specific (`persian-rug`, `modern-rug`, `flatweave-rug`, `rug-runner`): these are 4096 px showroom pieces, so a plain
 * "rug" in a planned room keeps the light procedural rug part.
 */
const ITEMS: Item[] = [
  { id: 'rug-vinton-teal', name: 'Vinton Persian rug, teal', category: 'decor', tags: ['rug', 'carpet', 'persian', 'medallion', 'teal', 'ivory', 'wool', 'fringe', 'oriental'], type: 'persian-rug', styles: ['traditional', 'persian'], colors: ['teal', 'ivory', 'rust'] },
  { id: 'rug-vinton-rust', name: 'Vinton Persian rug, rust', category: 'decor', tags: ['rug', 'carpet', 'persian', 'herati', 'rust', 'terracotta', 'antique', 'wool', 'fringe', 'oriental'], type: 'persian-rug', styles: ['traditional', 'persian'], colors: ['rust', 'navy', 'cream'] },
  { id: 'rug-motion-denim', name: 'Motion modern rug, denim', category: 'decor', tags: ['rug', 'carpet', 'modern', 'abstract', 'brushstroke', 'denim', 'blue', 'tufted', 'wool'], type: 'modern-rug', styles: ['modern', 'contemporary'], colors: ['blue', 'ivory'] },
  { id: 'rug-motion-marine', name: 'Motion modern rug, marine', category: 'decor', tags: ['rug', 'carpet', 'modern', 'abstract', 'wave', 'marine', 'blue', 'sand', 'tufted', 'wool'], type: 'modern-rug', styles: ['modern', 'contemporary', 'coastal'], colors: ['navy', 'blue', 'beige'] },
  { id: 'rug-heriz-runner', name: 'Heriz runner, teal', category: 'decor', tags: ['rug', 'runner', 'hall', 'heriz', 'persian', 'geometric', 'teal', 'red', 'wool', 'fringe'], type: 'rug-runner', styles: ['traditional', 'persian'], colors: ['teal', 'red', 'ivory'] },
  { id: 'rug-tabriz-runner', name: 'Tabriz runner, cream', category: 'decor', tags: ['rug', 'runner', 'hall', 'tabriz', 'persian', 'floral', 'cream', 'gold', 'wool', 'fringe'], type: 'rug-runner', styles: ['traditional', 'persian'], colors: ['cream', 'gold', 'pink'] },
  { id: 'rug-isfahan-wall', name: 'Isfahan wall rug, teal', category: 'decor', tags: ['rug', 'carpet', 'tapestry', 'wall', 'isfahan', 'persian', 'silk', 'teal', 'ivory', 'fringe'], type: 'persian-rug', styles: ['traditional', 'persian'], colors: ['ivory', 'teal', 'gold'] },
  { id: 'rug-motion-wall-denim', name: 'Motion wall rug, denim', category: 'decor', tags: ['rug', 'tapestry', 'wall', 'modern', 'abstract', 'brushstroke', 'denim', 'blue', 'tufted'], type: 'modern-rug', styles: ['modern', 'contemporary'], colors: ['blue', 'ivory'] },
  { id: 'rug-farmhouse-border', name: 'Farmhouse border rug, navy', category: 'decor', tags: ['rug', 'carpet', 'flatweave', 'kilim', 'border', 'farmhouse', 'navy', 'cream', 'reversible', 'wool'], type: 'flatweave-rug', styles: ['farmhouse', 'scandinavian'], colors: ['cream', 'navy'] },
  { id: 'rug-kashan-heirloom', name: 'Kashan heirloom rug, rust', category: 'decor', tags: ['rug', 'carpet', 'kashan', 'persian', 'medallion', 'antique', 'heirloom', 'rust', 'indigo', 'fringe'], type: 'persian-rug', styles: ['traditional', 'persian'], colors: ['rust', 'navy', 'ivory'] },
  { id: 'rug-farmhouse-stripe', name: 'Farmhouse stripe rug, navy', category: 'decor', tags: ['rug', 'carpet', 'flatweave', 'stripe', 'striped', 'farmhouse', 'navy', 'undyed', 'reversible', 'wool'], type: 'flatweave-rug', styles: ['farmhouse', 'coastal'], colors: ['cream', 'navy'] },
  { id: 'rug-mahal-wall', name: 'Mahal wall rug, rust', category: 'decor', tags: ['rug', 'carpet', 'wall', 'mahal', 'persian', 'floral', 'rust', 'blue', 'vegetable', 'fringe'], type: 'persian-rug', styles: ['traditional', 'persian'], colors: ['rust', 'blue', 'cream'] },
  { id: 'rug-motion-wall-marine', name: 'Motion wall rug, marine', category: 'decor', tags: ['rug', 'tapestry', 'wall', 'modern', 'abstract', 'wave', 'marine', 'blue', 'sand', 'tufted'], type: 'modern-rug', styles: ['modern', 'coastal'], colors: ['navy', 'blue', 'beige'] },
  { id: 'display-table-oak', name: 'Gallery display table, oak', category: 'furniture', tags: ['table', 'display', 'gallery', 'shop', 'showroom', 'oak', 'wood', 'long', 'exhibition'], type: 'display-table', styles: ['modern', 'scandinavian'], colors: ['light-brown'] },
  { id: 'display-plinth-oak', name: 'Gallery display plinth, oak top', category: 'furniture', tags: ['plinth', 'platform', 'podium', 'display', 'gallery', 'showroom', 'oak', 'wood', 'exhibition', 'low'], type: 'plinth', styles: ['modern', 'gallery'], colors: ['dark-brown', 'light-brown'] },
];

function blender(): string {
  const env = process.env['AETHER_BLENDER'];
  if (env) return env;
  const tools = join(homedir(), 'tools');
  if (existsSync(tools)) {
    const d = readdirSync(tools).filter((n) => /^blender-\d/.test(n) && existsSync(join(tools, n, 'blender'))).sort().pop();
    if (d) return join(tools, d, 'blender');
  }
  return 'blender';
}

function run(cmd: string, args: string[]): void {
  const env = { ...process.env, CUDA_VISIBLE_DEVICES: '', OMP_NUM_THREADS: '6' };
  const r = spawnSync('nice', ['-n', '10', cmd, ...args], { stdio: 'inherit', env });
  if (r.status !== 0) throw new Error(`${cmd} ${args.slice(0, 3).join(' ')} failed (${r.status})`);
}

const sha = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex');

/** Copy a work file into the library under a content-hashed name, removing older copies of the same stem. */
function ship(src: string, dir: string, stem: string, ext: string): { rel: string; hash: string; bytes: number } {
  const data = new Uint8Array(readFileSync(src));
  const h = sha(data);
  const out = join(LIB, dir);
  mkdirSync(out, { recursive: true });
  const re = new RegExp(`^${stem.replace(/\./g, '\\.')}\\.[0-9a-f]{8}\\.${ext}$`);
  for (const f of readdirSync(out)) if (re.test(f)) unlinkSync(join(out, f));
  const name = `${stem}.${h.slice(0, 8)}.${ext}`;
  copyFileSync(src, join(out, name));
  return { rel: `${dir}/${name}`, hash: h, bytes: data.byteLength };
}

/** Mean colour of a preview / thumbnail PNG, via Python (no image decoder in this script). */
function meanRgb(png: string): [number, number, number] {
  const r = spawnSync('python3', ['-c', 'import sys;from PIL import Image;import numpy as n;a=n.asarray(Image.open(sys.argv[1]).convert("RGBA")).reshape(-1,4).astype(float);a=a[a[:,3]>200];print(*[int(round(x)) for x in a[:,:3].mean(0)])', png], { encoding: 'utf8' });
  const v = r.stdout.trim().split(/\s+/).map(Number);
  return [v[0] ?? 128, v[1] ?? 128, v[2] ?? 128];
}

function main(): void {
  mkdirSync(WORK, { recursive: true });
  if (!process.argv.includes('--no-make')) {
    run('python3', [join(HERE, 'textures.py'), WORK]);
    const b = blender();
    run(b, ['-b', '--factory-startup', '-t', '6', '--python-exit-code', '1', '-P', join(HERE, 'blender_build.py'), '--', WORK]);
    run(b, ['-b', '--factory-startup', '-t', '6', '--python-exit-code', '1', '-P', join(HERE, 'blender_render.py'), '--', WORK, join(WORK, 'renders'), 'thumbs']);
  }
  const entries: CatalogEntryInput[] = [];
  const assets: Array<{ id: string; pack: string; licence: string; authors: null; source: { archive: string; path: string }; files: Array<{ path: string; sha256: string; bytes: number }> }> = [];
  for (const it of ITEMS) {
    const info = JSON.parse(readFileSync(join(WORK, `${it.id}.build.json`), 'utf8')) as { size: [number, number, number]; tris: number; bytes: number };
    const main = ship(join(WORK, `${it.id}.glb`), 'm', it.id, 'glb');
    const lite = ship(join(WORK, `${it.id}.lite.glb`), 'm', `${it.id}.lite`, 'glb');
    // 192 px WebP thumbnail from the Cycles render
    const thumbWebp = join(WORK, `${it.id}.thumb.webp`);
    const conv = spawnSync('python3', ['-c', 'import sys;from PIL import Image;Image.open(sys.argv[1]).convert("RGBA").resize((192,192),Image.LANCZOS).save(sys.argv[2],quality=82,method=6)', join(WORK, `${it.id}.thumb.png`), thumbWebp]);
    if (conv.status !== 0) throw new Error(`thumbnail of ${it.id} failed`);
    const thumb = ship(thumbWebp, 't', it.id, 'webp');
    const preview = it.id.startsWith('rug-') ? join(WORK, `${it.id}.preview.png`) : join(WORK, `${it.id}.thumb.png`);
    entries.push({
      id: it.id,
      name: it.name,
      kind: 'model',
      category: it.category,
      tags: [...new Set([...it.tags, 'realistic', it.category])].slice(0, 32),
      style: 'realistic',
      pack: PACK,
      size: info.size,
      tris: info.tris,
      bytes: main.bytes,
      file: main.rel,
      lods: [],
      lite: lite.rel,
      interior: { type: it.type, styles: it.styles, colors: it.colors, rgb: meanRgb(preview) },
      thumb: thumb.rel,
      collider: { type: 'box' },
      placement: 'floor',
      facing: '+z',
      source: SOURCE,
    });
    assets.push({ id: it.id, pack: PACK, licence: 'MIT', authors: null, source: { archive: 'Aether (code-authored)', path: SOURCE }, files: [main, lite, thumb].map((f) => ({ path: f.rel, sha256: f.hash, bytes: f.bytes })) });
    console.log(`${it.id}: ${main.rel} ${(main.bytes / 1048576).toFixed(2)} MB, lite ${(lite.bytes / 1024).toFixed(0)} KB, ${info.tris} tris`);
  }
  const out = {
    $comment: 'Procedural rugs and display furniture shipped with the library. Generated by scripts/assets/rugs/build.ts; merged into catalog.json and manifest.json (and re-merged by scripts/assets/build.ts).',
    packs: [{ id: PACK, title: 'Aether rugs and display furniture', author: 'Aether (code-authored models)', licence: 'MIT', licenceUrl: 'https://opensource.org/license/mit', url: 'https://opensource.org/license/mit', version: '1' }],
    sources: [{ id: PACK, provider: 'Aether', title: 'Procedural rugs and display furniture', version: '1', author: 'Aether', licence: 'MIT', licenceEvidence: 'generated by scripts/assets/rugs/build.ts', archive: SOURCE, sha256: null, retrieved: '2026-11-17' } as { id: string }],
    entries,
    assets,
  };
  writeFileSync(join(ROOT, 'assets', 'rugs.json'), `${JSON.stringify(out, null, 1)}\n`);
  mergeIntoCatalog(out);
}

main();
