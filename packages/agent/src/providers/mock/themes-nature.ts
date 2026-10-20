/**
 * Natural settings for the mock planner: forest camp, tropical beach,
 * winter, desert canyon, volcano, park, farm and a default meadow.
 */
import { r2 } from './builder';
import { terrainHeight } from './showcase/kit';
import { backdropMountains, campfire, clouds, lake, lamp, lantern, lightsOn, naturalGround, path, scatterBelt, treeRing, VIEW_BEARING, yawAlongX, yawFacingZ, type ThemeCtx } from './decor';
import type { Theme } from './theme';

/** The request asks for running water (a river, stream or creek) rather than a lake. */
export function wantsStream(c: ThemeCtx): boolean {
  return /\b(?:rivers?|streams?|creeks?|brooks?|riverside|riverbank)\b/.test(c.request ?? '');
}

/** Ground cover of a realistic setting: dense clumped grass, ferns and flowers over the land round the scene. */
function cover(c: ThemeCtx, o: { grass: string; ferns?: number; flowers?: readonly string[]; dry?: boolean; inner?: number; outer?: number }): void {
  const { b } = c;
  if (!b.realisticNature) return;
  const inner = o.inner ?? 3;
  const outer = o.outer ?? 40;
  scatterBelt(c, 'meadow', 'meadow-grass', { color: o.grass, size: o.dry ? 0.45 : 0.55 }, 520, inner, outer, { scaleRange: [0.6, 1.4], minSpacing: 0.3 });
  if ((o.ferns ?? 0) > 0) scatterBelt(c, 'ferns', 'fern', { size: 0.9 }, o.ferns ?? 0, inner + 4, outer, { scaleRange: [0.7, 1.4], minSpacing: 0.9 });
  for (const color of o.flowers ?? []) scatterBelt(c, 'wildflowers', 'wildflowers', { color, size: 0.5 }, 60, inner + 2, outer, { minSpacing: 0.5 });
}

function rocks(c: ThemeCtx, count: number, inner: number, outer: number, color: string, mossy: boolean, size: [number, number] = [0.8, 2.2]): void {
  for (let i = 0; i < count; i++) {
    const s = r2(c.b.rand(size[0], size[1]));
    const p = c.b.spot(c.x, c.z, Math.max(inner, c.clear + s), outer, s * 0.7);
    if (p) c.b.gen('rock', 'rock', { size: s, color, mossy }, [p[0], 0, p[1]], { yaw: r2(c.b.rand(0, 360)), physics: 'static', tags: ['rock'] });
  }
}

const forest: Theme = {
  id: 'forest',
  kind: 'setting',
  layerable: true,
  title: 'Forest Camp',
  match: /\b(forest|woods?|woodland|camp(?:ing|site|fire)?|pines?|jungle|grove|trees)\b/,
  radius: 40,
  blurb: 'a pine-and-oak forest clearing with a crackling campfire and tents',
  env(b) {
    b.env({ sky: 'day', timeOfDay: 17.5, fog: b.realisticNature ? { color: '#b9c6a6', density: 0.006, visibility: 320 } : { color: '#b9c6a6', density: 0.012 }, bloom: 0.6, ground: { material: { preset: 'grass', color: '#4f7a35' }, size: 400 } });
    b.player({ mode: 'thirdPerson', spawn: [0, 1, 12] });
  },
  build(c) {
    const { b } = c;
    // A real forest floor: a landscape with a clearing for the camp (and a stream across it when the request names one).
    const stream = wantsStream(c);
    naturalGround(c, { pad: Math.max(16, c.clear + 6), relief: 42, ...(stream ? { stream: { z: r2(c.z - 17), half: 2.4, bend: 4, depth: 1.5 } } : {}), woods: { conifers: 190, broadleaf: 50, birch: 24, scrub: 220, boulders: 46 }, conifer: { color: '#2c4a2e', height: 15 } });
    if (c.clear < 4) {
      const fire = campfire(b, c.x, c.z);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + 0.4;
        const lx = r2(c.x + Math.cos(a) * 2.6);
        const lz = r2(c.z + Math.sin(a) * 2.6);
        b.prim('log-seat', 'cylinder', [0.45, 2, 0.45], [lx, 0.225, lz], { rot: [0, r2(yawFacingZ(lx, lz, c.x, c.z) + 90), 90], material: { preset: 'bark', color: '#6b4a2f' }, physics: 'static', footprint: 1 });
      }
      for (let i = 0; i < 2; i++) {
        const a = Math.PI * (0.9 + i * 0.7);
        const tx = r2(c.x + Math.cos(a) * 6);
        const tz = r2(c.z + Math.sin(a) * 6);
        b.gen('tent', 'tent', { size: 2.6, color: b.pick(['#c8553d', '#2a9d8f', '#e9c46a']) }, [tx, 0, tz], { yaw: yawFacingZ(tx, tz, c.x, c.z), physics: 'static', footprint: 2 });
        if (lightsOn(b)) lantern(b, r2(tx + Math.cos(a + 1.2) * 2), r2(tz + Math.sin(a + 1.2) * 2));
      }
      // A trail winds from the camp toward the default camera (through the view corridor).
      path(b, r2(c.x + 1.2), r2(c.z + 3.2), r2(c.x + Math.sin((VIEW_BEARING * Math.PI) / 180) * 34), r2(c.z + Math.cos((VIEW_BEARING * Math.PI) / 180) * 34), 1.5, b.realisticNature ? '#6a6150' : '#6b5a45', 'dirt');
      // Woodpile: three stacked logs.
      const pile = b.prim('woodpile', 'cylinder', [0.32, 1.6, 0.32], [r2(c.x + 3.6), 0.16, r2(c.z + 1.4)], { rot: [0, 20, 90], material: { preset: 'bark', color: '#6b4a2f' }, physics: 'static', footprint: 0.9 });
      b.prim(`${pile}-log`, 'cylinder', [0.32, 1.6, 0.32], [0, 0, 0.33], { parent: pile, material: { preset: 'bark', color: '#7a5535' } });
      b.prim(`${pile}-log`, 'cylinder', [0.3, 1.5, 0.3], [0.28, 0, 0.165], { parent: pile, material: { preset: 'bark', color: '#5e402a' } });
      b.meta('Forest Camp', `Campfire clearing (${fire}) in a pine forest`);
    }
    if (b.mood.water && c.primary && !b.stream) {
      // Lakeside: the lake opens up behind the camp, toward the mountains.
      lake(b, r2(c.x - 3), r2(c.z - 17), 8);
    }
    treeRing(c, 22, 9, c.primary ? 30 : 22, [
      { generator: 'tree-pine', params: { height: 8, snow: b.mood.snow } },
      { generator: 'tree-pine', params: { height: 6, color: '#2b5e34', snow: b.mood.snow } },
      { generator: 'tree-oak', params: { height: 6, color: '#4f8a3b' } },
    ]);
    rocks(c, 6, 6, 24, '#8a8a85', true);
    scatterBelt(c, 'bushes', 'bush', { size: 1.1, berries: true }, b.realisticNature ? 14 : 6, 7, 26, { minSpacing: 1.5 });
    if (b.realisticNature) cover(c, { grass: '#6f9a45', ferns: 70, flowers: ['#e9e1b0'], outer: 36 });
    else {
      scatterBelt(c, 'mushrooms', 'mushroom', { height: 0.5 }, 5, 6, 22);
      scatterBelt(c, 'grass', 'grass-tuft', { color: '#6a9a45' }, 60, 3, 34, { scaleRange: [0.7, 1.4] });
    }
    if (c.primary) {
      scatterBelt(c, 'pine-forest', 'tree-pine', { height: 9, snow: b.mood.snow }, 30, 32, 70, { scaleRange: [0.8, 1.5], minSpacing: 3 });
      backdropMountains(c, 5, '#6f6a62', b.mood.snow ? 0.4 : 0.75);
      if (b.mood.night || b.mood.dusk) b.env({ weather: b.mood.rain ? 'rain' : b.mood.snow ? 'snow' : 'fireflies' });
    }
  },
};

const beach: Theme = {
  id: 'beach',
  kind: 'setting',
  title: 'Tropical Beach',
  match: /\b(beach|tropical|island|ocean|seaside|coast|shore|palms?|sea|surf)\b/,
  radius: 40,
  blurb: 'a sunny tropical beach with palms, umbrellas, a pier with a bobbing boat and a beach ball to kick around',
  env(b) {
    b.env({ sky: 'day', timeOfDay: 14.5, sunIntensity: 3, fog: { color: '#cfe8f5', density: 0.005 }, bloom: 0.7, ground: { material: { preset: 'sand', color: '#ecd9a5' }, size: 400 } });
    b.player({ mode: 'thirdPerson', spawn: [0, 1, 14] });
  },
  build(c) {
    const { b } = c;
    const seaZ = c.z - 8;
    b.prim('sea', 'box', [1600, 0.2, 700], [c.x, -0.04, r2(seaZ - 350)], { name: 'Sea', material: { preset: 'water', waterKind: 'sea', color: '#1f86b8', opacity: 0.85, roughness: 0.08 }, castShadow: false });
    const dockX = r2(c.x + 10);
    b.gen('dock', 'dock', { length: 14, width: 2.6, height: 1 }, [dockX, 0, r2(seaZ - 2)], { yaw: 90, physics: 'static', name: 'Pier' });
    b.gen('boat', 'boat', { length: 5, variant: 1, color: '#f4f1ea', accentColor: '#c8553d' }, [r2(dockX + 3.5), 0, r2(seaZ - 11)], {
      yaw: yawAlongX(0, -1),
      behaviors: [{ type: 'bob', params: { amplitude: 0.12, period: 3.2 } }],
      name: 'Sailboat',
    });
    let palms = 0;
    for (let i = 0; i < 40 && palms < 11; i++) {
      const x = r2(c.x + b.rand(-32, 32));
      const z = r2(c.z + b.rand(-4, 26));
      const dx = x - c.x;
      const dz = z - c.z;
      if (dx * dx + dz * dz < (c.clear + 2) ** 2 || !b.claim(x, z, 2.2)) continue;
      b.gen('palm', 'tree-palm', { height: r2(b.rand(6, 9)), coconuts: b.chance(0.6) }, [x, 0, z], { yaw: r2(b.rand(0, 360)), physics: 'static', tags: ['tree'] });
      palms++;
    }
    const stripes = ['#e63946', '#f4a261', '#2a9d8f', '#457b9d'];
    for (let i = 0; i < 4; i++) {
      const ux = r2(c.x - 14 + i * 6 + b.rand(-1, 1));
      const uz = r2(c.z + b.rand(1, 6));
      if (!b.claim(ux, uz, 1.6)) continue;
      const pole = b.prim('umbrella', 'cylinder', [0.08, 2.4, 0.08], [ux, 1.2, uz], { material: { preset: 'wood', color: '#f1e6d0' }, physics: 'static', name: 'Beach umbrella' });
      b.prim(`${pole}-canopy`, 'cone', [2.8, 0.7, 2.8], [0, 1.45, 0], { parent: pole, material: { preset: 'fabric', color: stripes[i % stripes.length] as string } });
      b.prim('towel', 'box', [0.9, 0.03, 1.9], [r2(ux + 1.4), 0.015, uz], { yaw: r2(b.rand(-15, 15)), material: { preset: 'fabric', color: b.pick(stripes) }, castShadow: false });
    }
    if (c.clear < 3) {
      const ball = b.prim('beach-ball', 'sphere', [0.7, 0.7, 0.7], [c.x, 0.35, r2(c.z + 4)], {
        name: 'Beach ball',
        material: { preset: 'rubber', color: '#ff4d6d' },
        physics: { body: 'dynamic', mass: 0.4, restitution: 0.8, linearDamping: 0.3 },
        tags: ['ball'],
        footprint: 0.6,
      });
      b.rule({ id: 'kick-ball', description: 'Click the beach ball to kick it', when: { on: 'click', target: ball }, then: [{ do: 'impulse', target: ball, vector: [0, 3, -2] }, { do: 'sound', sound: 'whoosh' }] });
      b.test({ id: 'ball-on-beach', kind: 'staysAbove', target: ball, y: -0.5, within: 6 });
    }
    b.gen('sandcastle', 'tower', { height: 1.6, radius: 0.6, color: '#d9c38c', roofColor: '#d9c38c' }, [r2(c.x - 5), 0, r2(c.z + 8)], { physics: 'static', footprint: 1 });
    rocks(c, 5, 8, 30, '#7b7469', false, [0.8, 1.8]);
    b.gen('island', 'island', { size: 46, height: 6 }, [r2(c.x - 55), 0, r2(seaZ - 85)], { name: 'Distant island' });
    if (c.primary) clouds(c, 6);
  },
};

const winter: Theme = {
  id: 'winter',
  kind: 'setting',
  layerable: true,
  title: 'Winter Wonderland',
  match: /\b(winter|snowy|snow|frozen|ice|icy|christmas|arctic|tundra|ski|snowman)\b/,
  radius: 38,
  blurb: 'a snowy valley with a glowing log cabin, snow-capped pines, a frozen pond and a snowman',
  env(b) {
    b.env({ sky: 'overcast', timeOfDay: 15, weather: 'snow', fog: b.realisticNature ? { color: '#dfe7ef', density: 0.006, visibility: 380 } : { color: '#dfe7ef', density: 0.018 }, bloom: 0.8, ambientIntensity: 0.6, ground: { material: { preset: 'snow', color: '#f4f7fb' }, size: 400 } });
    b.player({ mode: 'thirdPerson', spawn: [0, 1, 14] });
  },
  build(c) {
    const { b } = c;
    // A snowy valley: snow lying on rolling land, snow-laden spruce woods on the hills.
    naturalGround(c, { pad: Math.max(18, c.clear + 6), relief: 60, color: '#eef2f6', snow: true, woods: { conifers: 230, broadleaf: 0, birch: 24, scrub: 40, boulders: 30 }, conifer: { color: '#2a4433', height: 15 } });
    if (c.clear < 6) {
      const cabin = b.gen('cabin', 'house', { width: 7, depth: 6, color: '#7a5233', roofColor: '#f2f4f7', trimColor: '#3d2a1a', lights: true, variant: 2 }, [c.x, 0, r2(c.z - 4)], { physics: 'static', footprint: 5, name: 'Log cabin', tags: ['focus'] });
      b.light(cabin, [0, 2, 4], '#ffb86b', 2.5, 12);
      const sx = r2(c.x + 5);
      const sz = r2(c.z + 3);
      const snowman = b.prim('snowman', 'sphere', [1.4, 1.4, 1.4], [sx, 0.7, sz], { material: { preset: 'snow' }, physics: 'static', footprint: 1, name: 'Snowman' });
      b.prim(`${snowman}-body`, 'sphere', [1, 1, 1], [0, 1.05, 0], { parent: snowman, material: { preset: 'snow' } });
      b.prim(`${snowman}-head`, 'sphere', [0.7, 0.7, 0.7], [0, 1.8, 0], { parent: snowman, material: { preset: 'snow' } });
      b.prim(`${snowman}-nose`, 'cone', [0.12, 0.4, 0.12], [0, 1.82, 0.38], { parent: snowman, rot: [90, 0, 0], material: { color: '#f77f00' } });
      b.prim(`${snowman}-hat`, 'cylinder', [0.5, 0.45, 0.5], [0, 2.3, 0], { parent: snowman, material: { color: '#1d1d1f' } });
    }
    const px = r2(c.x - 12);
    const pz = r2(c.z + 2);
    if (b.claim(px, pz, 6)) {
      b.prim('frozen-pond', 'cylinder', [11, 0.1, 11], [px, 0.05, pz], { name: 'Frozen pond', material: { preset: 'ice', color: '#bfe3f2', roughness: 0.05 }, physics: { body: 'static', friction: 0.02 } });
    }
    treeRing(c, 22, 10, c.primary ? 30 : 22, [{ generator: 'tree-pine', params: { height: 8, snow: true } }, { generator: 'tree-pine', params: { height: 6, color: '#2b5e34', snow: true } }]);
    rocks(c, 5, 8, 26, '#9aa3ab', false);
    scatterBelt(c, 'snowy-bushes', 'bush', { color: '#3e6b4a', size: 0.9 }, 5, 8, 26);
    if (c.primary) {
      scatterBelt(c, 'snowy-forest', 'tree-pine', { height: 9, snow: true }, 30, 32, 70, { scaleRange: [0.8, 1.5], minSpacing: 3 });
      backdropMountains(c, 6, '#8d939b', 0.3, 110, 40);
      for (let i = 0; i < 4; i++) {
        const p = b.spot(c.x, c.z, 4, 14, 0.6);
        if (p) lamp(b, p[0], p[1], '#ffe0a3');
      }
    }
  },
};

const desert: Theme = {
  id: 'desert',
  kind: 'setting',
  layerable: true,
  title: 'Desert Canyon',
  match: /\b(desert|canyon|dunes?|sahara|wild west|western|mesa|cactus|cacti|oasis)\b/,
  radius: 40,
  blurb: 'a sun-baked canyon with red mesas, saguaro cacti, ancient ruins and dust in the air',
  env(b) {
    b.env({ sky: 'day', timeOfDay: 16.5, sunIntensity: 3.2, weather: 'dust', fog: b.realisticNature ? { color: '#e8c39a', density: 0.003, visibility: 900 } : { color: '#e3b98a', density: 0.012 }, bloom: 0.5, ground: { material: { preset: 'sand', color: '#d9a066' }, size: 400 } });
    b.player({ mode: 'thirdPerson', spawn: [0, 1, 14] });
  },
  build(c) {
    const { b } = c;
    // A real canyon: the terrain's sandstone canyon (flat floor along Z, stratified walls) instead of cones on a sand plane;
    // a race circuit laid out before the settings runs along its floor.
    const realCanyon = c.primary && b.realisticNature && !b.ground;
    if (realCanyon) {
      const size = b.track ? b.track.canyonSize : 420;
      const params = { size, height: b.track ? 58 : 46, resolution: 256, roughness: 0.55, color: '#9a8a4f', variant: 3 };
      const seed = (b.seed ^ 0xca7) % 100_000;
      b.env({ ground: null });
      const id = b.add({ id: b.id('canyon'), name: 'Canyon', shape: { kind: 'procedural', generator: 'terrain', params, seed }, transform: { position: [0, 0, 0] }, physics: { body: 'static', friction: 0.9 }, tags: ['terrain', 'canyon'] });
      b.ground = { h: terrainHeight(params, seed, size), surface: id };
    } else {
      for (const side of [-1, 1]) {
        for (let i = 0; i < 4; i++) {
          b.gen('mesa', 'mountain', { size: r2(b.rand(30, 42)), height: r2(b.rand(14, 22)), color: '#b5562f', snowLine: 1 }, [r2(c.x + side * b.rand(38, 46)), 0, r2(c.z - 50 + i * 28)], { yaw: r2(b.rand(0, 360)), physics: 'static', tags: ['canyon'] });
        }
      }
    }
    let cacti = 0;
    for (let i = 0; i < 30 && cacti < (b.realisticNature ? 16 : 9); i++) {
      const p = b.spot(c.x, c.z, Math.max(5, c.clear + 1), b.realisticNature ? 40 : 24, 1.2);
      if (!p) continue;
      if (b.realisticNature) {
        b.gen('saguaro', 'cactus', { height: r2(b.rand(3.5, 7.5)), arms: b.int(0, 4) }, [p[0], 0, p[1]], { yaw: r2(b.rand(0, 360)), scale: r2(b.rand(0.7, 1.15)), physics: 'static', tags: ['cactus', 'hazard'] });
        cacti++;
        continue;
      }
      const h = r2(b.rand(2.2, 3.6));
      const cactus = b.prim('cactus', 'capsule', [0.5, h, 0.5], [p[0], r2(h / 2), p[1]], { material: { preset: 'leaf', color: '#4a7c3a' }, physics: 'static', tags: ['cactus', 'hazard'] });
      const arm = r2(h * 0.15);
      b.prim(`${cactus}-arm`, 'capsule', [0.32, 1.1, 0.32], [0.45, arm, 0], { parent: cactus, material: { preset: 'leaf', color: '#4a7c3a' } });
      if (b.chance(0.6)) b.prim(`${cactus}-arm`, 'capsule', [0.3, 0.9, 0.3], [-0.42, r2(arm - 0.3), 0], { parent: cactus, material: { preset: 'leaf', color: '#4a7c3a' } });
      cacti++;
    }
    if (c.clear < 8 && !b.track) {
      b.gen('ruin-arch', 'arch', { width: 4, height: 5, color: '#c9a27a', accentColor: '#8a5a3c' }, [c.x, 0, r2(c.z - 6)], { physics: 'static', footprint: 3, name: 'Ancient arch', tags: ['focus'] });
      b.gen('ruin-wall', 'wall', { length: 6, height: 2, color: '#c9a27a', crenellated: false }, [r2(c.x - 6), 0, r2(c.z - 8)], { yaw: 25, physics: 'static', footprint: 3 });
      b.gen('ruin-statue', 'statue', { height: 3, color: '#d1b48c' }, [r2(c.x + 6), 0, r2(c.z - 7)], { yaw: -20, physics: 'static', footprint: 1.5 });
    }
    rocks(c, b.realisticNature ? 18 : 8, 6, b.realisticNature ? 44 : 30, b.realisticNature ? '#c79d76' : '#a0522d', false, [0.8, 2.6]);
    const track = b.track;
    if (b.realisticNature && track) {
      // Along the canyon floor beside the circuit and up the foot of the walls: scrub, dry grass, boulders and cacti in strips
      // that follow the canyon's meander.
      const CHUNK = 24;
      for (let zc = -200; zc <= 200; zc += CHUNK) {
        for (const side of [-1, 1]) {
          const cx = r2(track.axis(zc) + side * 31);
          b.scatter('desert-scrub', 'shrub', { size: 0.9, detail: 0.5, color: '#8a8a5c' }, 14, [14, CHUNK], [cx, 0, zc], { minSpacing: 2.4, scaleRange: [0.45, 1.1] });
          b.scatter('dry-grass', 'meadow-grass', { color: '#b8a066', size: 0.42 }, 120, [16, CHUNK], [cx, 0, zc], { minSpacing: 0.7, scaleRange: [0.6, 1.3] });
          b.scatter('scree', 'boulder', { size: 1.4, lichen: 0, color: '#c49a72', variant: 1 }, 7, [12, CHUNK], [r2(cx + side * 5), 0, zc], { minSpacing: 3, scaleRange: [0.4, 1.8] });
          if (Math.abs(zc) > 90 || b.chance(0.5)) b.gen('saguaro', 'cactus', { height: r2(b.rand(3.5, 7.5)), arms: b.int(0, 4) }, [r2(cx + b.rand(-4, 4)), 0, r2(zc + b.rand(-9, 9))], { yaw: r2(b.rand(0, 360)), scale: r2(b.rand(0.7, 1.15)), physics: 'static', tags: ['cactus'] });
        }
      }
    } else if (b.realisticNature) {
      scatterBelt(c, 'dry-grass', 'meadow-grass', { color: '#b8a066', size: 0.42 }, 260, 4, 46, { scaleRange: [0.6, 1.3], minSpacing: 0.6 });
      scatterBelt(c, 'desert-scrub', 'shrub', { size: 0.9, detail: 0.5, color: '#8a8a5c' }, 26, 6, 48, { scaleRange: [0.5, 1.2], minSpacing: 2.2 });
      scatterBelt(c, 'pebbles', 'boulder', { size: 0.5, lichen: 0, color: '#c8a27c', variant: 1 }, 40, 3, 40, { scaleRange: [0.3, 1], minSpacing: 1.2 });
    } else scatterBelt(c, 'dry-grass', 'grass-tuft', { color: '#b59a5b', size: 0.4 }, 30, 4, 34);
    if (c.primary) {
      b.gen('tumbleweed', 'bush', { size: 0.8, color: '#9c7a4f' }, [r2(c.x - 8), 0, r2(c.z + 6)], { behaviors: [{ type: 'wander', params: { radius: 10, speed: 2, pause: 0 } }], name: 'Tumbleweed' });
    }
  },
};

const volcano: Theme = {
  id: 'volcano',
  kind: 'setting',
  layerable: true,
  title: 'Volcanic Wastes',
  match: /\b(volcan(?:o|ic|oes)|lava|magma|inferno|hell|fire mountain|eruption)\b/,
  radius: 40,
  blurb: 'a smouldering volcano with rivers of glowing lava, basalt rocks and burning crystals',
  env(b) {
    b.env({ sky: 'sunset', timeOfDay: 17.4, fog: { color: '#3a1c14', density: 0.02 }, weather: 'dust', bloom: 1.2, exposure: 1.1, ambientIntensity: 0.3, ground: { material: { preset: 'dirt', color: '#2b2522' }, size: 400 } });
    b.player({ mode: 'thirdPerson', spawn: [0, 1, 16] });
  },
  build(c) {
    const { b } = c;
    const vz = r2(c.z - 55);
    b.gen('volcano', 'mountain', { size: 70, height: 38, color: '#3b302b', groundColor: '#2b2522', snowLine: 1 }, [c.x, 0, vz], { physics: 'static', name: 'Volcano' });
    // The crater's molten glow: a pulsing light just above the rim lights the peak from inside.
    const crater = b.empty('crater-glow', [c.x, 24, vz], { name: 'Crater glow' });
    b.light(crater, [0, 0, 0], '#ff5a1f', 8, 80, [{ type: 'pulseLight', params: { min: 5, max: 9, period: 2.5 } }]);
    for (const [ox, oz, w, d, yaw] of [[-14, -12, 4, 34, 20], [16, -6, 3, 28, -30]] as const) {
      const x = r2(c.x + ox);
      const z = r2(c.z + oz);
      if (!b.claim(x, z, d / 2)) continue;
      b.prim('lava-river', 'box', [w, 0.12, d], [x, 0.06, z], {
        yaw,
        material: { preset: 'lava', emissive: '#ff5a1f', emissiveIntensity: 3 },
        physics: { body: 'static', sensor: true },
        behaviors: [{ type: 'hazard', params: { mode: 'respawn', text: 'Too hot!' } }],
        tags: ['lava', 'hazard'],
      });
    }
    rocks(c, 12, 5, 30, '#2e2b2a', false, [1, 3]);
    for (let i = 0; i < 6; i++) {
      const p = b.spot(c.x, c.z, Math.max(6, c.clear + 1), 24, 1);
      if (!p) continue;
      const id = b.gen('ember-crystal', 'crystal', { size: r2(b.rand(1, 1.8)), color: '#ff7b29', glow: 3 }, [p[0], 0, p[1]], { physics: 'static', tags: ['crystal'] });
      b.light(id, [0, 1, 0], '#ff6a00', 1.5, 8, [{ type: 'pulseLight', params: { min: 0.8, max: 2, period: r2(b.rand(1, 2.2)) } }]);
    }
    scatterBelt(c, 'ash-rocks', 'rock', { size: 0.5, color: '#3a3533' }, 25, 4, 34);
  },
};

const park: Theme = {
  id: 'park',
  kind: 'setting',
  title: 'City Park',
  match: /\b(park|playground|garden|picnic|fountain|swings?|see-?saw|slide)\b/,
  radius: 32,
  blurb: 'a leafy park with a playground slide, a working see-saw, a pond, benches and flower beds',
  env(b) {
    b.env({ sky: 'day', timeOfDay: 11, bloom: 0.5, ...(b.realisticNature ? { fog: { color: '#d3dee8', density: 0.002, visibility: 700 } } : {}), ground: { material: { preset: 'grass', color: '#5f9a3e' }, size: 400 } });
    b.player({ mode: 'thirdPerson', spawn: [0, 1, 14] });
  },
  build(c) {
    const { b } = c;
    // Parkland: a lawn on gently rolling ground with woods round it.
    naturalGround(c, { pad: Math.max(32, c.clear + 6), relief: 36, woods: { conifers: 40, broadleaf: 160, birch: 40, scrub: 160, boulders: 10 }, broadleafColor: '#5a8a3a' });
    path(b, c.x - 26, c.z + 2, c.x + 26, c.z + 2, 2.4, '#c9b38b');
    path(b, c.x, c.z + 2, c.x, c.z - 24, 2.4, '#c9b38b');
    b.reserve(c.x, c.z + 2, 1.5);
    if (c.clear < 6) {
      // Slide: stairs up, ramp down (both rise/run along +X).
      const sx = r2(c.x - 9);
      const sz = r2(c.z - 6);
      b.gen('slide-stairs', 'stairs', { steps: 8, width: 1.2, height: 2.4, depth: 2.4, color: '#e76f51' }, [r2(sx - 2.4), 0, sz], { physics: 'static', name: 'Slide ladder' });
      b.prim('slide-deck', 'box', [1.2, 0.2, 1.4], [r2(sx - 0.6), 2.3, sz], { material: { preset: 'plastic', color: '#f4a261' }, physics: 'static' });
      b.gen('slide', 'ramp', { length: 4, width: 1.2, height: 2.4, color: '#2a9d8f' }, [r2(sx + 2), 0, sz], { yaw: 180, physics: 'static', name: 'Slide' });
      b.reserve(sx, sz, 4.5);
      // See-saw: plank hinged on a fulcrum (revolute joint to the world).
      const ex = r2(c.x + 8);
      const ez = r2(c.z - 6);
      b.prim('see-saw-base', 'cylinder', [0.5, 0.6, 0.5], [ex, 0.3, ez], { material: { preset: 'metal', color: '#264653' }, physics: 'static' });
      b.prim('see-saw', 'box', [4, 0.12, 0.5], [ex, 0.72, ez], {
        name: 'See-saw',
        material: { preset: 'wood', color: '#e9c46a' },
        physics: { body: 'dynamic', mass: 8 },
        joint: { type: 'revolute', target: 'world', anchor: [0, 0, 0], targetAnchor: [ex, 0.72, ez], axis: [0, 0, 1], limits: [-14, 14] },
        tags: ['toy'],
      });
      b.reserve(ex, ez, 2.5);
      const ball = b.prim('play-ball', 'sphere', [0.6, 0.6, 0.6], [r2(ex + 1.6), 1.08, ez], { material: { preset: 'rubber', color: '#e63946' }, physics: { body: 'dynamic', mass: 2, restitution: 0.6 }, name: 'Ball' });
      b.test({ id: 'see-saw-tips', kind: 'moves', target: ball, distance: 0.3, within: 6 });
    }
    const pondX = r2(c.x + 14);
    const pondZ = r2(c.z + 10);
    if (b.claim(pondX, pondZ, 5)) {
      b.prim('pond', 'cylinder', [9, 0.08, 9], [pondX, 0.04, pondZ], { name: 'Pond', material: { preset: 'water', waterKind: 'pond', color: '#3b8bb5', opacity: 0.85 }, castShadow: false });
      b.scatter('reeds', 'grass-tuft', { color: '#7a9a3a', size: 0.9 }, 18, [11, 11], [pondX, 0, pondZ], { minSpacing: 0.6 });
    }
    for (let i = 0; i < 4; i++) {
      const bx = r2(c.x - 18 + i * 12);
      if (b.claim(bx, c.z + 4.6, 1.1)) b.gen('bench', 'bench', { length: 1.8 }, [bx, 0, r2(c.z + 4.6)], { yaw: 180, physics: 'static' });
      if (i % 2 === 0) lamp(b, r2(bx + 3), r2(c.z - 0.2));
    }
    treeRing(c, 14, 14, 30, [{ generator: 'tree-oak', params: { height: 6 } }, { generator: 'tree-oak', params: { height: 7, color: '#6a9f3a' } }]);
    scatterBelt(c, 'flower-bed', 'flowers', { color: b.pick(['#e84a8a', '#ffd23f', '#9b5de5']) }, b.realisticNature ? 60 : 25, 6, 22, { minSpacing: 0.5 });
    scatterBelt(c, 'shrubs', 'bush', { size: 1 }, b.realisticNature ? 10 : 5, 10, 28);
    if (b.realisticNature) scatterBelt(c, 'lawn', 'meadow-grass', { color: '#7fae4c', size: 0.35 }, 300, 3, 34, { scaleRange: [0.5, 1], minSpacing: 0.4 });
  },
};

const farm: Theme = {
  id: 'farm',
  kind: 'setting',
  layerable: true,
  title: 'Windmill Farm',
  match: /\b(farm|windmills?|barn|countryside|ranch|(?<!(?:asteroid|debris|force|star|ice|lava|snow|energy|magnetic|mine|battle) )fields?|crops?|sheep|cows?|harvest|rural|tractor)\b/,
  radius: 40,
  blurb: 'rolling farmland with windmills, a red barn, fenced crop fields, hay bales and wandering sheep',
  env(b) {
    b.env({ sky: 'day', timeOfDay: 9.5, fog: b.realisticNature ? { color: '#d8e4c8', density: 0.0025, visibility: 650 } : { color: '#d8e4c8', density: 0.008 }, bloom: 0.5, ground: { material: { preset: 'grass', color: '#7aa648' }, size: 400 } });
    b.player({ mode: 'thirdPerson', spawn: [0, 1, 16] });
  },
  build(c) {
    const { b } = c;
    // Farmland on rolling ground with hedgerow woods on the hills.
    naturalGround(c, { pad: Math.max(34, c.clear + 6), relief: 44, color: '#7aa648', woods: { conifers: 30, broadleaf: 150, birch: 20, scrub: 200, boulders: 12 }, broadleafColor: '#557d36' });
    const barnX = r2(c.x - 10);
    const barnZ = r2(c.z - 10);
    if (b.claim(barnX, barnZ, 6)) b.gen('barn', 'house', { width: 9, depth: 7, color: '#a63a2b', roofColor: '#4a3b35', trimColor: '#f1ece2', lights: b.mood.night, variant: 2 }, [barnX, 0, barnZ], { yaw: 10, physics: 'static', name: 'Barn', tags: ['focus'] });
    for (let i = 0; i < 3; i++) {
      const wx = r2(c.x + 10 + i * 12);
      const wz = r2(c.z - 18 - i * 6);
      if (b.claim(wx, wz, 4)) b.gen('windmill', 'windmill', { height: r2(b.rand(9, 12)) }, [wx, 0, wz], { yaw: r2(b.rand(-30, 30)), physics: 'static', tags: ['windmill'] });
    }
    // Fenced field with crop rows.
    const fx = r2(c.x + 14);
    const fz = r2(c.z + 4);
    if (b.claim(fx, fz, 8)) {
      for (const [dx, dz, yaw] of [[0, -6, 0], [0, 6, 0], [-6, 0, 90], [6, 0, 90]] as const) {
        b.gen('fence', 'fence', { length: 12, color: '#8b5a2b', variant: 1 }, [r2(fx + dx), 0, r2(fz + dz)], { yaw, physics: 'static' });
      }
      for (let row = 0; row < 5; row++) {
        b.scatter('crops', 'grass-tuft', { color: '#d8b43c', size: 0.9, blades: 12 }, 14, [10, 0.6], [fx, 0, r2(fz - 4 + row * 2)], { randomYaw: false });
      }
    }
    for (let i = 0; i < 5; i++) {
      const p = b.spot(c.x, c.z, Math.max(4, c.clear + 1), 18, 1);
      if (p) b.prim('hay-bale', 'cylinder', [1.2, 1.4, 1.2], [p[0], 0.6, p[1]], { rot: [0, r2(b.rand(0, 180)), 90], material: { preset: 'fabric', color: '#e3c565' }, physics: 'static' });
    }
    for (let i = 0; i < 5; i++) {
      const p = b.spot(c.x, c.z, Math.max(5, c.clear + 1), 20, 1);
      if (!p) continue;
      if (b.realisticNature) {
        // The library's animated sheep (it walks and grazes), not a ball with a head.
        b.asset('sheep', 'sheep', [p[0], 0, p[1]], { name: 'Sheep', yaw: r2(b.rand(0, 360)), behaviors: [{ type: 'wander', params: { radius: 5, speed: 0.6, pause: 3 } }], tags: ['animal'], fallback: { kind: 'primitive', primitive: 'box', size: [0.6, 0.8, 1.2] } });
        continue;
      }
      const sheep = b.prim('sheep', 'sphere', [1.2, 1.2, 1.2], [p[0], 0.7, p[1]], {
        scale: [1.2, 0.85, 0.85],
        name: 'Sheep',
        material: { preset: 'fabric', color: '#f5f3ee' },
        behaviors: [{ type: 'wander', params: { radius: 5, speed: 0.8, pause: 2 } }],
        tags: ['animal'],
      });
      b.prim(`${sheep}-head`, 'sphere', [0.5, 0.5, 0.5], [0.6, 0.15, 0], { parent: sheep, material: { color: '#2b2b2b' } });
    }
    if (b.claim(c.x - 2, c.z - 16, 2.5)) b.gen('tractor', 'car', { length: 3.6, color: '#2e7d32', variant: 1 }, [r2(c.x - 2), 0, r2(c.z - 16)], { yaw: 35, physics: 'static', name: 'Tractor' });
    treeRing(c, 10, 22, 36, [{ generator: 'tree-oak', params: { height: 7 } }]);
    scatterBelt(c, 'wildflowers', 'flowers', { color: '#ffd23f' }, 20, 8, 34);
    if (b.realisticNature) scatterBelt(c, 'pasture', 'meadow-grass', { color: '#86ae4e', size: 0.5 }, 380, 6, 40, { scaleRange: [0.6, 1.3], minSpacing: 0.35 });
    if (c.primary) {
      backdropMountains(c, 4, '#7d8a6a', 0.85, 120, 22);
      clouds(c, 5);
    }
  },
};

const meadow: Theme = {
  id: 'meadow',
  kind: 'setting',
  layerable: true,
  title: 'Mountain Meadow',
  match: /\b(meadow|valley|hills?|mountains?|nature|lake|river|landscape|scenery|calm|peaceful|serene|scenic|pretty)\b/,
  radius: 36,
  blurb: 'a peaceful mountain meadow with wildflowers, oaks and pines under distant snowy peaks',
  env(b) {
    b.env({ sky: 'day', timeOfDay: 10.5, fog: b.realisticNature ? { color: '#cfdde8', density: 0.0025, visibility: 700 } : { color: '#cfdde8', density: 0.008 }, bloom: 0.5, ground: { material: { preset: 'grass', color: '#66924a' }, size: 400 } });
    b.player({ mode: 'thirdPerson', spawn: [0, 1, 14] });
  },
  build(c) {
    const { b } = c;
    const real = b.realisticNature;
    const stream = wantsStream(c);
    // A real valley floor: rolling land, a stream when the request names one, woods on the hills.
    naturalGround(c, { pad: Math.max(16, c.clear + 6), relief: 56, ...(stream ? { stream: { z: r2(c.z - 15), half: 2.6, bend: 5, depth: 1.4 } } : {}), woods: { conifers: 120, broadleaf: 110, birch: 30, scrub: 200, boulders: 40 } });
    const lx = r2(c.x - 14);
    const lz = r2(c.z - 10);
    if (!b.stream && b.claim(lx, lz, 8)) {
      b.prim('lake', 'cylinder', [16, 0.08, 16], [lx, 0.04, lz], { name: 'Lake', material: { preset: 'water', waterKind: 'lake', color: '#3a87b8', opacity: 0.85, roughness: 0.05 }, castShadow: false });
      b.gen('boat', 'boat', { length: 3.5, variant: 0 }, [lx, 0.05, lz], { behaviors: [{ type: 'bob', params: { amplitude: 0.08, period: 3 } }], name: 'Rowboat' });
      if (real) {
        b.keepClear(lx, lz, 8.5);
        // Reeds at the water's edge.
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2 + b.rand(-0.2, 0.2);
          b.scatter('reeds', 'meadow-grass', { color: '#6f8a3a', size: 1.2 }, 14, [2.6, 2.6], [r2(lx + Math.cos(a) * 8.6), 0, r2(lz + Math.sin(a) * 8.6)], { minSpacing: 0.3, scaleRange: [0.9, 1.6] });
        }
      }
    }
    const bridgeAt = b.stream ? ([r2(c.x + 10), r2(b.stream.z(c.x + 10))] as const) : null;
    if (bridgeAt && b.stream && c.primary && b.claim(bridgeAt[0], r2(bridgeAt[1] + b.stream.half + 2.8), 1)) b.gen('bridge', 'bridge', { length: r2(b.stream ? b.stream.half * 2 + 7 : 10), width: 3, height: 1.2, color: '#8a8580' }, [bridgeAt[0], 0, bridgeAt[1]], { yaw: 90, physics: 'static', name: 'Stone bridge' });
    else if (!real && b.claim(c.x + 10, c.z - 6, 5)) b.gen('bridge', 'bridge', { length: 10, width: 3, height: 1.5, color: '#8a8580' }, [r2(c.x + 10), 0, r2(c.z - 6)], { yaw: 30, physics: 'static', name: 'Stone bridge' });
    const wintry = b.mood.snow || b.envValue('weather') === 'snow';
    treeRing(c, 16, 8, 30, wintry ? [{ generator: 'tree-pine', params: { height: 8, snow: true } }, { generator: 'tree-pine', params: { height: 6, snow: true } }] : [{ generator: 'tree-oak', params: { height: 6 } }, { generator: 'tree-pine', params: { height: 8 } }]);
    rocks(c, 6, 6, 26, '#8d8a84', !wintry);
    if (real && wintry) scatterBelt(c, 'dry-grass', 'meadow-grass', { color: '#a9a487', size: 0.4 }, 90, 4, 36, { scaleRange: [0.5, 1.1], minSpacing: 0.5 });
    else if (real) cover(c, { grass: '#7aa04a', flowers: ['#e84a8a', '#ffd23f', '#f1efe6'], outer: 40 });
    else {
      scatterBelt(c, 'wildflowers', 'flowers', { color: '#e84a8a' }, 25, 4, 30, { minSpacing: 0.4 });
      scatterBelt(c, 'wildflowers-yellow', 'flowers', { color: '#ffd23f' }, 25, 6, 32, { minSpacing: 0.4 });
      scatterBelt(c, 'grass', 'grass-tuft', {}, 60, 3, 34);
    }
    if (c.primary) {
      backdropMountains(c, 6, '#76726a', 0.65, 105, 35);
      clouds(c, 5);
    }
  },
};

/** Natural settings (order = tie-break priority). */
export const NATURE_THEMES: readonly Theme[] = [forest, beach, winter, desert, volcano, park, farm, meadow];

/** Default setting when nothing matches. */
export const DEFAULT_SETTING: Theme = meadow;
