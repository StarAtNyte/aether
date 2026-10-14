/**
 * Built / stylized settings for the mock planner: village, castle, city
 * street with drivable car, haunted graveyard, and outer space.
 */
import { r2 } from './builder';
import { backdropMountains, clouds, lamp, lightsOn, path, scatterBelt, treeRing, yawAlongX, yawFacingZ, type ThemeCtx } from './decor';
import type { Theme } from './theme';
import { catalogEntry, getCatalog } from '@aether/assets';

const ROOFS = ['#a0442c', '#5b6d8a', '#7a4b2a', '#4a6b45', '#8a3b2e'];
const WALLS = ['#e8dcc4', '#f1e3c8', '#d9c9a8', '#efe6d6', '#cfd8dc'];

/** Houses on a ring around a plaza, facing the center. */
function housesAround(c: ThemeCtx, count: number, radius: number, variant: number | null): void {
  const { b } = c;
  const offset = b.rand(0, Math.PI * 2);
  for (let i = 0; i < count; i++) {
    const a = offset + (i / count) * Math.PI * 2 + b.rand(-0.12, 0.12);
    const hx = r2(c.x + Math.cos(a) * radius);
    const hz = r2(c.z + Math.sin(a) * radius);
    if (!b.claim(hx, hz, 4.6)) continue;
    b.gen('house', 'house', {
      width: r2(b.rand(5.5, 7.5)),
      depth: r2(b.rand(4.5, 6)),
      floors: b.int(1, 2),
      color: b.pick(WALLS),
      roofColor: b.pick(ROOFS),
      lights: lightsOn(b),
      variant: variant ?? b.int(0, 2),
    }, [hx, 0, hz], { yaw: yawFacingZ(hx, hz, c.x, c.z), physics: 'static', tags: ['house'] });
  }
}

const village: Theme = {
  id: 'village',
  kind: 'setting',
  title: 'Cozy Village',
  match: /\b(village|town|hamlet|cottages?|houses?|medieval town|settlement|market)\b/,
  radius: 34,
  blurb: 'a cozy village of cottages around a plaza with a statue, market stalls, lamp posts and a friendly villager to talk to',
  env(b) {
    b.env({ sky: 'day', timeOfDay: 16, fog: { color: '#e6dccb', density: 0.008 }, bloom: 0.6, ground: { material: { preset: 'grass', color: '#6a9a45' }, size: 400 } });
    b.player({ mode: 'thirdPerson', spawn: [0, 1, 6] });
  },
  build(c) {
    const { b } = c;
    if (c.clear < 4) {
      b.prim('plaza', 'cylinder', [14, 0.06, 14], [c.x, 0.03, c.z], { material: { preset: 'stone', color: '#b8b0a2' }, castShadow: false, name: 'Plaza' });
      b.gen('statue', 'statue', { height: 3 }, [c.x, 0, c.z], { physics: 'static', footprint: 1.8, name: 'Founder statue', tags: ['focus'] });
      for (let i = 0; i < 2; i++) {
        const tx = r2(c.x + (i === 0 ? -4.5 : 4.5));
        const tz = r2(c.z - 3);
        b.gen('market-stall', 'table', { width: 2, depth: 1, color: '#9a6a3c' }, [tx, 0, tz], { physics: 'static', footprint: 1.4 });
        b.gen('crate', 'crate', { size: 0.7 }, [r2(tx + 1.4), 0, tz], { physics: 'static', footprint: 0.5 });
      }
      const npc = b.prim('villager', 'capsule', [0.6, 1.7, 0.6], [r2(c.x + 3), 0.85, r2(c.z + 3)], {
        name: 'Villager',
        material: { preset: 'fabric', color: '#3f6e8c' },
        behaviors: [{ type: 'npc', params: { name: 'Mira', persona: 'cheerful baker', lines: ['Welcome to our village!', 'Fresh bread at dawn, every day.', 'Have you seen the old windmill?'], wanderRadius: 4 } }],
        tags: ['npc'],
        footprint: 0.8,
      });
      b.prim(`${npc}-head`, 'sphere', [0.45, 0.45, 0.45], [0, 1.05, 0], { parent: npc, material: { color: '#f1c27d' } });
    }
    housesAround(c, 8, 16, null);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      lamp(b, r2(c.x + Math.cos(a) * 8.5), r2(c.z + Math.sin(a) * 8.5));
    }
    for (let i = 0; i < 6; i++) {
      const p = b.spot(c.x, c.z, Math.max(6, c.clear + 1), 13, 0.5);
      if (p) b.gen('barrel', 'barrel', {}, [p[0], 0, p[1]], { physics: 'static' });
    }
    path(b, c.x, c.z + 7, c.x, c.z + 30, 2.6, '#a68a64', 'dirt');
    treeRing(c, 14, 22, 34, [{ generator: 'tree-oak', params: { height: 6 } }, { generator: 'tree-pine', params: { height: 8 } }]);
    scatterBelt(c, 'flowers', 'flowers', {}, 20, 9, 26, { minSpacing: 0.5 });
    if (c.primary) {
      const wx = r2(c.x - 26);
      const wz = r2(c.z - 22);
      if (b.claim(wx, wz, 4)) b.gen('windmill', 'windmill', { height: 11 }, [wx, 0, wz], { yaw: 30, physics: 'static' });
      backdropMountains(c, 5, '#7d7a70', 0.7);
      clouds(c, 4);
    }
  },
};

const castle: Theme = {
  id: 'castle',
  kind: 'setting',
  title: 'Castle Keep',
  match: /\b(castle|fortress|fort|citadel|keep|kingdom|knights?|king|queen|medieval|(?<!(?:bell|block|crate|domino|box|card|clock|water|jenga|stacked|stack of) )towers?(?! of (?:blocks?|crates?|boxes|cards|dominoe?s))|battlements)\b/,
  radius: 36,
  blurb: 'a stone castle with four corner towers, crenellated walls, a gatehouse arch, a central keep and torches',
  env(b) {
    b.env({ sky: 'day', timeOfDay: 15.8, fog: { color: '#d6d2c4', density: 0.01 }, bloom: 0.7, ground: { material: { preset: 'grass', color: '#5c7f3c' }, size: 400 } });
    b.player({ mode: 'thirdPerson', spawn: [0, 1, 26] });
  },
  build(c) {
    const { b } = c;
    const half = 12;
    const stone = '#9a948a';
    // The castle sits behind an activity's clear zone, otherwise at the origin.
    const cx = c.x;
    const cz = c.clear > 0 ? r2(c.z - c.clear - half - 4) : c.z;
    const corners: Array<[number, number]> = [[-half, -half], [half, -half], [-half, half], [half, half]];
    for (const [dx, dz] of corners) {
      b.gen('tower', 'tower', { height: 14, radius: 2.6, color: stone, roofColor: '#3f4f7a' }, [r2(cx + dx), 0, r2(cz + dz)], { physics: 'static', tags: ['castle'] });
    }
    const wallLen = 2 * half - 5;
    for (const [dx, dz, yaw] of [[0, -half, 0], [-half, 0, 90], [half, 0, 90]] as const) {
      b.gen('castle-wall', 'wall', { length: wallLen, height: 6, thickness: 1.4, color: stone, crenellated: true }, [r2(cx + dx), 0, r2(cz + dz)], { yaw, physics: 'static', tags: ['castle'] });
    }
    // Front wall split around the gate.
    const seg = (wallLen - 5) / 2;
    for (const side of [-1, 1]) {
      b.gen('castle-wall', 'wall', { length: r2(seg), height: 6, thickness: 1.4, color: stone, crenellated: true }, [r2(cx + side * (2.5 + seg / 2)), 0, r2(cz + half)], { physics: 'static', tags: ['castle'] });
    }
    b.gen('gatehouse', 'arch', { width: 5, height: 7, thickness: 1.6, color: '#8f897f', accentColor: '#7a1f1f' }, [cx, 0, r2(cz + half)], { physics: 'static', name: 'Gatehouse' });
    b.gen('keep', 'tower', { height: 20, radius: 4, color: '#a39d92', roofColor: '#7a1f1f' }, [cx, 0, r2(cz - 3)], { physics: 'static', name: 'Keep', tags: ['focus'] });
    b.prim('banner', 'box', [0.05, 2.4, 1.4], [r2(cx + 4.1), 16, r2(cz - 3)], { material: { preset: 'fabric', color: '#b5232f' }, castShadow: false, name: 'Royal banner' });
    b.reserve(cx, cz, half + 3);
    for (const side of [-1, 1]) {
      const tx = r2(cx + side * 3.5);
      const tz = r2(cz + half + 2);
      const torch = b.prim('torch', 'cylinder', [0.15, 1.8, 0.15], [tx, 0.9, tz], { material: { preset: 'wood', color: '#5b3a24' }, physics: 'static' });
      b.prim(`${torch}-flame`, 'sphere', [0.35, 0.35, 0.35], [0, 1.05, 0], { parent: torch, material: { preset: 'emissive', color: '#ff9a3c', emissive: '#ff7a1a', emissiveIntensity: 4 } });
      b.light(torch, [0, 1.3, 0], '#ff9a3c', 2, 10, [{ type: 'pulseLight', params: { min: 1.4, max: 2.4, period: 0.4 } }]);
    }
    path(b, cx, cz + half + 1, cx, cz + half + 26, 4, '#9c8b6e', 'dirt');
    const ring: ThemeCtx = { ...c, x: cx, z: cz, clear: half + 4 };
    treeRing(ring, 16, half + 6, half + 26, [{ generator: 'tree-pine', params: { height: 9 } }, { generator: 'tree-oak', params: { height: 7 } }]);
    scatterBelt(ring, 'grass', 'grass-tuft', {}, 50, half + 3, half + 30);
    if (c.primary) {
      backdropMountains(c, 6, '#6c6a66', 0.6, 120, 40);
      clouds(c, 5);
    }
  },
};

/** True when the asset library is loaded and has every id (themes then use real models). */
function hasAssets(...ids: string[]): boolean {
  const cat = getCatalog();
  if (!cat || cat.entries.length === 0) return false;
  return ids.every((id) => catalogEntry(id) !== null);
}

const CITY_BUILDINGS = ['shop-building', 'office-building', 'apartment-building', 'corner-building', 'brick-building', 'city-building', 'cafe-building', 'tall-building'] as const;
const CITY_CARS = ['car', 'taxi', 'van', 'suv', 'hatchback', 'police-car', 'delivery-truck'] as const;
const PEOPLE = ['man', 'woman', 'man-b', 'woman-b', 'man-c', 'woman-c', 'man-d', 'woman-d', 'man-e', 'woman-e'] as const;
const CAR_FALLBACK = { kind: 'procedural' as const, generator: 'car', params: { length: 4.2 } };

/** City street dressed with real library models: road tiles, shops, cars, street lights, pedestrians. */
function libraryStreet(c: ThemeCtx): void {
  const { b } = c;
  const tiles = 12;
  const tile = 8;
  const z0 = c.z - (tiles * tile) / 2 + tile / 2;
  for (let i = 0; i < tiles; i++) {
    const crossing = i === 4 || i === 9;
    b.asset('road', crossing ? 'road-crossing' : 'road', [c.x, 0, r2(z0 + i * tile)], { yaw: 90, castShadow: false, name: crossing ? 'Crossing' : 'Road' });
  }
  for (const side of [-1, 1]) {
    b.prim('sidewalk', 'box', [3, 0.2, tiles * tile], [r2(c.x + side * 5.5), 0.1, c.z], { material: { preset: 'concrete', color: '#b9bcc0' }, physics: 'static', castShadow: false });
    for (let i = 0; i < 6; i++) {
      const bz = r2(c.z - 36 + i * 14 + b.rand(-0.6, 0.6));
      const bx = r2(c.x + side * 14);
      const kind = CITY_BUILDINGS[(i * 3 + (side > 0 ? 1 : 0)) % CITY_BUILDINGS.length] as string;
      b.asset('building', kind, [bx, 0, bz], {
        yaw: side > 0 ? -90 : 90,
        physics: 'static',
        tags: ['building'],
        fallback: { kind: 'procedural', generator: 'house', params: { floors: 3, width: 9, depth: 9 } },
      });
      if (i % 2 === 0) {
        const lx = r2(c.x + side * 4.6);
        const lz = r2(bz + 5);
        const post = b.asset('streetlight', 'streetlight', [lx, 0.2, lz], { yaw: side > 0 ? 90 : -90, physics: 'static', tags: ['lamp'], footprint: 0.6 });
        if (lightsOn(b)) b.light(post, [0, 4.6, 0], '#ffe6b0', 3, 16);
      }
    }
    // Pedestrians strolling up and down the sidewalk (they walk, animate and turn at each end).
    for (let k = 0; k < 2; k++) {
      const px = r2(c.x + side * (5.1 + k * 0.8));
      const from = r2(c.z - 30 + b.rand(0, 20));
      const to = r2(from + side * 22);
      b.asset('pedestrian', b.pick([...PEOPLE]), [px, 0.2, from], {
        name: b.pick(['Ada', 'Bram', 'Cleo', 'Dorian', 'Esme', 'Finn', 'Gwen', 'Hugo']),
        behaviors: [{ type: 'patrol', params: { waypoints: [[px, 0.2, from], [px, 0.2, to]], speed: r2(b.rand(1.2, 1.6)), mode: 'pingpong', face: true } }],
        tags: ['npc', 'character'],
      });
    }
  }
  // Parked cars along the curb (library cars face -Z, the engine's forward axis).
  for (let i = 0; i < 4; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    b.asset('parked-car', b.pick([...CITY_CARS]), [r2(c.x + side * 3), 0, r2(c.z - 30 + i * 16)], { yaw: side > 0 ? 180 : 0, physics: 'static', tags: ['car'], fallback: CAR_FALLBACK });
  }
  // Traffic: kinematic cars patrolling the lanes.
  for (const [lane, dir] of [[-1.8, 1], [1.8, -1]] as const) {
    const startZ = r2(c.z - dir * 40);
    b.asset('traffic-car', b.pick(['taxi', 'car', 'suv', 'van']), [r2(c.x + lane), 0, startZ], {
      yaw: dir > 0 ? 180 : 0,
      physics: 'kinematic',
      behaviors: [{ type: 'patrol', params: { waypoints: [[r2(c.x + lane), 0, startZ], [r2(c.x + lane), 0, r2(c.z + dir * 40)]], speed: 7, mode: 'loop', face: false } }],
      tags: ['car', 'traffic'],
      fallback: CAR_FALLBACK,
    });
  }
  b.asset('traffic-light', 'traffic-light', [r2(c.x + 4.4), 0.2, r2(z0 + 4 * tile - 4.6)], { yaw: 90, physics: 'static' });
  b.asset('traffic-light', 'traffic-light', [r2(c.x - 4.4), 0.2, r2(z0 + 4 * tile + 4.6)], { yaw: -90, physics: 'static' });
  b.asset('dumpster', 'dumpster', [r2(c.x - 6.3), 0.2, r2(c.z + 26)], { yaw: 90, physics: 'static' });
  b.asset('bench', 'bench-painted', [r2(c.x + 6.4), 0.2, r2(c.z - 12)], { yaw: -90, physics: 'static' });
  b.asset('planter', 'planter', [r2(c.x + 6.4), 0.2, r2(c.z - 16)], { physics: 'static' });
  b.asset('planter', 'planter', [r2(c.x - 6.4), 0.2, r2(c.z + 2)], { physics: 'static' });
}

const city: Theme = {
  id: 'city',
  kind: 'setting',
  title: 'City Street',
  match: /\b(city|street|downtown|urban|cars?|traffic|road|drive|driving|race|racing|highway|neighbou?rhood|parking)\b/,
  radius: 40,
  blurb: 'a city street lined with buildings, lamp posts, parked cars and traffic — hop in the red car and drive',
  env(b) {
    b.env({ sky: 'day', timeOfDay: 17, fog: { color: '#c8cdd4', density: 0.008 }, bloom: 0.7, ground: { material: { preset: 'concrete', color: '#8f9399' }, size: 400 } });
  },
  build(c) {
    const { b } = c;
    const library = hasAssets(...CITY_BUILDINGS, ...CITY_CARS, ...PEOPLE, 'road', 'road-crossing', 'streetlight', 'sports-car', 'traffic-light', 'dumpster', 'bench-painted', 'planter');
    if (library) {
      libraryStreet(c);
      // Photographic daylight for the real models (image-based lighting), unless it is night.
      if (c.primary && !b.mood.night && !b.mood.dusk && hasAssets('sky-partly-cloudy')) b.env({ hdri: 'sky-partly-cloudy', timeOfDay: 14 });
      if (c.primary) {
        const car = b.asset('player-car', 'sports-car', [r2(c.x - 1.8), 0, r2(c.z + 10)], {
          name: 'Your car',
          physics: { body: 'dynamic', mass: 900, friction: 0.9, angularDamping: 2, linearDamping: 0.1 },
          behaviors: [{ type: 'vehicle', params: { maxSpeed: 22, acceleration: 9 } }],
          tags: ['car', 'player-car', 'focus'],
          fallback: { kind: 'procedural', generator: 'car', params: { length: 4.2, color: '#d62828' } },
        });
        b.player({ mode: 'vehicle', controls: car, spawn: [r2(c.x - 1.8), 1, r2(c.z + 16)] });
        b.test({ id: 'car-on-road', kind: 'staysAbove', target: car, y: -0.5, within: 5 });
        backdropMountains(c, 4, '#7a7f87', 0.8, 140, 30);
      }
      return;
    }
    const roadLen = 90;
    b.prim('road', 'box', [8, 0.05, roadLen], [c.x, 0.025, c.z], { material: { preset: 'concrete', color: '#2f3237', roughness: 0.9 }, castShadow: false, name: 'Road' });
    for (let i = 0; i < 14; i++) {
      b.prim('lane-mark', 'box', [0.2, 0.02, 2.4], [c.x, 0.06, r2(c.z - roadLen / 2 + 3 + i * 6.4)], { material: { preset: 'emissive', color: '#f5f0d0', emissive: '#f5f0d0', emissiveIntensity: 0.2 }, castShadow: false });
    }
    for (const side of [-1, 1]) {
      b.prim('sidewalk', 'box', [3, 0.2, roadLen], [r2(c.x + side * 5.5), 0.1, c.z], { material: { preset: 'concrete', color: '#b9bcc0' }, physics: 'static', castShadow: false });
      for (let i = 0; i < 6; i++) {
        const bz = r2(c.z - 36 + i * 14 + b.rand(-1, 1));
        const bx = r2(c.x + side * 14);
        const modern = b.chance(0.6);
        b.gen('building', 'house', { width: r2(b.rand(8.5, 11)), depth: r2(b.rand(8, 10)), floors: 3, color: b.pick(['#c7b9a5', '#9fb3c8', '#d6c6b8', '#b5a89a', '#e0d5c1']), roofColor: '#4b4f56', lights: lightsOn(b), variant: modern ? 1 : 0 }, [bx, 0, bz], {
          yaw: side > 0 ? -90 : 90,
          physics: 'static',
          tags: ['building'],
        });
        if (i % 2 === 0) lamp(b, r2(c.x + side * 4.6), r2(bz + 5), '#ffe6b0', 4.5);
      }
    }
    // Parked cars along the curb (cars face +X; the road runs along Z).
    for (let i = 0; i < 4; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      b.gen('parked-car', 'car', { length: 4, color: b.pick(['#1d3557', '#e9c46a', '#f1faee', '#6d6875', '#2a9d8f']), variant: b.int(0, 2) }, [r2(c.x + side * 3), 0, r2(c.z - 30 + i * 16)], {
        yaw: yawAlongX(0, side > 0 ? 1 : -1),
        physics: 'static',
        tags: ['car'],
      });
    }
    // Traffic: kinematic cars patrolling the lanes.
    for (const [lane, dir] of [[-1.8, 1], [1.8, -1]] as const) {
      const startZ = r2(c.z - dir * 40);
      b.gen('traffic-car', 'car', { length: 4.2, color: b.pick(['#f4a261', '#457b9d', '#ffb703']) }, [r2(c.x + lane), 0, startZ], {
        yaw: yawAlongX(0, dir),
        physics: 'kinematic',
        behaviors: [{ type: 'patrol', params: { waypoints: [[r2(c.x + lane), 0, startZ], [r2(c.x + lane), 0, r2(c.z + dir * 40)]], speed: 7, mode: 'loop', face: false } }],
        tags: ['car', 'traffic'],
      });
    }
    if (c.primary) {
      const car = b.gen('player-car', 'car', { length: 4.2, color: '#d62828', variant: 0 }, [r2(c.x - 1.8), 0, r2(c.z + 10)], {
        name: 'Your car',
        yaw: yawAlongX(0, -1),
        physics: { body: 'dynamic', mass: 900, friction: 0.9, angularDamping: 2, linearDamping: 0.1 },
        behaviors: [{ type: 'vehicle', params: { maxSpeed: 22, acceleration: 9 } }],
        tags: ['car', 'player-car', 'focus'],
      });
      b.player({ mode: 'vehicle', controls: car, spawn: [r2(c.x - 1.8), 1, r2(c.z + 16)] });
      b.test({ id: 'car-on-road', kind: 'staysAbove', target: car, y: -0.5, within: 5 });
      backdropMountains(c, 4, '#7a7f87', 0.8, 140, 30);
    }
  },
};

const haunted: Theme = {
  id: 'haunted',
  kind: 'setting',
  layerable: true,
  title: 'Haunted Hollow',
  match: /\b(haunted|spooky|ghosts?|graveyard|cemetery|halloween|creepy|horror|scary|zombies?|witch|pumpkins?)\b/,
  radius: 34,
  blurb: 'a fog-drenched haunted hollow with a dark mansion, crooked gravestones, glowing pumpkins, fireflies and a drifting ghost',
  env(b) {
    b.env({ sky: 'night', timeOfDay: 23, fog: { color: '#1b1630', density: 0.04 }, weather: 'fireflies', bloom: 1.4, ambientIntensity: 0.25, sunIntensity: 0.4, ground: { material: { preset: 'dirt', color: '#2f3326' }, size: 400 } });
    b.player({ mode: 'thirdPerson', spawn: [0, 1, 14] });
  },
  build(c) {
    const { b } = c;
    const mx = c.x;
    const mz = r2(c.z - Math.max(14, c.clear + 8));
    if (b.claim(mx, mz, 7)) {
      b.gen('mansion', 'house', { width: 10, depth: 8, floors: 3, color: '#3d3a44', roofColor: '#1f1c24', trimColor: '#14121a', lights: true, variant: 2 }, [mx, 0, mz], { physics: 'static', name: 'Haunted mansion', tags: ['focus'] });
      b.light(b.empty('mansion-glow', [mx, 0, r2(mz + 5)]), [0, 3, 0], '#9d7bff', 2.5, 14, [{ type: 'pulseLight', params: { min: 1, max: 3, period: 3 } }]);
    }
    let graves = 0;
    for (let i = 0; i < 30 && graves < 14; i++) {
      const p = b.spot(c.x, c.z, Math.max(4, c.clear + 1), 16, 0.8);
      if (!p) continue;
      const h = r2(b.rand(0.9, 1.5));
      b.prim('gravestone', 'box', [0.8, h, 0.22], [p[0], r2(h / 2), p[1]], { rot: [r2(b.rand(-8, 8)), r2(b.rand(-25, 25)), r2(b.rand(-6, 6))], material: { preset: 'stone', color: '#7d7f85' }, physics: 'static', tags: ['grave'] });
      graves++;
    }
    for (let i = 0; i < 6; i++) {
      const p = b.spot(c.x, c.z, Math.max(3, c.clear + 1), 14, 0.6);
      if (!p) continue;
      const pumpkin = b.prim('pumpkin', 'sphere', [0.7, 0.55, 0.7], [p[0], 0.28, p[1]], { scale: [1, 0.8, 1], material: { color: '#e86a17', emissive: '#ff7b00', emissiveIntensity: 1.2 }, physics: 'static', tags: ['pumpkin'] });
      b.light(pumpkin, [0, 0.4, 0], '#ff7b00', 1, 5, [{ type: 'pulseLight', params: { min: 0.5, max: 1.4, period: r2(b.rand(0.8, 1.6)) } }]);
    }
    for (let i = 0; i < 2; i++) {
      b.prim('ghost', 'capsule', [0.9, 1.8, 0.9], [r2(c.x + (i === 0 ? -6 : 7)), 1.6, r2(c.z - 4 - i * 3)], {
        name: 'Ghost',
        material: { color: '#e8f0ff', emissive: '#b8c8ff', emissiveIntensity: 1.5, opacity: 0.5 },
        behaviors: [{ type: 'bob', params: { amplitude: 0.4, period: 3 } }, { type: 'wander', params: { radius: 6, speed: 1.2, pause: 0.5 } }],
        castShadow: false,
        tags: ['ghost'],
      });
    }
    for (const side of [-1, 1]) {
      const fx = r2(c.x + side * Math.max(8, c.clear + 6));
      if (b.claim(fx, c.z + 8, 3)) b.gen('iron-fence', 'fence', { length: 12, height: 1.6, color: '#1c1c22', variant: 2 }, [fx, 0, r2(c.z + 8)], { physics: 'static' });
    }
    treeRing(c, 14, 14, 30, [{ generator: 'tree-oak', params: { height: 7, color: '#3b3a2a', trunkColor: '#2a211a', density: 2 } }], 2);
    scatterBelt(c, 'glow-mushrooms', 'mushroom', { color: '#7b2cbf', height: 0.5 }, 8, 6, 24);
    scatterBelt(c, 'dead-grass', 'grass-tuft', { color: '#4a4a32' }, 40, 3, 30);
    if (c.primary) backdropMountains(c, 4, '#2c2a33', 1, 100, 26);
  },
};

const space: Theme = {
  id: 'space',
  kind: 'setting',
  title: 'Asteroid Station',
  match: /\b(space|asteroids?|planets?|galaxy|orbit|moon|mars|alien|sci-?fi|spaceship|cosmos|stars|zero[- ]?g(?:ravity)?)\b/,
  radius: 40,
  blurb: 'a low-gravity asteroid outpost floating in space with glowing crystals, orbiting planets and a warp portal',
  env(b) {
    b.env({ sky: 'space', fog: null, ground: null, gravity: [0, -1.62, 0], bloom: 1, ambientIntensity: 0.35, sunIntensity: 2.2, weather: 'clear' });
    b.player({ mode: 'thirdPerson', spawn: [0, 2, 6], jumpSpeed: 7 });
  },
  build(c) {
    const { b } = c;
    const base = b.prim('station-deck', 'cylinder', [16, 1, 16], [c.x, -0.5, c.z], { name: 'Station deck', material: { preset: 'metal', color: '#6f7a88', metalness: 0.6, roughness: 0.42 }, physics: 'static', tags: ['platform', 'focus'] });
    b.prim(`${base}-rim`, 'torus', [16.4, 0.4, 16.4], [0, 0.3, 0], { parent: base, rot: [90, 0, 0], material: { preset: 'neon', color: '#00e5ff', emissive: '#00e5ff', emissiveIntensity: 1.1 } });
    b.reserve(c.x, r2(c.z - 5.5), 1.8); // portal
    for (let i = 0; i < 4; i++) {
      const p = b.spot(c.x, c.z, 2, 6.5, 0.8);
      if (p) b.gen('crate', 'crate', { size: 0.9, color: '#6c7a89' }, [p[0], 0, p[1]], { physics: { body: 'dynamic', mass: 4 }, tags: ['cargo'] });
    }
    const portal = b.gen('warp-portal', 'portal', { size: 3, glowColor: '#00e5ff' }, [c.x, 0, r2(c.z - 5.5)], { physics: 'static', name: 'Warp portal' });
    b.light(portal, [0, 1.5, 0.5], '#00e5ff', 1.6, 12, [{ type: 'pulseLight', params: { min: 1.2, max: 2.2, period: 2 } }]);
    // Floating asteroid stepping stones and big drifting asteroids.
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const d = 12 + i * 1.5;
      const ax = r2(c.x + Math.cos(a) * d);
      const az = r2(c.z + Math.sin(a) * d);
      b.gen('asteroid-step', 'rock', { size: 3, color: '#6b625a' }, [ax, r2(0.6 + i * 0.9), az], { physics: 'static', tags: ['platform', 'asteroid'] });
      b.reserve(ax, az, 2);
    }
    for (let i = 0; i < 8; i++) {
      const a = b.rand(0, Math.PI * 2);
      const d = b.rand(28, 60);
      b.gen('asteroid', 'rock', { size: r2(b.rand(4, 10)), color: b.pick(['#5d554d', '#7a6f63', '#4a4440']) }, [r2(c.x + Math.cos(a) * d), r2(b.rand(-10, 25)), r2(c.z + Math.sin(a) * d)], {
        behaviors: [{ type: 'spin', params: { axis: [r2(b.rand(-1, 1)), 1, r2(b.rand(-1, 1))], speed: r2(b.rand(4, 14)) } }],
        tags: ['asteroid', 'backdrop'],
      });
    }
    for (let i = 0; i < 5; i++) {
      const p = b.spot(c.x, c.z, 3, 7.5, 0.7);
      if (!p) continue;
      const crystal = b.gen('crystal', 'crystal', { size: r2(b.rand(0.8, 1.6)), color: b.pick(['#7fd4ff', '#c77dff', '#72efdd']), glow: 2.5 }, [p[0], 0, p[1]], { physics: 'static', tags: ['crystal'] });
      if (i < 2) b.light(crystal, [0, 1, 0], '#9be7ff', 0.8, 7);
    }
    b.reserve(c.x, c.z, 8); // the deck is full now
    b.scatter('debris-field', 'rock', { size: 1.2, color: '#5d554d' }, 60, [140, 140], [c.x, -8, c.z], { scaleRange: [0.5, 2.5], minSpacing: 4, castShadow: false, tags: ['backdrop'] });
    const planet = b.prim('gas-giant', 'sphere', [40, 40, 40], [r2(c.x - 80), 8, r2(c.z - 150)], { name: 'Gas giant', material: { color: '#d08c60', emissive: '#6b3a1f', emissiveIntensity: 0.4 }, castShadow: false, tags: ['backdrop'] });
    b.prim(`${planet}-ring`, 'torus', [70, 1.5, 70], [0, 0, 0], { parent: planet, rot: [70, 0, 15], material: { color: '#e9d8a6', opacity: 0.7 }, castShadow: false });
    b.prim('moon', 'sphere', [8, 8, 8], [r2(c.x + 60), 40, r2(c.z - 80)], {
      material: { color: '#c9c9c9', emissive: '#5a5a5a', emissiveIntensity: 0.3 },
      behaviors: [{ type: 'orbit', params: { center: [c.x, 30, r2(c.z - 60)], radius: 70, speed: 4 } }],
      castShadow: false,
      tags: ['backdrop'],
    });
    b.test({ id: 'cargo-on-deck', kind: 'staysAbove', target: '#cargo', y: -1, within: 8 });
    b.test({ id: 'deck-stable', kind: 'stable', target: '#cargo', seconds: 4, maxDrift: 0.3 });
  },
};

/** Built settings (order = tie-break priority). */
export const BUILT_THEMES: readonly Theme[] = [village, castle, city, haunted, space];
