/**
 * Turn surfaces baked by `bake-surfaces.py` into the studio's texture sets and skin bundled worlds with them.
 *
 *   npx tsx scripts/blender/pack-surfaces.ts --in=<bake dir> [--apply=lisbon-hills:cobble+plaster,kepler-base:regolith]
 *
 * Per surface: the albedo becomes colour ratios around its mean (the material colour still tints it), darkened in the cavities by
 * the baked occlusion (dirt and wear where real surfaces collect it); ORM is the baked occlusion and roughness; the normal map is
 * Blender's tangent-space bake. Three tiers (256, 512, 1024) as WebP under the store's byte caps, in
 * `apps/studio/public/templates/textures/`. `--apply` writes the sets into the named templates and maps each finish the world uses
 * to its set with world `skins` (the renderer draws the set instead of the procedural maps for every part of that finish).
 * Needs ImageMagick (`convert`) for decoding, resizing and WebP.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { TextureSetDef } from '@aether/core';
import { textureSetId } from '../../packages/procgen/src/photo-texture/store';

const ARGS = process.argv.slice(2);
const arg = (n: string): string | undefined => ARGS.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const IN = resolve(arg('in') ?? '.');
const APPLY = (arg('apply') ?? '').split(',').filter(Boolean);
const ROOT = resolve(import.meta.dirname, '../..');
const TEX_DIR = join(ROOT, 'apps/studio/public/templates/textures');
const WORLDS = join(ROOT, 'apps/studio/public/templates/worlds');
const TIERS = [256, 512, 1024] as const;
const CAPS: Record<number, number> = { 256: 96 * 1024, 512: 320 * 1024, 1024: 1100 * 1024 };
const ALBEDO_SCALE = 2.5;

/** What each baked surface is, how big one tile is, and which finishes it draws in the worlds. */
const SURFACES: Record<string, { name: string; tile: number; finish: TextureSetDef['finish']; skins: string[] }> = {
  cobble: { name: 'granite setts (Blender bake)', tile: 1.0, finish: 'cobble', skins: ['cobble'] },
  'roof-tile': { name: 'Roman clay roof tiles (Blender bake)', tile: 1.0, finish: 'roof-tile', skins: ['roof-tile'] },
  limestone: { name: 'limestone ashlar (Blender bake)', tile: 1.2, finish: 'limestone', skins: ['limestone'] },
  plaster: { name: 'weathered lime plaster (Blender bake)', tile: 1.5, finish: 'plaster', skins: ['plaster'] },
  regolith: { name: 'Martian regolith with pebbles (Blender bake)', tile: 1.6, finish: 'soil', skins: ['soil'] },
  concrete: { name: 'cast concrete panels (Blender bake)', tile: 2.0, finish: 'concrete', skins: ['concrete'] },
};

/** RGBA8 pixels of an image file resized to `n`. */
function pixels(file: string, n: number): Uint8Array {
  return new Uint8Array(execFileSync('convert', [file, '-resize', `${n}x${n}!`, '-depth', '8', 'rgba:-'], { maxBuffer: 64 << 20 }));
}

/** WebP of RGBA8 pixels under the byte cap of the tier: quality steps down until it fits. */
function webp(rgba: Uint8Array, n: number, map: string): Buffer {
  const ladder = map === 'normal' ? [95, 90, 82, 70] : [92, 84, 72, 60, 45];
  for (const q of ladder) {
    const out = execFileSync('convert', ['-size', `${n}x${n}`, '-depth', '8', 'rgba:-', '-quality', String(q), '-define', 'webp:method=6', 'webp:-'], { input: Buffer.from(rgba), maxBuffer: 64 << 20 });
    if (out.byteLength <= (CAPS[n] as number)) return out;
  }
  throw new Error(`${map} ${n}px does not fit its cap`);
}

const toLin = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toSrgb = (v: number): number => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
const hex = (c: number[]): string => `#${c.map((v) => Math.round(Math.max(0, Math.min(1, toSrgb(v))) * 255).toString(16).padStart(2, '0')).join('')}`;

/** The three maps of one tier. */
function maps(dir: string, n: number, mean: number[]): { albedo: Uint8Array; orm: Uint8Array; normal: Uint8Array } {
  const col = pixels(join(dir, 'albedo.png'), n);
  const rough = pixels(join(dir, 'rough.png'), n);
  const ao = pixels(join(dir, 'ao.png'), n);
  const normal = pixels(join(dir, 'normal.png'), n);
  const albedo = new Uint8Array(n * n * 4);
  const orm = new Uint8Array(n * n * 4);
  for (let i = 0; i < n * n; i++) {
    const occ = (ao[i * 4] as number) / 255;
    // Weathering: grime settles where the surface is occluded (joints, under tile laps, between pebbles).
    const dirt = 0.62 + 0.38 * occ;
    for (let c = 0; c < 3; c++) {
      const ratio = (toLin((col[i * 4 + c] as number) / 255) / Math.max(1e-4, mean[c] as number)) * dirt;
      albedo[i * 4 + c] = Math.round(Math.max(0, Math.min(1, ratio / ALBEDO_SCALE)) * 255);
    }
    albedo[i * 4 + 3] = 255;
    orm[i * 4] = ao[i * 4] as number;
    orm[i * 4 + 1] = rough[i * 4] as number;
    orm[i * 4 + 2] = 0;
    orm[i * 4 + 3] = 255;
    normal[i * 4 + 3] = 255;
  }
  return { albedo, orm, normal };
}

const built: Record<string, { id: string; def: TextureSetDef; tile: number; skins: string[] }> = {};
for (const [surface, spec] of Object.entries(SURFACES)) {
  const dir = join(IN, surface);
  if (!existsSync(join(dir, 'normal.png'))) {
    process.stdout.write(`skip ${surface}: not baked\n`);
    continue;
  }
  // Mean colour of the bake (linear), the colour the ratios are taken around.
  const small = pixels(join(dir, 'albedo.png'), 64);
  const mean = [0, 0, 0];
  for (let i = 0; i < 64 * 64; i++) for (let c = 0; c < 3; c++) mean[c] = (mean[c] as number) + toLin((small[i * 4 + c] as number) / 255) / (64 * 64);
  const tiers = TIERS.map((n) => ({ n, ...maps(dir, n, mean) }));
  const t256 = tiers[0] as (typeof tiers)[number];
  const id = textureSetId({ size: 256, albedo: t256.albedo, orm: t256.orm, normal: t256.normal }, spec.tile);
  for (const t of tiers) for (const map of ['albedo', 'orm', 'normal'] as const) writeFileSync(join(TEX_DIR, `${id}.${map}.${t.n}.webp`), webp(t[map], t.n, map));
  const def: TextureSetDef = { name: spec.name, provenance: 'procedural', tile: spec.tile, tiers: [256, 512, 1024], albedoScale: ALBEDO_SCALE, mean: hex(mean), ...(spec.finish ? { finish: spec.finish } : {}), source: { model: 'blender-cycles' }, base: 'templates/textures' } as TextureSetDef;
  built[surface] = { id, def, tile: spec.tile, skins: spec.skins };
  process.stdout.write(`${surface}: ${id} mean ${def.mean}\n`);
}

for (const item of APPLY) {
  const [slug, list] = item.split(':') as [string, string | undefined];
  const want = new Set((list ?? '').split('+').filter(Boolean));
  const file = join(WORLDS, `${slug}.json`);
  const doc = JSON.parse(readFileSync(file, 'utf8')) as { world: { textures?: Record<string, TextureSetDef>; skins?: Record<string, { id: string; tile?: number }> } };
  const w = doc.world;
  w.textures = { ...(w.textures ?? {}) };
  w.skins = { ...(w.skins ?? {}) };
  for (const [surface, b] of Object.entries(built)) {
    if (want.size > 0 && !want.has(surface)) continue;
    w.textures[b.id] = b.def;
    for (const k of b.skins) w.skins[k] = { id: b.id };
  }
  writeFileSync(file, JSON.stringify(doc));
  process.stdout.write(`${slug}: ${Object.keys(w.skins).join(', ')}\n`);
}
