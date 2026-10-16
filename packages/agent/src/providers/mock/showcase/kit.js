import { generateBuiltinSync } from '@aether/procgen';
import { Builder, r2 } from '../builder';
/** A calm default mood (every flag off). */
const CALM = Object.freeze({ night: false, dusk: false, dawn: false, rain: false, snow: false, fog: false, lowGravity: false, water: false });
/** A builder for a whole new world, seeded from the flagship id. */
export function flagshipBuilder(seed, mood = {}, opts = {}) {
    const b = new Builder(seed, [], { ...CALM, ...mood });
    b.realisticNature = opts.stylised !== true;
    return b;
}
/**
 * Turn a builder into a complete plan: the world is cleared first (a
 * flagship always replaces the current world), then the builder's patches,
 * then the title card.
 */
export function finish(b, f) {
    b.meta(f.name, f.description);
    const patches = [{ op: 'clear', keepEnvironment: false }, ...b.build()];
    if (f.intro) {
        const intro = { title: f.intro.title };
        if (f.intro.tagline)
            intro.tagline = f.intro.tagline;
        if (f.intro.objective)
            intro.objective = f.intro.objective;
        if (f.intro.controls)
            intro.controls = f.intro.controls;
        if (f.intro.accent)
            intro.accent = f.intro.accent;
        patches.push({ op: 'setMeta', intro: intro });
    }
    return { plan: f.plan, patches, message: f.message, ...(f.arch ? { arch: f.arch } : {}) };
}
/** Point on a circle of radius `r` around (cx, cz) at angle `a` (radians), y = `y`. */
export function onCircle(cx, cz, r, a, y = 0) {
    return [r2(cx + Math.cos(a) * r), r2(y), r2(cz + Math.sin(a) * r)];
}
/** Yaw (degrees) facing from (x, z) toward (tx, tz) for a +Z-facing object. */
export function faceToward(x, z, tx, tz) {
    return r2((Math.atan2(tx - x, tz - z) * 180) / Math.PI);
}
/**
 * A glowing paper/stone lantern: a short post with an emissive shade and,
 * unless `lit` is false, a warm point light that breathes gently (keep real
 * lights to a dozen or so per world: each one costs every lit pixel).
 * Returns the post id.
 */
export function glowLantern(b, pos, color = '#ffb35c', o = {}) {
    const h = o.height ?? 1.4;
    const post = b.prim('lantern-post', 'box', [0.14, h, 0.14], [pos[0], r2(pos[1] + h / 2), pos[2]], { material: { preset: 'wood', color: '#3b2a20' }, physics: 'static', footprint: 0.4, ...(o.tags ? { tags: o.tags } : {}) });
    b.prim(`${post}-shade`, 'box', [0.36, 0.42, 0.36], [0, r2(h / 2 + 0.2), 0], { parent: post, material: { preset: 'emissive', color: o.shade ?? '#fff1d6', emissive: color, emissiveIntensity: 2.6 }, castShadow: false });
    if (o.lit === false)
        return post;
    b.light(post, [0, r2(h / 2 + 0.25), 0], color, o.intensity ?? 2.2, o.range ?? 10, [{ type: 'pulseLight', params: { min: (o.intensity ?? 2.2) * 0.8, max: (o.intensity ?? 2.2) * 1.1, period: r2(b.rand(2.2, 3.6)), phase: r2(b.rand(0, 1)) } }]);
    return post;
}
/** A floating spinning collectible (glowing gem / lantern / cell) adding to `scoreKey`. */
export function pickup(b, base, pos, o) {
    const s = o.size ?? 0.6;
    const id = b.prim(base, o.shape ?? 'sphere', [s, o.shape === 'cylinder' ? s * 0.25 : s, s], pos, {
        name: o.name ?? 'Collectible',
        ...(o.shape === 'cylinder' ? { rot: [90, 0, 0] } : {}),
        material: { preset: 'emissive', color: o.color, emissive: o.color, emissiveIntensity: 2.2 },
        behaviors: [
            { type: 'spin', params: { axis: o.shape === 'cylinder' ? [0, 0, 1] : [0, 1, 0], speed: 110 } },
            { type: 'bob', params: { amplitude: 0.18, period: 1.8, phase: r2(b.rand(0, 1)) } },
            { type: 'collectible', params: { scoreKey: o.scoreKey, value: 1, margin: 1.2, ...(o.message ? { message: o.message } : {}) } },
        ],
        tags: o.tags ?? ['pickup'],
        castShadow: false,
    });
    return id;
}
/** Points along a closed loop (ellipse with a wobble) — race lines, train tracks, patrols. */
export function loopPoints(cx, cz, rx, rz, count, wobble = 0, y = 0, phase = 0) {
    const out = [];
    for (let i = 0; i < count; i++) {
        const a = phase + (i / count) * Math.PI * 2;
        const w = 1 + wobble * Math.sin(a * 3);
        out.push([r2(cx + Math.cos(a) * rx * w), r2(y), r2(cz + Math.sin(a) * rz * w)]);
    }
    return out;
}
/** A thin box segment from `a` to `b` (rails, curbs, paths, fences of light). */
export function segment(b, base, from, to, width, height, material, extra = {}) {
    const dx = to[0] - from[0];
    const dz = to[2] - from[2];
    const len = Math.hypot(dx, dz);
    const yaw = (Math.atan2(dx, dz) * 180) / Math.PI;
    return b.prim(base, 'box', [r2(width), r2(height), r2(len)], [r2((from[0] + to[0]) / 2), r2(extra.y ?? (from[1] + to[1]) / 2 + height / 2), r2((from[2] + to[2]) / 2)], {
        yaw: r2(yaw),
        material,
        ...(extra.physics ? { physics: extra.physics } : {}),
        ...(extra.tags ? { tags: extra.tags } : {}),
        castShadow: extra.castShadow ?? false,
    });
}
/** Deep-frozen JSON params helper (keeps literal params typed as Json). */
export function params(p) {
    return p;
}
/**
 * Ground height under (x, z) of a built-in terrain entity (bilinear over the heightfield grid the renderer and physics
 * share), for placing things on it offline.
 */
export function terrainHeight(params, seed, size) {
    const out = generateBuiltinSync('terrain', params, seed);
    const hf = out.colliders.find((c) => c.kind === 'heightfield');
    if (!hf || hf.kind !== 'heightfield')
        throw new Error('terrain has no heightfield');
    const n = hf.rows + 1;
    const sizeY = hf.size[1];
    const at = (ix, iz) => hf.heights[Math.min(hf.cols, Math.max(0, ix)) * n + Math.min(hf.rows, Math.max(0, iz))] * sizeY;
    return (x, z) => {
        const fx = ((x + size / 2) / size) * hf.cols;
        const fz = ((z + size / 2) / size) * hf.rows;
        const ix = Math.floor(fx);
        const iz = Math.floor(fz);
        const tx = fx - ix;
        const tz = fz - iz;
        return at(ix, iz) * (1 - tx) * (1 - tz) + at(ix + 1, iz) * tx * (1 - tz) + at(ix, iz + 1) * (1 - tx) * tz + at(ix + 1, iz + 1) * tx * tz;
    };
}
