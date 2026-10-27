/**
 * Self-test fixtures: draw worlds we know from chosen cameras in the studio (GPU or software GL), and record the truth
 * (camera, room box, every piece, a per-pixel entity label and depth from rays cast on the real meshes).
 *
 *   GEN_GPU=intel npx tsx scripts/photo-selftest/render.ts [--worlds=a,b] [--out=dir] [--width=1280] [--force]
 *
 * Writes <out>/<world>/<pose>/{photo.png, photo.jpg, truth.json, masks.json}. Default out:
 * ~/.local/share/aether/qa/selftest. `photo.jpg` is the same picture through blur, noise and JPEG (a phone photo).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createWorld, type EntityId, type WorldDoc } from '@aether/core';
import { GpuRoom } from '../lib/gpu-room';
import { insideAnyPiece, makeCamera, rayAt, standardPoses, truthItems, truthRoom, basis, type PoseSpec, type TruthCamera } from '../../packages/agent/src/photo/selftest/truth';
import { SELFTEST_WORLDS, buildMasks, surfaceTruth, type RayHit } from '../../packages/agent/src/photo/selftest/fixture';

const args = process.argv.slice(2);
const opt = (k: string): string | undefined => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const out = resolve(opt('out') ?? join(homedir(), '.local/share/aether/qa/selftest'));
const width = Number(opt('width') ?? 1280);
const force = args.includes('--force');
const want = opt('worlds')?.split(',');
const GW = 256;

const worlds = SELFTEST_WORLDS.filter((w) => !want || want.includes(w.name));
const gpu = await GpuRoom.open({});
try {
  for (const spec of worlds) {
    const raw = JSON.parse(readFileSync(resolve('apps/studio/public/templates/worlds', `${spec.name}.json`), 'utf8')) as { world?: unknown };
    const world = createWorld((raw.world ?? raw) as never) as WorldDoc;
    const building = Object.values(world.entities).find((e) => e.arch?.role === 'building' && !e.parent);
    if (!building) { console.log(`${spec.name}: no building`); continue; }
    const first = truthRoom(world, building.id, makeCamera(0, [0, 0], 1.5, 0, 0, 70, 1.5));
    if (!first) { console.log(`${spec.name}: no rectangular room`); continue; }
    const levelEnt = Object.values(world.entities).find((e) => e.parent === building.id && e.arch?.role === 'level');
    const levelY = levelEnt?.transform.position[1] ?? 0;
    const poses: PoseSpec[] = spec.poses ?? standardPoses(first.room.bbox, spec.wide === true);
    let loaded = false;
    for (const ps of poses) {
      const dir = join(out, spec.name, ps.name);
      if (!force && existsSync(join(dir, 'truth.json'))) { console.log(`${spec.name}/${ps.name}: exists`); continue; }
      const [x0, z0, x1, z1] = first.room.bbox;
      const aspect = 1.5;
      const height = spec.eye ?? 1.5;
      // the eye stands where nothing else does: the nominal spot, else the nearest free one (0.2 m steps, inside the room)
      let at: [number, number] = [x0 + ps.at[0] * (x1 - x0), z0 + ps.at[1] * (z1 - z0)];
      const probe = truthRoom(world, building.id, makeCamera(0, at, height, ps.heading, ps.pitch, ps.hfov, aspect));
      if (probe) {
        const cands: Array<[number, number]> = [];
        for (let dx = -1.4; dx <= 1.4; dx += 0.2) for (let dz = -1.4; dz <= 1.4; dz += 0.2) cands.push([at[0] + dx, at[1] + dz]);
        cands.sort((a, b) => Math.hypot(a[0] - at[0], a[1] - at[1]) - Math.hypot(b[0] - at[0], b[1] - at[1]));
        const free = cands.find((c) => c[0] > x0 + 0.5 && c[0] < x1 - 0.5 && c[1] > z0 + 0.5 && c[1] < z1 - 0.5 && !insideAnyPiece(probe.scene, c[0], c[1], height));
        if (free) at = free;
      }
      const cam: TruthCamera = makeCamera(levelY, at, height, ps.heading, ps.pitch, ps.hfov, aspect);
      const tr = truthRoom(world, building.id, cam);
      if (!tr) continue;
      if (insideAnyPiece(tr.scene, at[0], at[1], height)) { console.log(`${spec.name}/${ps.name}: the eye is inside a piece, skipped`); continue; }
      mkdirSync(dir, { recursive: true });
      const h = Math.round(width / aspect);
      if (!loaded) { await gpu.load(world); loaded = true; }
      const png = await gpu.still({ position: cam.pos, target: [cam.pos[0] + basis(cam.heading, cam.pitch).fwd[0] * 5, cam.pos[1] + basis(cam.heading, cam.pitch).fwd[1] * 5, cam.pos[2] + basis(cam.heading, cam.pitch).fwd[2] * 5], fov: cam.vfov }, { width, height: h }, 'studio');
      writeFileSync(join(dir, 'photo.png'), png);
      // rays on the real meshes
      const GH = Math.round(GW / aspect);
      const dirs: number[] = [];
      for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) dirs.push(...rayAt(cam, i, j, GW, GH));
      const hits = await gpu.evaluate(
        ([o, d]) => {
          const r = window.__aether?.simulation?.renderer as unknown as { raycastWorld(o: number[], d: number[], max: number): { id: string; point: number[]; normal: number[] } | null };
          const arr = d as unknown as number[];
          const res: Array<[string, number, number, number, number] | null> = [];
          for (let k = 0; k < arr.length; k += 3) {
            const hit = r.raycastWorld(o as unknown as number[], [arr[k] as number, arr[k + 1] as number, arr[k + 2] as number], 60);
            res.push(hit ? [hit.id, hit.point[0] as number, hit.point[1] as number, hit.point[2] as number, hit.normal[1] as number] : null);
          }
          return res;
        },
        [[...cam.pos], dirs] as const,
      );
      const rayHits: Array<RayHit | null> = hits.map((x) => (x ? { id: x[0], p: [x[1], x[2], x[3]], ny: x[4] } : null));
      const items = truthItems(world, tr.scene, tr.room, tr.sr);
      const masks = buildMasks(cam, tr.room, items, GW, GH, rayHits);
      writeFileSync(join(dir, 'masks.json'), JSON.stringify(masks.masks));
      const truth = { world: spec.name, pose: ps.name, photo: { width, height: h }, camera: cam, room: tr.room, items: items.map((it) => ({ ...it, visible: masks.visible[it.id] ?? null })), levelY, surfaces: masks.surfaces, surfaceColours: surfaceTruth(world, building.id, tr.room.roomKey) };
      writeFileSync(join(dir, 'truth.json'), JSON.stringify(truth, null, 1));
      // a phone-photo variant: blur, sensor noise, JPEG
      spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', join(dir, 'photo.png'), '-vf', 'gblur=sigma=0.7,noise=alls=5:allf=t', '-q:v', '5', join(dir, 'photo.jpg')]);
      console.log(`${spec.name}/${ps.name}: ${items.length} pieces, ${rayHits.filter(Boolean).length}/${rayHits.length} rays hit`);
    }
  }
} finally {
  await gpu.close();
}
