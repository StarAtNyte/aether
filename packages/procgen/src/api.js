/**
 * The GeneratorApi implementation shared by built-in generators and
 * LLM-written (sandboxed) generators.
 *
 * - add() appends geometry into one accumulator per distinct material
 *   (stableStringify key), so equal materials become one draw call.
 * - build() normalizes the object so its base sits on y = 0 and it is
 *   centered in x/z (skipped for heightfield-based terrain or on request).
 * - All allocations are charged to a vertex budget; all inputs are validated.
 */
import { rng as seededRng, stableStringify } from '@aether/core';
import { mixHex, requireColor } from './color';
import { boxCollider, hullSupportPoints, parseCollider, translateCollider } from './colliders';
import { PROCGEN_LIMITS } from './limits';
import { sanitizeMaterial } from './material';
import { Noise } from './noise';
import { finite, Mesh, MeshBuilder, VertexBudget, computeBounds } from './kernel/mesh';
import { mat3AlignY } from './kernel/math3';
import * as prim from './kernel/primitives';
const BRAND = Symbol('aether.procgen.api');
/** True when `api` was created by {@link createGeneratorApi}. */
export function isInternalApi(api) {
    return typeof api === 'object' && api !== null && api[BRAND] === true;
}
/** Growable per-material vertex accumulator. */
class PartAccumulator {
    material;
    positions = new Float32Array(3 * 256);
    normals = new Float32Array(3 * 256);
    uvs = new Float32Array(2 * 256);
    colors;
    /** Terrain layer weights (4 per vertex), only for materials with `splat: true`. */
    splat;
    indices = new Uint32Array(3 * 256);
    vcount = 0;
    icount = 0;
    constructor(material) {
        this.material = material;
        this.colors = material.vertexColors === true ? new Float32Array(3 * 256) : null;
        this.splat = material.splat === true ? new Float32Array(4 * 256) : null;
    }
    append(mesh) {
        const nv = mesh.vertexCount;
        const ni = mesh.indices.length;
        this.reserve(this.vcount + nv, this.icount + ni);
        const base = this.vcount;
        this.positions.set(mesh.positions, base * 3);
        this.normals.set(mesh.normals, base * 3);
        this.uvs.set(mesh.uvs, base * 2);
        if (this.colors) {
            if (mesh.colors)
                this.colors.set(mesh.colors, base * 3);
            else
                this.colors.fill(1, base * 3, (base + nv) * 3);
        }
        if (this.splat) {
            if (mesh.splat && mesh.splat.length === nv * 4)
                this.splat.set(mesh.splat, base * 4);
            else {
                // No weights: plain grass.
                for (let i = 0; i < nv; i++)
                    this.splat[(base + i) * 4] = 1;
            }
        }
        const src = mesh.indices;
        const dst = this.indices;
        for (let i = 0; i < ni; i++)
            dst[this.icount + i] = src[i] + base;
        this.vcount += nv;
        this.icount += ni;
        return { start: base, end: base + nv };
    }
    reserve(nv, ni) {
        if (nv * 3 > this.positions.length) {
            let cap = this.positions.length / 3;
            while (cap < nv)
                cap *= 2;
            this.positions = resize(this.positions, cap * 3);
            this.normals = resize(this.normals, cap * 3);
            this.uvs = resize(this.uvs, cap * 2);
            if (this.colors)
                this.colors = resize(this.colors, cap * 3);
            if (this.splat)
                this.splat = resize(this.splat, cap * 4);
        }
        if (ni > this.indices.length) {
            let cap = this.indices.length;
            while (cap < ni)
                cap *= 2;
            const next = new Uint32Array(cap);
            next.set(this.indices);
            this.indices = next;
        }
    }
}
function resize(a, len) {
    const out = new Float32Array(len);
    out.set(a);
    return out;
}
function now() {
    return typeof performance !== 'undefined' ? performance.now() : 0;
}
function asMesh(m, what) {
    if (!(m instanceof Mesh))
        throw new TypeError(`${what}: expected a mesh created by the api (e.g. api.box(1, 1, 1))`);
    return m;
}
/**
 * Create a fresh generator API bound to `seed`. All randomness (rng, noise)
 * derives from the seed, so the same generator + params + seed always yields
 * identical geometry.
 */
export function createGeneratorApi(seed, opts = {}) {
    const started = now();
    const s = Number.isFinite(seed) ? Math.trunc(seed) : 0;
    const random = seededRng(s);
    const noise = new Noise(seededRng(s ^ 0x5bd1e995));
    const budget = new VertexBudget(opts.maxVertices ?? PROCGEN_LIMITS.MAX_ALLOCATED_VERTICES);
    const parts = new Map();
    const pieces = [];
    const colliders = [];
    let autoMode = null;
    let totalVertices = 0;
    const deriveColliders = (mode) => {
        const scored = pieces.map((p) => {
            const b = computeBounds(p.part.positions, p.start, p.end);
            const vol = Math.max(1e-6, b.max[0] - b.min[0]) * Math.max(1e-6, b.max[1] - b.min[1]) * Math.max(1e-6, b.max[2] - b.min[2]);
            return { p, b, vol };
        });
        scored.sort((a, b) => b.vol - a.vol);
        const out = [];
        for (const { p, b } of scored.slice(0, 32)) {
            if (mode === 'hull') {
                const pts = hullSupportPoints(p.part.positions, p.start, p.end);
                if (pts.length >= 12) {
                    out.push({ kind: 'hull', points: pts, offset: [0, 0, 0] });
                    continue;
                }
            }
            out.push(boxCollider((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2, Math.max(0.02, b.max[0] - b.min[0]), Math.max(0.02, b.max[1] - b.min[1]), Math.max(0.02, b.max[2] - b.min[2])));
        }
        return out;
    };
    const api = {
        [BRAND]: true,
        rng: random,
        seed: s,
        noise,
        noise2: (x, y) => noise.noise2(finite(x, 'noise2(x)'), finite(y, 'noise2(y)')),
        noise3: (x, y, z) => noise.noise3(finite(x, 'noise3(x)'), finite(y, 'noise3(y)'), finite(z, 'noise3(z)')),
        fbm2: (x, y, octaves) => noise.fbm2(finite(x, 'fbm2(x)'), finite(y, 'fbm2(y)'), octaves === undefined ? 4 : finite(octaves, 'fbm2(octaves)')),
        range: (min, max) => min + (max - min) * random(),
        box: (w, h, d) => prim.box(budget, w, h, d),
        sphere: (r, detail) => prim.sphere(budget, r, detail),
        cylinder: (rTop, rBottom, h, segs) => prim.cylinder(budget, rTop, rBottom, h, segs),
        cone: (r, h, segs) => prim.cone(budget, r, h, segs),
        torus: (r, tube, rs, ts) => prim.torus(budget, r, tube, rs, ts),
        capsule: (r, h) => prim.capsule(budget, r, h),
        plane: (w, d, sx, sz) => prim.plane(budget, w, d, sx, sz),
        lathe: (profile, segs) => prim.lathe(budget, profile, segs),
        extrude: (shape, depth) => prim.extrude(budget, shape, depth),
        tube: (path, radius, rs, radiusAt) => prim.tube(budget, path, radius, rs, radiusAt),
        heightfield: (cols, rows, width, depth, height) => prim.heightfield(budget, cols, rows, width, depth, height),
        icosphereRock: (r, roughness, detail) => prim.icosphereRock(budget, noise, random, r, roughness, detail ?? 2),
        grid: (cols, rows, width, depth, heights) => {
            const c = prim.segments(cols, 1, 1, prim.KERNEL_LIMITS.MAX_GRID);
            const r = prim.segments(rows, 1, 1, prim.KERNEL_LIMITS.MAX_GRID);
            if (!(heights instanceof Float64Array) || heights.length !== (c + 1) * (r + 1)) {
                throw new RangeError('grid: heights must be a Float64Array of (cols + 1) * (rows + 1) samples');
            }
            return prim.gridMesh(budget, c, r, prim.dim(width, 'grid(width)'), prim.dim(depth, 'grid(depth)'), heights);
        },
        icosphere: (r, detail) => prim.icosphere(budget, r, detail ?? 1),
        limb: (from, to, r0, r1, segs) => {
            const fx = finite(from[0], 'limb(from)'), fy = finite(from[1], 'limb(from)'), fz = finite(from[2], 'limb(from)');
            const dx = finite(to[0], 'limb(to)') - fx;
            const dy = finite(to[1], 'limb(to)') - fy;
            const dz = finite(to[2], 'limb(to)') - fz;
            const len = Math.max(1e-4, Math.hypot(dx, dy, dz));
            const m = prim.cylinder(budget, r1, r0, len, segs ?? 8);
            m.translate(0, len / 2, 0);
            return m.applyMatrix(mat3AlignY(dx, dy, dz), fx, fy, fz);
        },
        fromBuilder: (b) => {
            if (!(b instanceof MeshBuilder))
                throw new TypeError('fromBuilder: expected a MeshBuilder');
            return b.build(budget);
        },
        add(mesh, material) {
            const m = asMesh(mesh, 'add(mesh, material)');
            if (m.vertexCount === 0)
                return;
            const mat = sanitizeMaterial(material);
            if (m.colors && mat.vertexColors === undefined)
                mat.vertexColors = true;
            const key = stableStringify(mat);
            let part = parts.get(key);
            if (!part) {
                if (parts.size >= PROCGEN_LIMITS.MAX_PARTS) {
                    throw new RangeError(`add: at most ${PROCGEN_LIMITS.MAX_PARTS} distinct materials per object; reuse materials`);
                }
                part = new PartAccumulator(mat);
                parts.set(key, part);
            }
            totalVertices += m.vertexCount;
            if (totalVertices > PROCGEN_LIMITS.MAX_OUTPUT_VERTICES) {
                throw new RangeError(`add: output exceeds ${PROCGEN_LIMITS.MAX_OUTPUT_VERTICES} vertices`);
            }
            const { start, end } = part.append(m);
            pieces.push({ part, start, end });
        },
        collider(desc) {
            if (colliders.length >= PROCGEN_LIMITS.MAX_COLLIDERS)
                throw new RangeError(`collider: at most ${PROCGEN_LIMITS.MAX_COLLIDERS} colliders`);
            colliders.push(parseCollider(desc));
        },
        autoColliders(mode) {
            if (mode !== undefined && mode !== 'box' && mode !== 'hull')
                throw new TypeError('autoColliders(mode): mode must be "box" or "hull"');
            autoMode = mode ?? 'box';
        },
        color: (hex) => requireColor(hex, 'color(hex)'),
        mix: (a, b, t) => mixHex(a, b, finite(t, 'mix(t)')),
        build(opts = {}) {
            const all = [...colliders];
            if (autoMode !== null || (all.length === 0 && pieces.length > 0))
                all.push(...deriveColliders(autoMode ?? 'box'));
            const accs = [...parts.values()].filter((p) => p.vcount > 0);
            let bounds = null;
            for (const p of accs) {
                const b = computeBounds(p.positions, 0, p.vcount);
                if (!bounds)
                    bounds = b;
                else {
                    for (let k = 0; k < 3; k++) {
                        bounds.min[k] = Math.min(bounds.min[k], b.min[k]);
                        bounds.max[k] = Math.max(bounds.max[k], b.max[k]);
                    }
                }
            }
            const finalBounds = bounds ?? { min: [0, 0, 0], max: [0, 0, 0] };
            const recenter = opts.recenter ?? !all.some((c) => c.kind === 'heightfield');
            const dx = recenter ? -(finalBounds.min[0] + finalBounds.max[0]) / 2 : 0;
            const dy = recenter ? -finalBounds.min[1] : 0;
            const dz = recenter ? -(finalBounds.min[2] + finalBounds.max[2]) / 2 : 0;
            let triangles = 0;
            const outParts = accs.map((p) => {
                const positions = p.positions.slice(0, p.vcount * 3);
                if (dx !== 0 || dy !== 0 || dz !== 0) {
                    for (let i = 0; i < positions.length; i += 3) {
                        positions[i] = positions[i] + dx;
                        positions[i + 1] = positions[i + 1] + dy;
                        positions[i + 2] = positions[i + 2] + dz;
                    }
                }
                triangles += p.icount / 3;
                const part = {
                    positions,
                    normals: p.normals.slice(0, p.vcount * 3),
                    indices: p.indices.slice(0, p.icount),
                    uvs: p.uvs.slice(0, p.vcount * 2),
                    material: { ...p.material },
                };
                if (p.colors)
                    part.colors = p.colors.slice(0, p.vcount * 3);
                if (p.splat)
                    part.splat = p.splat.slice(0, p.vcount * 4);
                return part;
            });
            const outColliders = all.slice(0, PROCGEN_LIMITS.MAX_COLLIDERS).map((c) => translateCollider(c, dx, dy, dz));
            return {
                parts: outParts,
                colliders: outColliders,
                bounds: {
                    min: [finalBounds.min[0] + dx, finalBounds.min[1] + dy, finalBounds.min[2] + dz],
                    max: [finalBounds.max[0] + dx, finalBounds.max[1] + dy, finalBounds.max[2] + dz],
                },
                stats: { triangles, ms: Math.max(0, now() - started) },
            };
        },
    };
    return api;
}
