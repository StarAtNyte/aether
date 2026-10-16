/**
 * Species description of the four-legged anatomy and the rigid parts that go with it (ears, eyes, noses, hooves,
 * antlers, whiskers). Meshes here are in the authoring frame (+X forward, +Y up, +Z right).
 */
import { ellipsoid as ellipsoidMesh, loft, mesh, move, rotX, rotY, rotZ, tube } from './vehicle-geo';
/** A leaf-shaped, thin, closed plate along +X (base at the origin, tip at `len`), `width` tall, `thick` thick. */
export function leaf(len, width, thick, pointed = true) {
    const secs = [0, 0.12, 0.3, 0.5, 0.7, 0.86, 0.96, 1].map((t) => {
        const w = pointed ? Math.sin(Math.PI * Math.min(1, t ** 0.75 * 0.98 + 0.02)) ** 0.8 * (1 - t * 0.12) : Math.sqrt(Math.max(0, 1 - ((t - 0.45) / 0.55) ** 2)) * 0.95 + 0.05;
        const h = Math.max(0.0035, (width / 2) * (t < 0.1 ? 0.55 + t * 4.5 : w));
        return { x: t * len, hw: thick / 2, y0: -h, y1: h, e: 2.4 };
    });
    return loft(secs, { ring: 12 });
}
/** An ear: a cupped leaf standing from `base`, tilted outward (`tilt`, about the head's long axis) and back (`pitch`). */
export function ear(side, base, len, width, tilt, pitch, pointed = true) {
    const m = leaf(len, width, Math.max(0.004, len * 0.05), pointed);
    // Along +X -> up (+Y), then tilt outward about X and lean back about Z.
    rotZ(m, Math.PI / 2 - pitch);
    rotX(m, side * tilt);
    return move(m, base[0], base[1], base[2]);
}
/** An eyeball at `c`. */
export function eyeBall(c, r) {
    return ellipsoidMesh(c[0], c[1], c[2], r, r * 0.92, r * 0.85, 8, 12);
}
/** A smooth tube through points. */
export function tubeMesh(points, r, r1, seg = 8) {
    return tube(points, r, { seg, steps: 6, ...(r1 !== undefined ? { r1 } : {}) });
}
/** Rigid parts of a quadruped: ears, eyes, nose, hooves, antlers, whiskers. */
export function buildCreatureParts(s, c) {
    const out = [];
    const { skullC, muzzleB, hd } = c;
    // Ears.
    if (s.ear.len > 0) {
        for (const side of [1, -1]) {
            const base = c.earAt(side);
            const m = ear(side, [0, 0, 0], s.ear.len, s.ear.width, s.ear.tilt, s.ear.pitch, s.ear.pointed ?? true);
            // The ear bone's pivot is its base: the mesh stays in absolute space.
            move(m, base[0], base[1], base[2]);
            out.push({ bone: side === 1 ? 'earR' : 'earL', mat: 'coat', geo: m, paint: (p) => [0.45 + 0.3 * Math.min(1, Math.max(0, (p[1] - base[1]) / s.ear.len)), 0.38, 0.33] });
            // Pink or dark inside: a thinner leaf inset on the inner face.
            const inner = ear(side, [0, 0, 0], s.ear.len * 0.82, s.ear.width * 0.62, s.ear.tilt, s.ear.pitch, s.ear.pointed ?? true);
            move(inner, base[0] + 0.004, base[1] + s.ear.len * 0.02, base[2] - side * Math.max(0.003, s.ear.len * 0.03));
            out.push({ bone: side === 1 ? 'earR' : 'earL', mat: 'inner', geo: inner });
        }
    }
    // Eyes.
    for (const side of [1, -1]) {
        const eye = eyeBall([skullC[0] + hd.skull[0] * 0.12, skullC[1] + hd.skull[1] * 0.28, side * hd.skull[2] * 0.9], s.eye);
        out.push({ bone: 'head', mat: 'eye', geo: eye });
    }
    // Nose pad.
    out.push({ bone: 'head', mat: 'nose', geo: ellipsoidMesh(muzzleB[0] + hd.skull[2] * hd.muzzleW1 * 0.5, muzzleB[1] + hd.skull[2] * hd.muzzleW1 * 0.55, 0, hd.skull[2] * hd.muzzleW1 * 0.85, hd.skull[2] * hd.muzzleW1 * 0.7, hd.skull[2] * hd.muzzleW1 * 1.05, 8, 12) });
    // Hooves.
    if (s.hooves) {
        for (const leg of ['fl', 'fr', 'rl', 'rr']) {
            const p = c.legPoints(leg);
            const r = (leg[0] === 'f' ? s.foreR : s.hindR)[3];
            const h = ellipsoidMesh(p.toe[0] + r * 0.7, p.toe[1] + r * 0.3, p.toe[2], r * 2.1, r * 1.5, r * 1.3, 8, 12);
            out.push({ bone: `${leg}_foot`, mat: 'hoof', geo: h });
        }
    }
    // Antlers: two beams sweeping back and up, with brow, bez and top tines.
    if (s.antlers) {
        const hb = c.headBase;
        for (const side of [1, -1]) {
            const root = [hb[0] + hd.skull[0] * 0.55, hb[1] + hd.skull[1] * 0.85, side * hd.skull[2] * 0.55];
            const at = (dx, dy, dz) => [root[0] + dx * 0.62, root[1] + dy * 0.62, root[2] + side * dz * 0.9];
            const beam = [at(0, 0, 0), at(-0.02, 0.1, 0.03), at(-0.07, 0.22, 0.08), at(-0.1, 0.34, 0.1), at(-0.06, 0.46, 0.1), at(0.02, 0.56, 0.08), at(0.1, 0.62, 0.07)];
            const g = tubeMesh(beam, 0.017, 0.006, 8);
            const tine = (from, r0) => {
                const t = tubeMesh(from, r0, 0.004, 6);
                g.p.push(...t.p);
                g.n.push(...t.n);
                const base = g.p.length / 3 - t.p.length / 3;
                for (const i of t.i)
                    g.i.push(i + base);
            };
            tine([at(0.0, 0.06, 0.0), at(0.08, 0.1, 0.01), at(0.16, 0.14, 0.0)], 0.011);
            tine([at(-0.04, 0.2, 0.06), at(0.04, 0.26, 0.04), at(0.1, 0.34, 0.02)], 0.01);
            tine([at(-0.1, 0.34, 0.1), at(-0.16, 0.42, 0.12), at(-0.2, 0.5, 0.12)], 0.009);
            tine([at(0.02, 0.56, 0.08), at(0.06, 0.66, 0.1), at(0.04, 0.74, 0.1)], 0.008);
            out.push({ bone: 'head', mat: 'horn', geo: g, paint: (_p, _n) => [0.78, 0.72, 0.6] });
        }
    }
    // Whiskers (thin, pale).
    if (s.whiskers) {
        for (const side of [1, -1]) {
            for (let k = 0; k < 4; k++) {
                const y = muzzleB[1] + 0.012 - k * 0.006;
                const w = tubeMesh([[muzzleB[0] - hd.muzzle * 0.35, y, side * hd.skull[2] * 0.45], [muzzleB[0] - hd.muzzle * 0.15, y + 0.01 - k * 0.006, side * hd.skull[2] * 1.4], [muzzleB[0] - hd.muzzle * 0.45, y + 0.02 - k * 0.012, side * hd.skull[2] * 2.6]], 0.0012, 0.0004, 4);
                out.push({ bone: 'head', mat: 'whisker', geo: w });
            }
        }
    }
    void mesh;
    void rotY;
    return out;
}
