/**
 * Falling water: a waterfall sheet over a rock lip into a churning pool. The sheet is a set of ribbons (one per
 * strand) following the free-fall arc of water leaving the lip, drawn with the falling-water shader (material
 * `waterKind: 'fall'`: advected streaks, aeration, ragged edges). Add an entity `vfx: { preset: 'mist' }` at the
 * pool for the spray.
 */
import type { Vec3 } from '@aether/core';
import type { InternalApi } from '../api';
import { boxCollider } from '../colliders';
import { defineGenerator, MAT, pBool, pColor, pInt, pNum, pVariant } from './kit';

const G = 9.81;

const waterfallSheet = defineGenerator({
  id: 'waterfall-sheet',
  description: 'Waterfall: animated falling-water sheet off a rock lip into a churning pool; add vfx mist at the base.',
  category: 'nature',
  params: {
    height: pNum(18, 2, 120, 'drop from the lip to the pool in meters'),
    width: pNum(6, 0.5, 60, 'width of the falling water at the lip in meters'),
    strands: pInt(3, 1, 7, 'separate strands the water splits into (1 = one curtain)'),
    throwSpeed: pNum(1.6, 0, 6, 'horizontal speed leaving the lip (m/s): 0 slides down the face, 3+ leaps clear'),
    color: pColor('#6fa8a2', 'clear water colour at the lip'),
    variant: pVariant(0, '0 falls down a rock face with a lip, 1 free sheet (pour it off your own cliff, aqueduct or wall)'),
    pool: pBool(true, 'plunge pool at the foot'),
  },
  run(p, api: InternalApi) {
    const H = p.num('height');
    const W = p.num('width');
    const n = p.int('strands');
    const v0 = Math.max(0.05, p.num('throwSpeed'));
    const color = p.str('color');
    const fall = { preset: 'water', color, waterKind: 'fall', roughness: 0.1 } as const;
    const tEnd = Math.sqrt((2 * H) / G);
    const reach = v0 * tEnd;
    // Strands: share the width, with gaps; each a ribbon along the arc, widening as it aerates and spreads.
    const share = W / n;
    for (let k = 0; k < n; k++) {
      const x0 = -W / 2 + share * (k + 0.5) + api.range(-0.12, 0.12) * share;
      const w = share * (n === 1 ? 1 : api.range(0.62, 0.95));
      const v = v0 * api.range(0.85, 1.15);
      const drift = api.range(-0.04, 0.04) * H;
      const path: Vec3[] = [];
      const steps = Math.max(8, Math.min(48, Math.round(H / 1.2)));
      for (let i = 0; i <= steps; i++) {
        const t = (i / steps) * tEnd;
        path.push([x0 + drift * (i / steps) ** 2, H - 0.5 * G * t * t, 0.15 + v * t]);
      }
      api.add(api.ribbon(path, w, (t) => 1 + 0.4 * t), fall);
    }
    if (p.int('variant') === 0) {
      // The face the water leaves: a rough block behind the sheet with an overhanging lip.
      // A subdivided face (displacement needs vertices): a vertical sheet, broken by layered noise, leaning back.
      const fw = W * 1.6 + 2, fh = H + 1.5;
      const face = api.plane(fw, fh, Math.min(24, Math.ceil(fw / 1.2)), Math.min(32, Math.ceil(fh / 1.2))).rotate(90, 0, 0).translate(0, fh / 2 - 0.75, -0.6);
      face.displace((x, y) => api.fbm2(x * 0.22, y * 0.22) * Math.min(2.2, 0.35 + H * 0.05) + api.noise2(x * 0.9, y * 0.9) * 0.25);
      face.vertexColor((x, y) => api.mix('#5f625c', '#8d8b80', 0.5 + 0.5 * api.noise2(x * 0.4, y * 0.5)));
      api.add(face, MAT.stone);
      const lip = api.box(W + 1.2, 0.9, 1.4).translate(0, H - 0.45, 0.2);
      lip.displace((x, y, z) => api.noise3(x * 0.8, y, z * 0.8) * 0.18);
      lip.vertexColor(() => '#77766d');
      api.add(lip, MAT.stone);
      api.add(api.box(fw, fh, Math.max(2, H * 0.2)).translate(0, fh / 2 - 0.75, -0.9 - Math.max(2, H * 0.2) / 2), MAT.stone);
      api.collider(boxCollider(0, fh / 2 - 0.75, -0.9 - Math.max(2, H * 0.2) / 2, fw, fh, Math.max(2, H * 0.2)));
    }
    if (p.bool('pool')) {
      const R = Math.max(W * 0.75, H * 0.28, 2);
      const cz = reach * 0.8 + R * 0.35;
      api.add(api.cylinder(R, R, 0.1, 28).translate(0, -0.05, cz), { preset: 'water', color: '#2f6a6c', waterKind: 'pond' });
      // White churn where the water lands.
      api.add(api.cylinder(W * 0.55 + 0.6, W * 0.65 + 0.8, 0.12, 20).scale(1, 1, 0.6).translate(0, 0.02, reach + 0.3), { preset: 'water', color: '#e4eef0', waterKind: 'stream' });
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + api.range(-0.2, 0.2);
        const r = api.range(0.35, 0.9) * Math.min(3, R * 0.25);
        const rock = api.icosphereRock(r, 0.6, 1).scale(1, 0.6, 1).translate(Math.cos(a) * R * 0.98, r * 0.2, cz + Math.sin(a) * R * 0.98);
        rock.vertexColor(() => '#6e6f68');
        api.add(rock, MAT.stone);
      }
    }
    return api.build();
  },
});

export const WATER_GENERATORS = [waterfallSheet] as const;
