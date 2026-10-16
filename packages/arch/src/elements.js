/**
 * Plate-like and linear architectural elements: floor slabs, ceilings,
 * columns, railings and pool basins. All outputs use metric UVs and carry
 * static colliders where people can touch them.
 */
import { Geom, box, cylinder, roundedBox, tube } from './mesh';
import { PartSet } from './parts';
import { isAxisRectangle, bounds, positive, signedArea } from './math2';
import { triangulate } from './triangulate';
/** Side band of a polygon from y0 to y1 (outward faces). */
function band(g, poly, y0, y1, inward = false) {
    const pts = positive(poly);
    let u = 0;
    for (let k = 0; k < pts.length; k++) {
        const a = pts[k];
        const b = pts[(k + 1) % pts.length];
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (l < 1e-6)
            continue;
        if (inward)
            g.quadAuto([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], u, y0);
        else
            g.quadAuto([b[0], y0, b[1]], [a[0], y0, a[1]], [a[0], y1, a[1]], [b[0], y1, b[1]], u, y0);
        u += l;
    }
}
/** Floor slab: top at y = 0 with the floor finish, edge band down to −thickness. */
export function buildSlab(p) {
    const set = new PartSet();
    const top = new Geom().flatPolygon(p.polygon, 0, true, p.holes);
    const edge = new Geom();
    band(edge, p.polygon, -p.thickness, 0);
    for (const h of p.holes)
        band(edge, h, -p.thickness, 0, true);
    if (p.bottom)
        edge.flatPolygon(p.polygon, -p.thickness, false, p.holes);
    set.add(top, p.finish).add(edge, p.edge);
    // Collider: one box for plain rectangles, a closed triangle mesh otherwise.
    if (p.holes.length === 0 && isAxisRectangle(p.polygon)) {
        const [x0, z0, x1, z1] = bounds(p.polygon);
        set.boxMinMax(x0, -p.thickness, z0, x1, 0, z1);
    }
    else {
        const solid = new Geom().flatPolygon(p.polygon, 0, true, p.holes).flatPolygon(p.polygon, -p.thickness, false, p.holes);
        band(solid, p.polygon, -p.thickness, 0);
        for (const h of p.holes)
            band(solid, h, -p.thickness, 0, true);
        set.trimesh(solid);
    }
    return set.build();
}
/** Ceiling: a downward-facing surface at y = 0 (with an optional recessed cove). */
export function buildCeiling(p) {
    const set = new PartSet();
    const g = new Geom();
    if (p.cove > 0.005) {
        // Inset field raised by the cove depth, with a vertical return.
        const inset = insetRect(p.polygon, 0.35);
        if (inset) {
            const ring = new Geom();
            ring.flatPolygon(p.polygon, 0, false, [inset, ...p.holes]);
            band(ring, inset, 0, p.cove, true);
            g.merge(ring);
            g.flatPolygon(inset, p.cove, false);
        }
        else
            g.flatPolygon(p.polygon, 0, false, p.holes);
    }
    else
        g.flatPolygon(p.polygon, 0, false, p.holes);
    set.add(g, p.finish);
    if (p.downlights.length > 0) {
        // Recessed cans: a white trim ring and a flush lens; inside a cove the field is raised by the cove depth.
        const inset = p.cove > 0.005 ? insetRect(p.polygon, 0.35) : null;
        const trim = new Geom();
        const lens = new Geom();
        for (const [x, z] of p.downlights) {
            const y0 = inset && x > Math.min(...inset.map((q) => q[0])) && x < Math.max(...inset.map((q) => q[0])) && z > Math.min(...inset.map((q) => q[1])) && z < Math.max(...inset.map((q) => q[1])) ? p.cove : 0;
            trim.merge(cylinder(0.062, 0.062, 0.014, 20).translate(x, y0 - 0.014, z));
            const ring = [];
            for (let k = 0; k < 20; k++)
                ring.push([x + Math.cos((k / 20) * Math.PI * 2) * 0.046, z + Math.sin((k / 20) * Math.PI * 2) * 0.046]);
            lens.flatPolygon(ring, y0 - 0.0145, false);
        }
        set.add(trim, { finish: 'paint', color: '#f6f4f0', roughness: 0.4 });
        set.add(lens, { preset: 'emissive', color: '#ffe6c2', emissive: '#ffe0b0', emissiveIntensity: p.lit ? 1.5 : 0, roughness: 0.3 });
    }
    return set.build();
}
/** Inset of an axis-aligned rectangle (null for other shapes or when too small). */
function insetRect(poly, d) {
    if (!isAxisRectangle(poly))
        return null;
    const [x0, z0, x1, z1] = bounds(poly);
    if (x1 - x0 < 2 * d + 0.5 || z1 - z0 < 2 * d + 0.5)
        return null;
    return [
        [x0 + d, z0 + d],
        [x1 - d, z0 + d],
        [x1 - d, z1 - d],
        [x0 + d, z1 - d],
    ];
}
/** Column standing on y = 0. */
export function buildColumn(p) {
    const set = new PartSet();
    const r = p.size / 2;
    if (p.shape === 'round') {
        set.add(cylinder(r, r, p.height, 28), p.finish);
        set.box([0, p.height / 2, 0], [r, p.height / 2, r]);
    }
    else {
        set.add(roundedBox(p.size, p.height, p.size, Math.min(0.012, r * 0.2), 2).translate(0, p.height / 2, 0), p.finish);
        set.box([0, p.height / 2, 0], [r, p.height / 2, r]);
    }
    return set.build();
}
/** Railing along a plan polyline (top rail, posts, infill). */
export function buildRailing(p) {
    const set = new PartSet();
    const metal = new Geom();
    const infill = new Geom();
    const h = p.height;
    const pts = p.points;
    // Top rail.
    metal.merge(tube(pts.map((q) => [q[0], h, q[1]]), 0.022, 10));
    for (let k = 0; k + 1 < pts.length; k++) {
        const a = pts[k];
        const b = pts[k + 1];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 1e-3)
            continue;
        const ux = (b[0] - a[0]) / len;
        const uz = (b[1] - a[1]) / len;
        const yaw = (Math.atan2(-uz, ux) * 180) / Math.PI;
        // Posts every ~1.2 m (glass) or 0.12 m bars.
        const spacing = p.style === 'bars' ? 0.12 : 1.2;
        const n = Math.max(1, Math.round(len / spacing));
        for (let i = 0; i <= n; i++) {
            if (i === n && k + 2 < pts.length)
                continue; // shared with the next segment
            const x = a[0] + ux * (len * i) / n;
            const z = a[1] + uz * (len * i) / n;
            const r = p.style === 'bars' ? 0.009 : 0.022;
            metal.merge(cylinder(r, r, h, 8, { bottom: false }).translate(x, 0, z));
        }
        if (p.style === 'glass') {
            const pane = box(0.02, 0.06, -0.006, len - 0.02, h - 0.06, 0.006).rotateY(yaw).translate(a[0], 0, a[1]);
            infill.merge(pane);
        }
        else if (p.style === 'cable') {
            for (let y = 0.15; y < h - 0.05; y += 0.12)
                metal.merge(tube([[a[0], y, a[1]], [b[0], y, b[1]]], 0.003, 6));
        }
        else if (p.style === 'solid') {
            infill.merge(box(0, 0, -0.06, len, h - 0.03, 0.06).rotateY(yaw).translate(a[0], 0, a[1]));
        }
        set.box([(a[0] + b[0]) / 2, h / 2, (a[1] + b[1]) / 2], [len / 2, h / 2, 0.04], [0, yaw, 0]);
    }
    set.add(metal, p.finish);
    if (p.style === 'glass')
        set.add(infill, { finish: 'glass' });
    else if (p.style === 'solid')
        set.add(infill, { finish: 'plaster' });
    return set.build();
}
/**
 * Pool basin recessed below y = 0: tiled walls and floor facing inward, a
 * stone coping ring at the top and a water surface `freeboard` below it.
 * Centred on the origin (width along X, length along Z).
 */
export function buildBasin(p) {
    const set = new PartSet();
    const hx = p.width / 2;
    const hz = p.length / 2;
    const inner = [
        [-hx, -hz],
        [hx, -hz],
        [hx, hz],
        [-hx, hz],
    ];
    const tiles = new Geom();
    band(tiles, inner, -p.depth, 0, true);
    tiles.flatPolygon(inner, -p.depth, true);
    set.add(tiles, p.finish);
    // Coping: a 0.3 m ring slightly proud of the deck.
    const c = 0.3;
    const outer = [
        [-hx - c, -hz - c],
        [hx + c, -hz - c],
        [hx + c, hz + c],
        [-hx - c, hz + c],
    ];
    const coping = new Geom().flatPolygon(outer, 0.03, true, [inner]);
    band(coping, outer, 0, 0.03);
    band(coping, inner, -0.04, 0.03, true);
    set.add(coping, p.coping);
    if (p.water) {
        const water = new Geom().flatPolygon(inner, -p.freeboard, true);
        // Opaque: the basin sits below the ground plane, which must not show through the water.
        set.add(water, { finish: 'water', opacity: 1 });
    }
    // Colliders: floor and four walls (people can walk around and fall in).
    const t = 0.1;
    set.boxMinMax(-hx, -p.depth - t, -hz, hx, -p.depth, hz);
    set.boxMinMax(-hx - t, -p.depth, -hz - t, -hx, 0.03, hz + t);
    set.boxMinMax(hx, -p.depth, -hz - t, hx + t, 0.03, hz + t);
    set.boxMinMax(-hx, -p.depth, -hz - t, hx, 0.03, -hz);
    set.boxMinMax(-hx, -p.depth, hz, hx, 0.03, hz + t);
    return set.build();
}
/** Area of a slab's walkable top in m² (outline minus holes). */
export function slabArea(polygon, holes = []) {
    const { points, triangles } = triangulate(polygon, holes);
    let s = 0;
    for (let i = 0; i < triangles.length; i += 3)
        s += signedArea([points[triangles[i]], points[triangles[i + 1]], points[triangles[i + 2]]]);
    return Math.abs(s);
}
