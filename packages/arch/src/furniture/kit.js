import { Geom, box, cylinder, roundedBox } from '../mesh';
/** Most movable parts one piece may expose. */
export const MAX_MOVABLES = 16;
/** Collects the movable parts a builder hands out instead of merging them into the carcass. */
export class MovableSink {
    specs = [];
    add(spec) {
        if (this.specs.length < MAX_MOVABLES)
            this.specs.push(spec);
    }
}
/**
 * A front (cabinet door, drawer face) that is either merged into the static
 * geometry (`sink` undefined) or handed out as a movable part. `front` and
 * `handle` are in the piece frame; `body` (drawer box behind the face) is only
 * drawn for movable parts, since the carcass hides it otherwise.
 */
export function emitFront(sink, statics, spec) {
    if (!sink) {
        statics.front.merge(spec.front);
        statics.handle.merge(spec.handle);
        return;
    }
    const parts = [{ geom: spec.front, material: spec.frontMaterial }, { geom: spec.handle, material: spec.handleMaterial }];
    if (spec.body)
        parts.push({ geom: spec.body, material: spec.bodyMaterial ?? spec.frontMaterial });
    sink.add({ id: spec.id, name: spec.name, kind: spec.kind, center: spec.center, size: spec.size, motion: spec.motion, parts });
}
/** An open-top drawer box (sides, back, bottom) behind a front, in the piece frame; the front plane is at z = zFront. */
export function drawerBox(cx, cy, width, height, zFront, depth) {
    const t = 0.012;
    const g = new Geom();
    const x0 = cx - width / 2 + 0.012;
    const x1 = cx + width / 2 - 0.012;
    const y0 = cy - height / 2 + 0.015;
    const y1 = cy + height / 2 - 0.03;
    const zBack = zFront - depth;
    g.merge(box(x0, y0, zBack, x1, y0 + t, zFront - 0.01));
    g.merge(box(x0, y0, zBack, x0 + t, y1, zFront - 0.01));
    g.merge(box(x1 - t, y0, zBack, x1, y1, zFront - 0.01));
    g.merge(box(x0, y0, zBack, x1, y1, zBack + t));
    return g;
}
/** Reader over resolved params (values validated by the caller's resolver). */
export function reader(params, spec) {
    const get = (k) => (Object.hasOwn(params, k) ? params[k] : Object.hasOwn(spec, k) ? spec[k]?.default : undefined);
    return {
        num: (k) => {
            const v = get(k);
            return typeof v === 'number' && Number.isFinite(v) ? v : 0;
        },
        int: (k) => {
            const v = get(k);
            return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 0;
        },
        bool: (k) => get(k) === true,
        str: (k) => {
            const v = get(k);
            return typeof v === 'string' ? v : '';
        },
        color: (k) => {
            const v = get(k);
            return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : '#888888';
        },
    };
}
/** Number param. */
export function num(def, min, max, description) {
    return { type: 'number', default: def, min, max, description };
}
/** Integer param. */
export function int(def, min, max, description) {
    return { type: 'int', default: def, min, max, description };
}
/** Colour param. */
export function color(def, description) {
    return { type: 'color', default: def, description };
}
/** Enum param. */
export function choice(options, def, description) {
    return { type: 'enum', default: def, options, description };
}
/** Boolean param. */
export function flag(def, description) {
    return { type: 'boolean', default: def, description };
}
/** Wood options offered by most pieces. */
export const WOODS = ['oak', 'walnut', 'ash', 'black-metal', 'brass', 'chrome'];
/** Upholstery options. */
export const UPHOLSTERY = ['fabric', 'velvet', 'leather'];
/** Material of a finish name from a param (falls back to oak). */
export function mat(name, tint) {
    const f = (name || 'oak');
    return tint ? { finish: f, color: tint } : { finish: f };
}
/** Tapered round leg from the floor to `h`. */
export function leg(x, z, h, r = 0.018, taper = 0.7) {
    return cylinder(r * taper, r, h, 14).translate(x, 0, z);
}
/** Square leg (rounded edges). */
export function squareLeg(x, z, h, s = 0.04) {
    return roundedBox(s, h, s, Math.min(0.006, s * 0.2), 1).translate(x, h / 2, z);
}
/**
 * A soft cushion: a rounded box with generous radius, its bottom at y0.
 * `crown` adds a slight bulge on top by lifting the centre vertices.
 */
export function cushion(w, h, d, y0, crown = 0.015) {
    const r = Math.min(h * 0.45, 0.06);
    const g = roundedBox(w, h, d, r, 3);
    if (crown > 0) {
        for (let k = 0; k < g.p.length; k += 3) {
            const y = g.p[k + 1];
            if (y <= 0)
                continue;
            const fx = 1 - Math.min(1, Math.abs(g.p[k]) / (w / 2));
            const fz = 1 - Math.min(1, Math.abs(g.p[k + 2]) / (d / 2));
            g.p[k + 1] = y + crown * Math.sqrt(fx * fz) * (y / (h / 2));
        }
    }
    return g.translate(0, y0 + h / 2, 0);
}
/** Rounded rectangle outline (plan), `seg` points per corner. */
export function roundedRect(w, d, r, seg = 6) {
    const hx = w / 2;
    const hz = d / 2;
    const rr = Math.max(0, Math.min(r, hx - 1e-3, hz - 1e-3));
    const out = [];
    const corners = [
        [hx - rr, hz - rr, 0],
        [-hx + rr, hz - rr, 90],
        [-hx + rr, -hz + rr, 180],
        [hx - rr, -hz + rr, 270],
    ];
    for (const [cx, cz, a0] of corners) {
        for (let k = 0; k <= seg; k++) {
            const a = ((a0 + (90 * k) / seg) * Math.PI) / 180;
            out.push([cx + Math.cos(a) * rr, cz + Math.sin(a) * rr]);
        }
    }
    return out;
}
/** Seeded PRNG (sfc32-lite) for deterministic decoration (books, leaves). */
export function seeded(seed) {
    let s = (seed >>> 0) || 1;
    return () => {
        s ^= s << 13;
        s ^= s >>> 17;
        s ^= s << 5;
        return ((s >>> 0) % 1_000_000) / 1_000_000;
    };
}
