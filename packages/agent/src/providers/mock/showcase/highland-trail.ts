/**
 * Highland Trail — a realistic hiking game. A misty river valley at first light: follow the
 * worn trail upstream, log six survey stakes (meadow, birch grove, waterfall pool, shepherd's
 * hut, fern gully, ridge saddle), cross the footbridge and climb to the summit cairn before
 * the daylight runs out. The river is cold and fast: it carries you back to the last
 * checkpoint.
 *
 * Built to be the realism reference of the game flagships: layered terrain (grass, rock,
 * soil and snow weights per vertex), the realistic vegetation generators (broadleaf, birch and
 * spruce crowns of leaf and needle cards, shrubs, ferns, meadow grass, boulders), a photographic
 * sky, a trail that follows the ground, and a character you play as. Every position the player
 * has to reach is chosen with the same measuring the level tools offer the assistant: the
 * terrain height under it and the slope around it come from the generated heightfield, so the
 * stakes stand on walkable ground, the bridge spans the gully between two measured banks, and
 * the verified-playable bot walks the whole route.
 */
import { riverHalfWidth, riverMeander, type Json } from '@aether/core';
import { generateBuiltinSync } from '@aether/procgen';
import { r2, type Builder, type V3 } from '../builder';
import type { MockPlan } from '../planner';
import { finish, flagshipBuilder } from './kit';
import { addLife } from './life';

const SIZE = 320;
const RELIEF = 44;
const RES = 200;
const SEED = 0x4c71;
const WATER_Y = 0.38;
/** Daylight (seconds of play) before the game is lost. */
const DAYLIGHT = 900;

const HALF = riverHalfWidth(SIZE);

/** The valley's terrain parameters (also what the terrain entity is built from). */
const TERRAIN_PARAMS: Record<string, Json> = { size: SIZE, height: RELIEF, resolution: RES, roughness: 0.5, color: '#6f9a4a', variant: 4 };

function riverX(z: number): number {
  return riverMeander(z, SIZE);
}

/** Height of the generated terrain under (x, z), bilinear over the heightfield grid the renderer and physics share. */
function terrainSampler(): (x: number, z: number) => number {
  const out = generateBuiltinSync('terrain', TERRAIN_PARAMS, SEED);
  const hf = out.colliders.find((c) => c.kind === 'heightfield');
  if (!hf || hf.kind !== 'heightfield') throw new Error('terrain has no heightfield');
  const n = hf.rows + 1;
  const sizeY = hf.size[1];
  const at = (ix: number, iz: number): number => (hf.heights[Math.min(hf.cols, Math.max(0, ix)) * n + Math.min(hf.rows, Math.max(0, iz))] as number) * sizeY;
  return (x, z) => {
    const fx = ((x + SIZE / 2) / SIZE) * hf.cols;
    const fz = ((z + SIZE / 2) / SIZE) * hf.rows;
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;
    return at(ix, iz) * (1 - tx) * (1 - tz) + at(ix + 1, iz) * tx * (1 - tz) + at(ix, iz + 1) * (1 - tx) * tz + at(ix + 1, iz + 1) * tx * tz;
  };
}

/** Plan Highland Trail. */
export function highlandTrail(): MockPlan {
  const h = terrainSampler();
  const slope = (x: number, z: number): number => {
    const dx = (h(x + 1.2, z) - h(x - 1.2, z)) / 2.4;
    const dz = (h(x, z + 1.2) - h(x, z - 1.2)) / 2.4;
    return (Math.atan(Math.hypot(dx, dz)) * 180) / Math.PI;
  };
  const b = flagshipBuilder(0x4c, { dawn: true, water: true, fog: true });
  b.env({
    sky: 'day',
    hdri: 'sky-partly-cloudy',
    timeOfDay: 8.2,
    sunIntensity: 2.6,
    ambientIntensity: 0.5,
    fog: { color: '#cfdde8', density: 0.0042, visibility: 650 },
    weather: 'clear',
    bloom: 0.3,
    exposure: 1.05,
    wind: { speed: 3.5, direction: 200 },
    ground: null,
  });

  // --- The valley ------------------------------------------------------------------------------------
  const terrain = b.add({ id: b.id('valley'), name: 'Highland valley', shape: { kind: 'procedural', generator: 'terrain', params: TERRAIN_PARAMS, seed: SEED }, transform: { position: [0, 0, 0] }, physics: { body: 'static', friction: 0.9 }, tags: ['terrain'] });
  b.prim('river', 'plane', [SIZE, 0.1, SIZE], [0, WATER_Y, 0], { name: 'River', material: { preset: 'water', waterKind: 'river', waterFlow: [0, 0.9], color: '#5f98a8', opacity: 0.82, roughness: 0.04 }, castShadow: false, tags: ['water', 'river'] });
  // Far ranges close the horizon (the terrain ends at the valley's edge).
  const ring: Array<[number, number, number]> = [[-1, -0.7, 220], [-0.35, -1, 260], [0.5, -1, 240], [1, -0.4, 250], [1, 0.6, 230], [0.2, 1, 240], [-0.7, 0.9, 250], [-1, 0.2, 230]];
  for (const [ux, uz, s] of ring) {
    const l = Math.hypot(ux, uz);
    b.gen('range', 'mountain', { size: s, height: s * 0.55, resolution: 72, snowLine: 0.62, color: '#7d766b', groundColor: '#6a7f55', variant: 0 }, [r2((ux / l) * 300), -4, r2((uz / l) * 300)], { tags: ['backdrop'], castShadow: false });
  }

  // --- The route ------------------------------------------------------------------------------------------
  // East bank from the trailhead upstream (north, −z), the footbridge, then up the west hill to the cairn.
  const side = 1;
  const eastX = (z: number, d: number): number => r2(riverX(z) + side * (HALF + d));
  const westX = (z: number, d: number): number => r2(riverX(z) - side * (HALF + d));
  const start: V3 = [eastX(128, 14), 0, 128];
  start[1] = r2(h(start[0], start[2]));
  const markers: Array<{ name: string; at: [number, number] }> = [
    { name: 'Meadow stake', at: [eastX(100, 12), 100] },
    { name: 'Birch grove stake', at: [eastX(62, 15), 62] },
    { name: 'Waterfall pool stake', at: [eastX(24, 20), 24] },
    { name: "Shepherd's hut stake", at: [westX(-4, 15), -4] },
    { name: 'Fern gully stake', at: [westX(-42, 22), -42] },
    { name: 'Ridge saddle stake', at: [westX(-84, 36), -84] },
  ];
  // The summit: the highest point the player can walk to from the last stake. A flood fill over the
  // measured slopes (cells of 2 m, at most 28 degrees) finds what is connected, so the cairn never
  // stands on a hill that only a cliff leads to.
  const last = (markers[markers.length - 1] as { at: [number, number] }).at;
  const CELL = 2;
  const key = (ix: number, iz: number): number => (ix + 400) * 1000 + (iz + 400);
  const seen = new Set<number>();
  const queue: Array<[number, number]> = [[Math.round(last[0] / CELL), Math.round(last[1] / CELL)]];
  seen.add(key(queue[0]![0], queue[0]![1]));
  let best = { x: last[0], z: last[1], y: h(last[0], last[1]) };
  for (let head = 0; head < queue.length && queue.length < 60_000; head++) {
    const [ix, iz] = queue[head] as [number, number];
    const x = ix * CELL;
    const z = iz * CELL;
    const y = h(x, z);
    const far = Math.hypot(x - last[0], z - last[1]);
    if (y > best.y && far > 22 && far < 70 && slope(x, z) < 14 && Math.abs(x) < SIZE / 2 - 30 && Math.abs(z) < SIZE / 2 - 30) best = { x, z, y };
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = ix + dx;
      const nz = iz + dz;
      const k = key(nx, nz);
      if (seen.has(k)) continue;
      const wx = nx * CELL;
      const wz = nz * CELL;
      if (Math.abs(wx) > SIZE / 2 - 20 || Math.abs(wz) > SIZE / 2 - 20 || slope(wx, wz) > 28 || Math.abs(wx - riverX(wz)) < HALF + 2) continue;
      seen.add(k);
      queue.push([nx, nz]);
    }
  }
  const summit: V3 = [best.x, r2(best.y), best.z];

  // The footbridge crosses where the banks are measured: the deck stands a hand above the higher bank shoulder,
  // runs out to where the ground comes up to it, and a ramp on each side meets the terrain, so there is never a step.
  const bridgeZ = 10;
  const cx = riverX(bridgeZ);
  const shoulder = (dir: number): number => {
    let top = 0;
    for (let d = HALF; d < HALF + 30; d += 1) top = Math.max(top, h(cx + dir * d, bridgeZ));
    return top;
  };
  // The valley's banks are steep for the first 15 m; the shoulder above them is where the ground levels out.
  const deckY = r2(Math.min(shoulder(-1), shoulder(1), 14) * 0.8 + 0.1);
  const deckEnd = (dir: number): number => {
    for (let d = HALF + 4; d < HALF + 45; d += 0.5) if (h(cx + dir * d, bridgeZ) >= deckY - 0.2) return r2(cx + dir * d);
    return r2(cx + dir * (HALF + 30));
  };
  const xWest = deckEnd(-1);
  const xEast = deckEnd(1);
  const RAMP = 7;
  const lx = r2(xWest - RAMP);
  const rx = r2(xEast + RAMP);

  // The trail: straight legs between the stops, worn into the ground as a strip of gravel following the terrain.
  const route: Array<[number, number]> = [[start[0], start[2]], ...markers.slice(0, 3).map((m) => m.at), [rx, bridgeZ]];
  const west: Array<[number, number]> = [[lx, bridgeZ], ...markers.slice(3).map((m) => m.at), [summit[0], summit[2]]];
  const reserve = (pts: ReadonlyArray<readonly [number, number]>, r: number): void => {
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i] as readonly [number, number];
      const c = pts[i + 1] as readonly [number, number];
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      for (let t = 0; t <= len; t += 2.5) b.reserve(a[0] + ((c[0] - a[0]) * t) / len, a[1] + ((c[1] - a[1]) * t) / len, r);
    }
  };
  reserve(route, 3.2);
  reserve(west, 3.2);
  // The trailhead camp stays open: a clearing around the fire, the tent and the spawn.
  b.reserve(start[0], start[2] + 3, 7);
  b.reserve(start[0] + 5, start[2] + 4, 5);
  const strip = (pts: ReadonlyArray<readonly [number, number]>): void => {
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i] as readonly [number, number];
      const c = pts[i + 1] as readonly [number, number];
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      const yaw = (Math.atan2(c[0] - a[0], c[1] - a[1]) * 180) / Math.PI;
      for (let t = 0; t < len; t += 3) {
        const l = Math.min(3.4, len - t + 0.4);
        const mx = a[0] + ((c[0] - a[0]) * (t + l / 2)) / len;
        const mz = a[1] + ((c[1] - a[1]) * (t + l / 2)) / len;
        const h0 = h(a[0] + ((c[0] - a[0]) * t) / len, a[1] + ((c[1] - a[1]) * t) / len);
        const h1 = h(a[0] + ((c[0] - a[0]) * (t + l)) / len, a[1] + ((c[1] - a[1]) * (t + l)) / len);
        const pitch = (Math.atan2(h1 - h0, l) * 180) / Math.PI;
        b.prim('trail', 'box', [1.9, 0.07, r2(l)], [r2(mx), r2(h(mx, mz) + 0.025), r2(mz)], { rot: [r2(-pitch), r2(yaw), 0], material: { finish: 'gravel', color: '#c9bba0' }, castShadow: false, tags: ['trail'] });
      }
    }
  };
  strip(route);
  strip(west);

  // --- The footbridge ------------------------------------------------------------------------------------------------
  const bridge = b.empty('footbridge', [r2((xWest + xEast) / 2), deckY, bridgeZ], { name: 'Footbridge', physics: 'static', footprint: 3 });
  const deckPhysics = { body: 'static' as const, friction: 0.9 };
  const spanLen = xEast - xWest + 1;
  b.add({ id: b.id('deck'), name: 'Bridge deck', parent: bridge, shape: { kind: 'primitive', primitive: 'box', size: [r2(spanLen), 0.22, 2.1] }, transform: { position: [0, -0.11, 0] }, material: { finish: 'decking', color: '#9a7a58' }, physics: deckPhysics, tags: ['bridge'] });
  // Ramps from each deck end to the ground, pitched to meet it.
  for (const dir of [-1, 1]) {
    const xe = dir < 0 ? xWest : xEast;
    const xo = xe + dir * RAMP;
    const yo = r2(h(xo, bridgeZ) + 0.03);
    const len = Math.hypot(RAMP + 0.4, yo - deckY);
    const pitch = (Math.atan2(yo - deckY, RAMP) * 180) / Math.PI;
    b.add({
      id: b.id('ramp'),
      name: 'Bridge approach',
      shape: { kind: 'primitive', primitive: 'box', size: [r2(len), 0.22, 2.1] },
      transform: { position: [r2((xe + xo) / 2), r2((deckY + yo) / 2 - 0.11), bridgeZ], rotation: [0, 0, r2(dir < 0 ? -pitch : pitch)] },
      material: { finish: 'decking', color: '#9a7a58' },
      physics: deckPhysics,
      tags: ['bridge'],
    });
  }
  for (const sd of [-1, 1]) {
    b.add({ id: b.id('rail'), parent: bridge, shape: { kind: 'primitive', primitive: 'box', size: [r2(spanLen), 0.1, 0.1] }, transform: { position: [0, 0.95, sd * 1.0] }, material: { finish: 'oak', color: '#7a5c3e' }, castShadow: true, tags: ['bridge'] });
    for (let k = 0; k <= 6; k++) {
      b.add({ id: b.id('post'), parent: bridge, shape: { kind: 'primitive', primitive: 'box', size: [0.12, 1.0, 0.12] }, transform: { position: [r2((k / 6 - 0.5) * spanLen), 0.45, sd * 1.0] }, material: { finish: 'oak', color: '#7a5c3e' }, tags: ['bridge'] });
    }
  }

  // --- The river is cold: it carries you back to the last checkpoint ---------------------------------------------
  for (let z = 150; z > -150; z -= 12) {
    b.prim('current', 'box', [r2(HALF * 1.7), 1.6, 14], [r2(riverX(z - 6)), 0.5, z - 6], { visible: false, physics: { body: 'static', sensor: true }, behaviors: [{ type: 'hazard', params: { mode: 'respawn', cooldown: 1 } }], tags: ['river-hazard'], castShadow: false });
  }
  const checkpoint = (x: number, z: number, name: string): void => {
    b.prim('checkpoint', 'box', [5, 3, 5], [x, r2(h(x, z) + 1.5), z], { name, visible: false, physics: { body: 'static', sensor: true }, behaviors: [{ type: 'checkpoint', params: {} }], tags: ['checkpoint'], castShadow: false });
  };
  checkpoint(start[0], start[2], 'Trailhead');
  checkpoint(rx, bridgeZ, 'East bridgehead');
  checkpoint(lx, bridgeZ, 'West bridgehead');

  // --- Landmarks -------------------------------------------------------------------------------------------------
  // Trailhead camp: tent, fire, a bench and a hiker who knows the way.
  const campX = start[0] + 5;
  const campZ = start[2] + 4;
  b.gen('tent', 'tent', { color: '#c2613a' }, [r2(campX), r2(h(campX, campZ)), r2(campZ)], { yaw: -30, physics: 'static', footprint: 3, name: 'Hiker tent' });
  const fx = start[0] - 4;
  const fz = start[2] + 3;
  const fire = b.gen('campfire', 'campfire', { size: 1.1 }, [r2(fx), r2(h(fx, fz)), r2(fz)], { physics: 'static', footprint: 2, name: 'Campfire', tags: ['fire'] });
  b.light(fire, [0, 0.8, 0], '#ff8a3d', 2.4, 10, [{ type: 'pulseLight', params: { min: 1.6, max: 2.8, period: 0.4 } }]);
  b.gen('bench', 'bench', {}, [r2(fx - 2.4), r2(h(fx - 2.4, fz)), r2(fz)], { yaw: 90, physics: 'static', footprint: 1.4 });
  b.add({
    id: b.id('elena'),
    name: 'Elena',
    shape: { kind: 'primitive', primitive: 'capsule', size: [0.56, 1.7, 0.56] },
    transform: { position: [r2(start[0] - 1.2), r2(h(start[0] - 1.2, start[2] + 2.4) + 0.85), r2(start[2] + 2.4)], rotation: [0, 150, 0] },
    physics: { body: 'kinematic' },
    character: { wardrobe: 'traveller', gender: 'female', age: 'adult', hold: 'staff', mood: 'calm' },
    npc: {
      role: 'hiker',
      archetype: 'villager',
      faction: 'trail',
      wander: 1.5,
      dialogue: {
        start: 'start',
        nodes: {
          start: { text: 'Morning! The valley is lovely before the mist lifts. Six survey stakes mark the route up to the summit cairn.', choices: [{ text: 'Where are the stakes?', next: 'stakes' }, { text: 'What about the river?', next: 'river' }, { text: 'Thanks.', next: null }] },
          stakes: { text: 'Follow the trail upstream: the meadow, the birches, the waterfall pool. Cross the footbridge for the hut, the fern gully and the ridge. Then the cairn.', next: 'start' },
          river: { text: 'Cold and fast. It will carry you back to the last checkpoint, so use the footbridge. And mind the daylight: you have fifteen minutes.', next: 'start' },
        },
      },
    } as never,
    tags: ['npc', 'villager'],
  });

  // The shepherd's hut on the west bank: stone and timber.
  const hx = westX(-4, 28);
  const hz = -10;
  b.gen('hut', 'house', { width: 5, depth: 4, color: '#8a7f70', roofColor: '#4a3a2c', trimColor: '#3a2a20', lights: false, variant: 1 }, [r2(hx), r2(h(hx, hz) + 0.2), r2(hz)], { yaw: 90, physics: 'static', footprint: 5, name: "Shepherd's hut" });
  b.gen('fence', 'fence', { length: 14, height: 1.1, color: '#7a6048' }, [r2(hx - 6), r2(h(hx - 6, hz + 8)), r2(hz + 8)], { yaw: 0, physics: 'static', footprint: 1 });
  // The waterfall pool above the third stake.
  const wz = 16;
  b.gen('waterfall', 'waterfall', { height: 8, waterColor: '#9cc9d6' }, [eastX(wz, 34), r2(h(eastX(wz, 34), wz) - 0.2), wz], { yaw: 90, physics: 'static', name: 'Waterfall', footprint: 8 });

  // --- The six stakes and the cairn --------------------------------------------------------------------------------
  b.state('stakes', 0);
  b.hud('stakes', 'Survey stakes / 6');
  for (const m of markers) {
    const y = h(m.at[0], m.at[1]);
    const pole = b.add({
      id: b.id('stake'),
      name: m.name,
      shape: { kind: 'primitive', primitive: 'cylinder', size: [0.09, 2.4, 0.09] },
      transform: { position: [r2(m.at[0]), r2(y + 1.2), r2(m.at[1])] },
      material: { finish: 'oak', color: '#e8e2d6' },
      behaviors: [{ type: 'collectible', params: { scoreKey: 'stakes', value: 1, margin: 1.5, message: `${m.name} logged` } }],
      tags: ['stake', 'pickup', 'focus'],
    });
    b.prim('flag', 'box', [0.6, 0.38, 0.03], [0.34, 0.9, 0], { parent: pole, material: { preset: 'plastic', color: '#e8652a', roughness: 0.7, emissive: '#e8652a', emissiveIntensity: 0.25 }, castShadow: false });
    b.prim('band', 'cylinder', [0.1, 0.45, 0.1], [0, -0.35, 0], { parent: pole, material: { preset: 'plastic', color: '#c8321e', roughness: 0.6 }, castShadow: false });
    b.reserve(m.at[0], m.at[1], 2.5);
  }
  // The summit cairn: stacked boulders, a flag and the goal that wakes once every stake is logged.
  const cairn = b.empty('cairn', [summit[0], summit[1], summit[2]], { name: 'Summit cairn', physics: 'static', footprint: 4, tags: ['focus'] });
  for (let i = 0; i < 5; i++) {
    const w = 1.5 - i * 0.22;
    b.gen('cairn-stone', 'boulder', { size: r2(w * 1.4), lichen: 0.1, variant: 0 }, [r2((i % 2) * 0.15), r2(i * 0.42), r2(((i + 1) % 2) * 0.12)], { parent: cairn, yaw: r2(i * 47), physics: 'static' });
  }
  b.prim('cairn-pole', 'cylinder', [0.08, 3.2, 0.08], [0, 3.1, 0], { parent: cairn, material: { finish: 'oak', color: '#6e5238' }, castShadow: true });
  b.prim('cairn-flag', 'box', [1.1, 0.7, 0.03], [0.6, 4.4, 0], { parent: cairn, material: { preset: 'plastic', color: '#e8652a', roughness: 0.65 }, castShadow: false, behaviors: [{ type: 'spin', params: { axis: [0, 1, 0], speed: 0 } }] });
  const goal = b.prim('summit-goal', 'cylinder', [4, 3, 4], [summit[0], r2(summit[1] + 1.5), summit[2]], { name: 'Summit', visible: false, physics: { body: 'static', sensor: true }, behaviors: [{ type: 'goal', enabled: false, params: { text: 'Summit reached. The whole valley lies below you.' } }], castShadow: false, tags: ['goal'] });
  b.reserve(summit[0], summit[2], 4);

  // --- Life: measured placement (ground not steep, air clear, water deep enough) -------------------------------
  const riverBody = { id: 'river', y: WATER_Y, minX: -SIZE / 2, maxX: SIZE / 2, minZ: -SIZE / 2, maxZ: SIZE / 2, round: false, area: SIZE * SIZE };
  addLife(b, { height: (x, z) => (Math.abs(x) < SIZE / 2 && Math.abs(z) < SIZE / 2 ? h(x, z) : null), water: [riverBody] }, [
    { id: 'deer', species: 'deer', count: 3, x: westX(26, 34), z: 26, radius: 12 },
    { id: 'does', species: 'doe', count: 3, x: eastX(104, 36), z: 104, radius: 12 },
    { id: 'songbirds', species: 'bird', count: 7, x: eastX(62, 10), z: 62, radius: 22 },
    { id: 'crows', species: 'crow', count: 4, x: westX(-40, 30), z: -40, radius: 20 },
    { id: 'hawk', species: 'hawk', count: 1, x: 0, z: -20, radius: 70 },
    { id: 'butterflies', species: 'butterfly', count: 8, x: eastX(100, 9), z: 100, radius: 7 },
    { id: 'trout', species: 'fish', count: 6, x: riverX(46), z: 46, radius: 7 },
    { id: 'pool-trout', species: 'fish', count: 4, x: riverX(78), z: 78, radius: 6 },
  ]);

  // --- Vegetation ------------------------------------------------------------------------------------------------------
  const points = (count: number, ok: (x: number, z: number) => boolean, spacing: number, tries = 40): V3[] => {
    const out: V3[] = [];
    for (let i = 0; i < count; i++) {
      for (let t = 0; t < tries; t++) {
        const x = r2(b.rand(-SIZE / 2 + 14, SIZE / 2 - 14));
        const z = r2(b.rand(-SIZE / 2 + 14, SIZE / 2 - 14));
        if (!ok(x, z) || !b.isFree(x, z, spacing)) continue;
        b.reserve(x, z, spacing);
        out.push([x, 0, z]);
        break;
      }
    }
    return out;
  };
  const awayFromRiver = (x: number, z: number, d: number): boolean => Math.abs(x - riverX(z)) > HALF + d;
  const grove = (base: string, generator: string, params: Record<string, Json>, pts: V3[], scale: [number, number], name: string): void => {
    if (pts.length === 0) return;
    b.add({
      id: b.id(base),
      name,
      transform: { position: [0, 0, 0] },
      shape: { kind: 'scatter', of: { kind: 'procedural', generator, params }, count: pts.length, area: [SIZE, SIZE], seed: b.subSeed() % 100_000, scaleRange: scale, onSurface: terrain, points: pts },
      tags: ['grove'],
    });
  };
  grove('spruce', 'tree-spruce', { height: 13, detail: 0.55, color: '#2c4f2a' }, points(150, (x, z) => awayFromRiver(x, z, 24) && slope(x, z) < 32 && h(x, z) > 4, 5), [0.75, 1.3], 'Spruce forest');
  grove('spruce-low', 'tree-spruce', { height: 9, detail: 0.5, color: '#35592f' }, points(55, (x, z) => awayFromRiver(x, z, 12) && slope(x, z) < 30, 4.5), [0.7, 1.2], 'Young spruce');
  grove('birch', 'tree-birch', { height: 8.5, detail: 0.7 }, points(46, (x, z) => awayFromRiver(x, z, 5) && x > riverX(z) && z < 90 && z > 30 && slope(x, z) < 25, 5), [0.8, 1.2], 'Birch grove');
  grove('birch-west', 'tree-birch', { height: 8, detail: 0.6 }, points(30, (x, z) => awayFromRiver(x, z, 6) && x < riverX(z) && z < 20 && z > -80 && slope(x, z) < 25, 5.5), [0.8, 1.2], 'West birches');
  grove('broadleaf', 'tree-broadleaf', { height: 10.5, detail: 0.55, variant: 2 }, points(44, (x, z) => awayFromRiver(x, z, 8) && slope(x, z) < 22 && h(x, z) < 20, 8), [0.8, 1.25], 'Meadow oaks');
  grove('shrub', 'shrub', { size: 1.5, detail: 0.7 }, points(160, (x, z) => awayFromRiver(x, z, 3) && slope(x, z) < 35, 2.2), [0.7, 1.4], 'Shrubs');
  grove('fern', 'fern', { size: 0.95 }, points(260, (x, z) => awayFromRiver(x, z, 3) && slope(x, z) < 35 && (h(x, z) > 2 || true), 1.6), [0.8, 1.4], 'Ferns');
  grove('boulder', 'boulder', { size: 1.8, lichen: 0.4, variant: 0 }, points(70, (x, z) => slope(x, z) < 45 && (awayFromRiver(x, z, 0.5) || b.chance(0.3)), 3.2), [0.5, 1.8], 'Boulders');
  // Meadow grass hugs the trail and the river: tens of thousands of cards would be wasted far from where anyone walks.
  const route2: Array<[number, number]> = [...route, ...west];
  const nearTrail = (x: number, z: number, d: number): boolean => {
    for (let i = 0; i + 1 < route2.length; i++) {
      const a = route2[i] as [number, number];
      const c = route2[i + 1] as [number, number];
      const l2 = (c[0] - a[0]) ** 2 + (c[1] - a[1]) ** 2;
      if (l2 > 160 * 160) continue; // the jump over the bridge is not a trail leg
      const t = l2 < 1e-6 ? 0 : Math.max(0, Math.min(1, ((x - a[0]) * (c[0] - a[0]) + (z - a[1]) * (c[1] - a[1])) / l2));
      if (Math.hypot(x - (a[0] + t * (c[0] - a[0])), z - (a[1] + t * (c[1] - a[1]))) < d) return true;
    }
    return false;
  };
  const tufts: V3[] = [];
  for (let i = 0; i < 30000; i++) {
    const x = r2(b.rand(-SIZE / 2 + 14, SIZE / 2 - 14));
    const z = r2(b.rand(-SIZE / 2 + 14, SIZE / 2 - 14));
    if (slope(x, z) > 36 || !(nearTrail(x, z, 34) || Math.abs(x - riverX(z)) < HALF + 14) || Math.abs(x - riverX(z)) < HALF + 0.4) continue;
    if (nearTrail(x, z, 1.1)) continue; // the worn trail stays bare
    tufts.push([x, 0, z]);
  }
  grove('grass', 'meadow-grass', { size: 0.5, color: '#7aa83f' }, tufts, [0.65, 1.25], 'Meadow grass');

  // --- Rules --------------------------------------------------------------------------------------------------------------------
  b.player({ mode: 'thirdPerson', spawn: [r2(start[0] + 2), r2(start[1] + 1), r2(start[2] + 6)], moveSpeed: 5.2, jumpSpeed: 6.2, character: { wardrobe: 'traveller', gender: 'male', age: 'adult', hold: 'bag' } });
  b.rule({ id: 'welcome', when: { on: 'start' }, then: [{ do: 'message', text: 'First light on the trail. Find the six survey stakes, then climb to the summit cairn.', duration: 6 }] });
  b.rule({ id: 'halfway', when: { on: 'state', key: 'stakes', op: '>=', value: 3 }, then: [{ do: 'message', text: 'Halfway. Cross the footbridge: the river is too cold to wade.', duration: 5 }], once: true });
  b.rule({
    id: 'summit-open',
    description: 'Every stake logged: the summit cairn becomes the goal',
    when: { on: 'state', key: 'stakes', op: '>=', value: 6 },
    then: [{ do: 'enableBehavior', target: goal, behavior: 'goal', enabled: true }, { do: 'message', text: 'All six stakes logged. Climb to the summit cairn!', duration: 6 }, { do: 'sound', sound: 'bell' }],
    once: true,
  });
  b.rule({ id: 'light-fading', when: { on: 'timer', at: Math.round(DAYLIGHT * 0.7) }, then: [{ do: 'message', text: 'The light is fading. Keep moving.', duration: 5 }], once: true });
  b.rule({ id: 'night', when: { on: 'timer', at: DAYLIGHT }, then: [{ do: 'sound', sound: 'lose' }, { do: 'lose', text: 'Night caught you on the mountain. Try again at first light.' }], once: true });
  b.rule({ id: 'reset-key', when: { on: 'key', key: 'r' }, then: [{ do: 'reset' }] });
  b.test({ id: 'stakes-stay', kind: 'staysAbove', target: '#stake', y: 0.2, within: 4 });

  return finish(b, {
    name: 'Highland Trail',
    description: 'A realistic hiking game in a misty river valley: six survey stakes, a footbridge and a summit cairn before the light runs out.',
    intro: {
      title: 'Highland Trail',
      tagline: 'A river valley at first light',
      objective: 'Log the six survey stakes up the valley, then climb to the summit cairn before the daylight is gone.',
      controls: ['WASD to walk', 'Shift to hurry', 'Space to jump', 'E to talk', 'R to start over'],
      accent: '#e8652a',
    },
    plan: 'Plan: a river valley from the layered terrain generator, the realistic vegetation set (spruce, birch, broadleaf, shrubs, ferns, grass, boulders), a gravel trail following the ground, a footbridge between two measured banks, six survey stakes and a summit cairn on the highest walkable hill, a hiker with dialogue, river hazards with checkpoints and a daylight timer.',
    message: 'Built Highland Trail: follow the trail upstream, log the six survey stakes, cross the footbridge and climb to the summit cairn before the light runs out. Talk to Elena at the trailhead for directions.',
  });
}
