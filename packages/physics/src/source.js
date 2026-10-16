import { decodeMeshCached, meshBounds, stableStringify } from '@aether/core';
import { DEFAULT_SEED, generateBuiltinSync, getBuiltinGenerator, meshColliders, outputBytes, primitiveOutput } from '@aether/procgen';
import { collidersBounds, fromColliderDesc, sanitizePoints, SHAPE_LIMITS } from './shapes';
import { assetColliderDescs, assetGeneratorShape } from './asset-colliders';
const TORUS_SEGMENTS = 12;
const PLANE_HALF_THICKNESS = 0.01;
const MAX_CACHE_ENTRIES = 64;
/** Byte budget of each output cache (typed arrays of the cached outputs). */
export const MAX_COLLIDER_CACHE_BYTES = 32 * 1024 * 1024;
/** Colliders accepted from one provider/generator result (untrusted input cap). */
export const MAX_COLLIDERS_PER_SHAPE = 2048;
/** Small LRU of generator outputs keyed by generator + params + seed, bounded by count and bytes. */
class OutputCache {
    map = new Map();
    bytes = 0;
    get(key) {
        const hit = this.map.get(key);
        if (hit !== undefined) {
            this.map.delete(key);
            this.map.set(key, hit);
        }
        return hit?.out;
    }
    set(key, value) {
        this.drop(key);
        const bytes = value ? outputBytes(value) : 0;
        if (bytes > MAX_COLLIDER_CACHE_BYTES)
            return;
        this.map.set(key, { out: value, bytes });
        this.bytes += bytes;
        while (this.map.size > MAX_CACHE_ENTRIES || this.bytes > MAX_COLLIDER_CACHE_BYTES) {
            const oldest = this.map.keys().next();
            if (oldest.done)
                break;
            this.drop(oldest.value);
        }
    }
    drop(key) {
        const old = this.map.get(key);
        if (!old)
            return;
        this.map.delete(key);
        this.bytes -= old.bytes;
    }
    get size() {
        return this.map.size;
    }
    get heldBytes() {
        return this.bytes;
    }
    clear() {
        this.map.clear();
        this.bytes = 0;
    }
}
const builtinCache = new OutputCache();
const primitiveCache = new OutputCache();
/** Entries and bytes held by the collider output caches (diagnostics, memory budgets). */
export function colliderCacheStats() {
    return { entries: builtinCache.size + primitiveCache.size, bytes: builtinCache.heldBytes + primitiveCache.heldBytes };
}
/** Drop cached generator outputs (tests, memory pressure). */
export function clearColliderCache() {
    builtinCache.clear();
    primitiveCache.clear();
}
/**
 * Run a built-in generator synchronously (cached per generator + params +
 * seed). Returns `null` for unknown/custom generators or generator failures.
 */
export function builtinOutput(shape) {
    const seed = shape.seed ?? DEFAULT_SEED;
    const params = shape.params ?? {};
    const key = `${shape.generator}|${seed}|${stableStringify(params)}`;
    const hit = builtinCache.get(key);
    if (hit !== undefined)
        return hit;
    let out = null;
    if (getBuiltinGenerator(shape.generator)) {
        try {
            out = generateBuiltinSync(shape.generator, params, seed);
        }
        catch {
            out = null;
        }
    }
    out = out ? colliderView(out) : null;
    builtinCache.set(key, out);
    return out;
}
/** Points kept from a mesh too big for a trimesh collider (hulls only need a spread sample). */
const COLLIDER_SAMPLE_POINTS = 16_384;
/**
 * Physics never needs the triangles of a mesh above the trimesh limit (a
 * trimesh is refused, hulls subsample anyway), so such outputs are cached
 * as a light view: their colliders, bounds and a strided point sample. A
 * 400k-triangle sculpture then costs ~200 KB of cache instead of ~15 MB,
 * and the cache stops thrashing in worlds with several of them.
 */
export function colliderView(out) {
    let nv = 0;
    for (const p of out.parts)
        nv += p.positions.length / 3;
    if (nv <= SHAPE_LIMITS.MAX_TRIMESH_VERTICES)
        return out;
    const stride = Math.max(1, Math.ceil(nv / COLLIDER_SAMPLE_POINTS));
    const sample = new Float32Array(Math.ceil(nv / stride) * 3);
    let w = 0;
    let k = 0;
    for (const p of out.parts) {
        for (let i = 0; i + 2 < p.positions.length; i += 3, k++) {
            if (k % stride !== 0 || w + 3 > sample.length)
                continue;
            sample[w++] = p.positions[i];
            sample[w++] = p.positions[i + 1];
            sample[w++] = p.positions[i + 2];
        }
    }
    const positions = sample.slice(0, w);
    const material = out.parts[0]?.material ?? {};
    return { ...out, parts: [{ positions, normals: new Float32Array(positions.length), indices: new Uint32Array(0), material }] };
}
function primitiveGeometry(shape) {
    const key = stableStringify(shape);
    const hit = primitiveCache.get(key);
    if (hit !== undefined)
        return hit;
    let out;
    try {
        out = primitiveOutput(shape);
    }
    catch {
        out = null;
    }
    primitiveCache.set(key, out);
    return out;
}
function at(shape, position = [0, 0, 0], rotation = [0, 0, 0, 1]) {
    return { shape, position, rotation };
}
function dims(shape) {
    const s = shape.size;
    const d = (v) => (Number.isFinite(v) && v > 0 ? Math.min(v, SHAPE_LIMITS.MAX_EXTENT) : 1);
    return [d(s[0]), d(s[1]), d(s[2])];
}
/** Exact colliders for a primitive (size semantics from schema.ts, centered on origin). */
export function primitiveColliders(shape) {
    const [sx, sy, sz] = dims(shape);
    switch (shape.primitive) {
        case 'box':
            return [at({ kind: 'box', half: [sx / 2, sy / 2, sz / 2] })];
        case 'sphere':
            return [at({ kind: 'ball', radius: sx / 2 })];
        case 'cylinder':
            return [at({ kind: 'cylinder', halfHeight: sy / 2, radius: sx / 2 })];
        case 'cone':
            return [at({ kind: 'cone', halfHeight: sy / 2, radius: sx / 2 })];
        case 'capsule': {
            const r = sx / 2;
            const h = Math.max(sy, 2 * r);
            return [at({ kind: 'capsule', halfHeight: Math.max(0, h / 2 - r), radius: r })];
        }
        case 'plane':
            return [at({ kind: 'box', half: [sx / 2, PLANE_HALF_THICKNESS, sz / 2] })];
        case 'torus': {
            // Ring in the XY plane (as rendered): a loop of convex box segments keeps the hole open.
            const tube = Math.min(sy / 2, sx / 4);
            const ringR = Math.max(tube * 0.25, sx / 2 - tube);
            const segLen = 2 * ringR * Math.sin(Math.PI / TORUS_SEGMENTS) + tube;
            const out = [];
            for (let k = 0; k < TORUS_SEGMENTS; k++) {
                const a = ((k + 0.5) / TORUS_SEGMENTS) * Math.PI * 2;
                const half = a / 2;
                out.push(at({ kind: 'box', half: [tube, segLen / 2, tube] }, [Math.cos(a) * ringR, Math.sin(a) * ringR, 0], [0, 0, Math.sin(half), Math.cos(half)]));
            }
            return out;
        }
    }
}
function boundsOfPrimitive(shape) {
    const [sx, sy, sz] = dims(shape);
    if (shape.primitive === 'plane')
        return { min: [-sx / 2, -PLANE_HALF_THICKNESS, -sz / 2], max: [sx / 2, PLANE_HALF_THICKNESS, sz / 2] };
    if (shape.primitive === 'sphere')
        return { min: [-sx / 2, -sx / 2, -sx / 2], max: [sx / 2, sx / 2, sx / 2] };
    if (shape.primitive === 'torus')
        return { min: [-sx / 2, -sx / 2, -sy / 2], max: [sx / 2, sx / 2, sy / 2] };
    if (shape.primitive === 'box')
        return { min: [-sx / 2, -sy / 2, -sz / 2], max: [sx / 2, sy / 2, sz / 2] };
    const h = shape.primitive === 'capsule' ? Math.max(sy, sx) : sy;
    return { min: [-sx / 2, -h / 2, -sx / 2], max: [sx / 2, h / 2, sx / 2] };
}
function fromDescs(descs, warnings, label) {
    const out = [];
    let bad = 0;
    if (descs.length > MAX_COLLIDERS_PER_SHAPE)
        warnings.push(`${label}: only the first ${MAX_COLLIDERS_PER_SHAPE} of ${descs.length} colliders are used`);
    for (const d of descs.slice(0, MAX_COLLIDERS_PER_SHAPE)) {
        const c = fromColliderDesc(d);
        if (c)
            out.push(c);
        else
            bad++;
    }
    if (bad > 0)
        warnings.push(`${label}: ignored ${bad} malformed collider(s)`);
    return out;
}
function unitBox() {
    return { min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] };
}
function modelBounds(fitSize) {
    const s = fitSize && Number.isFinite(fitSize) ? Math.min(fitSize, SHAPE_LIMITS.MAX_EXTENT) : 1;
    return { min: [-s / 2, 0, -s / 2], max: [s / 2, s, s / 2] };
}
function finiteBounds(b) {
    return !!b && b.min.every(Number.isFinite) && b.max.every(Number.isFinite) && b.max[0] >= b.min[0] && b.max[1] >= b.min[1] && b.max[2] >= b.min[2];
}
function boxFromBounds(b) {
    const half = [
        Math.max(SHAPE_LIMITS.MIN_EXTENT, (b.max[0] - b.min[0]) / 2),
        Math.max(SHAPE_LIMITS.MIN_EXTENT, (b.max[1] - b.min[1]) / 2),
        Math.max(SHAPE_LIMITS.MIN_EXTENT, (b.max[2] - b.min[2]) / 2),
    ];
    return at({ kind: 'box', half }, [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2]);
}
/**
 * Editable mesh colliders from the document: an exact triangle mesh for
 * static/kinematic bodies, a convex hull for dynamic ones (always derived
 * from the current mesh data, so edits keep colliders in sync).
 */
function meshGeometry(entity, meshId, world, warnings) {
    const asset = world?.meshes && Object.hasOwn(world.meshes, meshId) ? world.meshes[meshId] : undefined;
    if (!asset) {
        warnings.push(`${entity.id}: mesh '${meshId.slice(0, 64)}' is missing; using a 1m box placeholder`);
        const b = unitBox();
        return { bounds: b, output: null, colliders: [boxFromBounds(b)] };
    }
    try {
        const data = decodeMeshCached(asset);
        const bounds = meshBounds(data.positions);
        const output = {
            parts: [{ positions: data.positions, normals: new Float32Array(0), indices: data.indices, material: {} }],
            colliders: [],
            bounds,
            stats: { triangles: data.indices.length / 3, ms: 0 },
        };
        const descs = meshColliders(data, entity.physics?.body ?? 'static');
        return { bounds, output, colliders: fromDescs(descs, warnings, entity.id) };
    }
    catch (err) {
        warnings.push(`${entity.id}: mesh data is invalid (${err instanceof Error ? err.message.slice(0, 120) : 'error'}); using a 1m box`);
        const b = unitBox();
        return { bounds: b, output: null, colliders: [boxFromBounds(b)] };
    }
}
/** Colliders that the shape itself defines ('auto' mode), or null when unknown. */
function autoColliders(entity, world, provider, warnings) {
    const shape = entity.shape;
    const label = entity.id;
    switch (shape.kind) {
        case 'primitive':
            return { bounds: boundsOfPrimitive(shape), output: null, colliders: primitiveColliders(shape) };
        case 'mesh':
            return meshGeometry(entity, shape.mesh, world, warnings);
        case 'procedural':
        case 'model': {
            const provided = safeProvide(provider, entity, warnings);
            if (provided && provided.length > 0) {
                const colliders = fromDescs(provided, warnings, label);
                const bounds = collidersBounds(colliders);
                if (colliders.length > 0 && bounds)
                    return { bounds, output: null, colliders };
            }
            if (shape.kind === 'model') {
                warnings.push(`${label}: model colliders unknown; using a ${shape.fitSize ?? 1}m box (pass a ColliderProvider for exact shapes)`);
                const b = modelBounds(shape.fitSize);
                return { bounds: b, output: null, colliders: [boxFromBounds(b)] };
            }
            const isCustom = !!world && Object.hasOwn(world.generators ?? {}, shape.generator);
            const out = isCustom ? null : builtinOutput(shape);
            if (out && finiteBounds(out.bounds)) {
                const colliders = fromDescs(out.colliders, warnings, label);
                return { bounds: out.bounds, output: out, colliders: colliders.length > 0 ? colliders : [boxFromBounds(out.bounds)] };
            }
            warnings.push(`${label}: no colliders for generator "${shape.generator.slice(0, 64)}"; using a 1m box placeholder`);
            const b = unitBox();
            return { bounds: b, output: null, colliders: [boxFromBounds(b)] };
        }
        case 'asset': {
            const provided = safeProvide(provider, entity, warnings);
            const descs = provided && provided.length > 0 ? provided : assetColliderDescs(shape);
            if (descs) {
                const colliders = fromDescs(descs, warnings, label);
                const bounds = collidersBounds(colliders);
                if (colliders.length > 0 && bounds)
                    return { bounds, output: null, colliders };
            }
            // Fallback chain: a generator asset, then the shape's own fallback, then a placeholder box.
            const generated = assetGeneratorShape(shape) ?? shape.fallback;
            if (generated)
                return autoColliders({ ...entity, shape: generated }, world, provider, warnings);
            warnings.push(`${label}: asset "${shape.id.slice(0, 64)}" is unknown here; using a ${shape.fitSize ?? 1}m box placeholder`);
            const b = modelBounds(shape.fitSize);
            return { bounds: b, output: null, colliders: [boxFromBounds(b)] };
        }
        default:
            return { bounds: unitBox(), output: null, colliders: null };
    }
}
function safeProvide(provider, entity, warnings) {
    if (!provider)
        return undefined;
    try {
        const r = provider(entity);
        return Array.isArray(r) ? r : undefined;
    }
    catch (err) {
        warnings.push(`${entity.id}: collider provider failed (${err instanceof Error ? err.message.slice(0, 120) : 'error'})`);
        return undefined;
    }
}
/** Gather vertex positions of a generator output (subsampled for hulls). */
function outputPoints(out) {
    if (!out)
        return null;
    let total = 0;
    for (const p of out.parts)
        total += p.positions.length;
    if (total < 12)
        return null;
    const merged = new Float32Array(total);
    let o = 0;
    for (const p of out.parts) {
        merged.set(p.positions, o);
        o += p.positions.length;
    }
    return sanitizePoints(merged);
}
function outputTrimesh(out) {
    if (!out)
        return null;
    let nv = 0;
    let ni = 0;
    for (const p of out.parts) {
        nv += p.positions.length / 3;
        ni += p.indices.length;
    }
    if (nv < 3 || ni < 3 || nv > SHAPE_LIMITS.MAX_TRIMESH_VERTICES || ni > SHAPE_LIMITS.MAX_TRIMESH_INDICES)
        return null;
    const positions = new Float32Array(nv * 3);
    const indices = new Uint32Array(ni);
    let vo = 0;
    let io = 0;
    for (const p of out.parts) {
        positions.set(p.positions, vo * 3);
        for (let i = 0; i < p.indices.length; i++)
            indices[io + i] = p.indices[i] + vo;
        vo += p.positions.length / 3;
        io += p.indices.length;
    }
    return { positions, indices };
}
/**
 * Resolve the colliders of `entity` in its unscaled local frame.
 * `mode` is the physics collider kind (never 'none').
 */
export function resolveShapeColliders(entity, mode, world, provider) {
    const warnings = [];
    if (entity.shape.kind === 'none' || entity.shape.kind === 'scatter') {
        // Bodies without geometry get a small box so they still have mass and can be hit.
        return { colliders: mode === 'auto' && entity.shape.kind === 'none' ? [] : [boxFromBounds({ min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] })], warnings };
    }
    const geo = autoColliders(entity, world, provider, warnings);
    if (mode === 'auto')
        return { colliders: geo.colliders ?? [boxFromBounds(geo.bounds)], warnings };
    const b = geo.bounds;
    const center = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
    const hx = Math.max(SHAPE_LIMITS.MIN_EXTENT, (b.max[0] - b.min[0]) / 2);
    const hy = Math.max(SHAPE_LIMITS.MIN_EXTENT, (b.max[1] - b.min[1]) / 2);
    const hz = Math.max(SHAPE_LIMITS.MIN_EXTENT, (b.max[2] - b.min[2]) / 2);
    const geometry = () => {
        if (geo.output)
            return geo.output;
        if (entity.shape.kind === 'primitive')
            return primitiveGeometry(entity.shape);
        return null;
    };
    switch (mode) {
        case 'box':
            return { colliders: [boxFromBounds(b)], warnings };
        case 'sphere':
            return { colliders: [at({ kind: 'ball', radius: Math.max(hx, hy, hz) }, center)], warnings };
        case 'capsule': {
            const r = Math.max(hx, hz);
            return { colliders: [at({ kind: 'capsule', halfHeight: Math.max(0, hy - r), radius: r }, center)], warnings };
        }
        case 'cylinder':
            return { colliders: [at({ kind: 'cylinder', halfHeight: hy, radius: Math.max(hx, hz) }, center)], warnings };
        case 'hull': {
            const pts = outputPoints(geometry());
            if (pts)
                return { colliders: [at({ kind: 'hull', points: pts })], warnings };
            const fromColliders = geo.colliders ? hullOfColliders(geo.colliders) : null;
            if (fromColliders)
                return { colliders: [fromColliders], warnings };
            warnings.push(`${entity.id}: no geometry for a hull; using a bounds box`);
            return { colliders: [boxFromBounds(b)], warnings };
        }
        case 'trimesh': {
            const mesh = outputTrimesh(geometry());
            if (mesh)
                return { colliders: [at({ kind: 'trimesh', positions: mesh.positions, indices: mesh.indices })], warnings };
            warnings.push(`${entity.id}: no triangle geometry for a trimesh (or too large); using the auto colliders`);
            return { colliders: geo.colliders ?? [boxFromBounds(b)], warnings };
        }
        case 'heightfield': {
            const hf = geo.colliders?.filter((c) => c.shape.kind === 'heightfield') ?? [];
            if (hf.length > 0)
                return { colliders: hf, warnings };
            warnings.push(`${entity.id}: shape has no heightfield; using a bounds box`);
            return { colliders: [boxFromBounds(b)], warnings };
        }
    }
}
/** Convex hull over the corner points of a set of colliders. */
function hullOfColliders(list) {
    const b = collidersBounds(list);
    if (!b)
        return null;
    const pts = [];
    for (const x of [b.min[0], b.max[0]])
        for (const y of [b.min[1], b.max[1]])
            for (const z of [b.min[2], b.max[2]])
                pts.push(x, y, z);
    return at({ kind: 'hull', points: new Float32Array(pts) });
}
