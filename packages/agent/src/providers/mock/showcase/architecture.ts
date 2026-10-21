/**
 * Architecture flagships, compiled by `build_architecture` like any
 * building the planner makes, then staged as portfolio renders:
 *
 * - Skyline Penthouse — a three-bedroom penthouse on a rooftop at golden
 *   hour, picture windows over a city of towers far below, a terrace pool;
 *   walk it with light switches, time-of-day presets, material swaps and
 *   photo mode.
 * - Dusk House by the Lake — a two-storey glass house lit from inside at
 *   dusk, a pool terrace stepping down to a lake with a jetty, pines and
 *   mountains; made for the exploded, cutaway and section views.
 */
import type { V3 } from '../builder';
import { r2 } from '../builder';
import type { MockPlan } from '../planner';
import { estateGround, finish, flagshipBuilder, grove, landPoints, onCircle } from './kit';
import { cityStreets, skylineRing } from './skyline';

const WALK_CONTROLS = ['WASD — walk', 'E — doors, lights, talk', '1–4 — time of day', 'R — swap finishes', 'P — photo mode', 'V — view'];

/** Skyline Penthouse: rooftop apartment over a sunset city. */
export function skylinePenthouse(): MockPlan {
  const b = flagshipBuilder(0x9e47, { dusk: true });
  b.env({
    sky: 'sunset',
    timeOfDay: 17.7,
    sunIntensity: 2.6,
    ambientIntensity: 0.45,
    fog: { color: '#e9c2a6', density: 0.0011 },
    bloom: 0.7,
    exposure: 1.05,
    weather: 'clear',
    // The rooftop: a finite slab of concrete (the collider under it is infinite, so nobody falls).
    ground: { material: { finish: 'stone', color: '#b3ada3' }, size: 52, skirt: false },
  });
  // Parapet around the roof edge with a glass rail on top (the plan is centred on the roof: origin −9.5, −3).
  const half = 25;
  const parapet = (from: V3, to: V3): void => {
    const dx = to[0] - from[0];
    const dz = to[2] - from[2];
    const len = Math.hypot(dx, dz);
    b.prim('parapet', 'box', [r2(Math.abs(dx) > 0 ? len : 0.35), 1.05, r2(Math.abs(dz) > 0 ? len : 0.35)], [r2((from[0] + to[0]) / 2), 0.52, r2((from[2] + to[2]) / 2)], { material: { finish: 'concrete', color: '#c9c3b8' }, physics: 'static', tags: ['parapet'] });
    b.prim('rail-glass', 'box', [r2(Math.abs(dx) > 0 ? len : 0.04), 0.9, r2(Math.abs(dz) > 0 ? len : 0.04)], [r2((from[0] + to[0]) / 2), 1.5, r2((from[2] + to[2]) / 2)], { material: { finish: 'glass', opacity: 0.25 }, physics: 'static', castShadow: false });
  };
  const cx = 0;
  const cz = 0;
  parapet([cx - half, 0, cz - half], [cx + half, 0, cz - half]);
  parapet([cx - half, 0, cz + half], [cx + half, 0, cz + half]);
  parapet([cx - half, 0, cz - half], [cx - half, 0, cz + half]);
  parapet([cx + half, 0, cz - half], [cx + half, 0, cz + half]);
  // Rooftop planting and loungers on the deck outside the glass.
  for (const [x, z] of [[-15.5, -13], [15.5, -13], [-15.5, 13], [15.5, 13], [-15.5, 0], [15.5, 0]] as const) {
    b.prim('planter', 'box', [1.5, 0.72, 1.5], [x, 0.36, z], { name: 'Planter', material: { finish: 'concrete', color: '#bdb6aa' }, physics: 'static', footprint: 1, tags: ['planter'] });
    b.prim('planter-soil', 'box', [1.3, 0.04, 1.3], [x, 0.73, z], { material: { finish: 'soil', color: '#3f3328' }, castShadow: false });
    b.gen('olive', 'tree-broadleaf', { height: 3.9, variant: 2, color: '#7f8f66', trunkColor: '#7d6d5a', detail: 1.1 }, [x, 0.72, z], { yaw: r2(b.rand(0, 360)), physics: 'static' });
  }
  // A guest on the terrace with a drink, at the far edge of the pool looking out over the city (walkable deck, clear of the loungers).
  b.add({
    id: b.id('guest'),
    name: 'Guest',
    shape: { kind: 'primitive', primitive: 'capsule', size: [0.56, 1.7, 0.56] },
    transform: { position: [4.4, 1.0, -10.1], rotation: [0, 180, 0] },
    physics: { body: 'kinematic' },
    character: { wardrobe: 'formal', gender: 'female', age: 'adult', top: '#2f4a5e', bottom: '#2a2d33', mood: 'calm', hold: 'cup' },
    npc: {
      role: 'guest',
      archetype: 'villager',
      faction: 'household',
      wander: 0.3,
      speed: 0.8,
      talkRange: 2.8,
      dialogue: { start: 'start', nodes: { start: { text: 'The city never looks better than at this hour. Stay a while.', next: null } } },
    } as never,
    tags: ['npc', 'resident'],
  });
  // The city: towers standing on streets 40 m below the roof, their crowns rising around the
  // terrace, landmark spires beyond.
  // 64 setback high-rises with window-grid facades (lit windows at dusk) over a street grid 40 m below.
  cityStreets(b, [cx, cz], -40, 330);
  skylineRing(b, { center: [cx, cz], count: 64, radius: [105, 285], height: [60, 125], baseY: -40, glass: 0.5 });
  // Warm beacons on a few crowns.
  for (let i = 0; i < 6; i++) {
    const [x, , z] = onCircle(cx, cz, b.rand(170, 250), b.rand(0, Math.PI * 2));
    b.prim('beacon', 'sphere', [1.6, 1.6, 1.6], [x, r2(b.rand(24, 42)), z], { material: { preset: 'emissive', color: '#ff5a3c', emissive: '#ff5a3c', emissiveIntensity: 4 }, castShadow: false, behaviors: [{ type: 'pulseLight', params: { min: 0.5, max: 4, period: 2.4, phase: r2(b.rand(0, 1)), property: 'material.emissiveIntensity' } }], tags: ['backdrop'] });
  }
  const plan = {
    id: 'penthouse',
    name: 'Skyline Penthouse',
    style: 'modern',
    origin: [-9.5, -3],
    residents: 2,
    // Start in the gallery hall facing the living room, so the first frame is the room and the city beyond its windows.
    spawn: { at: [5, 8.3], yaw: 0 },
    plinth: 0.15,
    exteriorWall: { thickness: 0.3, finish: { finish: 'plaster', color: '#efebe4' } },
    levels: [{
      name: 'Penthouse',
      height: 3.3,
      autoWindows: false,
      rooms: [
        { id: 'living', type: 'living', name: 'Living room', rect: [0, 0, 10, 7], floor: { finish: 'oak', color: '#c9a77c' } },
        { id: 'dining', type: 'dining', name: 'Dining', rect: [10, 0, 15, 7], floor: { finish: 'oak', color: '#c9a77c' } },
        { id: 'kitchen', type: 'kitchen', name: 'Kitchen', rect: [15, 0, 19, 7] },
        { id: 'hall', type: 'hall', name: 'Gallery hall', rect: [0, 7, 19, 9], floor: { finish: 'marble', color: '#ecebe7' } },
        { id: 'master', type: 'bedroom', name: 'Main bedroom', rect: [0, 9, 6, 14] },
        { id: 'bath', type: 'bathroom', name: 'Bathroom', rect: [6, 9, 9, 14] },
        { id: 'guest', type: 'bedroom', name: 'Guest bedroom', rect: [9, 9, 13.5, 14] },
        { id: 'study', type: 'office', name: 'Study', rect: [13.5, 9, 19, 14] },
      ],
      doors: [
        { between: ['hall', 'outside'], side: 'east', main: true, width: 1.1 },
        { between: ['hall', 'living'], kind: 'opening', width: 2.4 },
        { between: ['living', 'dining'], kind: 'opening', width: 4 },
        { between: ['dining', 'kitchen'], kind: 'opening', width: 3.2 },
        { between: ['living', 'outside'], side: 'north', kind: 'sliding', width: 2.4, style: 'glass' },
        { between: ['hall', 'master'] },
        { between: ['hall', 'bath'], width: 0.9 },
        { between: ['hall', 'guest'] },
        { between: ['hall', 'study'] },
      ],
      windows: [
        { room: 'living', side: 'north', count: 2, width: 2.6, height: 2.6, sill: 0.25, style: 'picture' },
        { room: 'living', side: 'west', count: 2, width: 2.2, height: 2.6, sill: 0.25, style: 'picture' },
        { room: 'dining', side: 'north', count: 2, width: 1.9, height: 2.6, sill: 0.25, style: 'picture' },
        { room: 'kitchen', side: 'north', count: 1, width: 2.4, height: 1.4, sill: 1.05, style: 'fixed' },
        { room: 'kitchen', side: 'east', count: 1, width: 2, height: 2.4, sill: 0.4, style: 'picture' },
        { room: 'master', side: 'south', count: 2, width: 2, height: 2.4, sill: 0.4, style: 'picture' },
        { room: 'master', side: 'west', count: 1, width: 2.2, height: 2.4, sill: 0.4, style: 'picture' },
        { room: 'guest', side: 'south', count: 1, width: 2.2, height: 2.2, sill: 0.5, style: 'picture' },
        { room: 'study', side: 'south', count: 1, width: 2.2, height: 2.2, sill: 0.5, style: 'picture' },
        { room: 'study', side: 'east', count: 1, width: 1.6, height: 2.2, sill: 0.5, style: 'picture' },
        { room: 'bath', side: 'south', count: 1, width: 1, height: 0.9, sill: 1.5, style: 'fixed' },
      ],
    }],
    roof: { shape: 'flat', overhang: 0.6 },
    site: { terrace: [[-1, -8], [20, -8], [20, 0], [-1, 0]], terraceFinish: { finish: 'decking', color: '#9c7a58' }, pool: { at: [12, -4.2], width: 9, length: 3.2 }, planting: true },
  };
  b.player({ mode: 'firstPerson', moveSpeed: 3.2 });
  return finish(b, {
    name: 'Skyline Penthouse',
    description: 'A rooftop penthouse at golden hour over a city of towers.',
    intro: {
      title: 'Skyline Penthouse',
      tagline: 'Three bedrooms, a terrace pool and the whole city at your feet.',
      objective: 'Walk through, meet your guests, switch the lights, change the time of day and take a photo.',
      controls: WALK_CONTROLS,
      accent: '#f2b880',
    },
    plan: 'Plan: modern three-bedroom penthouse (8 rooms) compiled with build_architecture on a rooftop with a parapet, terrace pool and planters, 34 towers of the city below, sunset light.',
    message: 'Built Skyline Penthouse: a three-bedroom penthouse with picture windows and a terrace pool on a rooftop above a sunset city. Press Play to walk it — E switches lights, 1–4 change the time of day, R swaps finishes, P is photo mode; the Architecture bar has the floor plan, cutaway, exploded and section views.',
    arch: { ops: [{ op: 'create_building', plan }], message: 'Skyline Penthouse' },
  });
}

/** Dusk House by the Lake: two-storey glass house, pool terrace, lake and jetty. */
export function duskLakeHouse(): MockPlan {
  const b = flagshipBuilder(0xd05e, { dusk: true, water: true });
  b.env({
    sky: 'sunset',
    timeOfDay: 18.15,
    sunIntensity: 1.6,
    ambientIntensity: 0.4,
    fog: { color: '#c9a7b8', density: 0.0026 },
    bloom: 0.95,
    exposure: 1.1,
    weather: 'fireflies',
    ground: null,
  });
  // The land: a level plot for the house and its terrace, meadow swells, wooded hills on the horizon and a lake basin
  // south of the terrace (the water level is the shore's, a little below the plot).
  const lx = 7;
  const lz = 39;
  const lr = 15;
  const waterY = -0.45;
  const land = estateGround(b, 0xd05e, { size: 420, relief: 52, pad: [7, 4, 20], lake: [lx, lz, lr, 3.4], color: '#6f8a4e', roughness: 0.5, name: 'Lakeside land' });
  b.keepClearRect(-3, -1, 17, 16);
  const lake = b.prim('lake', 'cylinder', [lr * 2.5, 0.08, lr * 2.5], [lx, waterY, lz], { name: 'Lake', material: { preset: 'water', waterKind: 'lake', color: '#4f7f99', opacity: 0.9, roughness: 0.03 }, castShadow: false, tags: ['water'] });
  b.reserve(lx, lz, lr + 1);
  b.keepClear(lx, lz, lr + 1);
  b.keepClearRect(lx - lr * 1.2, lz - lr * 1.2, lx + lr * 1.2, lz + lr * 1.2);
  b.gen('jetty', 'dock', { length: 10, width: 2, height: 0.45, color: '#7a5a3c', variant: 1 }, [lx - 2, waterY - 0.15, lz - lr + 1.5], { yaw: 90, physics: 'static', name: 'Jetty' });
  b.gen('rowboat', 'boat', { length: 3.6, variant: 0, color: '#e8e1d4', accentColor: '#2f5d7a' }, [lx + 2.2, waterY + 0.05, lz - lr + 8], { yaw: 70, behaviors: [{ type: 'bob', params: { amplitude: 0.05, period: 3.6 } }], name: 'Rowboat' });
  const awayFromLake = (x: number, z: number, d: number): boolean => Math.hypot(x - lx, z - lz) > lr * 1.25 + d;
  const onPlot = (x: number, z: number): boolean => x > -6 && x < 20 && z > -4 && z < 19;
  // Reeds along the shore, spruce and birch round the plot and up the hills, meadow grass, shrubs and boulders.
  const reeds = landPoints(b, 140, 60, (x, z) => { const d = Math.hypot(x - lx, z - lz); return d > lr * 1.0 && d < lr * 1.3; }, 0.7, (x, z) => land.h(x, z), 30);
  grove(b, 'reeds', 'Reeds', 'meadow-grass', { color: '#6f8a3a', size: 1.3 }, reeds, [0.9, 1.7], land.id, 120);
  const ok = (minD: number) => (x: number, z: number): boolean => !onPlot(x, z) && awayFromLake(x, z, 3) && Math.hypot(x - 30, z - 38) > 27 && Math.hypot(x - 7, z - 4) > minD && land.slope(x, z) < 28;
  grove(b, 'spruce', 'Spruce wood', 'tree-spruce', { height: 14, detail: 0.55, color: '#2f4f3a' }, landPoints(b, 210, 200, ok(26), 5.5, land.h), [0.75, 1.35], land.id);
  grove(b, 'birch', 'Birches', 'tree-broadleaf', { height: 10, detail: 0.55, color: '#8fa558', trunkColor: '#d8d2c4', variant: 1 }, landPoints(b, 150, 170, ok(22), 6, land.h), [0.8, 1.25], land.id);
  grove(b, 'shrub', 'Shrubs', 'shrub', { size: 1.4, detail: 0.6, color: '#5f7a42' }, landPoints(b, 380, 160, ok(14), 2.4, land.h), [0.7, 1.5], land.id);
  grove(b, 'boulder', 'Boulders', 'boulder', { size: 1.6, lichen: 0.3, variant: 0 }, landPoints(b, 40, 150, (x, z) => ok(10)(x, z) || !awayFromLake(x, z, 0.5) && Math.hypot(x - lx, z - lz) > lr * 1.15, 3.5, land.h), [0.5, 1.6], land.id);
  const meadow = { heightAt: land.h, onSurface: land.id, minSpacing: 0.45, scaleRange: [0.7, 1.5] as [number, number] };
  b.scatter('meadow', 'meadow-grass', { color: '#7d9a52', size: 0.6 }, 3600, [100, 90], [7, 0, 20], meadow);
  b.scatter('meadow-cover', 'meadow-grass', { color: '#86a258', size: 0.7 }, 2200, [30, 26], [22, 0, 27], { ...meadow, minSpacing: 0.3, scaleRange: [0.8, 1.7] });
  b.scatter('meadow-north', 'meadow-grass', { color: '#7d9a52', size: 0.6 }, 2000, [110, 50], [7, 0, -34], meadow);
  b.scatter('wildflowers', 'flowers', { color: '#e9e1b0', size: 0.5 }, 260, [90, 80], [7, 0, 16], { ...meadow, minSpacing: 0.8 });
  b.light(lake, [0, 3, 0], '#ffb06a', 0.8, 30);
  const plan = {
    id: 'lakehouse',
    name: 'Dusk House by the Lake',
    style: 'japandi',
    residents: 2,
    plinth: 0.3,
    exteriorWall: { thickness: 0.3, finish: { finish: 'plaster', color: '#e9e4da' } },
    levels: [
      {
        name: 'Ground floor',
        height: 3.3,
        autoWindows: false,
        rooms: [
          { id: 'living', type: 'living', name: 'Living room', rect: [0, 0, 9, 7], floor: { finish: 'oak', color: '#c8a57a' } },
          { id: 'kitchen', type: 'kitchen', name: 'Kitchen', rect: [9, 0, 14, 7] },
        ],
        doors: [
          { between: ['kitchen', 'outside'], side: 'east', main: true, width: 1.1 },
          { between: ['living', 'kitchen'], kind: 'opening', width: 3 },
          { between: ['living', 'outside'], side: 'south', kind: 'sliding', width: 2.6, style: 'glass' },
        ],
        windows: [
          { room: 'living', side: 'south', count: 2, width: 2.4, height: 2.7, sill: 0.2, style: 'picture' },
          { room: 'living', side: 'west', count: 2, width: 2, height: 2.6, sill: 0.25, style: 'picture' },
          { room: 'kitchen', side: 'south', count: 1, width: 3, height: 2.6, sill: 0.25, style: 'picture' },
          { room: 'kitchen', side: 'north', count: 1, width: 2.2, height: 1.2, sill: 1.1, style: 'fixed' },
        ],
        // Clear of the 0.3 m north wall (its inside face is at z 0.15; from z 0.6 the flight ran 6 cm into it).
        stairs: [{ at: [0.6, 0.66], heading: 'east', width: 1 }],
      },
      {
        name: 'Upper floor',
        height: 3,
        autoWindows: false,
        rooms: [
          { id: 'landing', type: 'hall', name: 'Landing', rect: [0, 0, 14, 2.2] },
          { id: 'master', type: 'bedroom', name: 'Main bedroom', rect: [0, 2.2, 6, 7] },
          { id: 'bath', type: 'bathroom', name: 'Bathroom', rect: [6, 2.2, 9, 7] },
          { id: 'guest', type: 'bedroom', name: 'Guest bedroom', rect: [9, 2.2, 14, 7] },
        ],
        doors: [{ between: ['landing', 'master'] }, { between: ['landing', 'bath'], width: 0.9 }, { between: ['landing', 'guest'] }],
        windows: [
          { room: 'master', side: 'south', count: 2, width: 2.2, height: 2.3, sill: 0.4, style: 'picture' },
          { room: 'master', side: 'west', count: 1, width: 1.8, height: 2.2, sill: 0.4, style: 'picture' },
          { room: 'guest', side: 'south', count: 1, width: 2.4, height: 2.3, sill: 0.4, style: 'picture' },
          { room: 'guest', side: 'east', count: 1, width: 1.6, height: 2.2, sill: 0.4, style: 'picture' },
          { room: 'bath', side: 'south', count: 1, width: 1.2, height: 1, sill: 1.4, style: 'fixed' },
          { room: 'landing', side: 'north', count: 3, width: 1.4, height: 1, sill: 1.3, style: 'fixed' },
        ],
      },
    ],
    roof: { shape: 'shed', pitch: 8, overhang: 1.1 },
    site: { terrace: [[-2, 7], [16, 7], [16, 15], [-2, 15]], terraceFinish: { finish: 'decking', color: '#8f6d4f' }, pool: { at: [8.5, 11], width: 8, length: 3 }, planting: true },
  };
  b.player({ mode: 'firstPerson', moveSpeed: 3.2 });
  return finish(b, {
    name: 'Dusk House by the Lake',
    description: 'A two-storey glass house lit from inside at dusk, by a lake.',
    intro: {
      title: 'Dusk House by the Lake',
      tagline: 'Warm light, cool water: a glass house the evening the lamps come on.',
      objective: 'Explode the storeys, cut a section, then walk down to the jetty.',
      controls: WALK_CONTROLS,
      accent: '#ffb46b',
    },
    plan: 'Plan: two-storey japandi house (6 rooms, stair, shed roof) compiled with build_architecture, pool terrace, lake with jetty and rowboat, pines, birches and mountains, dusk light with the interior lamps on.',
    message: 'Built Dusk House by the Lake: a two-storey glass house with a pool terrace stepping down to a lake and jetty, lit from inside at dusk. Use the Architecture bar to explode the storeys, cut away the walls or take a section; press Play to walk inside.',
    arch: { ops: [{ op: 'create_building', plan }], message: 'Dusk House by the Lake' },
  });
}
