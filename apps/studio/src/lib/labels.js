/**
 * Floating viewport labels: which entities get one and what it says
 * ("Crate · 12 kg"). Top-level, named, visible things only; backdrop
 * scenery and scatters are skipped; gameplay pieces and dynamic bodies
 * first. Pure.
 */
import { worldTransform } from '@aether/core';
import { MAX_LABELS } from '../engine/viewOverlay';
const BACKDROP_GENERATORS = new Set(['terrain', 'mountain', 'island', 'cloud', 'grass-tuft']);
/** Behaviours worth naming on a label (gameplay roles, not motion flourishes like spin or bob). */
const ROLE_LABEL = { collectible: 'pickup', goal: 'goal', hazard: 'hazard', launcher: 'jump pad', door: 'door', npc: 'character', checkpoint: 'checkpoint', spawner: 'spawner', pressurePlate: 'switch', vehicle: 'vehicle', playerController: 'player' };
function importance(e) {
    let score = 0;
    if (e.tags.includes('focus'))
        score += 8;
    if (e.behaviors.length > 0)
        score += 4;
    if (e.physics?.body === 'dynamic')
        score += 3;
    if (e.light)
        score += 1;
    if (e.name)
        score += 1;
    return score;
}
/** Secondary text: only when it tells something (mass, behaviour, light) — otherwise empty. */
function metricOf(e) {
    if (e.light)
        return 'light';
    if (e.physics?.body === 'dynamic' && e.physics.mass !== undefined)
        return `${Math.round(e.physics.mass * 10) / 10} kg`;
    for (const b of e.behaviors)
        if (b.enabled && ROLE_LABEL[b.type])
            return ROLE_LABEL[b.type];
    if (e.physics?.body === 'dynamic')
        return 'dynamic';
    return '';
}
function labelHeight(e) {
    const sy = Math.abs(e.transform.scale[1]) || 1;
    if (e.shape.kind === 'primitive')
        return (e.shape.size[1] / 2) * sy + 0.25;
    if (e.light)
        return 0.3;
    return 1.2 * sy;
}
/**
 * Labels for a world, most important first (at most {@link MAX_LABELS}).
 * Only named things get a label (unnamed scenery such as rocks does not);
 * overlapping labels are culled on screen by the overlay, by this order.
 */
export function worldLabels(world) {
    const out = [];
    for (const id of Object.keys(world.entities)) {
        const e = world.entities[id];
        if (!e || e.parent !== null || e.template || !e.visible)
            continue;
        if (e.shape.kind === 'scatter')
            continue;
        if (e.shape.kind === 'procedural' && BACKDROP_GENERATORS.has(e.shape.generator))
            continue;
        if (e.shape.kind === 'none' && !e.light)
            continue;
        const name = e.name.trim();
        if (!name)
            continue;
        const p = e.transform.position;
        out.push({ spec: { id, name, metric: metricOf(e), position: [p[0], p[1] + labelHeight(e), p[2]] }, score: importance(e) });
    }
    out.sort((a, b) => b.score - a.score || (a.spec.id < b.spec.id ? -1 : 1));
    return out.slice(0, MAX_LABELS).map((x) => x.spec);
}
/** Height of a room label above its floor (metres). */
const ROOM_LABEL_HEIGHT = 1.1;
/** Shoelace area and centroid of a plan polygon `[[x, z], …]`. */
function polygonStats(poly) {
    let a = 0;
    let cx = 0;
    let cz = 0;
    for (let i = 0; i < poly.length; i++) {
        const p = poly[i];
        const q = poly[(i + 1) % poly.length];
        const cross = p[0] * q[1] - q[0] * p[1];
        a += cross;
        cx += (p[0] + q[0]) * cross;
        cz += (p[1] + q[1]) * cross;
    }
    if (Math.abs(a) < 1e-9) {
        const n = Math.max(1, poly.length);
        return { area: 0, cx: poly.reduce((s, p) => s + p[0], 0) / n, cz: poly.reduce((s, p) => s + p[1], 0) / n };
    }
    return { area: Math.abs(a) / 2, cx: cx / (3 * a), cz: cz / (3 * a) };
}
function isPolygon(v) {
    return Array.isArray(v) && v.length >= 3 && v.length <= 128 && v.every((p) => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]));
}
/**
 * Room labels of parametric buildings ("Kitchen · 20 m²"), floating above
 * each room's floor — the chips of the cutaway views. `level` limits them to
 * one storey (null: all). Terraces are skipped. Pure and bounded.
 */
export function roomLabels(world, level = null) {
    const out = [];
    for (const id of Object.keys(world.entities)) {
        if (out.length >= MAX_LABELS)
            break;
        const e = world.entities[id];
        if (!e || e.arch?.role !== 'room' || e.arch.kind === 'terrace' || e.shape.kind !== 'procedural')
            continue;
        const storey = e.parent ? world.entities[e.parent]?.arch?.level : undefined;
        if (level !== null && storey !== undefined && storey !== level)
            continue;
        const poly = e.shape.params['polygon'];
        if (!isPolygon(poly))
            continue;
        const { area, cx, cz } = polygonStats(poly);
        let t;
        try {
            t = worldTransform(world, id);
        }
        catch {
            continue;
        }
        // Rotate the plan centroid by the room's world rotation (buildings may be rotated about Y): v' = v + w·t + q×t, t = 2·q×v.
        const [qx, qy, qz, qw] = t.quaternion;
        const tx = 2 * (qy * cz);
        const ty = 2 * (qz * cx - qx * cz);
        const tz = 2 * (-qy * cx);
        const rx = cx + qw * tx + (qy * tz - qz * ty);
        const rz = cz + qw * tz + (qx * ty - qy * tx);
        out.push({ id, name: e.arch.name ?? e.name, metric: `${area >= 100 ? Math.round(area) : Math.round(area * 10) / 10} m²`, position: [t.position[0] + rx, t.position[1] + ROOM_LABEL_HEIGHT, t.position[2] + rz] });
    }
    return out;
}
