/**
 * Stairs: straight, L (quarter turn with a landing) and U (half turn). Each
 * flight is a monolithic concrete-style profile (sawtooth top, sloped
 * soffit) extruded across the width, with timber treads on top. Riser
 * heights are equal over the whole stair (≈ 17.5 cm by default) and the last
 * riser lands on the floor above, so the upper slab edge is the top step.
 *
 * Local frame: the first riser is at x = 0, the first flight ascends along
 * +X centred on z = 0; "left" turns toward −Z (facing +X with Y up).
 * Colliders are smooth ramps (hulls) along each flight plus landing boxes,
 * so a character controller walks up without snagging on nosings.
 */
import { Geom, box, cylinder, tube } from './mesh';
import { PartSet } from './parts';
import { rect } from './math2';
/** Comfortable riser height used when `steps` is automatic (metres). */
export const DEFAULT_RISER = 0.175;
const TREAD = 0.04;
const NOSING = 0.02;
const WAIST = 0.18;
/** Riser count and height for a stair. */
export function stairRisers(p) {
    const count = p.steps > 0 ? p.steps : Math.max(2, Math.round(p.rise / DEFAULT_RISER));
    return { count, riser: p.rise / count };
}
/** Layout of the flights and landings (local plan). */
export function stairLayout(p) {
    const { count, riser } = stairRisers(p);
    const g = p.going;
    const w = p.width;
    if (p.shape === 'straight' || count < 4) {
        return { flights: [{ x: 0, z: 0, dx: 1, dz: 0, y0: 0, treads: count - 1 }], landings: [], riser };
    }
    const n1 = Math.floor(count / 2);
    const t1 = n1 - 1;
    const t2 = count - n1 - 1;
    const lx0 = t1 * g;
    const s = p.turn === 'left' ? -1 : 1;
    if (p.shape === 'l') {
        // Landing w×w at the end of flight 1; flight 2 leaves it sideways.
        const landing = { x0: lx0, z0: -w / 2, x1: lx0 + w, z1: w / 2, y: n1 * riser };
        const f2 = { x: lx0 + w / 2, z: s * (w / 2), dx: 0, dz: s, y0: n1 * riser, treads: t2 };
        return { flights: [{ x: 0, z: 0, dx: 1, dz: 0, y0: 0, treads: t1 }, f2], landings: [landing], riser };
    }
    // U: full-width landing; flight 2 runs back along −X beside flight 1.
    const off = s * (w + p.gap);
    const landing = { x0: lx0, z0: Math.min(-w / 2, off - w / 2), x1: lx0 + w, z1: Math.max(w / 2, off + w / 2), y: n1 * riser };
    const f2 = { x: lx0, z: off, dx: -1, dz: 0, y0: n1 * riser, treads: t2 };
    return { flights: [{ x: 0, z: 0, dx: 1, dz: 0, y0: 0, treads: t1 }, f2], landings: [landing], riser };
}
/** Plan footprint of the stair (the hole to cut in the floor above). */
export function stairFootprint(p) {
    const { flights, landings } = stairLayout(p);
    const w = p.width;
    const g = p.going;
    const f1 = flights[0];
    if (flights.length === 1)
        return rect(0, -w / 2, Math.max(g, f1.treads * g), w / 2);
    const l = landings[0];
    const f2 = flights[1];
    if (p.shape === 'u')
        return rect(0, l.z0, l.x1, l.z1);
    // L: flight 1 + landing, plus flight 2 going sideways.
    const len2 = f2.treads * g;
    if (f2.dz < 0) {
        return [
            [0, -w / 2],
            [l.x0, -w / 2],
            [l.x0, -w / 2 - len2],
            [l.x1, -w / 2 - len2],
            [l.x1, w / 2],
            [0, w / 2],
        ];
    }
    return [
        [0, -w / 2],
        [l.x1, -w / 2],
        [l.x1, w / 2 + len2],
        [l.x0, w / 2 + len2],
        [l.x0, w / 2],
        [0, w / 2],
    ];
}
/** Build one flight's structure and treads into the geometry sets. */
function buildFlight(f, p, riser, structure, treads, set) {
    if (f.treads <= 0)
        return;
    const g = p.going;
    const w = p.width;
    const n = f.treads;
    // Side profile in (s, y): sawtooth top and a sloped soffit.
    const profile = [[0, f.y0]];
    for (let i = 0; i < n; i++) {
        const y = f.y0 + (i + 1) * riser - TREAD;
        profile.push([i * g, y], [(i + 1) * g, y]);
    }
    const run = n * g;
    const yTop = f.y0 + n * riser - TREAD;
    const slope = (n * riser) / Math.max(1e-3, run);
    const waist = WAIST * Math.sqrt(1 + slope * slope);
    profile.push([run, Math.max(f.y0, yTop - waist)]);
    if (f.y0 > 0.01)
        profile.push([0, Math.max(0, f.y0 - waist)]);
    // Extrude across the width: the profile lies in (s, y), the width runs along Z.
    const local = new Geom();
    const hw = w / 2;
    const face = (pts, t, facing) => {
        const tmp = new Geom().flatPolygon(pts, 0, facing > 0);
        // flatPolygon lays (s, y) on (x, z) facing ±Y: swap y and z to stand it up at z = t.
        for (let k = 0; k < tmp.p.length; k += 3) {
            const sv = tmp.p[k];
            const yv = tmp.p[k + 2];
            tmp.p[k + 1] = yv;
            tmp.p[k + 2] = t;
            tmp.n[k] = 0;
            tmp.n[k + 1] = 0;
            tmp.n[k + 2] = facing;
            tmp.uv[(k / 3) * 2] = sv;
            tmp.uv[(k / 3) * 2 + 1] = yv;
        }
        // The y/z swap is a mirror: restore front-facing winding.
        tmp.flip();
        local.merge(tmp);
    };
    face(profile, hw, 1);
    face(profile, -hw, -1);
    // Bands across the width (risers, tread beds, soffit), facing out of the profile.
    const ccw = profileArea(profile) > 0;
    for (let k = 0; k < profile.length; k++) {
        const a = profile[k];
        const b = profile[(k + 1) % profile.length];
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-5)
            continue;
        const q0 = [a[0], a[1], -hw];
        const q1 = [b[0], b[1], -hw];
        const q2 = [b[0], b[1], hw];
        const q3 = [a[0], a[1], hw];
        // (q0, q1, q2, q3) faces the right-hand normal of a→b, which is outward for a counter-clockwise profile.
        if (ccw)
            local.quadAuto(q0, q1, q2, q3);
        else
            local.quadAuto(q3, q2, q1, q0);
    }
    // Treads with a small nosing.
    const tr = new Geom();
    for (let i = 0; i < n; i++) {
        const y = f.y0 + (i + 1) * riser;
        tr.merge(box(i * g - NOSING, y - TREAD, -hw, (i + 1) * g, y, hw));
    }
    // Orient the flight: local +X → (dx, dz).
    const yaw = (Math.atan2(-f.dz, f.dx) * 180) / Math.PI;
    for (const geom of [local, tr])
        geom.rotateY(yaw).translate(f.x, 0, f.z);
    structure.merge(local);
    treads.merge(tr);
    // Ramp collider along the nosing line.
    const pts = [];
    const corners = [
        [0, f.y0, -hw],
        [0, f.y0, hw],
        [run, f.y0 + n * riser, -hw],
        [run, f.y0 + n * riser, hw],
        [run, Math.max(f.y0, f.y0 + n * riser - 0.3), -hw],
        [run, Math.max(f.y0, f.y0 + n * riser - 0.3), hw],
    ];
    for (const [s, y, t] of corners) {
        const r = rotate(s, t, yaw);
        pts.push(f.x + r[0], y, f.z + r[1]);
    }
    set.hull(pts);
}
function profileArea(profile) {
    let a = 0;
    for (let i = 0; i < profile.length; i++) {
        const p = profile[i];
        const q = profile[(i + 1) % profile.length];
        a += p[0] * q[1] - q[0] * p[1];
    }
    return a / 2;
}
function rotate(x, z, yawDeg) {
    const t = (yawDeg * Math.PI) / 180;
    return [x * Math.cos(t) + z * Math.sin(t), -x * Math.sin(t) + z * Math.cos(t)];
}
/** Build a stair (see the module docs). */
export function buildStair(p) {
    const set = new PartSet();
    const { flights, landings, riser } = stairLayout(p);
    const structure = new Geom();
    const treads = new Geom();
    for (const f of flights)
        buildFlight(f, p, riser, structure, treads, set);
    for (const l of landings) {
        structure.merge(box(l.x0, Math.max(0, l.y - WAIST - TREAD), l.z0, l.x1, l.y - TREAD, l.z1));
        treads.merge(box(l.x0, l.y - TREAD, l.z0, l.x1, l.y, l.z1));
        set.boxMinMax(l.x0, l.y - 0.2, l.z0, l.x1, l.y, l.z1);
    }
    set.add(structure, p.structure).add(treads, p.finish);
    // Handrails: sloped tube at 0.9 m above the nosing line, with posts.
    if (p.rail !== 'none') {
        const rails = new Geom();
        for (const f of flights) {
            if (f.treads <= 0)
                continue;
            const run = f.treads * p.going;
            const yaw = (Math.atan2(-f.dz, f.dx) * 180) / Math.PI;
            const sides = [];
            if (p.rail === 'left' || p.rail === 'both')
                sides.push(-1);
            if (p.rail === 'right' || p.rail === 'both')
                sides.push(1);
            for (const side of sides) {
                const t = side * (p.width / 2 - 0.05);
                const h0 = f.y0 + riser + 0.9;
                const h1 = f.y0 + (f.treads + 1) * riser + 0.9;
                const r = new Geom().merge(tube([[0, h0, t], [run, h1, t]], 0.022, 10));
                const posts = Math.max(2, Math.round(run / 1.1) + 1);
                for (let k = 0; k < posts; k++) {
                    const s = (run * k) / (posts - 1);
                    const base = f.y0 + Math.min(f.treads, Math.floor(s / p.going) + 1) * riser;
                    const top = h0 + ((h1 - h0) * s) / Math.max(1e-3, run);
                    r.merge(cylinder(0.012, 0.012, Math.max(0.1, top - base), 8, { bottom: false }).translate(Math.min(run - 0.03, Math.max(0.03, s)), base, t));
                }
                rails.merge(r.rotateY(yaw).translate(f.x, 0, f.z));
            }
        }
        set.add(rails, p.railMaterial);
    }
    return set.build();
}
