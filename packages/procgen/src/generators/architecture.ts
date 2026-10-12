/**
 * Architecture generators: house, tower, wall, fence, bridge, stairs, arch,
 * ramp, windmill. Built from many small, individually colored parts merged
 * per material; compound box/cylinder/hull colliders (never trimesh).
 */
import type { MaterialSpec, Vec3 } from '@aether/core';
import type { InternalApi } from '../api';
import type { ColliderDesc } from '../types';
import type { Mesh } from '../kernel/mesh';
import { boxCollider, cylinderCollider } from '../colliders';
import { mixLinear } from '../color';
import {
  defineGenerator, glow, jitter, lin, MAT, paintNoise, paintSolid, pBool, pColor, pInt, pNum, pVariant, shade,
} from './kit';

const DEG = 180 / Math.PI;

/** Add a noise-tinted piece in one call. */
function piece(api: InternalApi, mesh: Mesh, color: string, material: MaterialSpec, variation = 0.12, freq = 2): void {
  paintNoise(mesh, api, shade(color, -variation), shade(color, variation), freq);
  api.add(mesh, material);
}

/** Window (frame + glass + sill) on a wall face; `axis` is the outward normal direction. */
function addWindow(
  api: InternalApi, x: number, y: number, z: number, axis: 'x+' | 'x-' | 'z+' | 'z-',
  w: number, h: number, trim: string, glass: MaterialSpec,
): void {
  const along = axis[0] === 'z';
  const sign = axis[1] === '+' ? 1 : -1;
  const place = (mesh: Mesh, out: number): Mesh =>
    along ? mesh.translate(x, y, z + sign * out) : mesh.rotate(0, 90, 0).translate(x + sign * out, y, z);
  piece(api, place(api.box(w + 0.16, h + 0.16, 0.08), 0.02), trim, MAT.wood, 0.08);
  api.add(place(api.box(w, h, 0.06), 0.05), glass);
  piece(api, place(api.box(w + 0.3, 0.08, 0.2), 0.08).translate(0, -h / 2 - 0.06, 0), trim, MAT.wood, 0.06);
  // cross mullions
  piece(api, place(api.box(0.05, h, 0.04), 0.09), trim, MAT.wood, 0.05);
  piece(api, place(api.box(w, 0.05, 0.04), 0.09), trim, MAT.wood, 0.05);
}

const house = defineGenerator({
  id: 'house',
  description: 'Cozy cottage with walls, foundation, pitched shingle roof, door, framed windows and a chimney. Multi-floor capable.',
  category: 'architecture',
  params: {
    width: pNum(6, 3, 20, 'width (x) in meters'),
    depth: pNum(5, 3, 20, 'depth (z) in meters'),
    floors: pInt(1, 1, 3, 'number of floors'),
    color: pColor('#e8dcc4', 'wall color'),
    roofColor: pColor('#a0442c', 'roof color'),
    trimColor: pColor('#5a3a22', 'door and window frame color'),
    lights: pBool(false, 'windows glow warmly (night scenes)'),
    variant: pVariant(2, '0 cottage, 1 modern flat roof, 2 timber frame'),
  },
  run(p, api) {
    const W = p.num('width');
    const D = p.num('depth');
    const floors = p.int('floors');
    const variant = p.int('variant');
    const wallC = p.color('color');
    const roofC = p.color('roofColor');
    const trim = p.color('trimColor');
    const glass: MaterialSpec = p.bool('lights') ? glow('#ffd98a', 1.2) : { ...MAT.glass };
    const floorH = 2.8;
    const base = 0.3;
    const wallH = floors * floorH;
    const top = base + wallH;

    piece(api, api.box(W + 0.3, base, D + 0.3).translate(0, base / 2, 0), '#8f8a82', MAT.stone, 0.15, 3);
    const walls = api.box(W, wallH, D).translate(0, base + wallH / 2, 0);
    const wc0 = lin(shade(wallC, -0.12));
    const wc1 = lin(shade(wallC, 0.06));
    walls.paintFn((x, y, z, _nx, _ny, _nz, out) => mixLinear(wc0, wc1, 0.5 + 0.5 * api.noise.noise3(x * 1.5, y * 1.5, z * 1.5) + (y - base) * 0.05, out));
    api.add(walls, { preset: 'concrete', vertexColors: true, roughness: 0.95, flatShading: true });
    api.collider(boxCollider(0, top / 2, 0, W + 0.3, top, D + 0.3));

    if (variant === 2) {
      // timber frame: corner posts, floor beams and diagonal braces
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) piece(api, api.box(0.2, wallH, 0.2).translate(sx * (W / 2 + 0.02), base + wallH / 2, sz * (D / 2 + 0.02)), trim, MAT.wood);
      }
      for (let f = 0; f <= floors; f++) {
        const y = base + f * floorH - (f === floors ? 0.1 : 0);
        piece(api, api.box(W + 0.08, 0.18, 0.12).translate(0, y, D / 2 + 0.04), trim, MAT.wood);
        piece(api, api.box(W + 0.08, 0.18, 0.12).translate(0, y, -D / 2 - 0.04), trim, MAT.wood);
        piece(api, api.box(0.12, 0.18, D + 0.08).translate(W / 2 + 0.04, y, 0), trim, MAT.wood);
        piece(api, api.box(0.12, 0.18, D + 0.08).translate(-W / 2 - 0.04, y, 0), trim, MAT.wood);
      }
      for (let f = 0; f < floors; f++) {
        const y = base + f * floorH + floorH / 2;
        const len = Math.hypot(W * 0.22, floorH);
        const ang = Math.atan2(floorH, W * 0.22) * DEG;
        for (const sx of [-1, 1]) {
          piece(api, api.box(0.12, len, 0.1).rotate(0, 0, sx * (90 - ang)).translate(sx * W * 0.36, y, D / 2 + 0.05), trim, MAT.wood);
        }
      }
    }

    // door + step + lamp-ish knob
    const doorX = floors > 1 || W < 4.5 ? 0 : -W * 0.15;
    piece(api, api.box(1.3, 2.3, 0.1).translate(doorX, base + 1.15, D / 2 + 0.03), shade(trim, -0.2), MAT.wood, 0.05);
    const door = api.box(1.05, 2.1, 0.1).translate(doorX, base + 1.05, D / 2 + 0.07);
    const dc0 = lin(shade(trim, -0.08));
    const dc1 = lin(shade(trim, 0.14));
    door.paintFn((x, _y, _z, _nx, _ny, _nz, out) => mixLinear(dc0, dc1, (Math.floor((x - doorX + 0.6) * 6) % 2) * 0.6 + 0.2, out));
    api.add(door, MAT.wood);
    piece(api, api.sphere(0.05, 0).translate(doorX + 0.38, base + 1.05, D / 2 + 0.14), '#d4af37', MAT.metal, 0.05);
    piece(api, api.box(1.6, base, 0.7).translate(doorX, base / 2, D / 2 + 0.45), '#8f8a82', MAT.stone, 0.12, 3);

    // windows
    const ww = variant === 1 ? 1.6 : 0.9;
    const wh = variant === 1 ? 1.4 : 1.0;
    for (let f = 0; f < floors; f++) {
      const y = base + f * floorH + 1.5;
      const front = f === 0 ? (doorX === 0 ? [-W * 0.3, W * 0.3] : [W * 0.2]) : [-W * 0.3, 0, W * 0.3];
      for (const x of front) addWindow(api, x, y, D / 2, 'z+', ww, wh, trim, glass);
      for (const x of [-W * 0.25, W * 0.25]) addWindow(api, x, y, -D / 2, 'z-', ww, wh, trim, glass);
      addWindow(api, W / 2, y, 0, 'x+', ww, wh, trim, glass);
      addWindow(api, -W / 2, y, 0, 'x-', ww, wh, trim, glass);
    }

    if (variant === 1) {
      // flat roof with parapet
      piece(api, api.box(W + 0.4, 0.3, D + 0.4).translate(0, top + 0.15, 0), shade(wallC, -0.25), MAT.stone, 0.06);
      piece(api, api.box(W * 0.35, 0.9, D * 0.3).translate(W * 0.18, top + 0.75, -D * 0.15), '#9aa0a6', MAT.metal, 0.08);
      api.collider(boxCollider(0, top + 0.15, 0, W + 0.4, 0.3, D + 0.4));
    } else {
      const over = 0.45;
      const roofH = Math.min(W * 0.45, 3.2);
      const gable = api.extrude([[-W / 2, 0], [W / 2, 0], [0, roofH]], D).translate(0, top, 0);
      paintNoise(gable, api, shade(wallC, -0.15), wallC, 1.5);
      api.add(gable, { preset: 'concrete', vertexColors: true, roughness: 0.95, flatShading: true });
      const run = W / 2 + over;
      const slope = Math.atan2(roofH, W / 2);
      const slabLen = run / Math.cos(slope);
      const thick = 0.18;
      const r0 = lin(shade(roofC, -0.22));
      const r1 = lin(shade(roofC, 0.08));
      for (const sx of [-1, 1]) {
        const slab = api.box(slabLen, thick, D + over * 2);
        slab.paintFn((x, _y, z, _nx, _ny, _nz, out) => {
          const row = Math.floor((x + slabLen / 2) * 3.2);
          mixLinear(r0, r1, (row % 2) * 0.55 + 0.25 * api.noise.noise2(x * 2 + row, z * 1.3), out);
        });
        // ridge at x=0, eave at x = sx*run; slab center halfway, lifted by half thickness along its normal
        const cx = (sx * run) / 2;
        const cy = top + roofH - (run / 2) * Math.tan(slope);
        slab.rotate(0, 0, -sx * slope * DEG).translate(cx + sx * Math.sin(slope) * thick * 0.5, cy + Math.cos(slope) * thick * 0.5, 0);
        api.add(slab, { preset: 'brick', vertexColors: true, roughness: 0.85, flatShading: true });
      }
      piece(api, api.box(0.22, 0.22, D + over * 2 + 0.05).rotate(0, 0, 45).translate(0, top + roofH + 0.08, 0), shade(roofC, -0.35), MAT.wood, 0.05);
      const chimneyH = roofH * 0.5 + 1.2;
      const chx = W * 0.25;
      const roofAtChimney = top + roofH * (1 - chx / (W / 2));
      const chimney = api.box(0.65, chimneyH, 0.65).translate(chx, roofAtChimney - 0.3 + chimneyH / 2, -D * 0.2);
      piece(api, chimney, '#8d4b3a', MAT.brick, 0.18, 4);
      const chb = chimney.bounds();
      piece(api, api.box(0.8, 0.12, 0.8).translate(chx, chb.max[1], -D * 0.2), '#6d6a66', MAT.stone, 0.05);
      const roofHull: number[] = [];
      for (const z of [-D / 2 - over, D / 2 + over]) roofHull.push(-run, top - over * Math.tan(slope), z, run, top - over * Math.tan(slope), z, 0, top + roofH + 0.15, z);
      api.collider({ kind: 'hull', points: new Float32Array(roofHull), offset: [0, 0, 0] });
      api.collider(boxCollider(chx, (chb.min[1] + chb.max[1]) / 2, -D * 0.2, 0.65, chb.max[1] - chb.min[1], 0.65));
    }
    return api.build();
  },
});

const tower = defineGenerator({
  id: 'tower',
  description: 'Round stone tower with block courses, arrow-slit windows, a door and either a conical roof or battlements.',
  category: 'architecture',
  params: {
    height: pNum(12, 4, 60, 'height of the masonry in meters'),
    radius: pNum(2.5, 1, 15, 'radius in meters'),
    color: pColor('#9a948a', 'stone color'),
    roofColor: pColor('#4a5a8a', 'roof color'),
    variant: pVariant(2, '0 conical roof, 1 battlements, 2 wizard spire'),
  },
  run(p, api) {
    const H = p.num('height');
    const R = p.num('radius');
    const variant = p.int('variant');
    const stone = p.color('color');
    const segs = 12;
    const body = api.cylinder(R * 0.93, R, H, segs).translate(0, H / 2, 0);
    const s0 = lin(shade(stone, -0.18));
    const s1 = lin(shade(stone, 0.1));
    body.paintFn((x, y, z, _nx, _ny, _nz, out) => {
      const course = Math.floor(y / 0.55);
      const a = Math.atan2(x, z) * 4 + (course % 2) * 0.5;
      const block = Math.floor(a) + course * 7;
      mixLinear(s0, s1, ((block * 2654435761) >>> 0) % 997 / 997 * 0.7 + 0.15 * api.noise.noise3(x, y, z), out);
    });
    api.add(body, MAT.stone);
    piece(api, api.cylinder(R * 1.1, R * 1.15, 0.8, segs).translate(0, 0.4, 0), shade(stone, -0.2), MAT.stone, 0.1, 3);
    api.collider(cylinderCollider(0, H / 2, 0, R, H));

    const dark = '#20232a';
    for (let level = 1; level * 3 < H - 1; level++) {
      const y = level * 3 + 0.5;
      for (let k = 0; k < 3; k++) {
        const ang = (k / 3) * 360 + level * 47;
        const slit = api.box(0.28, 1.0, 0.3).translate(0, y, R * 0.95 - 0.08).rotate(0, ang, 0);
        paintSolid(slit, dark);
        api.add(slit, MAT.stone);
      }
    }
    const door = api.box(1.2, 2.2, 0.4).translate(0, 1.1, R - 0.12);
    paintNoise(door, api, '#4a2f1b', '#6b4529', 5);
    api.add(door, MAT.wood);
    piece(api, api.box(1.6, 0.3, 0.45).translate(0, 2.35, R - 0.1), shade(stone, -0.25), MAT.stone);

    const roofC = p.color('roofColor');
    if (variant === 1) {
      piece(api, api.cylinder(R * 1.12, R * 0.95, 0.6, segs).translate(0, H + 0.3, 0), stone, MAT.stone, 0.1, 3);
      const merlons = 12;
      for (let k = 0; k < merlons; k += 1) {
        if (k % 2) continue;
        const m = api.box(0.9, 0.9, 0.5).translate(0, H + 0.6 + 0.45, R * 1.02).rotate(0, (k / merlons) * 360, 0);
        piece(api, m, stone, MAT.stone, 0.15, 3);
      }
      api.collider(cylinderCollider(0, H + 0.75, 0, R * 1.12, 1.5));
    } else {
      const roofH = variant === 2 ? R * 3.4 : R * 1.6;
      const roofR = R * 1.3;
      const roof = api.lathe([[0, 0], [roofR, 0], [roofR * 0.92, roofH * 0.1], [roofR * 0.35, roofH * 0.65], [0, roofH]], segs).translate(0, H, 0);
      const r0 = lin(shade(roofC, -0.25));
      const r1 = lin(shade(roofC, 0.12));
      roof.paintFn((x, y, z, _nx, _ny, _nz, out) => mixLinear(r0, r1, (Math.floor((y - H) * 2.5) % 2) * 0.5 + 0.2 * api.noise.noise3(x, y, z) + 0.2, out));
      api.add(roof, { preset: 'brick', vertexColors: true, roughness: 0.8, flatShading: true });
      piece(api, api.sphere(R * 0.12, 1).translate(0, H + roofH + R * 0.08, 0), '#e5b93c', MAT.metal, 0.1);
      if (variant === 2) {
        const flag = api.box(R * 0.6, R * 0.35, 0.03).translate(R * 0.3, H + roofH + R * 0.55, 0);
        paintSolid(flag, '#d1453b');
        api.add(flag, MAT.fabric);
        piece(api, api.cylinder(0.04, 0.04, R * 0.9, 5).translate(0, H + roofH + R * 0.45, 0), '#5a4a3a', MAT.wood);
      }
      const hull: number[] = [];
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        hull.push(Math.cos(a) * roofR, H, Math.sin(a) * roofR);
      }
      hull.push(0, H + roofH, 0);
      api.collider({ kind: 'hull', points: new Float32Array(hull), offset: [0, 0, 0] });
    }
    return api.build();
  },
});

const wall = defineGenerator({
  id: 'wall',
  description: 'Straight defensive or garden wall along X built from staggered stone blocks or bricks (optional battlements), or a wooden palisade.',
  category: 'architecture',
  params: {
    length: pNum(8, 1, 100, 'length along X in meters'),
    height: pNum(3, 0.5, 20, 'height in meters'),
    thickness: pNum(0.8, 0.2, 5, 'thickness in meters'),
    color: pColor('#9a948a', 'stone / brick / wood color'),
    crenellated: pBool(true, 'battlements on top (stone/brick)'),
    variant: pVariant(2, '0 stone blocks, 1 brick, 2 wooden palisade'),
  },
  run(p, api) {
    const L = p.num('length');
    const H = p.num('height');
    const T = p.num('thickness');
    const variant = p.int('variant');
    const c = p.color('color');
    if (variant === 2) {
      const count = Math.max(3, Math.min(60, Math.round(L / 0.35)));
      const r = L / count / 2;
      for (let i = 0; i < count; i++) {
        const x = -L / 2 + r + i * 2 * r;
        const h = H * api.range(0.9, 1.05);
        const log = api.cylinder(r * 0.95, r, h, 7).translate(x, h / 2, 0);
        const tip = api.cone(r * 0.95, r * 2.2, 7).translate(x, h + r * 1.1, 0);
        const lc = jitter(api, c === '#9a948a' ? '#8b5a2b' : c, 0.12);
        paintNoise(log.merge(tip), api, shade(lc, -0.15), shade(lc, 0.1), 3);
        api.add(log, MAT.wood);
      }
      piece(api, api.box(L, 0.18, 0.1).translate(0, H * 0.75, -r - 0.05), '#5a3a22', MAT.wood);
      piece(api, api.box(L, 0.18, 0.1).translate(0, H * 0.3, -r - 0.05), '#5a3a22', MAT.wood);
      api.collider(boxCollider(0, H / 2, 0, L, H, r * 2));
      return api.build();
    }
    const brick = variant === 1;
    const rows = Math.max(1, Math.min(brick ? 20 : 12, Math.round(H / (brick ? 0.25 : 0.5))));
    const rowH = H / rows;
    const cols = Math.max(1, Math.min(brick ? 24 : 20, Math.round(L / (brick ? 0.5 : 1))));
    const blockL = L / cols;
    const core = api.box(Math.max(0.05, L - 0.04), H, Math.max(0.05, T - 0.08)).translate(0, H / 2, 0);
    paintSolid(core, shade(c, -0.45));
    api.add(core, brick ? MAT.brick : MAT.stone);
    for (let r = 0; r < rows; r++) {
      const offset = r % 2 ? blockL / 2 : 0;
      for (let k = -1; k < cols; k++) {
        let x0 = -L / 2 + k * blockL + offset;
        let x1 = x0 + blockL;
        x0 = Math.max(-L / 2, x0);
        x1 = Math.min(L / 2, x1);
        if (x1 - x0 < 0.05) continue;
        const gap = brick ? 0.02 : 0.035;
        const blk = api.box(x1 - x0 - gap, rowH - gap, T + api.range(-0.02, 0.03));
        blk.translate((x0 + x1) / 2, r * rowH + rowH / 2, api.range(-0.01, 0.01));
        piece(api, blk, jitter(api, c, brick ? 0.1 : 0.14), brick ? MAT.brick : MAT.stone, 0.06, 3);
      }
    }
    api.collider(boxCollider(0, H / 2, 0, L, H, T));
    if (p.bool('crenellated')) {
      const mw = Math.min(0.7, L / 3);
      const mh = Math.min(0.7, H * 0.35);
      const count = Math.max(1, Math.floor(L / (mw * 2)));
      const spacing = L / count;
      for (let i = 0; i < count; i++) {
        const x = -L / 2 + spacing * (i + 0.5);
        piece(api, api.box(mw, mh, T + 0.04).translate(x, H + mh / 2, 0), jitter(api, c, 0.1), brick ? MAT.brick : MAT.stone, 0.08, 3);
        api.collider(boxCollider(x, H + mh / 2, 0, mw, mh, T));
      }
    }
    return api.build();
  },
});

const fence = defineGenerator({
  id: 'fence',
  description: 'Fence segment along X: picket, ranch rails, or wrought iron with spear tips.',
  category: 'architecture',
  params: {
    length: pNum(6, 1, 60, 'length along X in meters'),
    height: pNum(1.1, 0.3, 4, 'height in meters'),
    color: pColor('#8b5a2b', 'main color (e.g. #f2efe8 for a white picket fence)'),
    variant: pVariant(2, '0 picket, 1 ranch rails, 2 wrought iron'),
  },
  run(p, api) {
    const L = p.num('length');
    const H = p.num('height');
    const variant = p.int('variant');
    const c = variant === 2 && p.color('color') === '#8b5a2b' ? '#2b2d31' : p.color('color');
    const mat = variant === 2 ? MAT.metal : MAT.wood;
    const posts = Math.max(2, Math.round(L / 2) + 1);
    for (let i = 0; i < posts; i++) {
      const x = -L / 2 + (i * L) / (posts - 1);
      if (variant === 2) piece(api, api.cylinder(0.05, 0.05, H * 1.05, 6).translate(x, H * 0.525, 0), c, mat, 0.05);
      else {
        piece(api, api.box(0.13, H * 1.05, 0.13).translate(x, H * 0.525, 0), jitter(api, c, 0.08), mat, 0.1, 4);
        piece(api, api.box(0.17, 0.05, 0.17).translate(x, H * 1.05 + 0.025, 0), shade(c, -0.1), mat, 0.05);
      }
    }
    const rails = variant === 1 ? [0.3, 0.6, 0.9] : [0.25, 0.75];
    for (const r of rails) {
      const rail = variant === 2 ? api.box(L, 0.04, 0.04) : api.box(L, H * 0.09, 0.05);
      piece(api, rail.translate(0, H * r, variant === 1 ? 0.09 : -0.06), c, mat, 0.1, 2);
    }
    if (variant !== 1) {
      const spacing = Math.max(variant === 2 ? 0.14 : 0.18, L / 80);
      const count = Math.floor(L / spacing);
      for (let i = 0; i < count; i++) {
        const x = -L / 2 + spacing * (i + 0.5);
        if (variant === 2) {
          const bar = api.cylinder(0.015, 0.015, H * 0.9, 5).translate(x, H * 0.45, 0);
          bar.merge(api.cone(0.04, 0.12, 4).translate(x, H * 0.9 + 0.06, 0));
          piece(api, bar, c, mat, 0.05);
        } else {
          const h = H * 0.85;
          const picket = api.box(0.09, h, 0.03).translate(x, h / 2 + 0.04, 0.03);
          picket.merge(api.cone(0.064, 0.09, 4).rotate(0, 45, 0).scale(1, 1, 0.35).translate(x, h + 0.085, 0.03));
          piece(api, picket, jitter(api, c, 0.06), mat, 0.06, 5);
        }
      }
    }
    api.collider(boxCollider(0, H / 2, 0, L, H, 0.16));
    return api.build();
  },
});

/** Points along a parabolic arc from x=-L/2 to L/2 with rise `h` at the center. */
function arcY(x: number, L: number, h: number): number {
  const t = (2 * x) / L;
  return h * (1 - t * t);
}

const bridge = defineGenerator({
  id: 'bridge',
  description: 'Bridge spanning X: arched wooden plank bridge with railings, or a solid stone arch bridge with parapets. Walkable deck colliders.',
  category: 'architecture',
  params: {
    length: pNum(10, 3, 60, 'span along X in meters'),
    width: pNum(3, 1, 12, 'deck width in meters'),
    height: pNum(1.5, 0, 10, 'arch rise at the center in meters'),
    color: pColor('#8b5a2b', 'main color (wood or stone)'),
    variant: pVariant(1, '0 wooden, 1 stone'),
  },
  run(p, api) {
    const L = p.num('length');
    const W = p.num('width');
    const rise = p.num('height');
    const stone = p.int('variant') === 1;
    const c = stone && p.color('color') === '#8b5a2b' ? '#a39d92' : p.color('color');
    const deck = 0.25;
    const segs = Math.max(4, Math.min(10, Math.round(L / 2)));
    if (stone) {
      const thick = Math.max(0.6, rise * 0.4 + 0.5);
      const top: Array<[number, number]> = [];
      for (let i = 0; i <= 16; i++) {
        const x = -L / 2 + (i * L) / 16;
        top.push([x, arcY(x, L, rise) + thick]);
      }
      const a = L * 0.36;
      const archH = Math.max(0.4, Math.min(rise + thick * 0.4, a * 0.9));
      const shape: Array<[number, number]> = [[-L / 2, 0], [-a, 0]];
      for (let i = 1; i < 12; i++) {
        const ang = Math.PI - (i / 12) * Math.PI;
        shape.push([Math.cos(ang) * a, Math.sin(ang) * archH]);
      }
      shape.push([a, 0], [L / 2, 0]);
      for (let i = top.length - 1; i >= 0; i--) shape.push(top[i] as [number, number]);
      const body = api.extrude(shape, W);
      const s0 = lin(shade(c, -0.2));
      const s1 = lin(shade(c, 0.1));
      body.paintFn((x, y, z, _nx, _ny, _nz, out) => {
        const blk = Math.floor(x * 1.6 + (Math.floor(y * 2.2) % 2) * 0.5) * 31 + Math.floor(y * 2.2) * 17;
        mixLinear(s0, s1, (((blk * 2654435761) >>> 0) % 101) / 101 * 0.6 + 0.15 * api.noise.noise3(x, y, z), out);
      });
      api.add(body, MAT.stone);
      for (const sz of [-1, 1]) {
        const par: Array<[number, number]> = [];
        for (let i = 0; i <= 16; i++) par.push(top[i] as [number, number]);
        for (let i = 16; i >= 0; i--) {
          const q = top[i] as [number, number];
          par.push([q[0], q[1] + 0.7]);
        }
        piece(api, api.extrude(par, 0.3).translate(0, 0, sz * (W / 2 - 0.15)), shade(c, 0.05), MAT.stone, 0.1, 3);
      }
      for (let i = 0; i < segs; i++) {
        const x0 = -L / 2 + (i * L) / segs;
        const x1 = -L / 2 + ((i + 1) * L) / segs;
        const a0: Vec3 = [x0, arcY(x0, L, rise) + thick - 0.3, 0];
        const a1: Vec3 = [x1, arcY(x1, L, rise) + thick - 0.3, 0];
        api.collider(rotateBoxForSpan(a0, a1, W, 0.6));
        for (const sz of [-1, 1]) api.collider(rotateBoxForSpan([x0, a0[1] + 0.65, sz * (W / 2 - 0.15)], [x1, a1[1] + 0.65, sz * (W / 2 - 0.15)], 0.3, 0.7));
      }
      api.collider(boxCollider(-L / 2 + (L / 2 - a) / 2, thick / 2, 0, L / 2 - a, thick, W));
      api.collider(boxCollider(L / 2 - (L / 2 - a) / 2, thick / 2, 0, L / 2 - a, thick, W));
      return api.build();
    }
    // wooden
    const planks = Math.max(6, Math.min(120, Math.round(L / 0.32)));
    const pw = L / planks;
    for (let i = 0; i < planks; i++) {
      const x = -L / 2 + pw * (i + 0.5);
      const y = arcY(x, L, rise) + deck;
      const slope = Math.atan2(-8 * rise * x / (L * L), 1) * DEG;
      const plank = api.box(pw * 0.9, 0.08, W * api.range(0.96, 1.02)).rotate(0, 0, slope).translate(x, y, api.range(-0.03, 0.03));
      piece(api, plank, jitter(api, c, 0.12), MAT.wood, 0.08, 3);
    }
    const stringer = (z: number): void => {
      for (let i = 0; i < segs; i++) {
        const x0 = -L / 2 + (i * L) / segs;
        const x1 = -L / 2 + ((i + 1) * L) / segs;
        const a0: Vec3 = [x0, arcY(x0, L, rise) + deck - 0.16, z];
        const a1: Vec3 = [x1, arcY(x1, L, rise) + deck - 0.16, z];
        piece(api, api.limb(a0, a1, 0.12, 0.12, 4), shade(c, -0.25), MAT.wood, 0.08);
      }
    };
    stringer(W / 2 - 0.2);
    stringer(-W / 2 + 0.2);
    const posts = Math.max(3, Math.round(L / 1.6) + 1);
    const rail = 1.0;
    for (const sz of [-1, 1]) {
      const z = sz * (W / 2 - 0.05);
      let prev: Vec3 | null = null;
      for (let i = 0; i < posts; i++) {
        const x = -L / 2 + 0.1 + (i * (L - 0.2)) / (posts - 1);
        const y = arcY(x, L, rise) + deck;
        piece(api, api.box(0.12, rail, 0.12).translate(x, y + rail / 2, z), shade(c, -0.15), MAT.wood, 0.08, 4);
        const topP: Vec3 = [x, y + rail, z];
        if (prev) piece(api, api.limb(prev, topP, 0.05, 0.05, 4), shade(c, 0.05), MAT.wood, 0.06);
        prev = topP;
      }
    }
    for (const sx of [-1, 1]) piece(api, api.box(1, deck + 0.1, W + 0.4).translate(sx * (L / 2 + 0.3), (deck + 0.1) / 2, 0), '#8f8a82', MAT.stone, 0.15, 3);
    for (let i = 0; i < segs; i++) {
      const x0 = -L / 2 + (i * L) / segs;
      const x1 = -L / 2 + ((i + 1) * L) / segs;
      const a0: Vec3 = [x0, arcY(x0, L, rise) + deck - 0.1, 0];
      const a1: Vec3 = [x1, arcY(x1, L, rise) + deck - 0.1, 0];
      api.collider(rotateBoxForSpan(a0, a1, W, 0.2));
      for (const sz of [-1, 1]) {
        api.collider(rotateBoxForSpan([x0, a0[1] + 0.6, sz * (W / 2 - 0.05)], [x1, a1[1] + 0.6, sz * (W / 2 - 0.05)], 0.12, rail));
      }
    }
    return api.build();
  },
});

/** Box spanning a→b (in the XY plane) with depth `w` (z) and thickness `t`. */
function rotateBoxForSpan(a: Vec3, b: Vec3, w: number, t: number): ColliderDesc {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.max(1e-3, Math.hypot(dx, dy));
  return {
    kind: 'box',
    halfExtents: [len / 2 + 0.02, Math.max(1e-3, t / 2), Math.max(1e-3, w / 2)],
    offset: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2],
    rotation: [0, 0, Math.atan2(dy, dx) * DEG],
  };
}

const stairs = defineGenerator({
  id: 'stairs',
  description: 'Staircase rising along +X: solid stone steps, wooden steps with stringers and handrail, or floating slabs on a spine.',
  category: 'architecture',
  params: {
    steps: pInt(8, 2, 40, 'number of steps'),
    width: pNum(2, 0.5, 10, 'width (z) in meters'),
    height: pNum(2.4, 0.3, 20, 'total rise in meters'),
    depth: pNum(3.2, 0.5, 40, 'total run (x) in meters'),
    color: pColor('#a39e93', 'main color'),
    variant: pVariant(2, '0 solid stone, 1 wooden, 2 floating slabs'),
  },
  run(p, api) {
    const n = p.int('steps');
    const W = p.num('width');
    const H = p.num('height');
    const D = p.num('depth');
    const variant = p.int('variant');
    const c = variant === 1 && p.color('color') === '#a39e93' ? '#9a6a3c' : p.color('color');
    const rise = H / n;
    const run = D / n;
    for (let i = 0; i < n; i++) {
      const x = -D / 2 + run * (i + 0.5);
      const y = rise * (i + 1);
      if (variant === 0) {
        piece(api, api.box(run, y, W).translate(x, y / 2, 0), jitter(api, c, 0.08), MAT.stone, 0.1, 2);
        piece(api, api.box(run + 0.04, 0.05, W + 0.02).translate(x + 0.02, y - 0.02, 0), shade(c, 0.12), MAT.stone, 0.05, 3);
        api.collider(boxCollider(x, y / 2, 0, run, y, W));
      } else {
        const t = variant === 1 ? 0.07 : 0.16;
        piece(api, api.box(run * 1.08, t, W).translate(x, y - t / 2, 0), jitter(api, c, 0.1), variant === 1 ? MAT.wood : MAT.stone, 0.08, 3);
        api.collider(boxCollider(x, y - t / 2, 0, run, t, W));
      }
    }
    const start: Vec3 = [-D / 2, 0, 0];
    const end: Vec3 = [D / 2, H, 0];
    if (variant === 1) {
      for (const sz of [-1, 1]) {
        piece(api, api.limb([start[0], 0.1, sz * (W / 2 + 0.04)], [end[0], H - 0.05, sz * (W / 2 + 0.04)], 0.08, 0.08, 4), shade(c, -0.2), MAT.wood, 0.06);
      }
      const posts = Math.max(2, Math.round(n / 3) + 1);
      let prev: Vec3 | null = null;
      for (let i = 0; i < posts; i++) {
        const f = i / (posts - 1);
        const x = -D / 2 + run * 0.5 + f * (D - run);
        const y = rise * (1 + f * (n - 1));
        piece(api, api.box(0.08, 0.95, 0.08).translate(x, y + 0.47, W / 2 - 0.05), shade(c, -0.1), MAT.wood, 0.05);
        const topP: Vec3 = [x, y + 0.95, W / 2 - 0.05];
        if (prev) piece(api, api.limb(prev, topP, 0.045, 0.045, 5), shade(c, 0.1), MAT.wood, 0.05);
        prev = topP;
      }
    } else if (variant === 2) {
      piece(api, api.limb([start[0] + run * 0.5, 0, 0], [end[0] - run * 0.5, H - rise * 0.6, 0], 0.18, 0.18, 6), '#3b3e44', MAT.metal, 0.05);
    }
    return api.build();
  },
});

/** One wedge-shaped arch stone between angles a0..a1 around (cx, cy). */
function voussoir(api: InternalApi, cx: number, cy: number, r0: number, r1: number, a0: number, a1: number, depth: number): Mesh {
  return api.extrude(
    [
      [cx + Math.cos(a0) * r0, cy + Math.sin(a0) * r0],
      [cx + Math.cos(a0) * r1, cy + Math.sin(a0) * r1],
      [cx + Math.cos(a1) * r1, cy + Math.sin(a1) * r1],
      [cx + Math.cos(a1) * r0, cy + Math.sin(a1) * r0],
    ],
    depth,
  );
}

const arch = defineGenerator({
  id: 'arch',
  description: 'Freestanding archway: round Roman stone arch, pointed gothic arch, or a Japanese torii gate.',
  category: 'architecture',
  params: {
    width: pNum(4, 1, 30, 'opening width in meters'),
    height: pNum(5, 1.5, 40, 'total height in meters'),
    thickness: pNum(1, 0.2, 6, 'depth (z) in meters'),
    color: pColor('#a8a29a', 'stone color'),
    accentColor: pColor('#c0392b', 'torii lacquer color'),
    variant: pVariant(2, '0 round arch, 1 gothic pointed arch, 2 torii gate'),
  },
  run(p, api) {
    const Wd = p.num('width');
    const H = p.num('height');
    const T = p.num('thickness');
    const variant = p.int('variant');
    const c = p.color('color');
    if (variant === 2) {
      const red = p.color('accentColor');
      const pr = Math.max(0.12, Wd * 0.05);
      for (const sx of [-1, 1]) {
        const x = sx * (Wd / 2 + pr);
        piece(api, api.cylinder(pr * 0.9, pr, H * 0.92, 10).translate(x, H * 0.46, 0), red, MAT.paint, 0.06);
        piece(api, api.cylinder(pr * 1.25, pr * 1.25, H * 0.07, 10).translate(x, H * 0.035, 0), '#1f1f22', MAT.paint, 0.04);
        api.collider(cylinderCollider(x, H * 0.46, 0, pr, H * 0.92));
      }
      const span = Wd + pr * 6;
      piece(api, api.box(span * 0.92, H * 0.06, pr * 1.4).translate(0, H * 0.72, 0), red, MAT.paint, 0.06);
      const beam: Array<[number, number]> = [];
      for (let i = 0; i <= 10; i++) {
        const x = -span / 2 + (i * span) / 10;
        beam.push([x, H * 0.86 + Math.pow((2 * x) / span, 2) * H * 0.05]);
      }
      for (let i = 10; i >= 0; i--) {
        const q = beam[i] as [number, number];
        beam.push([q[0] * 1.04, q[1] + H * 0.07]);
      }
      const kasagi = api.extrude(beam, pr * 2.2);
      paintNoise(kasagi, api, '#1f1f22', '#34343a', 2);
      api.add(kasagi, MAT.paint);
      piece(api, api.box(span * 0.95, H * 0.05, pr * 2).translate(0, H * 0.86, 0), red, MAT.paint, 0.05);
      piece(api, api.box(pr * 1.2, H * 0.13, pr * 0.9).translate(0, H * 0.79, 0), red, MAT.paint, 0.05);
      api.collider(boxCollider(0, H * 0.9, 0, span, H * 0.16, pr * 2.2));
      return api.build();
    }
    const pw = Math.max(0.4, Wd * 0.18);
    const R = Wd / 2;
    const rise = variant === 1 ? Wd * 0.85 : R;
    const springY = Math.max(0.6, H - rise - pw);
    for (const sx of [-1, 1]) {
      const x = sx * (R + pw / 2);
      piece(api, api.box(pw * 1.25, 0.35, T * 1.15).translate(x, 0.175, 0), shade(c, -0.12), MAT.stone, 0.08, 3);
      const courses = Math.max(1, Math.round(springY / 0.6));
      for (let k = 0; k < courses; k++) {
        const h = springY / courses;
        piece(api, api.box(pw, h - 0.03, T).translate(x, k * h + h / 2, 0), jitter(api, c, 0.1), MAT.stone, 0.06, 3);
      }
      piece(api, api.box(pw * 1.2, 0.22, T * 1.1).translate(x, springY + 0.11, 0), shade(c, 0.08), MAT.stone, 0.06, 3);
      api.collider(boxCollider(x, (springY + 0.22) / 2, 0, pw * 1.2, springY + 0.22, T * 1.1));
    }
    const base = springY + 0.22;
    const addRing = (cx: number, r: number, from: number, to: number, count: number): void => {
      for (let k = 0; k < count; k++) {
        const a0 = from + ((to - from) * k) / count;
        const a1 = from + ((to - from) * (k + 1)) / count;
        const gap = 0.012;
        const v = voussoir(api, cx, base, r, r + pw, a0 + gap, a1 - gap, T);
        piece(api, v, jitter(api, c, 0.1), MAT.stone, 0.06, 3);
        const am = (a0 + a1) / 2;
        const rm = r + pw / 2;
        api.collider({
          kind: 'box',
          halfExtents: [pw / 2, (Math.abs(a1 - a0) * rm) / 2, T / 2],
          offset: [cx + Math.cos(am) * rm, base + Math.sin(am) * rm, 0],
          rotation: [0, 0, am * DEG],
        });
      }
    };
    if (variant === 1) {
      const Rg = Wd * 0.95;
      const off = Rg - R;
      const aTop = Math.acos(off / Rg);
      addRing(off, Rg, Math.PI, Math.PI - aTop, 5);
      addRing(-off, Rg, aTop, 0, 5);
      const apexY = base + Math.sin(aTop) * (Rg + pw * 0.5);
      piece(api, api.box(pw * 0.75, pw * 0.75, T * 1.06).rotate(0, 0, 45).translate(0, apexY, 0), shade(c, 0.1), MAT.stone, 0.05, 3);
    } else {
      addRing(0, R, Math.PI, 0, 9);
      const key = voussoir(api, 0, base, R - 0.05, R + pw + 0.12, Math.PI / 2 - 0.09, Math.PI / 2 + 0.09, T * 1.08);
      piece(api, key, shade(c, 0.1), MAT.stone, 0.05, 3);
    }
    return api.build();
  },
});

const ramp = defineGenerator({
  id: 'ramp',
  description: 'Ramp rising along +X: solid concrete wedge with hazard-striped edge, or a wooden plank ramp on supports. Exact wedge collider.',
  category: 'architecture',
  params: {
    length: pNum(4, 0.5, 40, 'run along X in meters'),
    width: pNum(2, 0.3, 20, 'width (z) in meters'),
    height: pNum(1.2, 0.1, 15, 'rise at the high end in meters'),
    color: pColor('#8a8580', 'main color'),
    variant: pVariant(1, '0 solid wedge, 1 wooden plank ramp'),
  },
  run(p, api) {
    const L = p.num('length');
    const W = p.num('width');
    const H = p.num('height');
    const c = p.color('color');
    if (p.int('variant') === 1) {
      const wood = c === '#8a8580' ? '#9a6a3c' : c;
      const ang = Math.atan2(H, L) * DEG;
      const len = Math.hypot(L, H);
      const planks = Math.max(3, Math.min(60, Math.round(len / 0.3)));
      for (let i = 0; i < planks; i++) {
        const f = (i + 0.5) / planks;
        const plank = api.box(len / planks - 0.02, 0.06, W).rotate(0, 0, ang).translate(-L / 2 + f * L, f * H, 0);
        piece(api, plank, jitter(api, wood, 0.12), MAT.wood, 0.08, 3);
      }
      for (const f of [0.35, 0.7, 1]) {
        for (const sz of [-1, 1]) {
          const h = f * H;
          piece(api, api.box(0.12, h, 0.12).translate(-L / 2 + f * L - 0.08, h / 2, sz * (W / 2 - 0.08)), shade(wood, -0.2), MAT.wood, 0.05);
        }
      }
    } else {
      const wedge = api.extrude([[-L / 2, 0], [L / 2, 0], [L / 2, H]], W);
      const c0 = lin(shade(c, -0.22));
      const c1 = lin(shade(c, 0.12));
      wedge.paintFn((x, y, z, _nx, ny, _nz, out) => mixLinear(c0, c1, (ny > 0.2 ? 0.6 : 0) + 0.25 * api.noise.noise3(x * 2, y * 2, z * 2), out));
      // hazard stripes along both top edges: alternating yellow/black segments lying on the slope
      const ang = Math.atan2(H, L) * DEG;
      const len = Math.hypot(L, H);
      const segs = Math.max(4, Math.min(24, Math.round(len / 0.4)));
      for (const sz of [-1, 1]) {
        for (let i = 0; i < segs; i++) {
          const f = (i + 0.5) / segs;
          const stripe = api.box(len / segs, 0.02, 0.14).rotate(0, 0, ang).translate(-L / 2 + f * L, f * H + 0.012, sz * (W / 2 - 0.09));
          paintSolid(stripe, i % 2 ? '#1f1f22' : '#f2c230');
          api.add(stripe, { preset: 'plastic', vertexColors: true, roughness: 0.6 });
        }
      }
      api.add(wedge, { preset: 'concrete', vertexColors: true, roughness: 0.9, flatShading: true });
    }
    const pts: number[] = [];
    for (const z of [-W / 2, W / 2]) pts.push(-L / 2, 0, z, L / 2, 0, z, L / 2, H, z);
    api.collider({ kind: 'hull', points: new Float32Array(pts), offset: [0, 0, 0] });
    return api.build();
  },
});

const windmill = defineGenerator({
  id: 'windmill',
  description: 'Dutch-style windmill: tapered octagonal tower, door and windows, rotating-cap roof, hub and four lattice sail blades.',
  category: 'architecture',
  params: {
    height: pNum(9, 4, 30, 'height of the tower body in meters'),
    color: pColor('#e8e0d0', 'tower color'),
    roofColor: pColor('#8a3b2e', 'cap color'),
    bladeColor: pColor('#f5f0e6', 'sail color'),
    variant: pVariant(1, '0 plastered tower, 1 wooden smock mill'),
  },
  run(p, api) {
    const H = p.num('height');
    const variant = p.int('variant');
    const R = H * 0.17;
    const rt = R * 0.62;
    const towerC = variant === 1 && p.color('color') === '#e8e0d0' ? '#6e4a2c' : p.color('color');
    const tower = api.cylinder(rt, R, H, 8).translate(0, H / 2, 0);
    const t0 = lin(shade(towerC, -0.15));
    const t1 = lin(shade(towerC, 0.06));
    tower.paintFn((x, y, z, _nx, _ny, _nz, out) => {
      const band = variant === 1 ? (Math.floor(y * 3) % 2) * 0.5 : 0;
      mixLinear(t0, t1, 0.4 + band + 0.25 * api.noise.noise3(x, y, z), out);
    });
    api.add(tower, variant === 1 ? MAT.wood : { preset: 'concrete', vertexColors: true, roughness: 0.9, flatShading: true });
    piece(api, api.cylinder(R * 1.08, R * 1.12, 0.5, 8).translate(0, 0.25, 0), '#8f8a82', MAT.stone, 0.12, 3);
    api.collider(cylinderCollider(0, H / 2, 0, (R + rt) / 2 + 0.05, H));
    const door = api.box(R * 0.45, Math.min(2.1, H * 0.22), 0.15).translate(0, Math.min(2.1, H * 0.22) / 2 + 0.5, R * 0.96);
    piece(api, door, '#5a3a22', MAT.wood, 0.1, 5);
    for (const f of [0.45, 0.72]) {
      const y = H * f;
      const rr = R + (rt - R) * f;
      const win = api.box(R * 0.28, R * 0.32, 0.12).translate(0, y, rr * 0.94).rotate(0, 35, 0);
      paintSolid(win, '#2d3a4a');
      api.add(win, MAT.glass);
    }
    // balcony / gallery for smock mills
    if (variant === 1) {
      piece(api, api.cylinder(R * 1.25, R * 1.25, 0.15, 8).translate(0, H * 0.35, 0), '#5a3a22', MAT.wood, 0.08);
    }
    const capH = R * 1.1;
    const cap = api.lathe([[0, 0], [rt * 1.25, 0], [rt * 1.2, capH * 0.25], [rt * 0.7, capH * 0.8], [0, capH]], 8).translate(0, H, 0);
    paintNoise(cap, api, shade(p.color('roofColor'), -0.2), shade(p.color('roofColor'), 0.1), 2);
    api.add(cap, { preset: 'wood', vertexColors: true, roughness: 0.8, flatShading: true });
    api.collider(cylinderCollider(0, H + capH * 0.4, 0, rt * 1.2, capH * 0.8));
    const hubZ = rt * 1.25 + 0.25;
    const hubY = H + capH * 0.3;
    piece(api, api.cylinder(0.18 * R, 0.24 * R, 0.6, 8).rotate(90, 0, 0).translate(0, hubY, hubZ - 0.2), '#3b3e44', MAT.metal, 0.05);
    const bladeLen = H * 0.48;
    const bladeW = bladeLen * 0.22;
    const bladeC = p.color('bladeColor');
    const offset = api.rng() * 30;
    for (let k = 0; k < 4; k++) {
      const ang = offset + k * 90;
      const spar = api.box(0.1, bladeLen, 0.08).translate(0, bladeLen / 2, 0);
      const frame = api.box(bladeW, bladeLen * 0.78, 0.05).translate(bladeW / 2 + 0.05, bladeLen * 0.58, 0.02);
      const lattice = api.box(0.04, bladeLen * 0.78, 0.07).translate(bladeW + 0.05, bladeLen * 0.58, 0.02);
      for (const m of [spar, lattice]) {
        m.rotate(0, 0, ang).translate(0, hubY, hubZ + 0.1);
        piece(api, m, '#6b4a2f', MAT.wood, 0.08);
      }
      frame.rotate(0, 0, ang).translate(0, hubY, hubZ + 0.1);
      const fc0 = lin(shade(bladeC, -0.1));
      const fc1 = lin(bladeC);
      frame.paintFn((x, y, _z, _nx, _ny, _nz, out) => mixLinear(fc0, fc1, (Math.floor((x + y) * 3) % 2) * 0.6 + 0.2, out));
      api.add(frame, { ...MAT.fabric, flatShading: false });
    }
    return api.build();
  },
});

/** Architecture generators in catalog order. */
export const ARCHITECTURE_GENERATORS = [house, tower, wall, fence, bridge, stairs, arch, ramp, windmill];
