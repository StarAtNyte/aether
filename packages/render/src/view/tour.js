/**
 * Camera director: a cinematic fly-through around the meaningful content.
 *
 * `tourKeys` composes a loop of camera keys around the content sphere —
 * sweeping low passes alternating with high reveals, each looking at the
 * centre or at a focus point — starting and ending at the current camera so
 * the tour begins and returns without a cut. `CameraTour` plays the keys on
 * a uniform Catmull-Rom spline (positions and look targets)
 * with an ease-in/ease-out timeline. Allocation-free per frame.
 */
import { Vector3 } from 'three';
/** Default tour length (s). */
export const TOUR_SECONDS = 26;
/**
 * Keys of a loop around `center` (content radius `radius`), beginning and
 * ending at the current camera pose. `focus` points (statues, set-pieces)
 * become look targets of the low passes. Never below `floorY`.
 */
export function tourKeys(from, center, radius, focus = [], floorY = 0.5) {
    const r = Math.max(2, Number.isFinite(radius) ? radius : 10);
    const start = Math.atan2(from.pos[0] - center[0], from.pos[2] - center[2]);
    const keys = [from];
    const stops = 6;
    for (let i = 1; i <= stops; i++) {
        const a = start + (i / (stops + 1)) * Math.PI * 2;
        const low = i % 2 === 1;
        const dist = r * (low ? 0.75 : 1.55);
        const height = Math.max(floorY, center[1] + r * (low ? 0.12 : 0.65));
        const f = focus.length > 0 ? focus[(i - 1) % focus.length] : undefined;
        const target = low && f ? [f[0], f[1], f[2]] : [center[0], center[1] + r * (low ? 0.05 : 0.1), center[2]];
        keys.push({ pos: [center[0] + Math.sin(a) * dist, height, center[2] + Math.cos(a) * dist], target });
    }
    keys.push({ pos: [...from.pos], target: [...from.target] });
    return keys;
}
const _look = new Vector3();
/** Plays a key loop on a camera. */
export class CameraTour {
    duration;
    /** Keys packed as pos xyz + target xyz (typed: no boxed element loads per frame). */
    data;
    count;
    constructor(keys, duration = TOUR_SECONDS) {
        this.duration = Math.max(1, Number.isFinite(duration) ? duration : TOUR_SECONDS);
        this.count = keys.length;
        this.data = new Float64Array(keys.length * 6);
        keys.forEach((k, i) => this.data.set([...k.pos, ...k.target], i * 6));
    }
    /** True until the last key is reached. */
    get active() {
        return this.io[0] < 1 && this.count >= 2;
    }
    /** Progress 0..1. */
    get progress() {
        return this.io[0];
    }
    /**
     * Per-frame scalars in a typed array (doubles stored into object fields or
     * passed across calls get boxed): [t, eased, pending dt, floor y].
     */
    io = Float64Array.from([0, 0, 0, Number.NEGATIVE_INFINITY]);
    /** Write the pose at the current eased progress into `pos` / `target`. */
    place(pos, target) {
        const n = this.count;
        const x = Math.min(0.999999, Math.max(0, this.io[1])) * (n - 1);
        const i = x | 0;
        const f = x - i;
        const d = this.data;
        const a = Math.max(0, i - 1) * 6;
        const b = i * 6;
        const c = Math.min(n - 1, i + 1) * 6;
        const e = Math.min(n - 1, i + 2) * 6;
        // Catmull-Rom basis weights, inline (no calls taking or returning doubles: no boxing).
        const f2 = f * f;
        const f3 = f2 * f;
        const w0 = 0.5 * (-f + 2 * f2 - f3);
        const w1 = 0.5 * (2 - 5 * f2 + 3 * f3);
        const w2 = 0.5 * (f + 4 * f2 - 3 * f3);
        const w3 = 0.5 * (-f2 + f3);
        pos.x = w0 * d[a] + w1 * d[b] + w2 * d[c] + w3 * d[e];
        pos.y = w0 * d[a + 1] + w1 * d[b + 1] + w2 * d[c + 1] + w3 * d[e + 1];
        pos.z = w0 * d[a + 2] + w1 * d[b + 2] + w2 * d[c + 2] + w3 * d[e + 2];
        target.x = w0 * d[a + 3] + w1 * d[b + 3] + w2 * d[c + 3] + w3 * d[e + 3];
        target.y = w0 * d[a + 4] + w1 * d[b + 4] + w2 * d[c + 4] + w3 * d[e + 4];
        target.z = w0 * d[a + 5] + w1 * d[b + 5] + w2 * d[c + 5] + w3 * d[e + 5];
    }
    /**
     * Advance by `dt` seconds and place `camera`; `floorY` keeps it above the
     * ground. Returns the look target in `outTarget`. False once finished.
     */
    update(dt, camera, outTarget, floorY = Number.NEGATIVE_INFINITY) {
        this.io[2] = dt;
        this.io[3] = floorY;
        return this.step(camera, outTarget);
    }
    /** {@link update} with dt / floor taken from {@link io} (the allocation-free per-frame call). */
    step(camera, outTarget) {
        if (!this.active)
            return false;
        const io = this.io;
        const dt = io[2];
        const t = Math.min(1, io[0] + Math.max(0, Number.isFinite(dt) ? dt : 0) / this.duration);
        io[0] = t;
        // Smooth start and stop over the whole loop.
        io[1] = t * t * (3 - 2 * t);
        this.place(camera.position, outTarget);
        if (camera.position.y < io[3])
            camera.position.y = io[3];
        _look.copy(outTarget);
        camera.lookAt(_look);
        return true;
    }
}
