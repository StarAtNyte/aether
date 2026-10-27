/**
 * Perceive a room photo with the measuring models (detection, masks, metric depth, geometry, colours).
 *   npx tsx scripts/perceive-photo.ts <photo.jpg> [--find=bed,desk,curtain] [--out=dir] [--json]
 * Needs ffmpeg to decode. Weights are fetched on first use into ~/.local/share/aether/models/perception (see
 * packages/agent/src/photo/perception/weights.ts and docs/THIRD_PARTY.md). Writes <out>/perception.json and
 * <out>/overlay.png when --out is given.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_NOUNS, Perceiver, perceptionText } from '../packages/agent/src/photo/perception/perceive';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const opt = (k: string): string | undefined => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
if (!file) throw new Error('usage: perceive-photo.ts <photo> [--find=a,b,c] [--out=dir] [--json]');
const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]).stdout.toString().trim().split(',').map(Number);
const [pw, ph] = probe as [number, number];
const s = 1024 / Math.max(pw, ph);
const w = Math.round(pw * s);
const h = Math.round(ph * s);
const dec = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', `scale=${w}:${h}:flags=area`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'], { maxBuffer: 1 << 28 });
const raster = { width: w, height: h, data: new Uint8ClampedArray(dec.stdout.buffer, dec.stdout.byteOffset, w * h * 4) };
const find = opt('find') ? (opt('find') as string).split(',').map((x) => x.trim()).filter(Boolean) : DEFAULT_NOUNS;
const t0 = performance.now();
const p = new Perceiver({ raster: async () => raster });
const rep = await p.run({ find, generic: true });
if (!rep) { console.log('could not decode the photo'); process.exit(1); }
const ms = Math.round(performance.now() - t0);
console.log(args.includes('--json') ? JSON.stringify(rep, null, 1) : perceptionText(rep));
console.log(`\ntotal ${ms} ms; stages ${JSON.stringify(rep.timingsMs)}`);
const out = opt('out');
if (out) {
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'perception.json'), JSON.stringify(rep));
  const o = await p.overlay();
  if (o) writeFileSync(join(out, 'overlay.png'), Buffer.from(o.split(',')[1] as string, 'base64'));
  console.log(`wrote ${out}/perception.json and overlay.png`);
}
await p.dispose();
