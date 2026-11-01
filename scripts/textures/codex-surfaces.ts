/**
 * AI-generated surface textures for bundled worlds, made the way `make_texture` makes them: the Codex CLI's image tool (on the
 * user's own ChatGPT login) draws a flat, front-on swatch from `texturePrompt`, `deriveFromSwatch` makes it seamless and de-lit, and
 * `buildTextureSet` turns it into the albedo / occlusion-roughness / normal maps of a texture set. The set goes into the template
 * and a world skin draws it for every part of the chosen finish.
 *
 *   npx tsx scripts/textures/codex-surfaces.ts --world=lisbon-hills --only=asphalt
 *
 * Needs `codex` logged in (ChatGPT) and ImageMagick (`convert`) for decoding and WebP.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { MaterialFinish, TextureSetDef } from '@aether/core';
import { buildTextureSet, deriveFromSwatch } from '@aether/procgen/photo-texture';
import { createCodexImageBackend } from '../../apps/bridge/src/backends/codex-image';
import { texturePrompt } from '../../packages/agent/src/images';

const ARGS = process.argv.slice(2);
const arg = (n: string): string | undefined => ARGS.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const ROOT = resolve(import.meta.dirname, '../..');
const WORLD = arg('world') ?? 'lisbon-hills';
const ONLY = (arg('only') ?? '').split(',').filter(Boolean);

/** Surfaces to draw: what to ask for, the surface class word, one tile in metres, and the finishes it skins. */
const SURFACES: Record<string, { subject: string; word: string; tile: number; finish: MaterialFinish; skins: string[] }> = {
  asphalt: { subject: 'weathered asphalt road surface with fine grey aggregate, faint hairline cracks and a few darker patches', word: 'concrete', tile: 3, finish: 'asphalt', skins: ['asphalt'] },
};

/** WebP of RGBA8 pixels at the asked quality (ImageMagick). */
const encode = (rgba: Uint8Array, size: number, _map: string, quality: number): Uint8Array =>
  new Uint8Array(execFileSync('convert', ['-size', `${size}x${size}`, '-depth', '8', 'rgba:-', '-quality', String(Math.round(quality * 100)), '-define', 'webp:method=6', 'webp:-'], { input: Buffer.from(rgba), maxBuffer: 64 << 20 }));

async function main(): Promise<void> {
  const codex = createCodexImageBackend();
  const file = join(ROOT, 'apps/studio/public/templates/worlds', `${WORLD}.json`);
  const doc = JSON.parse(readFileSync(file, 'utf8')) as { world: { textures?: Record<string, TextureSetDef>; skins?: Record<string, { id: string }> } };
  const w = doc.world;
  w.textures = { ...(w.textures ?? {}) };
  w.skins = { ...(w.skins ?? {}) };
  for (const [key, s] of Object.entries(SURFACES)) {
    if (ONLY.length > 0 && !ONLY.includes(key)) continue;
    const prompt = texturePrompt(s.subject, { tileable: true });
    process.stdout.write(`${key}: asking Codex for an image\n`);
    const got = await codex.generate({ prompt, size: 1024 });
    const n = 1024;
    const data = new Uint8Array(execFileSync('convert', ['-', '-resize', `${n}x${n}^`, '-gravity', 'center', '-extent', `${n}x${n}`, '-depth', '8', 'rgba:-'], { input: Buffer.from(got.bytes), maxBuffer: 64 << 20 }));
    writeFileSync(join(ROOT, `scripts/textures/.${key}-swatch.png`), got.bytes);
    const d = deriveFromSwatch({ width: n, height: n, data }, { word: s.word, tileMetres: s.tile, tileable: true });
    const set = await buildTextureSet(d.tile, { name: `${key} (AI image, Codex)`, provenance: 'ai-generated', tileMetres: s.tile, mean: d.mean, cls: d.cls, finish: s.finish, source: { prompt: s.subject.slice(0, 400), model: got.model.slice(0, 64) }, base: 'templates/textures' }, encode);
    if (!set) throw new Error(`${key}: no tier fits the size caps`);
    for (const f of set.files) writeFileSync(join(ROOT, 'apps/studio/public/templates/textures', `${set.id}.${f.map}.${f.tier}.webp`), f.bytes);
    w.textures[set.id] = set.def;
    for (const k of s.skins) w.skins[k] = { id: set.id };
    process.stdout.write(`${key}: ${set.id} mean ${d.mean} seam ${d.seam.toFixed(2)} model ${got.model}\n`);
  }
  writeFileSync(file, JSON.stringify(doc));
}

main().then(() => process.exit(0), (e: unknown) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
