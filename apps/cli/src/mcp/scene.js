/**
 * World IR -> world-space triangle meshes, headless. Uses the same procgen
 * kernel as the renderer and physics, so a still or a glTF file shows the
 * geometry the browser draws (primitives, built-in and custom generators,
 * buildings, scatter fields). Model, library-asset and sculpted-mesh shapes
 * need files this server does not read; they are listed in `skipped`.
 */
import { worldTransform } from '@aether/core';
import { scatterInstances } from '@aether/physics';
import { fallbackOutput, generate, GeneratorCache, primitiveOutput } from '@aether/procgen';
const PRESET_COLOR = {
    plastic: '#c9ced6', wood: '#9a6b3f', stone: '#8d8f94', brick: '#a4553f', concrete: '#a3a4a6', metal: '#aeb4bb', gold: '#e0b13c', glass: '#bfe3f0',
    water: '#3a7fb5', ice: '#bfe6f2', grass: '#5f9a46', dirt: '#7b5a3c', sand: '#d9c58f', snow: '#f3f6f8', lava: '#ff5a1f', neon: '#46f0d0', rubber: '#2a2a2d',
    fabric: '#a08c78', leaf: '#4d8a3a', bark: '#5c4330', crystal: '#9d7bf0', emissive: '#fff3c4',
};
const FINISH_COLOR = {
    oak: '#b98b56', walnut: '#6b4a32', ash: '#d3b88a', herringbone: '#b98b56', marble: '#e9e8e4', terrazzo: '#cfc9c0', concrete: '#a3a4a6', plaster: '#ece7de', paint: '#e8e8e8',
    tile: '#d8d8d6', 'subway-tile': '#f0f0ee', stone: '#8d8f94', brick: '#a4553f', fabric: '#a08c78', velvet: '#5a3a6a', leather: '#6d4630', carpet: '#8c8c90', 'brushed-metal': '#b5b9bd',
    chrome: '#d9dde0', brass: '#c9a24b', 'black-metal': '#26272a', glass: '#bfe3f0', 'frosted-glass': '#dfeef3', ceramic: '#f2f2f0', mirror: '#d7e4ea', 'roof-tile': '#9b4a37',
    'metal-roof': '#7d848b', decking: '#a77c52', grass: '#5f9a46', gravel: '#9b9a96', water: '#3a7fb5',
};
/** Parse `#rrggbb` to sRGB 0..1 (grey when invalid). */
export function hexToRgb(hex, fallback = [0.72, 0.72, 0.74]) {
    if (typeof hex !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(hex))
        return fallback;
    return [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255];
}
/** Flat colour of a material (explicit colour, then finish, then preset). */
export function materialColor(m, fallback = [0.72, 0.72, 0.74]) {
    if (!m)
        return fallback;
    if (m.color)
        return hexToRgb(m.color, fallback);
    if (m.finish && FINISH_COLOR[m.finish])
        return hexToRgb(FINISH_COLOR[m.finish], fallback);
    if (m.preset && PRESET_COLOR[m.preset])
        return hexToRgb(PRESET_COLOR[m.preset], fallback);
    return fallback;
}
function rotate(q, x, y, z, out) {
    const qx = q[0];
    const qy = q[1];
    const qz = q[2];
    const qw = q[3];
    // t = 2 * cross(q.xyz, v); v' = v + w*t + cross(q.xyz, t)
    const tx = 2 * (qy * z - qz * y);
    const ty = 2 * (qz * x - qx * z);
    const tz = 2 * (qx * y - qy * x);
    out[0] = x + qw * tx + (qy * tz - qz * ty);
    out[1] = y + qw * ty + (qz * tx - qx * tz);
    out[2] = z + qw * tz + (qx * ty - qy * tx);
}
function yawQuat(deg) {
    const h = (deg * Math.PI) / 360;
    return [0, Math.sin(h), 0, Math.cos(h)];
}
function placeOutput(id, out, at, entity, budget, meshes) {
    const tmp = [0, 0, 0];
    for (const part of out.parts) {
        const tris = part.indices.length / 3;
        if (tris > budget.left)
            return;
        budget.left -= tris;
        const n = part.positions.length / 3;
        const positions = new Float32Array(n * 3);
        const normals = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
            rotate(at.quaternion, part.normals[i * 3], part.normals[i * 3 + 1], part.normals[i * 3 + 2], tmp);
            const nl = Math.hypot(tmp[0], tmp[1], tmp[2]) || 1;
            normals[i * 3] = tmp[0] / nl;
            normals[i * 3 + 1] = tmp[1] / nl;
            normals[i * 3 + 2] = tmp[2] / nl;
            rotate(at.quaternion, part.positions[i * 3] * at.scale[0], part.positions[i * 3 + 1] * at.scale[1], part.positions[i * 3 + 2] * at.scale[2], tmp);
            positions[i * 3] = tmp[0] + at.position[0];
            positions[i * 3 + 1] = tmp[1] + at.position[1];
            positions[i * 3 + 2] = tmp[2] + at.position[2];
        }
        const merged = { ...part.material, ...(entity.material ?? {}) };
        // An entity colour wins over the part's; a generator that paints vertices keeps them.
        const useVertex = part.colors !== undefined && (part.material.vertexColors === true || entity.material?.color === undefined) && part.material.color === undefined;
        const emissiveHex = merged.emissive;
        const emissive = emissiveHex && (merged.emissiveIntensity ?? 1) > 0 ? hexToRgb(emissiveHex, [1, 1, 1]) : null;
        meshes.push({
            id,
            positions,
            normals,
            indices: part.indices,
            vertexColors: useVertex ? part.colors : null,
            color: materialColor(merged),
            emissive,
            metalness: merged.metalness ?? (merged.preset === 'metal' || merged.preset === 'gold' ? 0.8 : 0),
            opacity: merged.opacity ?? (merged.preset === 'glass' || merged.finish === 'glass' ? 0.35 : 1),
        });
    }
}
/** Triangles, bounds and the like for a set of meshes. */
export function sceneBounds(meshes) {
    let min = null;
    let max = null;
    for (const m of meshes) {
        for (let i = 0; i < m.positions.length; i += 3) {
            const x = m.positions[i];
            const y = m.positions[i + 1];
            const z = m.positions[i + 2];
            if (!min || !max) {
                min = [x, y, z];
                max = [x, y, z];
                continue;
            }
            if (x < min[0])
                min[0] = x;
            if (y < min[1])
                min[1] = y;
            if (z < min[2])
                min[2] = z;
            if (x > max[0])
                max[0] = x;
            if (y > max[1])
                max[1] = y;
            if (z > max[2])
                max[2] = z;
        }
    }
    return min && max ? { min, max } : null;
}
/** Build the drawable scene of a world (see module docs). */
export async function buildScene(world, opts) {
    const cache = new GeneratorCache(64);
    const budget = { left: opts.maxTriangles };
    const meshes = [];
    const skipped = [];
    const hidden = new Set();
    // An entity under a hidden or template parent is not drawn either.
    for (const e of Object.values(world.entities))
        if (e.template || !e.visible)
            hidden.add(e.id);
    const isHidden = (e) => {
        for (let cur = e, depth = 0; cur && depth < 70; depth++) {
            if (hidden.has(cur.id))
                return true;
            cur = cur.parent === null ? undefined : world.entities[cur.parent];
        }
        return false;
    };
    for (const e of Object.values(world.entities)) {
        if (opts.signal?.aborted)
            throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
        if (e.shape.kind === 'none' || isHidden(e))
            continue;
        if (budget.left <= 0) {
            skipped.push({ id: e.id, reason: 'triangle budget spent' });
            continue;
        }
        let at;
        try {
            const t = worldTransform(world, e.id);
            at = { position: t.position, quaternion: t.quaternion, scale: t.scale };
        }
        catch {
            skipped.push({ id: e.id, reason: 'broken parent chain' });
            continue;
        }
        const override = opts.poses?.get(e.id);
        if (override)
            at = { ...at, position: override.position, quaternion: override.quaternion };
        const shape = e.shape;
        try {
            switch (shape.kind) {
                case 'primitive':
                    placeOutput(e.id, primitiveOutput(shape), at, e, budget, meshes);
                    break;
                case 'procedural': {
                    let out;
                    try {
                        out = await generate(shape, world, { cache, ...(opts.sandbox ? { sandbox: opts.sandbox } : {}) });
                    }
                    catch (err) {
                        out = fallbackOutput(err instanceof Error ? err.message : 'generator failed');
                        skipped.push({ id: e.id, reason: 'generator failed; drew a placeholder' });
                    }
                    placeOutput(e.id, out, at, e, budget, meshes);
                    break;
                }
                case 'scatter': {
                    const base = shape.of.kind === 'primitive' ? primitiveOutput(shape.of) : await generate(shape.of, world, { cache, ...(opts.sandbox ? { sandbox: opts.sandbox } : {}) });
                    const tris = base.parts.reduce((s, p) => s + p.indices.length / 3, 0) || 1;
                    const maxInstances = Math.max(1, Math.min(shape.count, 4000, Math.floor(budget.left / tris / 2)));
                    for (const inst of scatterInstances(shape, maxInstances)) {
                        const local = rotateBy(at, inst.position, inst.scale, inst.yawDeg);
                        placeOutput(e.id, base, local, e, budget, meshes);
                    }
                    break;
                }
                default:
                    skipped.push({ id: e.id, reason: `${shape.kind} shapes need files the MCP server does not read` });
            }
        }
        catch {
            skipped.push({ id: e.id, reason: 'could not be built' });
        }
    }
    const triangles = opts.maxTriangles - budget.left;
    return { meshes, triangles, bounds: sceneBounds(meshes), skipped };
}
/** Compose an instance transform (local to the scatter entity) into world space. */
function rotateBy(at, position, scale, yawDeg) {
    const p = [0, 0, 0];
    rotate(at.quaternion, position[0] * at.scale[0], position[1] * at.scale[1], position[2] * at.scale[2], p);
    const y = yawQuat(yawDeg);
    const q = at.quaternion;
    // q_world * q_yaw
    const quaternion = [
        q[3] * y[0] + q[0] * y[3] + q[1] * y[2] - q[2] * y[1],
        q[3] * y[1] - q[0] * y[2] + q[1] * y[3] + q[2] * y[0],
        q[3] * y[2] + q[0] * y[1] - q[1] * y[0] + q[2] * y[3],
        q[3] * y[3] - q[0] * y[0] - q[1] * y[1] - q[2] * y[2],
    ];
    return { position: [at.position[0] + p[0], at.position[1] + p[1], at.position[2] + p[2]], quaternion, scale: [at.scale[0] * scale, at.scale[1] * scale, at.scale[2] * scale] };
}
