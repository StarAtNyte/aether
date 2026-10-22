/**
 * Derive the photo textures of one example room and write them out for inspection: the rectified surfaces, the master tiles and the
 * maps of every tier as PNG, with a report. No model is called: the recorded description (tests/fixtures/photo) stands in.
 *
 *   npx tsx scripts/photo-textures.ts --photo=hotel --out=DIR
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { partKinds } from '@aether/arch';
import { parseRoomDescription, type RoomDescription } from '@aether/arch/photo';
import { cameraModel, deriveTextures, fromRgba8, rectify, roomPlanes, toRgba8, texturePbr } from '@aether/procgen/photo-texture';
import { encodePng } from '../apps/cli/src/mcp/png';

const ROOT = resolve(import.meta.dirname, '..');
const arg = (k: string, d: string): string => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const photo = arg('photo', 'hotel');
const out = resolve(arg('out', `${process.env['HOME']}/.local/share/aether/look7/textures`), photo);
mkdirSync(out, { recursive: true });

const FILES: Record<string, { jpg: string; desc: string }> = {
  hotel: { jpg: 'bedroom-cc0-hotel.jpg', desc: 'hotel.description.json' },
  hotelcodex: { jpg: 'bedroom-cc0-hotel.jpg', desc: 'hotel.codex.description.json' },
};
const f = FILES[photo];
if (!f) throw new Error(`no recorded description for ${photo}`);
const jpg = join(ROOT, 'tests/fixtures/photo', f.jpg);
// Decode with ffmpeg to raw RGBA at most 1280 px wide.
const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', jpg], { encoding: 'utf8' });
const [iw, ih] = probe.stdout.trim().split(',').map(Number) as [number, number];
const scale = Math.min(1, 1280 / iw);
const w = Math.round(iw * scale);
const h = Math.round(ih * scale);
const raw = spawnSync('ffmpeg', ['-v', 'error', '-i', jpg, '-vf', `scale=${w}:${h}`, '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'], { maxBuffer: 256 * 1024 * 1024 });
const raster = { width: w, height: h, data: new Uint8ClampedArray(raw.stdout) };
const parsed = parseRoomDescription(JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/photo', f.desc), 'utf8')) as unknown, partKinds());
if (!parsed.ok) throw new Error(parsed.error);
const d: RoomDescription = parsed.value;

const t0 = performance.now();
const res = deriveTextures(raster, d);
console.log(`derived ${res.textures.length} textures, skipped ${res.skipped.length} in ${Math.round(performance.now() - t0)} ms`);
for (const s of res.skipped) console.log(`  skipped ${s.target.id}: ${s.reason}`);
const cam = cameraModel(d.camera, w / h);
const planes = roomPlanes(d.footprint);
for (const t of res.textures) {
  console.log(`  ${t.target.id}: ${t.quality}, tile ${t.tileMetres} m, clean square ${t.sourceMetres.toFixed(2)} m, coverage ${(t.coverage * 100).toFixed(0)} %, contrast ${t.contrast.toFixed(3)}, mean ${t.mean}, class ${t.cls.finish}; ${t.notes.join('; ')}`);
  const tilePng = toRgba8(t.tile, { scale: 0.5, srgb: true });
  writeFileSync(join(out, `${t.target.id}.tile.png`), encodePng(tilePng, t.tile.width, t.tile.height));
  const [m512] = texturePbr(t, [512]);
  if (m512) for (const k of ['albedo', 'orm', 'normal'] as const) writeFileSync(join(out, `${t.target.id}.${k}.png`), encodePng(m512[k], 512, 512));
  const pl = planes[t.target.id];
  if (pl) {
    const rr = rectify(fromRgba8(raster), cam, pl, { ppm: 120 });
    writeFileSync(join(out, `${t.target.id}.rectified.png`), encodePng(toRgba8(rr.image, { srgb: true }), rr.image.width, rr.image.height));
  }
}
console.log(`written to ${out}`);
