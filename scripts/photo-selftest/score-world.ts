/**
 * Score the RESULT of a full photo-to-room run (eval-photo.ts with a `selftest:<world>/<pose>` photo) against the truth of that photo:
 * entity by entity (matched, missing, extra; position, size and colour errors), the shell and the camera, and the mask overlap of the
 * built room drawn from the run's own photo camera against the true masks.
 *
 *   npx tsx scripts/photo-selftest/score-world.ts <run dir> <world>/<pose> [--root=dir]
 *
 * <run dir> holds world.json, views.json and run.json written by eval-photo.ts.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createWorld, type WorldDoc } from '@aether/core';
import { readScene, renderInstanceIds, type ReviewPose } from '@aether/arch';
import { PHOTO_BUILDING_ID, deltaE2000, hexToLab } from '@aether/arch/photo';
import { decodeMasks, type TruthMasks } from '../../packages/agent/src/photo/selftest/fixture';
import { familyOf, labelMask, maskIou, median, type SelftestTruth } from '../../packages/agent/src/photo/selftest/metrics';
import { makeCamera, truthItems, truthRoom, vfovOf } from '../../packages/agent/src/photo/selftest/truth';

const [runDir, which] = process.argv.slice(2);
if (!runDir || !which) throw new Error('usage: score-world.ts <run dir> <world>/<pose>');
const root = resolve(process.argv.find((a) => a.startsWith('--root='))?.slice(7) ?? join(homedir(), '.local/share/aether/qa/selftest'));
const fx = join(root, which);
const truth = JSON.parse(readFileSync(join(fx, 'truth.json'), 'utf8')) as SelftestTruth;
const masks = JSON.parse(readFileSync(join(fx, 'masks.json'), 'utf8')) as TruthMasks;
const built = createWorld(JSON.parse(readFileSync(join(runDir, 'world.json'), 'utf8')) as never) as WorldDoc;
const views = JSON.parse(readFileSync(join(runDir, 'views.json'), 'utf8')) as { last: { pose: { position: [number, number, number]; target: [number, number, number]; fov: number } } };
const run = existsSync(join(runDir, 'run.json')) ? (JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8')) as { final?: { passed: number; total: number; judge?: number | null; objective?: number | null }; rounds?: unknown[]; calls?: number; ms?: number; builtWidth?: number | null; builtDepth?: number | null }) : {};

const r2 = (v: number | null): number | null => (v === null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);

// the run's photo camera in the built plan
const p = views.last.pose;
const dx = p.target[0] - p.position[0];
const dy = p.target[1] - p.position[1];
const dz = p.target[2] - p.position[2];
const heading = ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
const pitch = (Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI;
const scene0 = readScene(built, PHOTO_BUILDING_ID);
if (!scene0) throw new Error('the built world has no photo room');
const levelEnt = Object.values(built.entities).find((e) => e.parent === PHOTO_BUILDING_ID && e.arch?.role === 'level');
const levelY = levelEnt?.transform.position[1] ?? 0;
const aspect = truth.camera.aspect;
const hfov = (2 * Math.atan(Math.tan((p.fov * Math.PI) / 360) * aspect) * 180) / Math.PI;
const cam = makeCamera(levelY, [p.position[0], p.position[2]], p.position[1] - levelY, heading, pitch, hfov, aspect);
void vfovOf;
const tr = truthRoom(built, PHOTO_BUILDING_ID, cam);
if (!tr) throw new Error('no rectangular room in the built world');
const bItems = truthItems(built, tr.scene, tr.room, tr.sr);

// shell and camera
const shell = {
  width: { built: r2(tr.room.width), truth: r2(truth.room.width), rel: r2(tr.room.width / truth.room.width - 1) },
  depth: { built: r2(tr.room.depth), truth: r2(truth.room.depth), rel: r2(tr.room.depth / truth.room.depth - 1) },
  height: { built: r2(tr.room.height), truth: r2(truth.room.height), rel: r2(tr.room.height / truth.room.height - 1) },
};
const camera = { hfovErr: r2(hfov - truth.camera.hfov), heightErr: r2(cam.plan.height - truth.camera.plan.height), pitchErr: r2(pitch - truth.camera.pitch) };

// entities: truth pieces big enough to be seen, matched one to one to built pieces of the same family by distance
const eligible = truth.items.filter((t) => (t.visible?.area ?? 0) >= 0.0015);
const pairs: Array<{ t: number; b: number; d: number }> = [];
eligible.forEach((t, ti) => bItems.forEach((b, bi) => {
  if (familyOf(b.kind) !== familyOf(t.kind)) return;
  const d = Math.hypot(b.centre.u - t.centre.u, b.centre.v - t.centre.v);
  if (d <= 2.5) pairs.push({ t: ti, b: bi, d });
}));
pairs.sort((a, b) => a.d - b.d);
const usedT = new Set<number>();
const usedB = new Set<number>();
const match = new Map<number, number>();
for (const q of pairs) { if (usedT.has(q.t) || usedB.has(q.b)) continue; usedT.add(q.t); usedB.add(q.b); match.set(q.t, q.b); }
const dE = (a: string | null, b: string | null): number | null => { const x = a ? hexToLab(a) : null; const y = b ? hexToLab(b) : null; return x && y ? r2(deltaE2000(x, y)) : null; };

// mask overlap of the built room from the run's camera
const pose: ReviewPose = { name: 'built', label: 'built', room: 'x', kind: 'corner', position: p.position, target: p.target, up: [0, 1, 0], fov: p.fov, hideTops: false };
const inst = renderInstanceIds(built, PHOTO_BUILDING_ID, pose, aspect, masks.width, masks.height);
const dec = decodeMasks(masks);
const rasterOf = (id: string): Uint8Array => {
  const out = new Uint8Array(masks.width * masks.height);
  const k = inst ? inst.ids.indexOf(id) + 1 : 0;
  if (inst && k > 0) for (let i = 0; i < out.length; i++) if (inst.buffer[i] === k) out[i] = 1;
  return out;
};
const rows = eligible.map((t, ti) => {
  const bi = match.get(ti);
  const b = bi === undefined ? null : (bItems[bi] as (typeof bItems)[number]);
  const iou = b ? maskIou(labelMask(masks, t.id, dec), rasterOf(b.id)) : 0;
  return {
    truth: t.id, kind: t.kind, built: b?.id ?? null, builtKind: b?.kind ?? null, area: r2((t.visible?.area ?? 0) * 100),
    posM: b ? r2(Math.hypot(b.centre.u - t.centre.u, b.centre.v - t.centre.v)) : null,
    wRatio: b && t.size.w > 0.05 ? r2(b.size.w / t.size.w) : null, dRatio: b && t.size.d > 0.05 ? r2(b.size.d / t.size.d) : null, hRatio: b && t.size.h > 0.05 ? r2(b.size.h / t.size.h) : null,
    colourDE: b ? dE(b.mainHex, t.mainHex) : null, iou: r2(iou),
  };
});
const matched = rows.filter((r) => r.built);
const num = (a: Array<number | null>): number[] => a.filter((x): x is number => x !== null);
const extra = bItems.filter((_, bi) => !usedB.has(bi) && bItems[bi]!.mount !== 'wall' && bItems[bi]!.size.w * bItems[bi]!.size.d > 0.02).map((b) => `${b.id} (${b.kind})`);
const structure = (label: string, re: RegExp): number | null => {
  if (!inst) return null;
  const keep = new Uint8Array(inst.ids.length + 1);
  inst.ids.forEach((id, i) => { if (re.test(id)) keep[i + 1] = 1; });
  const m = new Uint8Array(masks.width * masks.height);
  for (let i = 0; i < m.length; i++) if (keep[inst.buffer[i] as number]) m[i] = 1;
  return r2(maskIou(labelMask(masks, label, dec), m));
};
const summary = {
  photo: which,
  entities: {
    truthEligible: eligible.length, matched: matched.length, missing: eligible.length - matched.length, extra: extra.length,
    posMedianM: r2(median(num(matched.map((r) => r.posM)))), posWithin25cm: matched.filter((r) => (r.posM ?? 9) <= 0.25).length,
    widthErrMedian: r2(median(num(matched.map((r) => (r.wRatio === null ? null : Math.abs(r.wRatio - 1)))))), heightErrMedian: r2(median(num(matched.map((r) => (r.hRatio === null ? null : Math.abs(r.hRatio - 1)))))),
    colourDEMedian: r2(median(num(matched.map((r) => r.colourDE)))), maskIouMedian: r2(median(num(rows.map((r) => r.iou)))),
  },
  shell, camera,
  structureIou: { floor: structure('floor', /^floor:/), ceiling: structure('ceiling', /^ceiling:/), wall: structure('wall', /^wall:/) },
  judge: run.final ? { passed: run.final.passed, total: run.final.total, passRate: r2(run.final.passed / Math.max(1, run.final.total)), judgeScore: run.final.judge ?? null, objective: run.final.objective ?? null } : null,
  run: { rounds: run.rounds?.length ?? null, calls: run.calls ?? null, minutes: run.ms ? Math.round(run.ms / 600) / 100 : null },
  rows, extra,
};
writeFileSync(join(runDir, 'selftest-score.json'), `${JSON.stringify(summary, null, 1)}\n`);
console.log(`${which}: ${summary.entities.matched} of ${summary.entities.truthEligible} true pieces matched, ${summary.entities.missing} missing, ${summary.entities.extra} extra built pieces`);
console.log(`  position median ${summary.entities.posMedianM} m (${summary.entities.posWithin25cm} within 25 cm), width error ${summary.entities.widthErrMedian}, height error ${summary.entities.heightErrMedian}, colour deltaE ${summary.entities.colourDEMedian}, mask IoU median ${summary.entities.maskIouMedian}`);
console.log(`  shell width ${shell.width.built}/${shell.width.truth} depth ${shell.depth.built}/${shell.depth.truth} height ${shell.height.built}/${shell.height.truth}; camera fov err ${camera.hfovErr} deg, height err ${camera.heightErr} m, pitch err ${camera.pitchErr} deg`);
console.log(`  structure IoU floor ${summary.structureIou.floor} ceiling ${summary.structureIou.ceiling} wall ${summary.structureIou.wall}`);
if (summary.judge) console.log(`  the run's own judge: ${summary.judge.passed}/${summary.judge.total} (${summary.judge.passRate})${summary.judge.judgeScore !== null ? `, judge score ${summary.judge.judgeScore}` : ''}`);
for (const r of rows) console.log(`  ${r.kind.padEnd(12)} ${r.built ? `-> ${r.builtKind} pos ${r.posM} m, w x${r.wRatio} h x${r.hRatio}, dE ${r.colourDE}, IoU ${r.iou}` : 'MISSING'}`);
if (extra.length > 0) console.log(`  extra: ${extra.join(', ')}`);
