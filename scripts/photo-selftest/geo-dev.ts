/**
 * Fast inner loop for the geometry stage of the photo self-test (no models, a few seconds): re-runs the vanishing-point box,
 * the wall lines and the back-projection of every object from the CACHED depth grid, masks and photo of a previous
 * `run.ts` run, and scores placements against the truth. Use after `npm run bench:photo-selftest` has filled the caches.
 *   npx tsx scripts/photo-selftest/geo-dev.ts [--variant=png] [--worlds=a,b] [--poses=end,corner] [--verbose]
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { boxFromVP, detectSegments, placeObject, solveManhattan, type DepthGrid, type ManhattanCamera } from '@aether/arch/photo';
import { decodeRle, type PerceptionReport } from '../../packages/agent/src/photo/perception/perceive';
import { SELFTEST_WORLDS, type TruthMasks } from '../../packages/agent/src/photo/selftest/fixture';
import { planToRoom } from '../../packages/agent/src/photo/selftest/truth';
import { detectionErrors, median, placementErrors, type SelftestTruth } from '../../packages/agent/src/photo/selftest/metrics';

const args = process.argv.slice(2);
const opt = (k: string): string | undefined => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const root = resolve(opt('root') ?? join(homedir(), '.local/share/aether/qa/selftest'));
const variant = opt('variant') ?? 'png';
const want = opt('worlds')?.split(',');
const wantPose = opt('poses')?.split(',');
const WALLISH = /(curtain|window|door|painting|picture|frame|mirror|poster|clock|tv|television|screen|radiator|vent|sconce|detector|blind|shade|wall light|light fixture|glass)/;

function decode(file: string, longSide: number): { width: number; height: number; data: Uint8ClampedArray } {
  const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]).stdout.toString().trim().split(',').map(Number);
  const [pw, ph] = probe as [number, number];
  const s = longSide / Math.max(pw, ph);
  const w = Math.round(pw * s);
  const h = Math.round(ph * s);
  const dec = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', `scale=${w}:${h}:flags=area`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'], { maxBuffer: 1 << 28 });
  return { width: w, height: h, data: new Uint8ClampedArray(dec.stdout.buffer, dec.stdout.byteOffset, w * h * 4) };
}
const shrink = (m: Uint8Array, mw: number, mh: number, w: number, h: number): Uint8Array => {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = m[Math.min(mh - 1, Math.floor(((y + 0.5) / h) * mh)) * mw + Math.min(mw - 1, Math.floor(((x + 0.5) / w) * mw))] as number;
  return out;
};

const perPhoto: Array<{ id: string; pos: number | null; rel: number | null; piece: number | null }> = [];
const all: number[] = [];
for (const w of readdirSync(root).sort()) {
  if (!statSync(join(root, w)).isDirectory()) continue;
  if (want ? !want.includes(w) : !SELFTEST_WORLDS.some((x) => x.name === w)) continue;
  for (const p of readdirSync(join(root, w)).sort()) {
    if (wantPose && !wantPose.includes(p)) continue;
    const dir = join(root, w, p);
    const cacheRep = join(dir, `perception.${variant}.json`);
    if (!existsSync(join(dir, 'truth.json')) || !existsSync(cacheRep)) continue;
    const truth = JSON.parse(readFileSync(join(dir, 'truth.json'), 'utf8')) as SelftestTruth;
    const masks = JSON.parse(readFileSync(join(dir, 'masks.json'), 'utf8')) as TruthMasks;
    const rep = JSON.parse(readFileSync(cacheRep, 'utf8')) as PerceptionReport;
    const geo = JSON.parse(readFileSync(join(dir, `geometry.${variant}.json`), 'utf8')) as { grid: { width: number; height: number; data: number[] } };
    const photoFile = existsSync(join(dir, `photo.${variant}`)) ? join(dir, `photo.${variant}`) : join(dir, 'photo.png');
    const vpCache = join(dir, `vp.${variant}.json`);
    let vp: ManhattanCamera | null;
    const gw = geo.grid.width, gh = geo.grid.height;
    if (existsSync(vpCache)) vp = JSON.parse(readFileSync(vpCache, 'utf8')) as ManhattanCamera | null;
    else {
      const photo = decode(photoFile, 1024);
      const sw = 640, sh = Math.max(16, Math.round((photo.height * 640) / photo.width));
      const seg = new Uint8Array(sw * sh);
      for (const o of rep.objects) if (o.mask && !WALLISH.test(o.label)) { const m = o.mask.rle; const s = shrink(decodeRle(m), m.width, m.height, sw, sh); for (let i = 0; i < s.length; i++) if (s[i]) seg[i] = 1; }
      const lines = detectSegments(photo, { width: 640, maskOut: seg });
      vp = solveManhattan(lines.segments, lines.width, lines.height);
      writeFileSync(vpCache, JSON.stringify(vp));
    }
    if (!vp) continue;
    const cachedFov = rep.vanishing?.fovDeg;
    if (process.env['ORACLE_FOV']) vp = { ...vp, fovDeg: truth.camera.hfov };
    // undo the scaling the report's grid already carries (trained 60 degrees to the vp field of view)
    const k = Math.tan((60 * Math.PI) / 360) / Math.tan(((cachedFov ?? vp.fovDeg) * Math.PI) / 360);
    const raw: DepthGrid = { width: gw, height: gh, data: Float32Array.from(geo.grid.data, (v) => v / k) };
    const notWall = new Uint8Array(gw * gh);
    for (const o of rep.objects) if (o.mask && !WALLISH.test(o.label)) { const m = o.mask.rle; const s = shrink(decodeRle(m), m.width, m.height, gw, gh); for (let i = 0; i < s.length; i++) if (s[i]) notWall[i] = 1; }
    let SC = Number(process.env['SC'] ?? 1);
    if (process.env['CAMH']) {
      const b0 = boxFromVP(raw, vp, { notWall, trainedFovDeg: 60 });
      if (b0) SC = (1.5 / b0.box.cameraHeight) ** Number(process.env['CAMH']);
    }
    const rawS: DepthGrid = { width: gw, height: gh, data: Float32Array.from(raw.data, (v) => v * SC) };
    const b = boxFromVP(rawS, vp, { notWall, trainedFovDeg: 60, ...(process.env['NOPRIOR'] ? { eyePrior: null } : process.env['EYE_W'] ? { eyePrior: { heightM: Number(process.env['EYE_H'] ?? 1.5), weight: Number(process.env['EYE_W']), maxScale: 1.6 } } : {}) });
    if (!b) continue;
    if (process.env['TRUECAMH']) b.frame.cameraHeight = truth.camera.plan.height;
    if (args.includes('--hist')) {
      const hs: number[] = [];
      b.cloud.p.forEach((q, i) => { if ((b.cloud.v[i] as number) >= gh * 0.45) hs.push(q[0] * b.frame.up[0] + q[1] * b.frame.up[1] + q[2] * b.frame.up[2]); });
      const bins = new Map<number, number>();
      for (const x of hs) { const k = Math.round(x / 0.1); bins.set(k, (bins.get(k) ?? 0) + 1); }
      console.log(`${w}/${p} floor off ${b.frame.floor.d.toFixed(2)} up ${b.frame.up.map((x) => x.toFixed(2))} hist(m:count) ` + [...bins.entries()].sort((a, c) => a[0] - c[0]).filter((e) => e[1] > hs.length * 0.02).map(([k, n]) => `${(k * 0.1).toFixed(1)}:${n}`).join(' '));
    }
    if (args.includes('--scales')) console.log(`${w}/${p} camH ${b.box.cameraHeight} (true ${truth.camera.plan.height}) -> k ${(truth.camera.plan.height / b.box.cameraHeight).toFixed(2)}; ceil ${b.box.height.value} ceilOk ${b.box.walls.ceiling} (true ${truth.room.height.toFixed(2)}) -> k ${(truth.room.height / b.box.height.value).toFixed(2)}`);
    for (const o of rep.objects) {
      if (!o.mask) { o.placement = null; continue; }
      const m = o.mask.rle;
      const pl = placeObject(shrink(decodeRle(m), m.width, m.height, gw, gh), b.grid, b.cam, b.frame, b.box, o.label);
      o.placement = pl;
    }
    rep.room = { ...(rep.room as NonNullable<typeof rep.room>), camera: b.box.camera, walls: b.box.walls };
    const det = detectionErrors(rep, truth, masks);
    const pe = placementErrors(rep, truth, det);
    perPhoto.push({ id: `${w}/${p}`, pos: pe.floorPosVisM, rel: pe.floorPosRelEyeM, piece: pe.floorPosPieceM });
    for (const r of pe.rows) if (r.floor && r.posVisM !== null) all.push(r.posVisM);
    if (args.includes('--frame')) {
      const [bx0, bz0, bx1, bz1] = truth.room.bbox;
      const eye = planToRoom(truth.room.back, truth.camera.plan.at[0] - bx0, truth.camera.plan.at[1] - bz0, bx1 - bx0, bz1 - bz0);
      console.log(`${w}/${p} vp fov ${vp.fovDeg} (true ${truth.camera.hfov}) yaw ${vp.yawDeg} (true ${-truth.room.yawRel}) pitch ${vp.pitchDeg} (true ${-truth.camera.pitch}) | est eye x ${b.box.camera.x} z ${b.box.camera.z} walls L${b.box.lines.left?.s.toFixed(2)} R${b.box.lines.right?.s.toFixed(2)} B${b.box.lines.back?.s.toFixed(2)} | true eye u ${eye[0].toFixed(2)} v ${eye[1].toFixed(2)} room W ${truth.room.width.toFixed(2)} D ${truth.room.depth.toFixed(2)}`);
      for (const r of pe.rows) if (r.floor) { const o = rep.objects.find((q) => false); void o; }
    }
    if (args.includes('--verbose')) for (const r of pe.rows) console.log(`  ${w}/${p} ${r.kind.padEnd(12)} pos ${r.posVisM} rel ${r.posRelEyeM} frame ${r.frame} w ${r.wRatio} h ${r.hRatio}`);
  }
}
for (const r of perPhoto) console.log(`${r.id.padEnd(34)} floorPos ${String(r.pos).padEnd(6)} relEye ${r.rel} piece ${r.piece}`);
const nn = (a: Array<number | null>): number[] => a.filter((x): x is number => x !== null && !Number.isNaN(x));
console.log(`median of photo medians: floorPos ${median(nn(perPhoto.map((r) => r.pos)))} relEye ${median(nn(perPhoto.map((r) => r.rel)))} piece ${median(nn(perPhoto.map((r) => r.piece)))}  | median over pieces ${median(all)} (n=${all.length})`);
