/**
 * Depth estimate of a room photo, the same numbers `measure_room` gives the photo flow.
 *   npx tsx scripts/measure-room.ts <photo.jpg> [--fov=75] [--out=depth.png] [--anchor=door:2.05:x0,y0,x1,y1]
 * Needs ffmpeg to decode; the model is fetched on first use (see packages/agent/src/photo/depth-model.ts).
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { estimateRoomFromDepth, depthAdvisoryText, type DepthAnchor } from '@aether/arch/photo';
import { estimateDepthMap } from '../packages/agent/src/photo/depth-model';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const opt = (k: string): string | undefined => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
if (!file) throw new Error('usage: measure-room.ts <photo> [--fov=N] [--out=depth.png] [--anchor=name:metres:x0,y0,x1,y1]');
const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]).stdout.toString().trim().split(',').map(Number);
const [pw, ph] = probe as [number, number];
const s = 518 / Math.max(pw, ph);
const w = Math.round(pw * s);
const h = Math.round(ph * s);
const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', `scale=${w}:${h}:flags=area`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'], { maxBuffer: 1 << 28 });
const raster = { width: w, height: h, data: new Uint8ClampedArray(r.stdout.buffer, r.stdout.byteOffset, w * h * 4) };
const t0 = performance.now();
const res = await estimateDepthMap(raster);
if (!res.ok) { console.log('unavailable:', res.reason); process.exit(0); }
const ms = Math.round(performance.now() - t0);
const a = opt('anchor');
let anchor: DepthAnchor | undefined;
if (a) { const [name, size, box] = a.split(':') as [string, string, string]; anchor = { name, sizeM: Number(size), axis: 'height', box: box.split(',').map(Number) as [number, number, number, number], tolerance: 0.04 }; }
const fov = opt('fov');
const est = estimateRoomFromDepth(res.map, { ...(anchor ? { anchor } : {}), ...(fov ? { fovs: [Number(fov)] } : {}) });
console.log(`${file}: depth ${res.map.width}x${res.map.height} in ${ms} ms`);
console.log(est ? depthAdvisoryText(est) : 'no usable structure in the depth map');
const out = opt('out');
if (out) writeFileSync(out, Buffer.from(res.image.split(',')[1] as string, 'base64'));
