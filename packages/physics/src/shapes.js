import { eulerDegToQuat } from '@aether/core';
import { isFiniteVec, isIdentityQuat, isUniform, quatMul, rotate } from './vec';
/** Hard caps keeping untrusted geometry from exhausting the WASM heap. */
export const SHAPE_LIMITS = Object.freeze({
    MAX_HULL_POINTS: 4096,
    MAX_TRIMESH_VERTICES: 200_000,
    MAX_TRIMESH_INDICES: 1_200_000,
    MAX_HEIGHTFIELD_CELLS: 1024,
    MIN_EXTENT: 1e-3,
    MAX_EXTENT: 1e5,
});
const IDENTITY = [0, 0, 0, 1];
const ELLIPSOID_SAMPLES = 42;
function clampExtent(v) {
    if (!Number.isFinite(v))
        return SHAPE_LIMITS.MIN_EXTENT;
    return Math.min(SHAPE_LIMITS.MAX_EXTENT, Math.max(SHAPE_LIMITS.MIN_EXTENT, Math.abs(v)));
}
function finiteOr(v, fallback) {
    return v && isFiniteVec(v) ? [v[0], v[1], v[2]] : [fallback[0], fallback[1], fallback[2]];
}
/**
 * Convert a procgen {@link ColliderDesc} (untrusted: may come from an
 * LLM-written generator via a provider) into a {@link LocalCollider}.
 * Returns `null` for malformed descriptors.
 */
export function fromColliderDesc(desc) {
    if (!desc || typeof desc !== 'object')
        return null;
    switch (desc.kind) {
        case 'box': {
            if (!isFiniteVec(desc.halfExtents))
                return null;
            const rot = desc.rotation && isFiniteVec(desc.rotation) ? eulerDegToQuat(desc.rotation) : IDENTITY;
            return {
                shape: { kind: 'box', half: [clampExtent(desc.halfExtents[0]), clampExtent(desc.halfExtents[1]), clampExtent(desc.halfExtents[2])] },
                position: finiteOr(desc.offset, [0, 0, 0]),
                rotation: [rot[0], rot[1], rot[2], rot[3]],
            };
        }
        case 'sphere':
            if (!Number.isFinite(desc.radius))
                return null;
            return { shape: { kind: 'ball', radius: clampExtent(desc.radius) }, position: finiteOr(desc.offset, [0, 0, 0]), rotation: [0, 0, 0, 1] };
        case 'capsule':
        case 'cylinder':
            if (!Number.isFinite(desc.radius) || !Number.isFinite(desc.halfHeight))
                return null;
            return {
                shape: { kind: desc.kind, halfHeight: desc.kind === 'capsule' ? Math.max(0, Math.min(SHAPE_LIMITS.MAX_EXTENT, desc.halfHeight)) : clampExtent(desc.halfHeight), radius: clampExtent(desc.radius) },
                position: finiteOr(desc.offset, [0, 0, 0]),
                rotation: [0, 0, 0, 1],
            };
        case 'hull': {
            const pts = sanitizePoints(desc.points);
            if (!pts)
                return null;
            return { shape: { kind: 'hull', points: pts }, position: finiteOr(desc.offset, [0, 0, 0]), rotation: [0, 0, 0, 1] };
        }
        case 'trimesh': {
            const mesh = sanitizeTrimesh(desc.positions, desc.indices);
            if (!mesh)
                return null;
            return { shape: { kind: 'trimesh', positions: mesh.positions, indices: mesh.indices }, position: [0, 0, 0], rotation: [0, 0, 0, 1] };
        }
        case 'heightfield': {
            const hf = sanitizeHeightfield(desc);
            if (!hf)
                return null;
            return { shape: hf, position: [0, 0, 0], rotation: [0, 0, 0, 1] };
        }
        default:
            return null;
    }
}
/** Validate packed xyz points (finite, ≥ 4 points), subsampling above the hull cap. */
export function sanitizePoints(points) {
    if (!(points instanceof Float32Array) || points.length < 12 || points.length % 3 !== 0)
        return null;
    const n = points.length / 3;
    const stride = Math.max(1, Math.ceil(n / SHAPE_LIMITS.MAX_HULL_POINTS));
    const out = new Float32Array(Math.ceil(n / stride) * 3);
    let w = 0;
    for (let i = 0; i < n; i += stride) {
        const x = points[i * 3];
        const y = points[i * 3 + 1];
        const z = points[i * 3 + 2];
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z))
            return null;
        out[w++] = x;
        out[w++] = y;
        out[w++] = z;
    }
    return w === out.length ? out : out.slice(0, w);
}
function sanitizeTrimesh(positions, indices) {
    if (!(positions instanceof Float32Array) || !(indices instanceof Uint32Array))
        return null;
    if (positions.length < 9 || positions.length % 3 !== 0 || indices.length < 3 || indices.length % 3 !== 0)
        return null;
    const nv = positions.length / 3;
    if (nv > SHAPE_LIMITS.MAX_TRIMESH_VERTICES || indices.length > SHAPE_LIMITS.MAX_TRIMESH_INDICES)
        return null;
    for (let i = 0; i < positions.length; i++)
        if (!Number.isFinite(positions[i]))
            return null;
    for (let i = 0; i < indices.length; i++)
        if (indices[i] >= nv)
            return null;
    return { positions, indices };
}
function sanitizeHeightfield(desc) {
    const { rows, cols, heights, size } = desc;
    if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 1 || cols < 1)
        return null;
    if (rows > SHAPE_LIMITS.MAX_HEIGHTFIELD_CELLS || cols > SHAPE_LIMITS.MAX_HEIGHTFIELD_CELLS)
        return null;
    if (!(heights instanceof Float32Array) || heights.length !== (rows + 1) * (cols + 1))
        return null;
    if (!isFiniteVec(size))
        return null;
    for (let i = 0; i < heights.length; i++)
        if (!Number.isFinite(heights[i]))
            return null;
    return { kind: 'heightfield', rows, cols, heights, scale: [clampExtent(size[0]), Math.max(1e-6, Math.abs(size[1])), clampExtent(size[2])] };
}
// ---------------------------------------------------------------------------
// Scaling
// ---------------------------------------------------------------------------
/** Sample points of a shape (in its own frame) used to build exact/approximate hulls. */
function shapePoints(shape) {
    const pts = [];
    switch (shape.kind) {
        case 'box': {
            const [hx, hy, hz] = shape.half;
            for (const sx of [-1, 1])
                for (const sy of [-1, 1])
                    for (const sz of [-1, 1])
                        pts.push(sx * hx, sy * hy, sz * hz);
            return pts;
        }
        case 'ball': {
            // Fibonacci sphere: evenly spread, deterministic.
            const golden = Math.PI * (3 - Math.sqrt(5));
            for (let i = 0; i < ELLIPSOID_SAMPLES; i++) {
                const y = 1 - (2 * (i + 0.5)) / ELLIPSOID_SAMPLES;
                const r = Math.sqrt(1 - y * y);
                const a = golden * i;
                pts.push(Math.cos(a) * r * shape.radius, y * shape.radius, Math.sin(a) * r * shape.radius);
            }
            return pts;
        }
        case 'capsule':
        case 'cylinder':
        case 'cone': {
            const seg = 16;
            const { radius: r, halfHeight: h } = shape;
            const ringYs = shape.kind === 'cone' ? [-h] : [-h, h];
            for (const y of ringYs)
                for (let k = 0; k < seg; k++) {
                    const a = (k / seg) * Math.PI * 2;
                    pts.push(Math.cos(a) * r, y, Math.sin(a) * r);
                }
            if (shape.kind === 'cone')
                pts.push(0, h, 0);
            if (shape.kind === 'capsule') {
                // Hemisphere caps approximated by two extra rings and poles.
                const c = Math.SQRT1_2;
                for (const sign of [-1, 1]) {
                    for (let k = 0; k < seg; k++) {
                        const a = (k / seg) * Math.PI * 2;
                        pts.push(Math.cos(a) * r * c, sign * (h + r * c), Math.sin(a) * r * c);
                    }
                    pts.push(0, sign * (h + r), 0);
                }
            }
            return pts;
        }
        case 'hull':
            return Array.from(shape.points);
        case 'trimesh':
            return Array.from(shape.positions);
        case 'heightfield':
            return [];
    }
}
function hullFrom(points, rot, pos, scale) {
    const out = new Float32Array(points.length);
    const tmp = [0, 0, 0];
    for (let i = 0; i < points.length; i += 3) {
        tmp[0] = points[i];
        tmp[1] = points[i + 1];
        tmp[2] = points[i + 2];
        rotate(rot, tmp, tmp);
        out[i] = (tmp[0] + pos[0]) * scale[0];
        out[i + 1] = (tmp[1] + pos[1]) * scale[1];
        out[i + 2] = (tmp[2] + pos[2]) * scale[2];
    }
    return { shape: { kind: 'hull', points: out }, position: [0, 0, 0], rotation: [0, 0, 0, 1] };
}
/**
 * Bake a (possibly non-uniform) scale into a collider expressed in a frame
 * that is about to be scaled: p' = S · (R · p + t).
 */
export function scaleCollider(c, scale) {
    const s = [Math.abs(scale[0]) || 1e-3, Math.abs(scale[1]) || 1e-3, Math.abs(scale[2]) || 1e-3];
    const position = [c.position[0] * s[0], c.position[1] * s[1], c.position[2] * s[2]];
    const uniform = isUniform(s);
    const u = s[0];
    const shape = c.shape;
    const axisAligned = isIdentityQuat(c.rotation);
    switch (shape.kind) {
        case 'box':
            if (uniform)
                return { shape: { kind: 'box', half: [shape.half[0] * u, shape.half[1] * u, shape.half[2] * u] }, position, rotation: c.rotation };
            if (axisAligned)
                return { shape: { kind: 'box', half: [shape.half[0] * s[0], shape.half[1] * s[1], shape.half[2] * s[2]] }, position, rotation: c.rotation };
            return hullFrom(shapePoints(shape), c.rotation, c.position, s);
        case 'ball':
            if (uniform)
                return { shape: { kind: 'ball', radius: shape.radius * u }, position, rotation: c.rotation };
            return hullFrom(shapePoints(shape), c.rotation, c.position, s);
        case 'capsule':
        case 'cylinder':
        case 'cone': {
            if (uniform)
                return { shape: { ...shape, halfHeight: shape.halfHeight * u, radius: shape.radius * u }, position, rotation: c.rotation };
            const sideways = Math.abs(s[0] - s[2]) / Math.max(s[0], s[2]) < 1e-4;
            if (axisAligned && sideways) {
                const r = shape.radius * s[0];
                if (shape.kind === 'capsule') {
                    const total = (shape.halfHeight + shape.radius) * s[1];
                    if (total >= r)
                        return { shape: { kind: 'capsule', halfHeight: total - r, radius: r }, position, rotation: c.rotation };
                }
                else {
                    return { shape: { kind: shape.kind, halfHeight: shape.halfHeight * s[1], radius: r }, position, rotation: c.rotation };
                }
            }
            return hullFrom(shapePoints(shape), c.rotation, c.position, s);
        }
        case 'hull':
            return hullFrom(shapePoints(shape), c.rotation, c.position, s);
        case 'trimesh': {
            const h = hullFrom(shapePoints(shape), c.rotation, c.position, s);
            const pts = h.shape.points;
            return { shape: { kind: 'trimesh', positions: pts, indices: shape.indices }, position: [0, 0, 0], rotation: [0, 0, 0, 1] };
        }
        case 'heightfield':
            // Heightfields are axis-aligned grids; rotation is kept, scale applied per axis.
            return {
                shape: { ...shape, scale: [shape.scale[0] * s[0], shape.scale[1] * s[1], shape.scale[2] * s[2]] },
                position,
                rotation: c.rotation,
            };
    }
}
/** Place a collider into a parent frame: p' = R · p + t (rigid, no scale). */
export function placeCollider(c, position, rotation) {
    if (isIdentityQuat(rotation) && position[0] === 0 && position[1] === 0 && position[2] === 0)
        return c;
    const p = rotate(rotation, c.position);
    return {
        shape: c.shape,
        position: [p[0] + position[0], p[1] + position[1], p[2] + position[2]],
        rotation: quatMul(rotation, c.rotation),
    };
}
/** Axis-aligned bounds (local frame) of a list of colliders; `null` when empty. */
export function collidersBounds(list) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    const tmp = [0, 0, 0];
    const grow = (x, y, z, c) => {
        tmp[0] = x;
        tmp[1] = y;
        tmp[2] = z;
        rotate(c.rotation, tmp, tmp);
        for (let k = 0; k < 3; k++) {
            const v = tmp[k] + c.position[k];
            if (v < min[k])
                min[k] = v;
            if (v > max[k])
                max[k] = v;
        }
    };
    for (const c of list) {
        if (c.shape.kind === 'heightfield') {
            const [sx, sy, sz] = c.shape.scale;
            for (const x of [-sx / 2, sx / 2])
                for (const y of [0, sy])
                    for (const z of [-sz / 2, sz / 2])
                        grow(x, y, z, c);
            continue;
        }
        const pts = c.shape.kind === 'ball'
            ? [-1, -1, -1, 1, 1, 1].map((v) => v * c.shape.radius)
            : shapePoints(c.shape);
        if (c.shape.kind === 'ball') {
            for (const x of [pts[0], pts[3]])
                for (const y of [pts[1], pts[4]])
                    for (const z of [pts[2], pts[5]])
                        grow(x, y, z, c);
        }
        else {
            for (let i = 0; i < pts.length; i += 3)
                grow(pts[i], pts[i + 1], pts[i + 2], c);
        }
    }
    if (!Number.isFinite(min[0]))
        return null;
    return { min, max };
}
