/**
 * Four-Seasons Garden — a Japanese garden whose four quarters each live in
 * a different season around a koi pond: cherry blossom, deep summer green,
 * autumn fire and winter frost. Keys 1–4 turn the whole garden to one
 * season (every tree, lawn and flower bed has all four looks), 5 brings the
 * four seasons back side by side. Fireflies at dusk, koi under a moon bridge.
 *
 * You walk it: a visitor enters at the south gate, strolls the gravel paths among gardeners and other visitors, stands in
 * each quarter to take in its season (a line of verse each) and, once all four are seen, takes tea with the tea master.
 */
import type { Json } from '@aether/core';
import { r2, type Builder, type V3 } from '../builder';
import type { MockPlan } from '../planner';
import { faceToward, finish, flagshipBuilder, glowLantern, onCircle } from './kit';

type Season = 'spring' | 'summer' | 'autumn' | 'winter';
const SEASONS: readonly Season[] = ['spring', 'summer', 'autumn', 'winter'];
/** Quarter centres (x, z) and the season each shows in the "all four" view. */
const QUARTERS: ReadonlyArray<{ id: string; x: number; z: number; season: Season }> = [
  { id: 'nw', x: -17, z: -17, season: 'spring' },
  { id: 'ne', x: 17, z: -17, season: 'summer' },
  { id: 'se', x: 17, z: 17, season: 'autumn' },
  { id: 'sw', x: -17, z: 17, season: 'winter' },
];
const LAWN: Readonly<Record<Season, string>> = { spring: '#8cc068', summer: '#5f9a3c', autumn: '#b58a3e', winter: '#eef3f7' };

/** The tree a spot shows in each season. */
function seasonalTree(season: Season): { generator: string; params: Record<string, Json> } {
  switch (season) {
    case 'spring':
      return { generator: 'hero-cherry-tree', params: { height: 5.2, spread: 6 } };
    case 'summer':
      return { generator: 'tree-broadleaf', params: { height: 6.4, color: '#4f8a3b', variant: 0 } };
    case 'autumn':
      return { generator: 'tree-broadleaf', params: { height: 6, color: '#d4542a', variant: 1 } };
    default:
      return { generator: 'tree-broadleaf', params: { height: 5.8, color: '#e3ebf2', variant: 1, trunkColor: '#4a413a', leaf: 0 } };
  }
}

/** Every season's version of a spot, tagged `<season>` and `<quarter>-<season>`; only `show` starts visible. */
function seasonalSpot(b: Builder, q: string, show: Season, place: (season: Season, visible: boolean, tags: string[]) => void): void {
  for (const s of SEASONS) place(s, s === show, [s, `${q}-${s}`]);
}

/** Plan Four-Seasons Garden. */
export function seasonsGarden(): MockPlan {
  const b = flagshipBuilder(0x5ea5, { dusk: true });
  b.env({
    sky: 'sunset',
    timeOfDay: 17.75,
    sunIntensity: 3.1,
    ambientIntensity: 0.7,
    fog: { color: '#efc9b4', density: 0.005 },
    weather: 'fireflies',
    bloom: 0.9,
    exposure: 1.25,
    ground: { material: { preset: 'grass', color: '#86a85d' }, size: 300 },
  });

  // --- Paths, pond, bridge, tea house -------------------------------------------------------
  for (const [w, d] of [[64, 3.2], [3.2, 64]] as const) b.prim('gravel-path', 'box', [w, 0.06, d], [0, 0.03, 0], { material: { finish: 'gravel', preset: 'sand', color: '#d6cdbb', roughness: 1 }, castShadow: false, tags: ['path'] });
  const pond = b.prim('koi-pond', 'cylinder', [16, 0.08, 16], [0, 0.2, 0], { name: 'Koi pond', material: { preset: 'water', waterKind: 'pond', color: '#2f5a63', opacity: 0.92, roughness: 0.03 }, castShadow: false, tags: ['water'] });
  void pond;
  // The rim is the stone bed and lip under the water: its top (0.2) stays below the water surface (0.24) so the pond shows.
  b.prim('pond-rim', 'cylinder', [17.4, 0.2, 17.4], [0, 0.1, 0], { material: { finish: 'limestone', preset: 'stone', color: '#8a857c' }, castShadow: false });
  b.keepClear(0, 0, 9.5);
  b.gen('moon-bridge', 'bridge', { length: 19, width: 2, height: 2.4, color: '#b8382a', variant: 0 }, [0, 0, 0], { physics: 'static', name: 'Moon bridge', tags: ['landmark'] });
  for (let i = 0; i < 8; i++) {
    const [x, , z] = onCircle(0, 0, 2.5 + (i % 3) * 1.4, (i / 8) * Math.PI * 2);
    b.asset('koi', 'fish', [x, 0.2, z], { fitSize: 0.7, physics: { body: 'kinematic', sensor: true }, behaviors: [{ type: 'orbit', params: { center: [0, 0.2, 0], radius: r2(2.5 + (i % 3) * 1.6), speed: r2(16 + i * 4) } }], castShadow: false, tags: ['koi'] });
  }
  for (let i = 0; i < 9; i++) {
    const [x, , z] = onCircle(0, 0, b.rand(4, 7), b.rand(0, Math.PI * 2));
    b.asset('lily-pad', 'lily-pad', [x, 0.25, z], { yaw: r2(b.rand(0, 360)), castShadow: false });
  }
  b.gen('tea-house', 'hero-gazebo', { width: 6, height: 5, color: '#efe6d6', roofColor: '#3d4a52', deckColor: '#8a6a4a' }, [0, 0, -34], { physics: 'static', name: 'Tea house', tags: ['landmark'] });
  b.light(b.empty('tea-light', [0, 2.6, -34]), [0, 0, 0], '#ffc27a', 2.6, 14);
  for (const [x, z] of [[-3, -9.5], [3, -9.5], [-3, 9.5], [3, 9.5], [-9.5, -3], [9.5, 3]] as const) glowLantern(b, [x, 0, z], '#ffb35c', { height: 1.1, lit: x > 0, shade: '#efe2c4' });

  // --- Four quarters, each with all four seasons ------------------------------------------------
  for (const q of QUARTERS) {
    // Lawn patch.
    seasonalSpot(b, q.id, q.season, (s, visible, tags) => {
      b.prim('lawn', 'box', [27, 0.04, 27], [q.x, 0.02, q.z], { name: `${s} lawn`, visible, material: { preset: s === 'winter' ? 'snow' : 'grass', color: LAWN[s] }, castShadow: false, tags });
    });
    // Trees in a loose ring, plus a feature rock.
    for (let k = 0; k < 6; k++) {
      const [x, , z] = onCircle(q.x, q.z, k === 0 ? 0 : b.rand(6, 10), (k / 5) * Math.PI * 2 + b.rand(-0.3, 0.3));
      const yaw = r2(b.rand(0, 360));
      seasonalSpot(b, q.id, q.season, (s, visible, tags) => {
        const t = seasonalTree(s);
        b.gen('garden-tree', t.generator, t.params, [r2(x), 0, r2(z)], { yaw, visible, ...(visible ? { physics: 'static' as const } : {}), tags: [...tags, 'tree'] });
      });
    }
    b.gen('feature-rock', 'rock', { size: 2.4, color: '#7d776d', mossy: true, variant: 2 }, [r2(q.x + 3), 0, r2(q.z - 3)], { yaw: r2(b.rand(0, 360)), physics: 'static' });
    // Seasonal beds: blossom and irises, sunflowers, fallen leaves, snow drifts.
    seasonalSpot(b, q.id, q.season, (s, visible, tags) => {
      const base = { visible, tags, minSpacing: 0.7, scaleRange: [0.7, 1.3] as [number, number] };
      if (s === 'spring') b.scatter('spring-bed', 'flowers', { size: 0.5, color: '#ffc0d6', centerColor: '#ffe9a8', count: 6 }, 160, [22, 22], [q.x, 0, q.z], base);
      else if (s === 'summer') b.scatter('summer-bed', 'flowers', { size: 0.65, color: '#8f6bff', centerColor: '#ffd23f', count: 5, variant: 1 }, 160, [22, 22], [q.x, 0, q.z], base);
      else if (s === 'autumn') {
        // Straw-gold grass and late chrysanthemums: the lawn itself is already russet.
        b.scatter('autumn-grass', 'grass-tuft', { size: 0.5, color: '#c79a45', blades: 11 }, 260, [24, 24], [q.x, 0, q.z], { ...base, scaleRange: [0.7, 1.3] });
        b.scatter('autumn-blooms', 'flowers', { size: 0.4, color: '#e0702a', centerColor: '#7a3b12', count: 6, variant: 1 }, 90, [22, 22], [q.x, 0, q.z], base);
      } else {
        // Snow drifts: low white swells, not boulders.
        for (let k = 0; k < 14; k++) {
          const dx = b.rand(-11, 11);
          const dz = b.rand(-11, 11);
          if (Math.hypot(dx, dz) < 3) continue;
          const w = r2(b.rand(1.2, 2.6));
          b.prim('snow-drift', 'sphere', [w, r2(w * 0.28), r2(w * b.rand(0.7, 1.1))], [r2(q.x + dx), 0.04, r2(q.z + dz)], { visible, tags, castShadow: false, material: { preset: 'snow', color: '#f5f8fb', roughness: 0.9 } });
        }
      }
    });
  }
  // A clipped hedge around the garden, with gates on the paths: leaf masses over a dark core (the `hedge` generator),
  // in 5.4 m runs so each keeps its leaf density.
  const HEDGE_RUNS = 5;
  for (const side of [-1, 1]) {
    for (const half of [-1, 1]) {
      for (let k = 0; k < HEDGE_RUNS; k++) {
        const along = r2(half * 17.8 - 13.5 + (27 / HEDGE_RUNS) * (k + 0.5));
        const params = { length: r2(27 / HEDGE_RUNS), height: 1.5, width: 1.4, color: '#355f31', detail: 0.6 };
        b.gen('hedge', 'hedge', params, [along, 0, r2(side * 32)], { physics: 'static', tags: ['hedge'] });
        b.gen('hedge', 'hedge', params, [r2(side * 32), 0, along], { physics: 'static', tags: ['hedge'], yaw: 90 });
      }
    }
  }
  // Rolling hills close in the garden, the far mountains stand blue behind them; meadow grass and wildflowers run up to the hedge.
  for (let i = 0; i < 9; i++) {
    const [x, , z] = onCircle(0, 0, b.rand(85, 115), (i / 9) * Math.PI * 2 + b.rand(-0.2, 0.2));
    b.gen('hill', 'mountain', { size: r2(b.rand(90, 130)), height: r2(b.rand(10, 20)), color: '#7a9a55', snowLine: 1, groundColor: '#6f8f4a', variant: 0 }, [x, 0, z], { tags: ['backdrop'] });
  }
  for (let i = 0; i < 6; i++) {
    const [x, , z] = onCircle(0, 0, b.rand(170, 210), Math.PI * 1.05 + (i / 6) * Math.PI * 0.9);
    b.gen('mountain', 'mountain', { size: r2(b.rand(110, 150)), height: r2(b.rand(40, 62)), color: '#6c7088', snowLine: 0.85, groundColor: '#6f8f4a' }, [x, 0, z], { tags: ['backdrop'] });
  }
  for (const [x, z, w, d] of [[0, 52, 120, 40], [0, -52, 120, 40], [52, 0, 40, 70], [-52, 0, 40, 70]] as const) {
    b.scatter('meadow-grass', 'grass-tuft', { size: 0.6, color: '#86a955', blades: 12 }, 4200, [w, d], [x, 0, z], { minSpacing: 0.55, scaleRange: [0.7, 1.5] });
    b.scatter('meadow-flowers', 'flowers', { size: 0.5, color: b.pick(['#ffffff', '#ffd23f', '#d98cff']), centerColor: '#ffd23f', count: 5 }, 400, [w, d], [x, 0, z], { minSpacing: 1.0, scaleRange: [0.8, 1.4] });
  }

  // --- People and the walk -------------------------------------------------------------------------
  const person = (base: string, name: string, pos: V3, look: Record<string, Json>, lines: string[], persona: string, wander: boolean, extra: { yawToward?: [number, number]; patrol?: V3[] } = {}): string =>
    b.prim(base, 'capsule', [0.56, 1.7, 0.56], [pos[0], 0.85, pos[2]], {
      name,
      character: look as never,
      ...(extra.yawToward ? { yaw: faceToward(pos[0], pos[2], extra.yawToward[0], extra.yawToward[1]) } : {}),
      physics: { body: 'kinematic', sensor: true },
      behaviors: [
        { type: 'npc' as const, params: { name, persona, lines, greetRadius: 4, talkInterval: 5, wander } },
        ...(extra.patrol ? [{ type: 'patrol' as const, params: { waypoints: extra.patrol, relative: true, speed: 1.05, mode: 'pingpong', wait: 2, face: true } }] : []),
      ],
      tags: ['npc'],
    });
  person('tea-master', 'Aiko', [2.2, 0, -31], { wardrobe: 'elder', gender: 'female', age: 'old', top: '#7f3b4a', bottom: '#3a3340', hold: 'cup', mood: 'calm' }, ['The garden changes its coat four times a year. Sit in each quarter, then come and take tea.', 'Tea tastes of whichever season you last stood in.'], 'a calm elderly tea master who speaks in short, gentle sentences about the seasons', false, { yawToward: [0, 40] });
  person('gardener', 'Haru', [r2(QUARTERS[2]!.x - 8), 0, r2(QUARTERS[2]!.z + 6)], { wardrobe: 'worker', gender: 'male', age: 'adult', top: '#5a6a48', bottom: '#4a4034', hold: 'staff', mood: 'calm' }, ['The maples turn the week the first frost comes. I just rake what they give me.'], 'a quiet gardener raking leaves', true);
  person('visitor', 'Visitor', [r2(-3.4), 0, 24], { wardrobe: 'casual', gender: 'female', age: 'adult', top: '#d8d2c4', bottom: '#51606e', mood: 'cheerful' }, ['The blossom here is better than the postcards.'], 'a visitor admiring the garden', false, { patrol: [[0, 0, 0], [0, 0, -14]] });
  person('visitor', 'Visitor', [r2(3.4), 0, -22], { wardrobe: 'formal', gender: 'male', age: 'adult', top: '#3d4757', bottom: '#2c2f38', mood: 'calm' }, ['I come every season. Never the same garden twice.'], 'a visitor who loves the garden', false, { patrol: [[0, 0, 0], [0, 0, 16]] });

  b.state('quarters', 0);
  b.hud('quarters', 'Quarters seen / 4');
  const verse: Record<Season, string> = {
    spring: 'Spring: petals fall like slow snow on the water.',
    summer: 'Summer: deep green, and the cicadas begin.',
    autumn: 'Autumn: the maples burn without smoke.',
    winter: 'Winter: frost on every branch, and the pond holds its breath.',
  };
  for (const q of QUARTERS) {
    const zone = b.prim('quarter-zone', 'cylinder', [9, 3, 9], [q.x, 1.5, q.z], { name: `${q.season} quarter`, visible: false, physics: { body: 'static', sensor: true }, tags: ['quarter-zone'], castShadow: false });
    b.rule({ id: `quarter-${q.id}`, description: `Standing in the ${q.season} quarter counts it as seen`, when: { on: 'enter', zone }, then: [{ do: 'message', text: verse[q.season], duration: 4.5 }, { do: 'add', key: 'quarters', amount: 1 }, { do: 'sound', sound: 'bell' }], once: true });
  }
  const teaGoal = b.prim('tea-goal', 'box', [6, 3, 5], [0, 1.5, -31], { name: 'Tea house steps', visible: false, physics: { body: 'static', sensor: true }, behaviors: [{ type: 'goal', enabled: false, params: { text: 'You take tea as the light goes. The garden is the same garden, in four coats.' } }], tags: ['goal'], castShadow: false });
  b.rule({ id: 'tea-ready', description: 'All four quarters seen: the tea house is open', when: { on: 'state', key: 'quarters', op: '>=', value: 4 }, then: [{ do: 'enableBehavior', target: teaGoal, behavior: 'goal', enabled: true }, { do: 'message', text: 'You have seen all four seasons. Aiko is waiting at the tea house.', duration: 5 }, { do: 'sound', sound: 'win' }], once: true });
  b.rule({ id: 'reset-key', when: { on: 'key', key: 'r' }, then: [{ do: 'reset' }] });

  // --- Season keys -------------------------------------------------------------------------------
  const show = (season: Season | 'all'): Array<{ do: 'setProperty'; target: string; path: string; value: Json }> => {
    const out: Array<{ do: 'setProperty'; target: string; path: string; value: Json }> = [];
    for (const q of QUARTERS) {
      for (const s of SEASONS) out.push({ do: 'setProperty', target: `#${q.id}-${s}`, path: 'visible', value: season === 'all' ? s === q.season : s === season });
    }
    return out;
  };
  SEASONS.forEach((s, i) => {
    b.rule({ id: `season-${s}`, description: `Key ${i + 1}: the whole garden in ${s}`, when: { on: 'key', key: String(i + 1) }, then: [...show(s), { do: 'message', text: s[0]?.toUpperCase() + s.slice(1), duration: 1.6 }, { do: 'set', key: 'season', value: s }] });
  });
  b.rule({ id: 'season-all', description: 'Key 5: all four seasons side by side', when: { on: 'key', key: '5' }, then: [...show('all'), { do: 'message', text: 'Four seasons', duration: 1.6 }, { do: 'set', key: 'season', value: 'all' }] });
  b.state('season', 'all');
  b.rule({ id: 'hint', when: { on: 'start' }, then: [{ do: 'message', text: 'Walk the garden and stand in each quarter. Press 1–4 to change the season, 5 for all four.', duration: 6 }] });
  b.player({ mode: 'thirdPerson', spawn: [0, 0.2, 29], moveSpeed: 4.6, jumpSpeed: 5, character: { wardrobe: 'casual', gender: 'female', age: 'adult', top: '#e7dcc8', bottom: '#44525f' } });
  b.test({ id: 'koi-swim', kind: 'moves', target: '#koi', distance: 1, within: 6 });

  return finish(b, {
    name: 'Four-Seasons Garden',
    description: 'A Japanese garden whose four quarters live in four seasons — switch them with 1–5.',
    intro: {
      title: 'Four-Seasons Garden',
      tagline: 'Blossom, green, fire and frost around one quiet koi pond.',
      objective: 'Stand in each of the four quarters, then take tea at the tea house. Keys 1–5 turn the seasons.',
      controls: ['WASD — walk', 'Mouse — look', '1–4 — season', '5 — all four', 'E — talk'],
      accent: '#ff9fb8',
    },
    plan: 'Plan: a hedged Japanese garden with gravel paths, a koi pond with fish, lily pads and a moon bridge, a tea house and lanterns; four quarters each holding all four seasonal looks (trees, lawn, beds) toggled by key rules, dusk with fireflies.',
    message: 'Built Four-Seasons Garden: four garden quarters in four seasons around a koi pond. Press Play, then 1–4 to turn the whole garden to one season, 5 for all four.',
  });
}
