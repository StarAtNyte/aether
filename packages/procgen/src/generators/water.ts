/**
 * Falling water: a waterfall over a rock lip into a churning pool. Each strand is a few layered ribbons following the
 * free-fall arc of water leaving the lip: a faint wide back veil, the core, and narrow front ropes that taper and break
 * off part-way down. A crown of splash veils and a ring of foam sheets churn where the water lands. Everything is drawn
 * with the falling-water shader (material `waterKind: 'fall'`: advected streaks, white at the lip and the base,
 * translucent blue-green between, ragged edges); the vertex colours carry its per-layer data (fraction of the fall,
 * layer opacity, noise seed). Add an entity `vfx: { preset: 'mist' }` at the pool for the spray.
 */
import type { Vec3 } from '@aether/core';
import type { InternalApi } from '../api';
import { boxCollider } from '../colliders';
import { MeshBuilder } from '../kernel/mesh';
import { defineGenerator, MAT, pBool, pColor, pInt, pNum, pVariant } from './kit';

const G = 9.81;

/** A linear value 0..1 as the sRGB hex byte that decodes back to it (vertex colours are stored linear). */
function linByte(v: number): string {
  const c = Math.min(1, Math.max(0, v));
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(s * 255).toString(16).padStart(2, '0');
}

/** The falling-water shader's per-vertex data: fraction of the fall, layer opacity, noise seed (all 0..1). */
function fallData(frac: number, alpha: number, seed: number): string {
  return `#${linByte(frac)}${linByte(alpha)}${linByte(seed)}`;
}

/**
 * A strip along `path` like `api.ribbon` (u 0..1 across, v metres along the path), `cols` segments across, its middle
 * pushed out of the sheet by `bow` of the half-width (a parabolic cross-section) with normals that follow the curve.
 */
function bowedSheet(path: readonly Vec3[], width: number, widthAt: (t: number) => number, cols: number, bow: number): MeshBuilder {
  const n = path.length;
  const lengths = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const a = path[i - 1] as Vec3, c = path[i] as Vec3;
    lengths[i] = (lengths[i - 1] as number) + Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
  }
  const total = (lengths[n - 1] as number) || 1;
  const b = new MeshBuilder(n * (cols + 1), (n - 1) * cols * 6);
  let ax = 1, az = 0;
  for (let i = 0; i < n; i++) {
    const p = path[i] as Vec3;
    const pa = path[Math.max(0, i - 1)] as Vec3, pc = path[Math.min(n - 1, i + 1)] as Vec3;
    let tx = pc[0] - pa[0], ty = pc[1] - pa[1], tz = pc[2] - pa[2];
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl; ty /= tl; tz /= tl;
    const hl = Math.hypot(tx, tz);
    if (hl > 0.08) {
      let nx = tz / hl, nz = -tx / hl;
      if (nx * ax + nz * az < 0) { nx = -nx; nz = -nz; }
      ax = nx; az = nz;
    }
    // Out of the sheet: tangent × across (up on the run over the lip, away from the cliff down the drop).
    let ox = ty * az, oy = tz * ax - tx * az, oz = -ty * ax;
    const ol = Math.hypot(ox, oy, oz) || 1;
    ox /= ol; oy /= ol; oz /= ol;
    const hw = (width * Math.max(0, widthAt((lengths[i] as number) / total))) / 2;
    for (let j = 0; j <= cols; j++) {
      const s = (j / cols) * 2 - 1;
      const out = bow * hw * (1 - s * s);
      // Normal of the bowed section: out + 2 s bow across (tilted toward each edge).
      let nx = ox + 2 * s * bow * ax, ny = oy, nz = oz + 2 * s * bow * az;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      b.vertex(p[0] + ax * s * hw + ox * out, p[1] + oy * out, p[2] + az * s * hw + oz * out, nx, ny, nz, j / cols, lengths[i] as number);
    }
  }
  const row = cols + 1;
  for (let i = 0; i + 1 < n; i++) {
    for (let j = 0; j < cols; j++) {
      const a = i * row + j;
      b.tri(a, a + row, a + 1);
      b.tri(a + 1, a + row, a + row + 1);
    }
  }
  return b;
}

const waterfallSheet = defineGenerator({
  id: 'waterfall-sheet',
  description: 'Waterfall: animated falling-water strands off a rock lip into a churning pool; add vfx mist at the base.',
  category: 'nature',
  params: {
    height: pNum(18, 2, 120, 'drop from the lip to the pool in meters'),
    width: pNum(6, 0.5, 60, 'width of the falling water at the lip in meters'),
    strands: pInt(3, 1, 7, 'separate strands the water splits into (1 = one curtain)'),
    throwSpeed: pNum(1.6, 0, 6, 'horizontal speed leaving the lip (m/s): 0 slides down the face, 3+ leaps clear'),
    color: pColor('#6fa8a2', 'clear water colour at the lip'),
    variant: pVariant(1, '0 falls down a rock face with a lip, 1 free sheet (pour it off your own cliff, aqueduct or wall)'),
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
    // Few vertices along the drop on many strands (a 7-strand 120 m fall stays light), more on a single curtain.
    const steps = Math.max(8, Math.min(n > 4 ? 22 : 28, Math.round(H / 1.5)));
    const sheetCols = n > 4 ? 2 : 3;
    /**
     * One sheet along the arc from the lip at (x0, z0) with speed v, `w` wide, ending at `end` of the drop. The water
     * slides over the lip on a short convex run first, and the cross-section bows outward by `bow` of its half-width
     * (`cols` segments across), so the sheet reads as a thick, rounded tongue of water and catches the light across
     * its curve instead of lying flat like a card.
     */
    const pour = (x0: number, z0: number, v: number, drift: number, w: number, widthAt: (t: number) => number, alpha: number, end = 1, cols = 1, bow = 0): void => {
      const path: Vec3[] = [];
      // The brink: the water surface curving down over the lip before it leaves it (only on the full sheets).
      if (cols > 1) {
        const run = Math.min(1.1, 0.35 + 0.08 * w);
        path.push([x0, H + 0.16, z0 - run], [x0, H + 0.12, z0 - run * 0.5]);
      }
      const tStop = tEnd * Math.sqrt(end);
      const k = Math.max(4, Math.round(steps * Math.sqrt(end)));
      for (let i = 0; i <= k; i++) {
        const t = (i / k) * tStop;
        const f = t / tEnd;
        path.push([x0 + drift * f * f, H - 0.5 * G * t * t, z0 + v * t]);
      }
      const seed = api.range(0, 1);
      const mesh = cols <= 1 && bow === 0 ? api.ribbon(path, w, widthAt) : api.fromBuilder(bowedSheet(path, w, widthAt, cols, bow));
      mesh.vertexColor((_x, y) => fallData(1 - y / H, alpha, seed));
      api.add(mesh, fall);
    };
    // Strands share the width, with gaps; each a few layered sheets, widening as the water aerates and spreads. The
    // layers stand apart (back veil, rounded core, ropes in front of its bulge), so they shift against each other.
    const share = W / n;
    const strandW: number[] = [];
    const strandX: number[] = [];
    for (let k = 0; k < n; k++) {
      const x0 = -W / 2 + share * (k + 0.5) + api.range(-0.12, 0.12) * share;
      const w = share * (n === 1 ? 1 : api.range(0.62, 0.95));
      const v = v0 * api.range(0.85, 1.15);
      const drift = api.range(-0.04, 0.04) * H;
      strandX.push(x0);
      strandW.push(w);
      const gap = Math.min(0.9, 0.18 + 0.035 * w);
      const coreBow = 0.16;
      // Back veil: wider and faint, behind the core (spray thrown off it).
      pour(x0 + api.range(-0.08, 0.08) * w, -gap, v * 0.92, drift * 1.2, w * 1.15, (t) => 0.95 + 0.6 * t, 0.5, 1, sheetCols - 1, n > 4 ? 0 : 0.08);
      // Core: necks just under the lip, then spreads as it aerates; rounded across.
      pour(x0, 0.15, v, drift, w, (t) => 0.9 + 0.1 * Math.cos(Math.min(1, t * 6) * Math.PI) * 0.5 + 0.45 * t * t, 1, 1, sheetCols, coreBow);
      // Front ropes: narrow, tapering to nothing, riding on the core's bulge; some break off part-way down.
      const ropes = w > 2.5 ? 2 : 1;
      for (let r = 0; r < ropes; r++) {
        const s = api.range(-0.35, 0.35);
        const rx = x0 + s * w;
        const end = api.range(0.45, 1);
        const rw = w * api.range(0.18, 0.32);
        const onBulge = coreBow * (w / 2) * (1 - 4 * s * s);
        pour(rx, 0.15 + onBulge + gap * 0.6, v * api.range(1.0, 1.12), drift * api.range(0.6, 1.4), rw, (t) => (1 - 0.85 * t) * (0.7 + 0.3 * Math.min(1, t * 8)), 0.85, end);
      }
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
    // Where the water lands: a crown of splash veils leaping back up and a ring of churning foam sheets.
    for (let k = 0; k < n; k++) {
      const x0 = strandX[k] as number, w = strandW[k] as number;
      const zi = reach + 0.3;
      const rise = Math.min(9, 1.5 + H * 0.12);
      const veils = w > 3 ? 4 : 3;
      for (let i = 0; i < veils; i++) {
        const sx = x0 + ((i + 0.5) / veils - 0.5) * w * 0.9 + api.range(-0.2, 0.2);
        const out = api.range(-1, 1);
        const h = rise * api.range(0.6, 1.1);
        const path: Vec3[] = [];
        for (let j = 0; j <= 6; j++) {
          const f = j / 6;
          path.push([sx + out * f * rise * 0.25, h * f, zi + 0.4 + (f + 0.6 * f * f) * rise * (i % 2 === 0 ? 0.3 : 0.18)]);
        }
        const seed = api.range(0, 1);
        const veil = api.ribbon(path, w * api.range(0.35, 0.55), (f) => 0.7 + 0.8 * f);
        veil.vertexColor((_x, y) => fallData(1, 0.55 * (1 - Math.min(1, y / h)) ** 0.8, seed));
        api.add(veil, fall);
      }
      // Churn: flat foam sheets lying on the plunge pool around the impact, streaming outward.
      for (let i = 0; p.bool('pool') && i < 2; i++) {
        const len = w * (1.2 + 0.5 * i) + 2;
        const path: Vec3[] = [];
        for (let j = 0; j <= 6; j++) {
          const f = j / 6 - 0.5;
          path.push([x0 + f * len, 0.04 + 0.03 * i, zi + 0.6 + i * 1.2 + Math.cos(f * Math.PI) * 0.08 * len]);
        }
        const seed = api.range(0, 1);
        const sheet = api.ribbon(path, 2.5 + w * 0.35 + i * 2, () => 1);
        sheet.vertexColor(() => fallData(1, i === 0 ? 0.95 : 0.6, seed));
        api.add(sheet, fall);
      }
      // A ring of boiling water around the impact: foam streaming round and out from where the strand lands.
      if (p.bool('pool')) {
        const rx = w * 0.55 + 1.2, rz = 1.4 + w * 0.22, segs = 14;
        const ring: Vec3[] = [];
        for (let j = 0; j <= segs; j++) {
          const a = (j / segs) * Math.PI * 2;
          ring.push([x0 + Math.cos(a) * rx, 0.05, zi + 0.7 + Math.sin(a) * rz]);
        }
        // A seed that draws nothing from the generator's random stream: the rocks after it stay where they were.
        const seed = (k * 0.618 + 0.37) % 1;
        const churn = api.ribbon(ring, 1.4 + w * 0.22, (t) => 0.8 + 0.4 * Math.abs(Math.sin(t * Math.PI * 3)));
        churn.vertexColor(() => fallData(1, 0.8, seed));
        api.add(churn, fall);
      }
    }
    if (p.bool('pool')) {
      const R = Math.max(W * 0.75, H * 0.28, 2);
      const cz = reach * 0.8 + R * 0.35;
      api.add(api.cylinder(R, R, 0.1, 28).translate(0, -0.05, cz), { preset: 'water', color: '#2f6a6c', waterKind: 'pond' });
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
