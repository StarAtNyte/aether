/**
 * Ground-truth self-test of the photo pipeline's measuring stages (no language model): perception (detection, masks, metric
 * depth, camera, room box, colours) and the geometry and comparison that follow it, scored against worlds whose truth we know.
 *
 *   npx tsx scripts/photo-selftest/run.ts [--worlds=a,b] [--poses=end,corner] [--variant=png|jpg] [--reuse] [--update-baseline]
 *                                          [--root=dir] [--no-render]
 *   npm run bench:photo-selftest
 *
 * Fixtures come from scripts/photo-selftest/render.ts (rendered here when missing and Chromium is available). Perception output
 * is cached next to the fixture (`--reuse` skips the models). Prints a table per stage and compares the medians with the targets
 * and the recorded baseline in tests/fixtures/selftest/baseline.json. Exit code 1 when `--strict` and a target is missed.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createWorld, type WorldDoc } from '@aether/core';
import { DEFAULT_NOUNS, Perceiver, type PerceptionReport } from '../../packages/agent/src/photo/perception/perceive';
import type { TruthMasks } from '../../packages/agent/src/photo/selftest/fixture';
import { SELFTEST_WORLDS } from '../../packages/agent/src/photo/selftest/fixture';
import { cameraErrors, colourErrors, depthErrors, detectionErrors, median, placementErrors, roomErrors, surfaceMaskErrors, type SelftestTruth } from '../../packages/agent/src/photo/selftest/metrics';
import { comparisonOracle, pipelinePose, plainPose, projectionOracle } from '../../packages/agent/src/photo/selftest/oracle';

const args = process.argv.slice(2);
const opt = (k: string): string | undefined => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const root = resolve(opt('root') ?? join(homedir(), '.local/share/aether/qa/selftest'));
const variant = opt('variant') ?? 'png';
const reuse = args.includes('--reuse');
const BASELINE = resolve('tests/fixtures/selftest/baseline.json');

/** Targets: what each stage must reach. A stage that misses is reported, not hidden. */
export const TARGETS = {
  fovErrDeg: 5,
  roomRelErr: 0.08,
  floorPosM: 0.15,
  sizeRelErr: 0.15,
  projectionIou: 0.9,
  colourDeltaE: 8,
  comparisonGood: 0.9,
} as const;

if (!existsSync(root) || readdirSync(root).length === 0) {
  if (args.includes('--no-render')) throw new Error(`no fixtures under ${root}`);
  console.log('no fixtures yet: rendering them (needs Chromium)');
  const r = spawnSync('npx', ['tsx', 'scripts/photo-selftest/render.ts', `--out=${root}`], { stdio: 'inherit', env: { ...process.env, GEN_GPU: process.env['GEN_GPU'] ?? 'intel' } });
  if (r.status !== 0) throw new Error('fixture rendering failed');
}

const want = opt('worlds')?.split(',');
const wantPose = opt('poses')?.split(',');
const fixtures: Array<{ world: string; pose: string; dir: string }> = [];
for (const w of readdirSync(root).sort()) {
  if (!statSync(join(root, w)).isDirectory()) continue;
  if (want ? !want.includes(w) : !SELFTEST_WORLDS.some((x) => x.name === w)) continue;
  for (const p of readdirSync(join(root, w)).sort()) {
    if (wantPose && !wantPose.includes(p)) continue;
    if (existsSync(join(root, w, p, 'truth.json'))) fixtures.push({ world: w, pose: p, dir: join(root, w, p) });
  }
}
if (fixtures.length === 0) throw new Error('no fixtures match');

function decode(file: string, longSide: number): { width: number; height: number; data: Uint8ClampedArray } {
  const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]).stdout.toString().trim().split(',').map(Number);
  const [pw, ph] = probe as [number, number];
  const s = longSide / Math.max(pw, ph);
  const w = Math.round(pw * s);
  const h = Math.round(ph * s);
  const dec = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', `scale=${w}:${h}:flags=area`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'], { maxBuffer: 1 << 28 });
  return { width: w, height: h, data: new Uint8ClampedArray(dec.stdout.buffer, dec.stdout.byteOffset, w * h * 4) };
}

const worldCache = new Map<string, WorldDoc>();
const loadWorld = (name: string): WorldDoc => {
  let w = worldCache.get(name);
  if (!w) {
    const raw = JSON.parse(readFileSync(resolve('apps/studio/public/templates/worlds', `${name}.json`), 'utf8')) as { world?: unknown };
    w = createWorld((raw.world ?? raw) as never) as WorldDoc;
    worldCache.set(name, w);
  }
  return w;
};

interface Row {
  world: string;
  pose: string;
  cam: ReturnType<typeof cameraErrors>;
  room: ReturnType<typeof roomErrors>;
  depth: ReturnType<typeof depthErrors> | null;
  planes: ReturnType<typeof surfaceMaskErrors>;
  det: ReturnType<typeof detectionErrors>;
  place: ReturnType<typeof placementErrors>;
  colour: ReturnType<typeof colourErrors>;
  projSpec: ReturnType<typeof projectionOracle>;
  projPlain: ReturnType<typeof projectionOracle>;
  compare: ReturnType<typeof comparisonOracle>;
}

const rows: Row[] = [];
for (const f of fixtures) {
  const truth = JSON.parse(readFileSync(join(f.dir, 'truth.json'), 'utf8')) as SelftestTruth;
  const masks = JSON.parse(readFileSync(join(f.dir, 'masks.json'), 'utf8')) as TruthMasks;
  const file = existsSync(join(f.dir, `photo.${variant}`)) ? join(f.dir, `photo.${variant}`) : join(f.dir, 'photo.png');
  const photo = decode(file, 1024);
  const tag = process.env['SELFTEST_TAG'] ? `.${process.env['SELFTEST_TAG']}` : '';
  const cacheRep = join(f.dir, `perception.${variant}${tag}.json`);
  const cacheGeo = join(f.dir, `geometry.${variant}${tag}.json`);
  let rep: PerceptionReport;
  let geo: { grid: { width: number; height: number; data: number[] }; kind: 'z' | 'ray'; planes?: { floor: number[]; ceil: number[]; wall: number[]; w: number; h: number } | null } | null = null;
  if (reuse && existsSync(cacheRep) && existsSync(cacheGeo)) {
    rep = JSON.parse(readFileSync(cacheRep, 'utf8')) as PerceptionReport;
    geo = JSON.parse(readFileSync(cacheGeo, 'utf8')) as typeof geo;
  } else {
    const t0 = performance.now();
    const p = new Perceiver({ raster: async () => photo, ...(process.env['SELFTEST_RESCALE'] === '1' ? { rescaleToFused: true } : {}) });
    const r = await p.run({ find: DEFAULT_NOUNS, generic: true });
    if (!r) throw new Error(`could not perceive ${file}`);
    rep = r;
    const g = p.debugGeometry();
    const dm = p.debugMasks;
    geo = g ? { grid: { width: g.grid.width, height: g.grid.height, data: Array.from(g.grid.data as ArrayLike<number>) }, kind: g.cam.kind, planes: dm ? { floor: Array.from(dm.floor), ceil: Array.from(dm.ceil), wall: Array.from(dm.wall), w: dm.w, h: dm.h } : null } : null;
    writeFileSync(cacheRep, JSON.stringify(rep));
    writeFileSync(cacheGeo, JSON.stringify(geo));
    await p.dispose();
    console.log(`${f.world}/${f.pose}: perceived in ${Math.round((performance.now() - t0) / 1000)} s, ${rep.objects.length} objects`);
  }
  const world = loadWorld(f.world);
  const det = detectionErrors(rep, truth, masks);
  const specPose = pipelinePose(world, truth);
  rows.push({
    world: f.world, pose: f.pose,
    cam: cameraErrors(rep, truth),
    room: roomErrors(rep, truth),
    depth: geo ? depthErrors({ width: geo.grid.width, height: geo.grid.height, data: geo.grid.data }, geo.kind, masks) : null,
    planes: surfaceMaskErrors(geo?.planes ?? null, masks),
    det,
    place: placementErrors(rep, truth, det),
    colour: colourErrors(rep, truth, det, masks, photo),
    projSpec: specPose ? projectionOracle(world, specPose, truth, masks) : null,
    projPlain: projectionOracle(world, plainPose(truth), truth, masks),
    compare: specPose ? comparisonOracle(world, specPose, truth, masks, photo, rep) : null,
  });
}

// ---------------------------------------------------------------------------------------------------------------- tables
const f1 = (v: number | null | undefined, d = 1): string => (v === null || v === undefined ? '-' : v.toFixed(d));
const pad = (s: string, n: number): string => s.padEnd(n);
const line = (cells: string[], widths: number[]): string => cells.map((c, i) => pad(c, widths[i] as number)).join(' ');
function table(title: string, head: string[], body: string[][]): void {
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((r) => (r[i] ?? '').length)));
  console.log(`\n${title}`);
  console.log(line(head, widths));
  for (const r of body) console.log(line(r, widths));
}
const id = (r: Row): string => `${r.world}/${r.pose}`;

table('(a) camera: horizontal field of view, pitch, eye height, yaw (estimate vs truth)', ['photo', 'fov est', 'fov true', 'fov err', 'vp fov err', 'pitch err', 'height err m', 'yaw est/true'], rows.map((r) => [id(r), f1(r.cam.fov.est), f1(r.cam.fov.truth), f1(r.cam.fov.err), f1(r.cam.vpFov.err), f1(r.cam.pitch.err), f1(r.cam.height.err, 2), `${f1(r.cam.yaw.est)}/${f1(r.cam.yaw.truth)}${r.cam.yaw.flipped ? ' FLIP' : ''}`]));
table('(b) room box (relative error; interior wall to wall)', ['photo', 'width est/true', 'rel', 'depth est/true', 'rel', 'height est/true', 'rel', 'cross-check rel w/d/h'], rows.map((r) => [id(r), `${f1(r.room.width.est, 2)}/${f1(r.room.width.truth, 2)}`, f1(r.room.width.relErr, 2), `${f1(r.room.depth.est, 2)}/${f1(r.room.depth.truth, 2)}`, f1(r.room.depth.relErr, 2), `${f1(r.room.height.est, 2)}/${f1(r.room.height.truth, 2)}`, f1(r.room.height.relErr, 2), r.room.cross ? `${f1(r.room.cross.width, 2)}/${f1(r.room.cross.depth, 2)}/${f1(r.room.cross.height, 2)}` : '-']));
table('(c) metric depth on true surfaces (median; ratio above 1 reads too far; after-scale is the shape error)', ['photo', 'abs m', 'rel', 'scale', 'rel after scale', 'floor rel', 'wall rel', 'items rel'], rows.map((r) => [id(r), f1(r.depth?.absM, 2), f1(r.depth?.rel, 2), f1(r.depth?.scale, 2), f1(r.depth?.relAfterScale, 2), f1(r.depth?.classes['floor']?.rel, 2), f1(r.depth?.classes['wall']?.rel, 2), f1(r.depth?.classes['items']?.rel, 2)]));
table('(d) detection and masks', ['photo', 'pieces', 'found', 'recall .3', 'recall .5', 'median IoU', 'IoU matched', 'label acc', 'false', 'structure'], rows.map((r) => [id(r), String(r.det.eligible), String(r.det.rows.filter((x) => x.perceivedId).length), f1(r.det.recall30, 2), f1(r.det.recall50, 2), f1(r.det.medianIou, 2), f1(r.det.medianIouMatched, 2), f1(r.det.labelAccuracy, 2), String(r.det.falseDetections.length), String(r.det.structureDetections)]));
table('(e) back-projection (matched pieces, IoU 0.3 or more)', ['photo', 'matched', 'floor pos m (visible)', 'floor pos m (piece)', 'floor pos rel. to eye', 'width err', 'height err', 'camera frame'], rows.map((r) => [id(r), String(r.place.rows.length), f1(r.place.floorPosVisM, 2), f1(r.place.floorPosPieceM, 2), f1(r.place.floorPosRelEyeM, 2), f1(r.place.sizeW, 2), f1(r.place.sizeH, 2), f1(r.place.cameraFrame, 2)]));
table('(f) colour deltaE (measured vs made / vs visible under the true mask; surfaces)', ['photo', 'raw vs made', 'normalised vs made', 'measured vs visible', 'visible vs made', 'floor vis', 'wall vis', 'ceiling vis'], rows.map((r) => [id(r), f1(r.colour.medianRawParam), f1(r.colour.medianNormParam), f1(r.colour.medianMeasVis), f1(r.colour.medianVisParam), f1(r.colour.surfaces[0]?.measVis), f1(r.colour.surfaces[1]?.measVis), f1(r.colour.surfaces[2]?.measVis)]));
table('(f2) surface masks (the plane masks the surface colours are read from, against the true floor, ceiling and walls)', ['photo', 'floor IoU', 'floor precision', 'ceiling IoU', 'walls IoU'], rows.map((r) => [id(r), f1(r.planes?.floor, 2), f1(r.planes?.floorPrecision, 2), f1(r.planes?.ceiling, 2), f1(r.planes?.walls, 2)]));
table('(g) projection oracle: true pieces through the pipeline raster vs true masks (IoU)', ['photo', 'via camera spec', 'large', 'plain pose', 'floor', 'ceiling', 'wall'], rows.map((r) => [id(r), f1(r.projSpec?.median, 2), f1(r.projSpec?.medianLarge, 2), f1(r.projPlain?.median, 2), f1(r.projSpec?.structure.floor, 2), f1(r.projSpec?.structure.ceiling, 2), f1(r.projSpec?.structure.wall, 2)]));
table('(g2) comparison oracle: perfect build + true masks through compareObjects', ['photo', 'objects', 'match', 'close', 'near', 'off', 'unclear', 'good share', 'median IoU', 'median dE'], rows.map((r) => [id(r), String(r.compare?.total ?? '-'), String(r.compare?.counts.match ?? '-'), String(r.compare?.counts.close ?? '-'), String(r.compare?.counts.near ?? '-'), String(r.compare?.counts.off ?? '-'), String(r.compare?.counts.unclear ?? '-'), f1(r.compare?.goodShare, 2), f1(r.compare?.medianIou, 2), f1(r.compare?.medianDeltaE)]));

// ---------------------------------------------------------------------------------------------------------------- aggregate
const nn = (a: Array<number | null | undefined>): number[] => a.filter((x): x is number => x !== null && x !== undefined);
const abs = (a: number[]): number[] => a.map(Math.abs);
const aggregate = {
  fovErrDeg: median(abs(nn(rows.map((r) => r.cam.fov.err)))),
  roomRelErr: median(abs(nn(rows.flatMap((r) => [r.room.width.relErr, r.room.depth.relErr, r.room.height.relErr])))),
  floorPosM: median(nn(rows.map((r) => r.place.floorPosVisM))),
  floorPosRelEyeM: median(nn(rows.map((r) => r.place.floorPosRelEyeM))),
  sizeRelErr: median(nn(rows.flatMap((r) => [r.place.sizeW, r.place.sizeH]))),
  projectionIou: median(nn(rows.map((r) => r.projSpec?.median))),
  colourDeltaE: median(nn(rows.map((r) => r.colour.medianMeasVis))),
  comparisonGood: median(nn(rows.map((r) => r.compare?.goodShare))),
  detectionRecall: median(nn(rows.map((r) => r.det.recall30))),
  detectionMedianIou: median(nn(rows.map((r) => r.det.medianIou))),
  depthRel: median(nn(rows.map((r) => r.depth?.rel))),
  depthScale: median(nn(rows.map((r) => r.depth?.scale))),
};
const lowerIsBetter = new Set(['fovErrDeg', 'roomRelErr', 'floorPosM', 'floorPosRelEyeM', 'sizeRelErr', 'colourDeltaE', 'depthRel']);
const baseline = existsSync(BASELINE) ? (JSON.parse(readFileSync(BASELINE, 'utf8')) as { measured?: Record<string, number | null> }) : { measured: {} };
console.log('\nStage summary (median over all photos) against the targets and the recorded baseline');
let missed = 0;
let regressed = 0;
for (const [k, v] of Object.entries(aggregate)) {
  const target = (TARGETS as Record<string, number>)[k];
  const lower = lowerIsBetter.has(k);
  const ok = target === undefined || v === null ? null : lower ? v <= target : v >= target;
  if (ok === false) missed++;
  const b = baseline.measured?.[k];
  const worse = b !== undefined && b !== null && v !== null && (lower ? v > b * 1.15 + 0.01 : v < b * 0.85 - 0.01);
  if (worse) regressed++;
  console.log(`${pad(k, 20)} ${pad(v === null ? '-' : String(Math.round(v * 100) / 100), 8)} target ${pad(target === undefined ? '-' : `${lower ? '<=' : '>='} ${target}`, 10)} ${ok === null ? '' : ok ? 'PASS' : 'MISS'}${b !== undefined && b !== null ? `  baseline ${b}${worse ? '  REGRESSED' : ''}` : ''}`);
}
console.log(`\n${rows.length} photos, ${missed} targets missed, ${regressed} regressions against the baseline`);

const out = join(root, 'results.json');
writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), variant, aggregate, rows }, null, 1));
console.log(`results: ${out}`);
if (args.includes('--update-baseline')) {
  mkdirSync(resolve('tests/fixtures/selftest'), { recursive: true });
  writeFileSync(BASELINE, JSON.stringify({ updated: new Date().toISOString().slice(0, 10), variant, photos: rows.map(id), targets: TARGETS, measured: Object.fromEntries(Object.entries(aggregate).map(([k, v]) => [k, v === null ? null : Math.round(v * 100) / 100])) }, null, 2) + '\n');
  console.log(`baseline written: ${BASELINE}`);
}
if (args.includes('--strict') && (missed > 0 || regressed > 0)) process.exit(1);
