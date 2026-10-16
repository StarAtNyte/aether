/**
 * Cinematic camera paths: keyframes (time, eye, look-at target, field of
 * view, easing of the segment that leaves the key) on a timeline, sampled
 * with a uniform Catmull–Rom spline through eyes and targets. Pure and
 * allocation-free per sample (a path is compiled into one Float64Array),
 * so the same code drives the live preview, the video encoder and tests.
 *
 * Presets compose keyframes around the content sphere: orbit, turntable,
 * fly-through, dolly-in, crane-up, top-down and reveal.
 */
import { z } from 'zod';
/** A 3-vector of finite numbers. */
const V3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
/** Easing of the segment that starts at a key. `cut` holds the key's pose, then jumps to the next key. */
export const Easing = z.enum(['linear', 'ease', 'easeIn', 'easeOut', 'cut']);
/** Field-of-view limits (degrees, vertical). */
export const FOV_RANGE = Object.freeze([12, 100]);
/** Default vertical field of view (matches the editor camera). */
export const DEFAULT_FOV = 55;
/** Longest path (seconds). */
export const MAX_PATH_SECONDS = 300;
/** Most keyframes per path. */
export const MAX_KEYS = 64;
/** One keyframe. */
export const CameraKey = z.object({
    t: z.number().finite().min(0).max(MAX_PATH_SECONDS),
    pos: V3,
    target: V3,
    fov: z.number().finite().min(FOV_RANGE[0]).max(FOV_RANGE[1]).default(DEFAULT_FOV),
    ease: Easing.default('linear'),
});
/** A camera path. Keys are kept sorted by time. */
export const CameraPath = z.object({
    v: z.literal(1),
    name: z.string().max(80).default('Shot'),
    /** Total length (seconds); keys past it are clamped. */
    duration: z.number().finite().min(0.5).max(MAX_PATH_SECONDS),
    keys: z.array(CameraKey).min(1).max(MAX_KEYS),
    /** Smooth start and stop of the whole path. */
    easeInOut: z.boolean().default(true),
});
/** Parse an untrusted path (null when invalid); keys are sorted and clamped to the duration. */
export function parseCameraPath(value) {
    const r = CameraPath.safeParse(value);
    if (!r.success)
        return null;
    return normalizePath(r.data);
}
/** Sort keys, clamp them into [0, duration] and drop exact time duplicates (last wins). */
export function normalizePath(path) {
    const keys = [...path.keys].map((k) => ({ ...k, t: Math.min(path.duration, Math.max(0, k.t)) })).sort((a, b) => a.t - b.t);
    const out = [];
    for (const k of keys) {
        const last = out[out.length - 1];
        if (last && Math.abs(last.t - k.t) < 1e-6)
            out[out.length - 1] = k;
        else
            out.push(k);
    }
    return { ...path, keys: out };
}
/** Easing curve value at u ∈ [0, 1]. */
export function ease(kind, u) {
    const x = Math.min(1, Math.max(0, u));
    switch (kind) {
        case 'ease':
            return x * x * (3 - 2 * x);
        case 'easeIn':
            return x * x;
        case 'easeOut':
            return 1 - (1 - x) * (1 - x);
        case 'cut':
            return x < 1 ? 0 : 1;
        default:
            return x;
    }
}
const EASE_CODE = { linear: 0, ease: 1, easeIn: 2, easeOut: 3, cut: 4 };
const EASE_BY_CODE = ['linear', 'ease', 'easeIn', 'easeOut', 'cut'];
/** Floats per compiled key: t, pos xyz, target xyz, fov, ease code. */
const STRIDE = 9;
/** A path compiled for allocation-free sampling. */
export class CompiledPath {
    duration;
    count;
    data;
    easeInOut;
    constructor(path) {
        const p = normalizePath(path);
        this.duration = p.duration;
        this.count = p.keys.length;
        this.easeInOut = p.easeInOut;
        this.data = new Float64Array(this.count * STRIDE);
        p.keys.forEach((k, i) => {
            const o = i * STRIDE;
            this.data[o] = k.t;
            this.data[o + 1] = k.pos[0];
            this.data[o + 2] = k.pos[1];
            this.data[o + 3] = k.pos[2];
            this.data[o + 4] = k.target[0];
            this.data[o + 5] = k.target[1];
            this.data[o + 6] = k.target[2];
            this.data[o + 7] = k.fov;
            this.data[o + 8] = EASE_CODE[k.ease];
        });
    }
    /** Global time warp: optional smooth start / stop over the whole path. */
    warp(t) {
        const d = this.duration;
        const x = Math.min(1, Math.max(0, t / d));
        if (!this.easeInOut)
            return x * d;
        // Ease in over the first 12 % and out over the last 12 %, linear (constant speed) between.
        const a = 0.12;
        const v = 1 / (1 - a); // peak speed so the warped curve still ends at 1
        let y;
        if (x < a)
            y = (v * x * x) / (2 * a);
        else if (x > 1 - a)
            y = 1 - (v * (1 - x) * (1 - x)) / (2 * a);
        else
            y = v * (x - a / 2);
        return Math.min(1, Math.max(0, y)) * d;
    }
    /** Write the pose at time `t` (seconds) into `out`. Allocation-free. */
    sample(t, out) {
        const d = this.data;
        const n = this.count;
        if (n === 1 || !Number.isFinite(t))
            return this.key(0, out);
        const tw = this.warp(t);
        if (tw <= d[0])
            return this.key(0, out);
        const lastT = d[(n - 1) * STRIDE];
        if (tw >= lastT)
            return this.key(n - 1, out);
        // Segment i: keys i .. i+1 (binary search; n ≤ 64).
        let lo = 0;
        let hi = n - 1;
        while (hi - lo > 1) {
            const mid = (lo + hi) >> 1;
            if (d[mid * STRIDE] <= tw)
                lo = mid;
            else
                hi = mid;
        }
        const i = lo;
        const t0 = d[i * STRIDE];
        const t1 = d[(i + 1) * STRIDE];
        const span = t1 - t0;
        const u = span > 1e-9 ? (tw - t0) / span : 1;
        const f = ease(EASE_BY_CODE[d[i * STRIDE + 8]] ?? 'linear', u);
        const a = Math.max(0, i - 1) * STRIDE;
        const b = i * STRIDE;
        const c = (i + 1) * STRIDE;
        const e = Math.min(n - 1, i + 2) * STRIDE;
        const f2 = f * f;
        const f3 = f2 * f;
        const w0 = 0.5 * (-f + 2 * f2 - f3);
        const w1 = 0.5 * (2 - 5 * f2 + 3 * f3);
        const w2 = 0.5 * (f + 4 * f2 - 3 * f3);
        const w3 = 0.5 * (-f2 + f3);
        for (let k = 0; k < 3; k++) {
            out.pos[k] = w0 * d[a + 1 + k] + w1 * d[b + 1 + k] + w2 * d[c + 1 + k] + w3 * d[e + 1 + k];
            out.target[k] = w0 * d[a + 4 + k] + w1 * d[b + 4 + k] + w2 * d[c + 4 + k] + w3 * d[e + 4 + k];
        }
        out.fov = d[b + 7] + (d[c + 7] - d[b + 7]) * f;
        return out;
    }
    key(i, out) {
        const o = i * STRIDE;
        const d = this.data;
        out.pos[0] = d[o + 1];
        out.pos[1] = d[o + 2];
        out.pos[2] = d[o + 3];
        out.target[0] = d[o + 4];
        out.target[1] = d[o + 5];
        out.target[2] = d[o + 6];
        out.fov = d[o + 7];
        return out;
    }
}
/** A fresh pose object for {@link CompiledPath.sample}. */
export function newPose() {
    return { pos: [0, 0, 0], target: [0, 0, 0], fov: DEFAULT_FOV };
}
// ---------------------------------------------------------------------------
// Editing helpers
// ---------------------------------------------------------------------------
/** Insert (or replace at the same time) a key; keeps the duration ≥ the key time. */
export function upsertKey(path, key) {
    const keys = path.keys.filter((k) => Math.abs(k.t - key.t) > 1e-3);
    if (keys.length >= MAX_KEYS)
        return path;
    return normalizePath({ ...path, duration: Math.max(path.duration, Math.min(MAX_PATH_SECONDS, key.t)), keys: [...keys, key] });
}
/** Remove the key at index `i` (a path keeps at least one key). */
export function removeKey(path, i) {
    if (path.keys.length <= 1 || i < 0 || i >= path.keys.length)
        return path;
    return { ...path, keys: path.keys.filter((_, j) => j !== i) };
}
/** Move key `i` to time `t` (clamped), keeping order. */
export function retimeKey(path, i, t) {
    const k = path.keys[i];
    if (!k || !Number.isFinite(t))
        return path;
    return normalizePath({ ...path, keys: path.keys.map((x, j) => (j === i ? { ...x, t: Math.min(path.duration, Math.max(0, t)) } : x)) });
}
/** Stretch every key to a new duration. */
export function rescalePath(path, duration) {
    const d = Math.min(MAX_PATH_SECONDS, Math.max(0.5, Number.isFinite(duration) ? duration : path.duration));
    const s = d / path.duration;
    return normalizePath({ ...path, duration: d, keys: path.keys.map((k) => ({ ...k, t: k.t * s })) });
}
/** Preset ids. */
export const PRESET_IDS = ['orbit', 'turntable', 'flythrough', 'dolly', 'crane', 'topdown', 'reveal'];
/** Labels and one-line descriptions of the presets. */
export const PRESETS = {
    orbit: { label: 'Orbit', hint: 'Circle the scene once from the current height', seconds: 12 },
    turntable: { label: 'Turntable', hint: 'Product-style spin at a fixed distance, loops seamlessly', seconds: 10 },
    flythrough: { label: 'Fly-through', hint: 'Low passes and high reveals around the content', seconds: 20 },
    dolly: { label: 'Dolly in', hint: 'Push slowly towards what you are looking at', seconds: 6 },
    crane: { label: 'Crane up', hint: 'Rise from eye level to a high establishing view', seconds: 7 },
    topdown: { label: 'Top-down', hint: 'Bird’s-eye view slowly rotating over the site', seconds: 8 },
    reveal: { label: 'Reveal', hint: 'Start close, pull back and up to show everything', seconds: 8 },
};
function clampY(p, floorY) {
    return [p[0], Math.max(floorY, p[1]), p[2]];
}
function round3(p) {
    return [Math.round(p[0] * 1000) / 1000, Math.round(p[1] * 1000) / 1000, Math.round(p[2] * 1000) / 1000];
}
function key(t, pos, target, fov, e = 'linear') {
    return { t: Math.round(t * 1000) / 1000, pos: round3(pos), target: round3(target), fov: Math.min(FOV_RANGE[1], Math.max(FOV_RANGE[0], fov)), ease: e };
}
/** Points on a horizontal circle around `c` (`turns` turns from angle `a0`, `steps` per turn). */
function circle(c, r, y, a0, turns, steps) {
    const out = [];
    const n = Math.max(2, Math.round(steps * Math.abs(turns)));
    for (let i = 0; i <= n; i++) {
        const a = a0 + (i / n) * Math.PI * 2 * turns;
        out.push([c[0] + Math.sin(a) * r, y, c[2] + Math.cos(a) * r]);
    }
    return out;
}
/** Keys of a preset (a complete path). */
export function presetPath(id, scene, seconds) {
    const meta = PRESETS[id];
    const d = Math.min(MAX_PATH_SECONDS, Math.max(1, seconds ?? meta.seconds));
    const c = scene.center;
    const r = Math.max(1.5, Number.isFinite(scene.radius) ? scene.radius : 10);
    const cam = scene.camera;
    const fov = Math.min(FOV_RANGE[1], Math.max(FOV_RANGE[0], cam.fov || DEFAULT_FOV));
    const fy = scene.floorY;
    const a0 = Math.atan2(cam.pos[0] - c[0], cam.pos[2] - c[2]);
    const camDist = Math.hypot(cam.pos[0] - c[0], cam.pos[2] - c[2]);
    const look = [c[0], c[1] + r * 0.05, c[2]];
    const keys = [];
    switch (id) {
        case 'orbit': {
            const dist = Math.max(r * 1.4, Math.min(r * 4, camDist || r * 2.2));
            const y = Math.max(fy, cam.pos[1]);
            const pts = circle(c, dist, y, a0, 1, 8);
            pts.forEach((p, i) => keys.push(key((i / (pts.length - 1)) * d, p, look, fov)));
            break;
        }
        case 'turntable': {
            const dist = r * 2.4;
            const y = Math.max(fy, c[1] + r * 0.55);
            const pts = circle(c, dist, y, a0, 1, 12);
            pts.forEach((p, i) => keys.push(key((i / (pts.length - 1)) * d, p, look, Math.min(fov, 45))));
            return { v: 1, name: meta.label, duration: d, keys, easeInOut: false };
        }
        case 'flythrough': {
            keys.push(key(0, cam.pos, cam.target, fov));
            const stops = 6;
            for (let i = 1; i <= stops; i++) {
                const a = a0 + (i / (stops + 1)) * Math.PI * 2;
                const low = i % 2 === 1;
                const dist = r * (low ? 0.75 : 1.55);
                const y = Math.max(fy, c[1] + r * (low ? 0.12 : 0.65));
                keys.push(key((i / (stops + 1)) * d, [c[0] + Math.sin(a) * dist, y, c[2] + Math.cos(a) * dist], [c[0], c[1] + r * (low ? 0.05 : 0.1), c[2]], fov));
            }
            keys.push(key(d, cam.pos, cam.target, fov));
            break;
        }
        case 'dolly': {
            const dir = [cam.target[0] - cam.pos[0], cam.target[1] - cam.pos[1], cam.target[2] - cam.pos[2]];
            const end = [cam.pos[0] + dir[0] * 0.55, cam.pos[1] + dir[1] * 0.55, cam.pos[2] + dir[2] * 0.55];
            keys.push(key(0, cam.pos, cam.target, fov, 'ease'), key(d, clampY(end, fy), cam.target, fov));
            break;
        }
        case 'crane': {
            const near = Math.max(r * 0.9, 3);
            const start = [c[0] + Math.sin(a0) * near, Math.max(fy, 1.6), c[2] + Math.cos(a0) * near];
            const end = [c[0] + Math.sin(a0 + 0.35) * r * 1.6, Math.max(fy, c[1] + r * 1.3), c[2] + Math.cos(a0 + 0.35) * r * 1.6];
            keys.push(key(0, start, [c[0], Math.max(fy, 1.4), c[2]], fov), key(d, end, look, fov));
            break;
        }
        case 'topdown': {
            const h = c[1] + r * 2.6;
            // A small horizontal offset keeps the up vector defined while looking almost straight down.
            const off = r * 0.12;
            const pts = circle(c, off, h, a0, 0.25, 8);
            pts.forEach((p, i) => keys.push(key((i / (pts.length - 1)) * d, clampY([p[0], h - (i / (pts.length - 1)) * r * 0.5, p[2]], fy), [c[0], c[1], c[2]], Math.min(fov, 50))));
            break;
        }
        case 'reveal': {
            const start = [c[0] + Math.sin(a0) * r * 0.45, Math.max(fy, c[1] + r * 0.08), c[2] + Math.cos(a0) * r * 0.45];
            const end = [c[0] + Math.sin(a0 - 0.3) * r * 2.3, Math.max(fy, c[1] + r * 1.1), c[2] + Math.cos(a0 - 0.3) * r * 2.3];
            keys.push(key(0, start, [c[0], c[1] + r * 0.1, c[2]], Math.max(fov, 60), 'ease'), key(d, end, look, fov));
            break;
        }
    }
    return { v: 1, name: meta.label, duration: d, keys, easeInOut: true };
}
/** A one-key path at the current camera (the timeline's starting point). */
export function stillPath(camera, seconds = 6) {
    return { v: 1, name: 'Shot', duration: seconds, keys: [key(0, camera.pos, camera.target, camera.fov || DEFAULT_FOV)], easeInOut: true };
}
