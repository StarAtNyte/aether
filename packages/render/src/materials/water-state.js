/**
 * Shared, mutable state of the water shaders: the water clock, the wind, the ripple rings, the sky colours the
 * planar reflection is measured against and the planar reflection's height. It is a module singleton because the
 * shaders are cached per material and one page shows one world at a time; the renderer feeds it once per frame and
 * every water (and every blade of grass, see `wind.ts`) reads the same uniforms. Everything is a few floats and
 * allocates nothing per frame.
 *
 * The ripple field is the part that makes water react: anything that enters the water calls {@link RippleField.emit},
 * the shader draws one expanding ring per slot and the slot expires by itself.
 */
import { uniform, uniformArray } from 'three/tsl';
import { Color, Vector2, Vector4 } from 'three';
import { DEFAULT_WIND, headingVector, RIPPLE } from './water-params';
/** The water clock (seconds): advanced by the renderer with the simulation step, so stills and replays are deterministic. */
export const waterClock = uniform(0);
/** Wind speed in m/s. */
export const windSpeed = uniform(DEFAULT_WIND.speed);
/** Unit wind heading (x, z) the air moves toward. */
export const windHeading = uniform(new Vector2(...headingVector(DEFAULT_WIND.direction)));
/** Horizon and zenith colour of the sky (linear), what a calm surface mirrors at grazing and steep angles. */
export const skyHorizon = uniform(new Color('#bcd4f0'));
export const skyZenith = uniform(new Color('#5a8fd0'));
/** Height (y) of the planar reflection and whether it is drawn (1) or not (0). */
export const reflectionY = uniform(0);
export const reflectionOn = uniform(0);
/** One ripple ring per slot: x, z, start time, strength (0 = free). */
const slots = Array.from({ length: RIPPLE.max }, () => new Vector4(0, 0, -1000, 0));
/** The ripple slots as a shader uniform array. */
export const rippleSlots = uniformArray(slots, 'vec4');
/** Simulated seconds since the clock was last reset (same value the shader reads). */
export function clockSeconds() {
    return waterClock.value;
}
/** Advance the water clock by `dt` seconds (ignored unless positive and finite). Wraps after a day to keep float precision. */
export function advanceWater(dt) {
    if (!(dt > 0) || !Number.isFinite(dt))
        return;
    let t = waterClock.value + Math.min(dt, 0.25);
    if (t > 86_400) {
        // Keep the pattern continuous across the wrap by shifting every ring with it.
        for (const s of slots)
            s.z -= 86_400;
        t -= 86_400;
    }
    waterClock.value = t;
}
/** Set the wind (speed in m/s, heading in degrees). Returns true when it changed. */
export function setWind(speed, directionDegrees) {
    const s = Number.isFinite(speed) ? Math.max(0, Math.min(30, speed)) : DEFAULT_WIND.speed;
    const [x, z] = headingVector(Number.isFinite(directionDegrees) ? directionDegrees : DEFAULT_WIND.direction);
    const h = windHeading.value;
    const changed = Math.abs(windSpeed.value - s) > 1e-6 || Math.abs(h.x - x) > 1e-6 || Math.abs(h.y - z) > 1e-6;
    windSpeed.value = s;
    h.set(x, z);
    return changed;
}
/** Current wind as plain numbers (speed m/s, heading unit vector x, z). */
export function currentWind() {
    const h = windHeading.value;
    return { speed: windSpeed.value, x: h.x, z: h.y };
}
/** Put the world's sky colours where the planar reflection can measure itself against them. */
export function setSkyColours(horizon, zenith) {
    skyHorizon.value.set(horizon);
    skyZenith.value.set(zenith);
}
/** Back to defaults (calm clock, light breeze, no rings): tests and world switches. */
export function resetWater() {
    waterClock.value = 0;
    setWind(DEFAULT_WIND.speed, DEFAULT_WIND.direction);
    reflectionOn.value = 0;
    for (const s of slots)
        s.set(0, 0, -1000, 0);
}
/** Emit and read the ripple rings. */
export const RippleField = {
    /**
     * Start a ring at world `(x, z)`. `strength` in 0..1 (a footstep 0.25, a splash 1). Reuses the oldest slot when all
     * twelve are live, and merges into a live ring that started within 0.3 m and 0.12 s so a running character does not
     * flood the field. Returns the slot index.
     */
    emit(x, z, strength) {
        if (!Number.isFinite(x) || !Number.isFinite(z))
            return -1;
        const s = Math.max(0, Math.min(1, Number.isFinite(strength) ? strength : 0.3));
        if (s <= 0)
            return -1;
        const now = waterClock.value;
        let oldest = 0;
        let oldestAge = -1;
        for (let i = 0; i < slots.length; i++) {
            const r = slots[i];
            const age = now - r.z;
            if (r.w > 0 && age < 0.12 && Math.abs(r.x - x) < 0.3 && Math.abs(r.y - z) < 0.3) {
                r.w = Math.min(1, Math.max(r.w, s));
                return i;
            }
            const effective = r.w > 0 && age < RIPPLE.life ? age : 1e9;
            if (effective > oldestAge) {
                oldestAge = effective;
                oldest = i;
            }
        }
        slots[oldest].set(x, z, now, s);
        return oldest;
    },
    /** Free the slots whose ring has faded (so the shader skips them). */
    expire() {
        const now = waterClock.value;
        let live = 0;
        for (const r of slots) {
            if (r.w > 0 && now - r.z >= RIPPLE.life)
                r.w = 0;
            else if (r.w > 0)
                live++;
        }
        return live;
    },
    /** Number of live rings. */
    live() {
        const now = waterClock.value;
        let n = 0;
        for (const r of slots)
            if (r.w > 0 && now - r.z < RIPPLE.life)
                n++;
        return n;
    },
    /** The raw slots (read-only use: tests and the shader's CPU twin). */
    slots() {
        return slots;
    },
};
/**
 * Height of the rings the shader draws at `(x, z)` (the CPU twin of the shader's ring term, used by tests and by the
 * buoyancy-free "does the water react here" checks). Rings are `sin` packets of {@link RIPPLE.width} that fade with
 * age and distance.
 */
export function rippleHeightAt(x, z) {
    const now = waterClock.value;
    let h = 0;
    for (const r of slots) {
        if (!(r.w > 0))
            continue;
        const age = now - r.z;
        if (age < 0 || age >= RIPPLE.life)
            continue;
        const dist = Math.hypot(x - r.x, z - r.y);
        const d = dist - RIPPLE.speed * age;
        const env = Math.exp(-(d * d) / (RIPPLE.width * RIPPLE.width)) * r.w * Math.exp(-age / 1.4) / (1 + dist * 0.9);
        h += Math.sin(d * 19) * env * 0.06;
    }
    return h;
}
