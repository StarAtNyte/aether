/**
 * Showcase settings of the mock planner that exercise the renderer's
 * large-scale paths: a canyon of colossal sculptures (virtual geometry)
 * between plateaus holding a million trees (culled level-of-detail fields).
 */
import { r2, type Builder, type PlaceOpts, type V3 } from './builder';
import type { Json } from '@aether/core';
import type { Theme } from './theme';
import { VIEW_BEARING } from './decor';

/**
 * A sculpture sharing one mesh with every other sculpture of the same
 * params (fixed seed): instances differ by transform only, so the renderer
 * builds one cluster hierarchy and one set of vertex buffers for all of them.
 */
function sculpture(b: Builder, base: string, params: Record<string, Json>, seed: number, pos: V3, o: PlaceOpts & { yaw: number; scale: number; footprint: number }): void {
  const id = b.id(base);
  b.add({
    id,
    ...(o.name ? { name: o.name } : {}),
    transform: { position: [r2(pos[0]), r2(pos[1]), r2(pos[2])], rotation: [0, r2(o.yaw), 0], scale: [r2(o.scale), r2(o.scale), r2(o.scale)] },
    shape: { kind: 'procedural', generator: 'colossus', params, seed },
    physics: { body: 'static' },
    ...(o.tags && o.tags.length > 0 ? { tags: o.tags } : {}),
  });
  b.reserve(pos[0], pos[2], o.footprint * o.scale);
}

/** Trees in the plateau forests (two fields of half each). */
export const SHOWCASE_TREES = 1_000_000;
/** Size of the canyon terrain (metres). */
const SIZE = 1400;

const canyonOfColossi: Theme = {
  id: 'colossi',
  kind: 'setting',
  title: 'Canyon of Colossi',
  match: /\b(?:benchmark|stress[- ]?test|nanite|virtual geometry|colossi|colossus|(?:a |one )?million (?:trees|pines|statues))\b|\bcanyon\b(?=.*\b(?:million|colossi|colossus|statues)\b)/,
  radius: 60,
  // The canyon replaces the desert setting that "canyon" alone would pick.
  absorbs: ['desert'],
  blurb: 'a stratified sandstone canyon lined with weathered colossal heads and a ring of carved standing stones, under plateaus holding a million pines — every statue drawn as virtual geometry, the forest as culled level-of-detail fields',
  env(b) {
    b.env({ sky: 'day', timeOfDay: 16.6, sunIntensity: 3.2, fog: { color: '#e8b98c', density: 0.004 }, bloom: 0.55, exposure: 1.05, weather: 'clear', ground: { material: { preset: 'sand', color: '#c98f5e' }, size: SIZE * 1.6 } });
    b.player({ mode: 'thirdPerson', spawn: [0, 1, 46] });
  },
  build(c) {
    const { b } = c;
    const terrain = b.gen('canyon', 'terrain', { size: SIZE, height: 85, resolution: 256, roughness: 0.6, color: '#5d7a3a', variant: 3 }, [0, 0, 0], { physics: 'static', tags: ['terrain'], name: 'Canyon' });
    // A million pines on the plateaus, either side of the canyon (fields of 500k each).
    const half = SHOWCASE_TREES / 2;
    const fieldW = SIZE / 2 - 150;
    for (const side of [-1, 1]) {
      b.add({
        id: b.id(side < 0 ? 'west-forest' : 'east-forest'),
        name: side < 0 ? 'West forest' : 'East forest',
        transform: { position: [r2(side * (150 + fieldW / 2)), 0, 0] },
        shape: { kind: 'scatter', of: { kind: 'procedural', generator: 'tree-pine', params: { height: 9, color: '#2f5d34' } }, count: half, area: [fieldW, SIZE - 40], seed: side < 0 ? 11 : 12, scaleRange: [0.7, 1.4], onSurface: terrain },
        tags: ['forest', 'backdrop'],
      });
    }
    // Dry grass along the canyon floor.
    b.add({ id: b.id('floor-grass'), name: 'Canyon grass', transform: { position: [0, 0, 0] }, shape: { kind: 'scatter', of: { kind: 'procedural', generator: 'grass-tuft', params: { size: 0.6, color: '#b9a35f' } }, count: 60_000, area: [70, SIZE - 100], seed: 13, scaleRange: [0.7, 1.5], onSurface: terrain }, tags: ['backdrop'] });
    // An avenue of colossal heads lining the floor, all gazing down the canyon toward the
    // default camera (one shared mesh: identical params and seed).
    for (let i = 0; i < 9; i++) {
      for (const side of [-1, 1]) {
        const z = r2(-260 + i * 65 + (side > 0 ? 30 : 0));
        const x = r2(side * (26 + b.rand(0, 8)) + Math.sin((z * 4.2) / SIZE) * SIZE * 0.025);
        const h = r2(b.rand(0.8, 1.25));
        sculpture(b, 'colossus', { variant: 0, detail: 3, height: 16, color: '#a39380' }, 7, [x, 0, z], { yaw: VIEW_BEARING + side * 8 + b.rand(-10, 10), scale: h, name: 'Colossal head', footprint: 6, tags: ['backdrop'] });
      }
    }
    // A ring of carved standing stones around the canyon's heart.
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const r = 17;
      sculpture(b, 'standing-stone', { variant: 1, detail: 3, height: 7, color: '#8e8a83' }, 3, [Math.cos(a) * r, 0, Math.sin(a) * r], { yaw: (-a * 180) / Math.PI + 90, scale: b.rand(0.8, 1.2), tags: i === 0 ? ['focus'] : [], name: 'Standing stone', footprint: 2 });
    }
    // Eroded boulders on the floor.
    for (let i = 0; i < 10; i++) {
      const z = r2(b.rand(-300, 300));
      const p = b.spot(0, z, 0, 18, 4);
      if (!p) continue;
      sculpture(b, 'boulder', { variant: 2, detail: 2, height: 4, color: '#9b7f66' }, 5, [p[0], 0, p[1]], { yaw: b.rand(0, 360), scale: b.rand(0.6, 1.4), name: 'Boulder', footprint: 3, tags: ['backdrop'] });
    }
  },
};

/** Showcase themes. */
export const TECH_THEMES: readonly Theme[] = [canyonOfColossi];
