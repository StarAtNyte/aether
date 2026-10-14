/**
 * Four-Seasons Garden — a Japanese garden whose four quarters each live in
 * a different season around a koi pond: cherry blossom, deep summer green,
 * autumn fire and winter frost. Keys 1–4 turn the whole garden to one
 * season (every tree, lawn and flower bed has all four looks), 5 brings the
 * four seasons back side by side. Fireflies at dusk, koi under a moon bridge.
 */
import type { Json } from '@aether/core';
import { r2, type Builder, type V3 } from '../builder';
import type { MockPlan } from '../planner';
import { finish, flagshipBuilder, glowLantern, onCircle } from './kit';

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
      return { generator: 'tree-oak', params: { height: 6, color: '#4f8a3b', density: 8, variant: 0 } };
    case 'autumn':
      return { generator: 'tree-oak', params: { height: 6, color: '#d4542a', density: 7, variant: 2 } };
    default:
      return { generator: 'tree-oak', params: { height: 5.6, color: '#e3ebf2', density: 4, variant: 1, trunkColor: '#3f3530' } };
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
    sunIntensity: 2.4,
    ambientIntensity: 0.5,
    fog: { color: '#efc9b4', density: 0.006 },
    weather: 'fireflies',
    bloom: 0.9,
    exposure: 1.05,
    ground: { material: { preset: 'grass', color: '#6f8f4a' }, size: 300 },
  });

  // --- Paths, pond, bridge, tea house -------------------------------------------------------
  for (const [w, d] of [[64, 3.2], [3.2, 64]] as const) b.prim('gravel-path', 'box', [w, 0.06, d], [0, 0.03, 0], { material: { preset: 'sand', color: '#d6cdbb', roughness: 1 }, castShadow: false, tags: ['path'] });
  const pond = b.prim('koi-pond', 'cylinder', [16, 0.08, 16], [0, 0.05, 0], { name: 'Koi pond', material: { preset: 'water', color: '#2f5a63', opacity: 0.92, roughness: 0.03 }, castShadow: false, tags: ['water'] });
  void pond;
  b.prim('pond-rim', 'cylinder', [17.4, 0.16, 17.4], [0, 0.04, 0], { material: { preset: 'stone', color: '#8a857c' }, castShadow: false });
  b.keepClear(0, 0, 9.5);
  b.gen('moon-bridge', 'bridge', { length: 19, width: 2, height: 2.4, color: '#b8382a', variant: 0 }, [0, 0, 0], { physics: 'static', name: 'Moon bridge', tags: ['landmark'] });
  for (let i = 0; i < 8; i++) {
    const [x, , z] = onCircle(0, 0, 2.5 + (i % 3) * 1.4, (i / 8) * Math.PI * 2);
    b.asset('koi', 'fish', [x, 0.03, z], { fitSize: 0.7, physics: { body: 'kinematic', sensor: true }, behaviors: [{ type: 'orbit', params: { center: [0, 0.03, 0], radius: r2(2.5 + (i % 3) * 1.6), speed: r2(16 + i * 4) } }], castShadow: false, tags: ['koi'] });
  }
  for (let i = 0; i < 9; i++) {
    const [x, , z] = onCircle(0, 0, b.rand(4, 7), b.rand(0, Math.PI * 2));
    b.asset('lily-pad', 'lily-pad', [x, 0.07, z], { yaw: r2(b.rand(0, 360)), castShadow: false });
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
      else if (s === 'autumn') b.scatter('autumn-leaves', 'rock', { size: 0.35, color: '#d0642a', variant: 1 }, 260, [24, 24], [q.x, 0, q.z], base);
      else b.scatter('snow-drifts', 'rock', { size: 1.1, color: '#f4f7fa', variant: 3 }, 90, [24, 24], [q.x, 0, q.z], base);
    });
  }
  // A clipped hedge around the garden, with gates on the paths.
  for (const side of [-1, 1]) {
    for (const half of [-1, 1]) {
      const hedge = { material: { preset: 'leaf' as const, color: '#3f6b35', roughness: 0.9, flatShading: true }, physics: 'static' as const, tags: ['hedge'] };
      b.prim('hedge', 'box', [27, 1.5, 1.4], [r2(half * 17.8), 0.75, r2(side * 32)], hedge);
      b.prim('hedge', 'box', [1.4, 1.5, 27], [r2(side * 32), 0.75, r2(half * 17.8)], hedge);
    }
  }
  for (let i = 0; i < 6; i++) {
    const [x, , z] = onCircle(0, 0, b.rand(110, 140), Math.PI * 1.05 + (i / 6) * Math.PI * 0.9);
    b.gen('mountain', 'mountain', { size: r2(b.rand(80, 120)), height: r2(b.rand(30, 50)), color: '#6a6a80', snowLine: 0.85, groundColor: '#6f8f4a' }, [x, 0, z], { tags: ['backdrop'] });
  }

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
  b.rule({ id: 'hint', when: { on: 'start' }, then: [{ do: 'message', text: 'Press 1–4 to change the season, 5 for all four.', duration: 5 }] });
  b.player({ mode: 'orbit', spawn: [34, 22, 46] });
  b.test({ id: 'koi-swim', kind: 'moves', target: '#koi', distance: 1, within: 6 });

  return finish(b, {
    name: 'Four-Seasons Garden',
    description: 'A Japanese garden whose four quarters live in four seasons — switch them with 1–5.',
    intro: {
      title: 'Four-Seasons Garden',
      tagline: 'Blossom, green, fire and frost around one quiet koi pond.',
      objective: 'Turn the garden through the seasons and find your favourite.',
      controls: ['1 — spring', '2 — summer', '3 — autumn', '4 — winter', '5 — all four', 'Drag — orbit'],
      accent: '#ff9fb8',
    },
    plan: 'Plan: a hedged Japanese garden with gravel paths, a koi pond with fish, lily pads and a moon bridge, a tea house and lanterns; four quarters each holding all four seasonal looks (trees, lawn, beds) toggled by key rules, dusk with fireflies.',
    message: 'Built Four-Seasons Garden: four garden quarters in four seasons around a koi pond. Press Play, then 1–4 to turn the whole garden to one season, 5 for all four.',
  });
}
