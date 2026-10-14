/**
 * Viewport overlay of a cinematic camera path: the eye's spline as a line
 * and every keyframe as a small marker with a tick towards where it looks.
 * Editor-only (hidden in captures and exports); buffers are reused while
 * the path is edited and grown only when it gets longer.
 */
import { BufferAttribute, BufferGeometry, Group, Line, LineBasicMaterial, LineSegments, type Object3D } from 'three';

/** Most line points drawn (the studio samples the spline into at most this many). */
export const MAX_PATH_POINTS = 2048;
/** Most keyframe markers. */
export const MAX_PATH_KEYS = 64;

/** Path overlay. */
export class PathOverlay {
  readonly group = new Group();
  private readonly lineGeo = new BufferGeometry();
  private readonly tickGeo = new BufferGeometry();
  private readonly linePos = new Float32Array(MAX_PATH_POINTS * 3);
  private readonly tickPos = new Float32Array(MAX_PATH_KEYS * 6 * 4);
  private readonly lineMat = new LineBasicMaterial({ color: 0x8b8cff, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false });
  private readonly tickMat = new LineBasicMaterial({ color: 0xffc04d, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false });

  constructor() {
    this.group.name = 'camera-path';
    this.group.visible = false;
    this.group.renderOrder = 1000;
    this.lineGeo.setAttribute('position', new BufferAttribute(this.linePos, 3));
    this.tickGeo.setAttribute('position', new BufferAttribute(this.tickPos, 3));
    this.lineGeo.setDrawRange(0, 0);
    this.tickGeo.setDrawRange(0, 0);
    const line = new Line(this.lineGeo, this.lineMat);
    const ticks = new LineSegments(this.tickGeo, this.tickMat);
    line.frustumCulled = false;
    ticks.frustumCulled = false;
    line.renderOrder = 1000;
    ticks.renderOrder = 1001;
    this.group.add(line, ticks);
  }

  /**
   * Show a path: `points` are sampled eye positions (xyz triples), `keys`
   * keyframes as eye xyz + target xyz (6 floats each). `size` scales the
   * key markers (metres). Null hides the overlay.
   */
  set(points: Float32Array | null, keys: Float32Array | null, size = 0.4): void {
    if (!points || points.length < 6) {
      this.group.visible = false;
      return;
    }
    const n = Math.min(MAX_PATH_POINTS, Math.floor(points.length / 3));
    this.linePos.set(points.subarray(0, n * 3));
    (this.lineGeo.getAttribute('position') as BufferAttribute).needsUpdate = true;
    this.lineGeo.setDrawRange(0, n);
    this.lineGeo.computeBoundingSphere();
    let v = 0;
    const s = Number.isFinite(size) && size > 0 ? size : 0.4;
    const k = keys ? Math.min(MAX_PATH_KEYS, Math.floor(keys.length / 6)) : 0;
    const tp = this.tickPos;
    for (let i = 0; i < k; i++) {
      const o = i * 6;
      const ex = keys?.[o] ?? 0;
      const ey = keys?.[o + 1] ?? 0;
      const ez = keys?.[o + 2] ?? 0;
      // A small cross at the eye…
      tp.set([ex - s, ey, ez, ex + s, ey, ez, ex, ey - s, ez, ex, ey + s, ez], v);
      v += 12;
      // …and a tick towards the look target.
      const dx = (keys?.[o + 3] ?? ex) - ex;
      const dy = (keys?.[o + 4] ?? ey) - ey;
      const dz = (keys?.[o + 5] ?? ez) - ez;
      const len = Math.hypot(dx, dy, dz) || 1;
      tp.set([ex, ey, ez, ex + (dx / len) * s * 3, ey + (dy / len) * s * 3, ez + (dz / len) * s * 3], v);
      v += 6;
    }
    (this.tickGeo.getAttribute('position') as BufferAttribute).needsUpdate = true;
    this.tickGeo.setDrawRange(0, v / 3);
    this.tickGeo.computeBoundingSphere();
    this.group.visible = true;
  }

  /** The overlay root (hidden during captures). */
  get object(): Object3D {
    return this.group;
  }

  dispose(): void {
    this.lineGeo.dispose();
    this.tickGeo.dispose();
    this.lineMat.dispose();
    this.tickMat.dispose();
    this.group.clear();
  }
}
