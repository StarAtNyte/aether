/**
 * Blueprint marks: when the agent builds, every new object is first drawn as
 * thin corner brackets around where it will stand — the plan, annotated on
 * the world — and then grows into its brackets (grow-in), after which the
 * marks fade away. One `LineSegments` for all marks, built once per build,
 * opacity animated in place (no per-frame allocation).
 */
import { BufferAttribute, BufferGeometry, Color, Group, LineBasicMaterial, LineSegments, type Box3 } from 'three';

/** Most objects marked in one build (the largest win). */
export const MAX_BLUEPRINT_BOXES = 400;
/** Seconds the marks stay at full strength. */
export const BLUEPRINT_HOLD_SECONDS = 1.8;
/** Seconds of the fade-out. */
export const BLUEPRINT_FADE_SECONDS = 0.7;
/** Seconds objects wait inside their marks before growing (the plan is seen first). */
export const BLUEPRINT_LEAD_SECONDS = 0.3;
const OPACITY = 0.85;
const COLOR = new Color('#d8d4cc');

/** An axis-aligned box: min and max corners. */
export interface MarkBox {
  min: readonly [number, number, number];
  max: readonly [number, number, number];
}

/**
 * Corner-bracket segments for boxes: three ticks at each of the 8 corners
 * (24 segments per box), each tick a quarter of the box's shortest side
 * (at least 4 cm, at most 1.5 m). Degenerate or non-finite boxes are
 * skipped; at most {@link MAX_BLUEPRINT_BOXES}. Pure.
 */
export function bracketSegments(boxes: readonly MarkBox[]): Float32Array {
  const list = boxes.filter((b) => b.min.every(Number.isFinite) && b.max.every(Number.isFinite) && b.max[0] >= b.min[0] && b.max[1] >= b.min[1] && b.max[2] >= b.min[2]).slice(0, MAX_BLUEPRINT_BOXES);
  const out = new Float32Array(list.length * 24 * 6);
  let o = 0;
  for (const b of list) {
    const sx = b.max[0] - b.min[0];
    const sy = b.max[1] - b.min[1];
    const sz = b.max[2] - b.min[2];
    const shortest = Math.min(sx > 0 ? sx : Infinity, sy > 0 ? sy : Infinity, sz > 0 ? sz : Infinity);
    const len = Math.max(0.04, Math.min(1.5, (Number.isFinite(shortest) ? shortest : 0.2) * 0.25));
    for (let c = 0; c < 8; c++) {
      const x = c & 1 ? b.max[0] : b.min[0];
      const y = c & 2 ? b.max[1] : b.min[1];
      const z = c & 4 ? b.max[2] : b.min[2];
      const dx = c & 1 ? -1 : 1;
      const dy = c & 2 ? -1 : 1;
      const dz = c & 4 ? -1 : 1;
      const tx = Math.min(len, sx / 2) * dx;
      const ty = Math.min(len, sy / 2) * dy;
      const tz = Math.min(len, sz / 2) * dz;
      out.set([x, y, z, x + tx, y, z, x, y, z, x, y + ty, z, x, y, z, x, y, z + tz], o);
      o += 18;
    }
  }
  return out;
}

/** Fading corner-bracket marks around newly built objects. */
export class BlueprintMarks {
  /** Add to the scene once. */
  readonly group = new Group();
  private readonly material = new LineBasicMaterial({ color: COLOR, transparent: true, opacity: OPACITY, depthWrite: false });
  private lines: LineSegments | null = null;
  /** Seconds since shown (a typed slot: updating it never boxes a number). */
  private readonly clock = new Float64Array(1);
  /** Wall-clock time (ms) the marks were shown: they must go even when slow frames advance the clock too little. */
  private shownAt = 0;

  constructor() {
    this.group.name = 'aether:blueprint';
  }

  /** True while marks are shown. */
  get active(): boolean {
    return this.lines !== null;
  }

  /** Show marks around `boxes` (replaces any current marks). */
  show(boxes: readonly MarkBox[]): void {
    this.clear();
    const positions = bracketSegments(boxes);
    if (positions.length === 0) return;
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(positions, 3));
    geo.computeBoundingSphere();
    const lines = new LineSegments(geo, this.material);
    lines.frustumCulled = false;
    lines.renderOrder = 9;
    this.material.opacity = OPACITY;
    this.clock[0] = 0;
    this.shownAt = BlueprintMarks.now();
    this.lines = lines;
    this.group.add(lines);
  }

  /** Wall clock in ms (indirection so tests can drive it). */
  static now: () => number = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  /** Advance; returns true while the marks changed (draw a frame). */
  update(dt: number): boolean {
    if (!this.lines) return false;
    const stepped = (this.clock[0] as number) + (Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.1)) : 0);
    const clock = Math.max(stepped, (BlueprintMarks.now() - this.shownAt) / 1000);
    this.clock[0] = clock;
    const fade = (clock - BLUEPRINT_HOLD_SECONDS) / BLUEPRINT_FADE_SECONDS;
    if (fade >= 1) {
      this.clear();
      return true;
    }
    if (fade > 0) this.material.opacity = OPACITY * (1 - fade);
    return fade > 0 || clock < 0.2;
  }

  /** Remove the marks (geometry disposed). */
  clear(): void {
    if (!this.lines) return;
    this.group.remove(this.lines);
    this.lines.geometry.dispose();
    this.lines = null;
  }

  /** Release everything. */
  dispose(): void {
    this.clear();
    this.material.dispose();
    this.group.removeFromParent();
  }
}

/** Box3 → {@link MarkBox} (shares no memory with the Box3). */
export function markBoxOf(box: Box3): MarkBox {
  return { min: [box.min.x, box.min.y, box.min.z], max: [box.max.x, box.max.y, box.max.z] };
}
