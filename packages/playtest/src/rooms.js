/**
 * Goals of a walkthrough: every room of every building must be walked into
 * from the entrance (the player spawn), through its doors, up its stairs.
 * Rooms come from the `arch` metadata of the document; a room is "visited"
 * when the bot's feet are inside its floor outline at the room's floor
 * height.
 */
import { rotateVec3, worldTransform } from '@aether/core';
import { pointInPolygon } from '@aether/arch';
import { entityBounds } from '@aether/physics';
import { deriveGoals } from './goals';
import { PLAYTEST_LIMITS } from './types';
/** World-space floor outline of a room entity, or null. */
export function roomOutline(world, room) {
    const shape = room.shape;
    if (shape.kind !== 'procedural')
        return null;
    const raw = shape.params['polygon'];
    if (!Array.isArray(raw) || raw.length < 3 || raw.length > 256)
        return null;
    let t;
    try {
        t = worldTransform(world, room.id);
    }
    catch {
        return null;
    }
    const out = [];
    for (const p of raw) {
        if (!Array.isArray(p) || typeof p[0] !== 'number' || typeof p[1] !== 'number')
            return null;
        const w = rotateVec3(t.quaternion, [p[0] * t.scale[0], 0, p[1] * t.scale[2]]);
        out.push([t.position[0] + w[0], t.position[2] + w[2]]);
    }
    return out;
}
/** A point well inside a polygon: the centroid when it is inside, else the middle of the widest horizontal span. */
export function interiorPoint(poly) {
    let cx = 0, cz = 0, area = 0;
    for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        const f = a[0] * b[1] - b[0] * a[1];
        area += f;
        cx += (a[0] + b[0]) * f;
        cz += (a[1] + b[1]) * f;
    }
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of poly) {
        minX = Math.min(minX, p[0]);
        maxX = Math.max(maxX, p[0]);
        minZ = Math.min(minZ, p[1]);
        maxZ = Math.max(maxZ, p[1]);
    }
    let point = Math.abs(area) > 1e-6 ? [cx / (3 * area), cz / (3 * area)] : [(minX + maxX) / 2, (minZ + maxZ) / 2];
    if (!pointInPolygon(point[0], point[1], poly)) {
        // Scan a coarse grid for the interior point farthest from the outline's bounding box edges.
        let best = -1;
        for (let i = 1; i < 20; i++) {
            for (let j = 1; j < 20; j++) {
                const x = minX + ((maxX - minX) * i) / 20;
                const z = minZ + ((maxZ - minZ) * j) / 20;
                if (!pointInPolygon(x, z, poly))
                    continue;
                const score = Math.min(x - minX, maxX - x, z - minZ, maxZ - z);
                if (score > best) {
                    best = score;
                    point = [x, z];
                }
            }
        }
    }
    const radius = Math.max(0.35, Math.min(1.4, Math.min(maxX - minX, maxZ - minZ) * 0.3));
    return { point, radius };
}
/** Rooms of a document as objectives (bounded). */
export function deriveWalkGoals(world) {
    const base = deriveGoals(world);
    const objectives = [];
    for (const id in world.entities) {
        const e = world.entities[id];
        if (e.template || e.arch?.role !== 'room')
            continue;
        const poly = roomOutline(world, e);
        if (!poly)
            continue;
        const { point, radius } = interiorPoint(poly);
        const b = entityBounds(world, id);
        const floorY = b ? b.max[1] : (worldTransformSafe(world, id)?.[1] ?? 0);
        const center = [point[0], floorY, point[1]];
        objectives.push({
            id: `room:${id}`,
            kind: 'room',
            label: e.name && e.name !== id ? e.name : id,
            entity: id,
            position: center,
            required: true,
            touch: { shape: { kind: 'cylinder', half: [radius, 1.3, radius] }, center: [point[0], floorY + 0.7, point[1]], rot: [0, 0, 0, 1], margin: 0 },
            completes: 'state',
            region: { poly, y0: floorY - 0.4, y1: floorY + 2.4 },
        });
        if (objectives.length >= PLAYTEST_LIMITS.MAX_OBJECTIVES)
            break;
    }
    return { ...base, objectives, winDefined: true, requiredKeys: new Set(), timerSeconds: 0, producible: new Map() };
}
function worldTransformSafe(world, id) {
    try {
        return worldTransform(world, id).position;
    }
    catch {
        return null;
    }
}
