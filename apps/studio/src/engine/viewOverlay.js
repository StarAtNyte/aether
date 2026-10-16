/**
 * Camera-dependent DOM overlays updated outside React, only on frames that
 * redrew the view: the axis gizmo (three SVG lines) and floating object
 * labels. Matrix maths reads `camera.matrixWorld` / `projectionMatrix`
 * elements directly — no Vector3/Matrix4 allocations per frame — and DOM
 * writes are skipped when a value moved by less than half a pixel.
 */
/** Most labels shown at once. */
export const MAX_LABELS = 24;
const GIZMO_RADIUS = 22;
const GIZMO_CENTER = 32;
/**
 * Screen direction of the three world axes for a camera: for each axis i,
 * `out[2i]` = x (right), `out[2i+1]` = y (down), in [-1, 1]. Pure.
 */
export function axisDirections(matrixWorld, out) {
    // Column-major: right = (e0, e1, e2), up = (e4, e5, e6).
    for (let i = 0; i < 3; i++) {
        out[2 * i] = matrixWorld[i] ?? 0;
        out[2 * i + 1] = -(matrixWorld[4 + i] ?? 0);
    }
    return out;
}
/**
 * Project a world point to CSS pixels in a `width`×`height` view. Writes
 * [x, y, visible(1|0)] into `out`. Pure, allocation-free.
 */
export function projectPoint(cam, p, width, height, out) {
    const v = cam.matrixWorldInverse.elements;
    const pr = cam.projectionMatrix.elements;
    const x = p[0];
    const y = p[1];
    const z = p[2];
    // View space.
    const vx = v[0] * x + v[4] * y + v[8] * z + v[12];
    const vy = v[1] * x + v[5] * y + v[9] * z + v[13];
    const vz = v[2] * x + v[6] * y + v[10] * z + v[14];
    // Clip space (w = -vz for a perspective camera; general form below).
    const cx = pr[0] * vx + pr[4] * vy + pr[8] * vz + pr[12];
    const cy = pr[1] * vx + pr[5] * vy + pr[9] * vz + pr[13];
    const cw = pr[3] * vx + pr[7] * vy + pr[11] * vz + pr[15];
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
/** Gap kept between two visible labels (px). */
const LABEL_GAP = 4;
/** Drives the gizmo and labels. Owns the label DOM nodes it creates. */
export class ViewOverlay {
    gizmoLines;
    gizmoDots;
    labelLayer;
    dirs = new Float32Array(6);
    proj = new Float32Array(3);
    slots = [];
    /** Accepted label rectangles this frame: [left, top, right, bottom] × MAX_LABELS. */
    placed = new Float32Array(MAX_LABELS * 4);
    lastCamera = null;
    constructor(gizmoLines, gizmoDots, labelLayer) {
        this.gizmoLines = gizmoLines;
        this.gizmoDots = gizmoDots;
        this.labelLayer = labelLayer;
    }
    /** Replace the label set (React calls this when the world or the toggle changes). */
    setLabels(specs) {
        const layer = this.labelLayer;
        if (!layer)
            return;
        const list = specs.slice(0, MAX_LABELS);
        while (this.slots.length > list.length)
            this.slots.pop()?.el.remove();
        for (let i = 0; i < list.length; i++) {
            const spec = list[i];
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
            if (slot.name.textContent !== spec.name)
                slot.name.textContent = spec.name;
            if (slot.metric.textContent !== spec.metric)
                slot.metric.textContent = spec.metric;
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
        if (this.lastCamera)
            this.update(this.lastCamera);
    }
    /** Update for a camera (after a redraw). */
    update(cam) {
        this.lastCamera = cam;
        const lines = this.gizmoLines;
        if (lines) {
            axisDirections(cam.matrixWorld.elements, this.dirs);
            for (let i = 0; i < 3; i++) {
                const line = lines[i];
                const x = GIZMO_CENTER + this.dirs[2 * i] * GIZMO_RADIUS;
                const y = GIZMO_CENTER + this.dirs[2 * i + 1] * GIZMO_RADIUS;
                line.x2.baseVal.value = x;
                line.y2.baseVal.value = y;
                const dot = this.gizmoDots?.[i];
                if (dot)
                    dot.transform.baseVal.getItem(0).setTranslate(x, y);
            }
        }
        const layer = this.labelLayer;
        if (!layer || this.slots.length === 0)
            return;
        const w = layer.clientWidth;
        const h = layer.clientHeight;
        let placed = 0;
        // Greedy culling in priority order: a label that would overlap one already
        // placed (or leave the view) is hidden this frame.
        for (const s of this.slots) {
            projectPoint(cam, s.pos, w, h, this.proj);
            const x = Math.round(this.proj[0]);
            const y = Math.round(this.proj[1]);
            const l = x - s.w / 2;
            const t = y - s.h;
            let visible = this.proj[2] === 1 && l >= 0 && t >= 0 && l + s.w <= w && y <= h;
            if (visible) {
                for (let i = 0; i < placed; i++) {
                    const o = i * 4;
                    if (l < this.placed[o + 2] + LABEL_GAP && l + s.w + LABEL_GAP > this.placed[o] && t < this.placed[o + 3] + LABEL_GAP && y + LABEL_GAP > this.placed[o + 1]) {
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
            if (!visible || (x === s.x && y === s.y))
                continue;
            s.x = x;
            s.y = y;
            s.el.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -100%)`;
        }
    }
    /** Remove the label nodes. */
    dispose() {
        for (const s of this.slots.splice(0))
            s.el.remove();
        this.lastCamera = null;
    }
}
