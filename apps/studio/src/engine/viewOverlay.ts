/**
 * Camera-dependent DOM overlays updated outside React, only on frames that
 * redrew the view: the axis gizmo (three SVG lines) and floating object
 * labels. Matrix maths reads `camera.matrixWorld` / `projectionMatrix`
 * elements directly — no Vector3/Matrix4 allocations per frame — and DOM
 * writes are skipped when a value moved by less than half a pixel.
 */

/** Minimal camera surface (three.js `Camera`). */
export interface OverlayCamera {
  readonly matrixWorld: { readonly elements: ArrayLike<number> };
  readonly matrixWorldInverse: { readonly elements: ArrayLike<number> };
  readonly projectionMatrix: { readonly elements: ArrayLike<number> };
}

/** One floating label. */
export interface LabelSpec {
  id: string;
  name: string;
  /** Secondary text ("12 kg", "Point light"). */
  metric: string;
  position: readonly [number, number, number];
  /** Visual tone: 'plan' marks what the agent is placing (accent outline). */
  tone?: 'plan';
}

/** Most labels shown at once. */
export const MAX_LABELS = 24;
const GIZMO_RADIUS = 22;
const GIZMO_CENTER = 32;

/**
 * Screen direction of the three world axes for a camera: for each axis i,
 * `out[2i]` = x (right), `out[2i+1]` = y (down), in [-1, 1]. Pure.
 */
export function axisDirections(matrixWorld: ArrayLike<number>, out: Float32Array): Float32Array {
  // Column-major: right = (e0, e1, e2), up = (e4, e5, e6).
  for (let i = 0; i < 3; i++) {
    out[2 * i] = (matrixWorld[i] as number) ?? 0;
    out[2 * i + 1] = -((matrixWorld[4 + i] as number) ?? 0);
  }
  return out;
}

/**
 * Project a world point to CSS pixels in a `width`×`height` view. Writes
 * [x, y, visible(1|0)] into `out`. Pure, allocation-free.
 */
export function projectPoint(cam: OverlayCamera, p: readonly [number, number, number], width: number, height: number, out: Float32Array): Float32Array {
  const v = cam.matrixWorldInverse.elements;
  const pr = cam.projectionMatrix.elements;
  const x = p[0];
  const y = p[1];
  const z = p[2];
  // View space.
  const vx = (v[0] as number) * x + (v[4] as number) * y + (v[8] as number) * z + (v[12] as number);
  const vy = (v[1] as number) * x + (v[5] as number) * y + (v[9] as number) * z + (v[13] as number);
  const vz = (v[2] as number) * x + (v[6] as number) * y + (v[10] as number) * z + (v[14] as number);
  // Clip space (w = -vz for a perspective camera; general form below).
  const cx = (pr[0] as number) * vx + (pr[4] as number) * vy + (pr[8] as number) * vz + (pr[12] as number);
  const cy = (pr[1] as number) * vx + (pr[5] as number) * vy + (pr[9] as number) * vz + (pr[13] as number);
  const cw = (pr[3] as number) * vx + (pr[7] as number) * vy + (pr[11] as number) * vz + (pr[15] as number);
  if (!(cw > 1e-6)) {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    return out;
  }
  const nx = cx / cw;
  const ny = cy / cw;
  out[0] = (nx * 0.5 + 0.5) * width;
  out[1] = (0.5 - ny * 0.5) * height;
  out[2] = nx >= -1.1 && nx <= 1.1 && ny >= -1.1 && ny <= 1.1 ? 1 : 0;
  return out;
}

interface LabelSlot {
  el: HTMLElement;
  name: HTMLElement;
  metric: HTMLElement;
  pos: [number, number, number];
  x: number;
  y: number;
  shown: boolean;
  /** Measured size (px), read once per label set — never per frame. */
  w: number;
  h: number;
}

/** Gap kept between two visible labels (px). */
const LABEL_GAP = 4;

/** Drives the gizmo and labels. Owns the label DOM nodes it creates. */
export class ViewOverlay {
  private readonly dirs = new Float32Array(6);
  private readonly proj = new Float32Array(3);
  private readonly slots: LabelSlot[] = [];
  /** Accepted label rectangles this frame: [left, top, right, bottom] × MAX_LABELS. */
  private readonly placed = new Float32Array(MAX_LABELS * 4);
  private lastCamera: OverlayCamera | null = null;

  constructor(
    private readonly gizmoLines: readonly [SVGLineElement, SVGLineElement, SVGLineElement] | null,
    private readonly gizmoDots: readonly [SVGGElement, SVGGElement, SVGGElement] | null,
    private readonly labelLayer: HTMLElement | null,
  ) {}

  /** Replace the label set (React calls this when the world or the toggle changes). */
  setLabels(specs: readonly LabelSpec[]): void {
    const layer = this.labelLayer;
    if (!layer) return;
    const list = specs.slice(0, MAX_LABELS);
    while (this.slots.length > list.length) this.slots.pop()?.el.remove();
    for (let i = 0; i < list.length; i++) {
      const spec = list[i] as LabelSpec;
      let slot = this.slots[i];
      if (!slot) {
        const el = document.createElement('div');
        el.className = 'vp-label';
        const dot = document.createElement('span');
        dot.className = 'vp-label__dot';
        const name = document.createElement('span');
        name.className = 'vp-label__name';
        const metric = document.createElement('span');
        metric.className = 'vp-label__metric';
        el.append(dot, name, metric);
        layer.appendChild(el);
        slot = { el, name, metric, pos: [0, 0, 0], x: NaN, y: NaN, shown: true, w: 0, h: 0 };
        this.slots.push(slot);
      }
      // textContent only: names come from the (untrusted) world document.
      if (slot.name.textContent !== spec.name) slot.name.textContent = spec.name;
      if (slot.metric.textContent !== spec.metric) slot.metric.textContent = spec.metric;
      slot.el.dataset['id'] = spec.id;
      slot.el.classList.toggle('vp-label--plan', spec.tone === 'plan');
      slot.pos[0] = spec.position[0];
      slot.pos[1] = spec.position[1];
      slot.pos[2] = spec.position[2];
      slot.x = NaN;
    }
    // One layout read per label set (sizes only change when the text does).
    for (const s of this.slots) {
      s.w = s.el.offsetWidth;
      s.h = s.el.offsetHeight;
    }
    if (this.lastCamera) this.update(this.lastCamera);
  }

  /** Update for a camera (after a redraw). */
  update(cam: OverlayCamera): void {
    this.lastCamera = cam;
    const lines = this.gizmoLines;
    if (lines) {
      axisDirections(cam.matrixWorld.elements, this.dirs);
      for (let i = 0; i < 3; i++) {
        const line = lines[i] as SVGLineElement;
        const x = GIZMO_CENTER + (this.dirs[2 * i] as number) * GIZMO_RADIUS;
        const y = GIZMO_CENTER + (this.dirs[2 * i + 1] as number) * GIZMO_RADIUS;
        line.x2.baseVal.value = x;
        line.y2.baseVal.value = y;
        const dot = this.gizmoDots?.[i];
        if (dot) dot.transform.baseVal.getItem(0).setTranslate(x, y);
      }
    }
    const layer = this.labelLayer;
    if (!layer || this.slots.length === 0) return;
    const w = layer.clientWidth;
    const h = layer.clientHeight;
    let placed = 0;
    // Greedy culling in priority order: a label that would overlap one already
    // placed (or leave the view) is hidden this frame.
    for (const s of this.slots) {
      projectPoint(cam, s.pos, w, h, this.proj);
      const x = Math.round(this.proj[0] as number);
      const y = Math.round(this.proj[1] as number);
      const l = x - s.w / 2;
      const t = y - s.h;
      let visible = this.proj[2] === 1 && l >= 0 && t >= 0 && l + s.w <= w && y <= h;
      if (visible) {
        for (let i = 0; i < placed; i++) {
          const o = i * 4;
          if (l < (this.placed[o + 2] as number) + LABEL_GAP && l + s.w + LABEL_GAP > (this.placed[o] as number) && t < (this.placed[o + 3] as number) + LABEL_GAP && y + LABEL_GAP > (this.placed[o + 1] as number)) {
            visible = false;
            break;
          }
        }
      }
      if (visible) {
        const o = placed * 4;
        this.placed[o] = l;
        this.placed[o + 1] = t;
        this.placed[o + 2] = l + s.w;
        this.placed[o + 3] = y;
        placed++;
      }
      if (visible !== s.shown) {
        s.shown = visible;
        s.el.style.visibility = visible ? 'visible' : 'hidden';
      }
      if (!visible || (x === s.x && y === s.y)) continue;
      s.x = x;
      s.y = y;
      s.el.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -100%)`;
    }
  }

  /** Remove the label nodes. */
  dispose(): void {
    for (const s of this.slots.splice(0)) s.el.remove();
    this.lastCamera = null;
  }
}
