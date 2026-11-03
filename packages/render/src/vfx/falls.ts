/**
 * Where falling water throws spray: read off the falling-water meshes of a scene object (any mesh drawn with the
 * falling-water shader, see `materials/waterfall.ts`), so every waterfall gets churning spray and mist where it lands
 * and a fine spray where it pours over the lip without an author placing emitters by hand.
 *
 * The anchors are found once per object: the lowest band of the falling water's vertices (the impact, the foam on the
 * pool) and the highest band (the lip), each split along the fall's width into a few spots a few metres apart.
 */
import { Matrix4, Vector3, type BufferAttribute, type Mesh, type Object3D } from 'three';

/** A spot to emit from, in the object's local frame. */
export type FallAnchor = readonly [number, number, number];

export interface FallAnchors {
  /** Where the water lands. */
  impact: FallAnchor[];
  /** Where it pours over the edge. */
  lip: FallAnchor[];
  /** Drop from the lip to the impact (m, object frame). */
  height: number;
}

/** Width (m) of one emitter's share of a wide fall. */
const SPOT_WIDTH = 7;
/** At most this many spots per band (a 60 m curtain gets a handful, not dozens). */
const MAX_SPOTS = 5;

const _m = new Matrix4();
const _inv = new Matrix4();
const _v = new Vector3();

function isFallMesh(o: Object3D): o is Mesh {
  const m = (o as Mesh).material;
  if (!(o as Mesh).isMesh || !m || Array.isArray(m)) return false;
  return (m as { userData?: Record<string, unknown> }).userData?.['aetherWaterfall'] === true;
}

/** Group points of one band along x into runs, then into spots at most {@link SPOT_WIDTH} wide. */
function spots(xs: number[], ys: number[], zs: number[]): FallAnchor[] {
  if (xs.length === 0) return [];
  const order = xs.map((_, i) => i).sort((a, b) => (xs[a] as number) - (xs[b] as number));
  const runs: number[][] = [];
  let run: number[] = [];
  let last = -Infinity;
  for (const i of order) {
    const x = xs[i] as number;
    if (run.length > 0 && x - last > 2.5) {
      runs.push(run);
      run = [];
    }
    run.push(i);
    last = x;
  }
  if (run.length > 0) runs.push(run);
  const out: FallAnchor[] = [];
  for (const r of runs) {
    const x0 = xs[r[0] as number] as number;
    const x1 = xs[r[r.length - 1] as number] as number;
    const k = Math.max(1, Math.round((x1 - x0) / SPOT_WIDTH));
    for (let s = 0; s < k; s++) {
      const lo = x0 + ((x1 - x0) * s) / k;
      const hi = x0 + ((x1 - x0) * (s + 1)) / k;
      let n = 0, sy = 0, sz = 0;
      for (const i of r) {
        const x = xs[i] as number;
        if (x < lo - 1e-6 || x > hi + 1e-6) continue;
        n++;
        sy += ys[i] as number;
        sz += zs[i] as number;
      }
      if (n > 0) out.push([(lo + hi) / 2, sy / n, sz / n]);
    }
  }
  if (out.length <= MAX_SPOTS) return out;
  // Too many: keep evenly spaced ones.
  const kept: FallAnchor[] = [];
  for (let i = 0; i < MAX_SPOTS; i++) kept.push(out[Math.round((i * (out.length - 1)) / (MAX_SPOTS - 1))] as FallAnchor);
  return kept;
}

/** The impact and lip spots of the falling water inside `root` (null when it has none, or none tall enough to spray). */
export function fallAnchors(root: Object3D): FallAnchors | null {
  root.updateMatrixWorld(true);
  _inv.copy(root.matrixWorld).invert();
  const px: number[] = [], py: number[] = [], pz: number[] = [];
  root.traverse((o) => {
    if (!isFallMesh(o)) return;
    const pos = o.geometry.getAttribute('position') as BufferAttribute | undefined;
    if (!pos) return;
    _m.multiplyMatrices(_inv, o.matrixWorld);
    // Every vertex of a few thousand-triangle fall is cheap; this runs once per object.
    for (let i = 0; i < pos.count; i++) {
      _v.fromBufferAttribute(pos, i).applyMatrix4(_m);
      px.push(_v.x);
      py.push(_v.y);
      pz.push(_v.z);
    }
  });
  if (px.length === 0) return null;
  let y0 = Infinity, y1 = -Infinity;
  for (const y of py) {
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  const h = y1 - y0;
  if (!(h > 1.5)) return null;
  const lowX: number[] = [], lowY: number[] = [], lowZ: number[] = [];
  const topX: number[] = [], topY: number[] = [], topZ: number[] = [];
  const lowCut = y0 + Math.max(0.6, h * 0.04);
  const topCut = y1 - Math.max(0.4, h * 0.02);
  for (let i = 0; i < px.length; i++) {
    const y = py[i] as number;
    if (y <= lowCut) {
      lowX.push(px[i] as number);
      lowY.push(y);
      lowZ.push(pz[i] as number);
    } else if (y >= topCut) {
      topX.push(px[i] as number);
      topY.push(y);
      topZ.push(pz[i] as number);
    }
  }
  return { impact: spots(lowX, lowY, lowZ), lip: spots(topX, topY, topZ), height: h };
}
