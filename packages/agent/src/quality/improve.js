/**
 * Deterministic, targeted improvements for the offline refinement loop: each
 * fixable issue of a {@link QualityReport} becomes a small set of patches
 * (ground floating objects, separate interpenetrating ones, dress an empty
 * scene, light a dark one, lower a flat noon sun). Pure; the host commits
 * the patches as one undoable edit and re-assesses.
 */
import { uniqueId } from '@aether/core';
import { contentExtent, placedContent } from './geometry';
/** Maximum entities moved per fix (keeps a refinement round small and reviewable). */
const MAX_MOVES = 12;
const r2 = (v) => Math.round(v * 100) / 100;
function supportTop(p, solid) {
    let top = 0;
    for (const q of solid) {
        if (q === p)
            continue;
        const xz = p.bounds.min[0] < q.bounds.max[0] && p.bounds.max[0] > q.bounds.min[0] && p.bounds.min[2] < q.bounds.max[2] && p.bounds.max[2] > q.bounds.min[2];
        if (xz && q.bounds.max[1] <= p.bounds.min[1] + 0.05)
            top = Math.max(top, q.bounds.max[1]);
    }
    return top;
}
function decorFor(world) {
    const preset = world.environment.ground?.material.preset;
    if (preset === 'sand')
        return { generator: 'rock', params: { size: 0.6, color: '#c9a66b' } };
    if (preset === 'snow' || preset === 'ice')
        return { generator: 'rock', params: { size: 0.7, color: '#c7d0d9' } };
    if (preset === 'stone' || preset === 'concrete')
        return { generator: 'bush', params: { size: 0.9 } };
    return { generator: 'flowers', params: { size: 0.8 } };
}
/**
 * Build improvement patches for the fixable issues of `report`.
 * `bounds` should be the same bounds source the report was computed with.
 */
export function improvementPatches(world, report, bounds, only) {
    const patches = [];
    const applied = [];
    const content = placedContent(world, bounds);
    const byId = new Map(content.map((p) => [p.id, p]));
    const solid = content.filter((p) => p.root && p.entity.physics?.body !== 'dynamic');
    const moved = new Set();
    const fixes = new Set(report.issues.map((i) => i.fix).filter((f) => f !== undefined && (!only || only.has(f))));
    for (const issue of report.issues) {
        if (issue.fix && only && !only.has(issue.fix))
            continue;
        if (issue.fix === 'ground') {
            let n = 0;
            for (const id of issue.entities ?? []) {
                const p = byId.get(id);
                if (!p || !p.root || moved.has(id) || n >= MAX_MOVES)
                    continue;
                const drop = p.bounds.min[1] - supportTop(p, solid);
                if (drop <= 0.05)
                    continue;
                const pos = p.entity.transform.position;
                patches.push({ op: 'update', id, set: { transform: { position: [pos[0], r2(pos[1] - drop), pos[2]] } } });
                moved.add(id);
                n++;
            }
            if (n > 0)
                applied.push(`grounded ${n} floating object${n > 1 ? 's' : ''}`);
        }
        else if (issue.fix === 'separate') {
            let n = 0;
            for (const id of issue.entities ?? []) {
                const p = byId.get(id);
                if (!p || !p.root || moved.has(id) || n >= MAX_MOVES)
                    continue;
                const other = solid.find((q) => q !== p && q.bounds.min[0] < p.bounds.max[0] && q.bounds.max[0] > p.bounds.min[0] && q.bounds.min[2] < p.bounds.max[2] && q.bounds.max[2] > p.bounds.min[2] && q.bounds.min[1] < p.bounds.max[1] && q.bounds.max[1] > p.bounds.min[1]);
                if (!other)
                    continue;
                const pc = [(p.bounds.min[0] + p.bounds.max[0]) / 2, (p.bounds.min[2] + p.bounds.max[2]) / 2];
                const oc = [(other.bounds.min[0] + other.bounds.max[0]) / 2, (other.bounds.min[2] + other.bounds.max[2]) / 2];
                let dx = pc[0] - oc[0];
                let dz = pc[1] - oc[1];
                const len = Math.hypot(dx, dz);
                if (len < 1e-3) {
                    dx = 1;
                    dz = 0;
                }
                else {
                    dx /= len;
                    dz /= len;
                }
                // Push out until the boxes no longer overlap along the push direction (+ 20 cm air).
                const halfP = Math.abs(dx) * (p.bounds.max[0] - p.bounds.min[0]) / 2 + Math.abs(dz) * (p.bounds.max[2] - p.bounds.min[2]) / 2;
                const halfO = Math.abs(dx) * (other.bounds.max[0] - other.bounds.min[0]) / 2 + Math.abs(dz) * (other.bounds.max[2] - other.bounds.min[2]) / 2;
                const need = halfP + halfO + 0.2 - (len < 1e-3 ? 0 : len);
                if (need <= 0)
                    continue;
                const pos = p.entity.transform.position;
                patches.push({ op: 'update', id, set: { transform: { position: [r2(pos[0] + dx * need), pos[1], r2(pos[2] + dz * need)] } } });
                moved.add(id);
                n++;
            }
            if (n > 0)
                applied.push(`separated ${n} intersecting object${n > 1 ? 's' : ''}`);
        }
    }
    const sky = world.environment.sky;
    const ext = contentExtent(content);
    if (fixes.has('densify') && world.environment.ground && sky !== 'space') {
        const decor = decorFor(world);
        const radius = Math.max(10, Math.min(60, ext.radius * 1.6 + 6));
        const id = uniqueId(world, 'set-dressing');
        patches.push({
            op: 'add',
            entity: {
                id,
                name: 'Set dressing',
                tags: ['decor', 'quality-refine'],
                transform: { position: [r2(ext.center[0]), 0, r2(ext.center[1])], rotation: [0, 0, 0], scale: [1, 1, 1] },
                shape: { kind: 'scatter', of: { kind: 'procedural', generator: decor.generator, params: decor.params }, count: Math.round(Math.min(90, radius * 2.2)), area: [r2(radius * 2), r2(radius * 2)], seed: 7, minSpacing: 1.2 },
            },
        });
        applied.push('added set dressing around the scene');
    }
    if (fixes.has('light-night')) {
        const r = Math.max(4, Math.min(30, ext.radius + 2));
        const taken = new Set();
        for (let i = 0; i < 3; i++) {
            const a = (Math.PI * 2 * i) / 3 + Math.PI / 4;
            const id = uniqueId(world, 'lantern', taken);
            taken.add(id);
            const lightId = uniqueId(world, `${id}-light`, taken);
            taken.add(lightId);
            const x = r2(ext.center[0] + Math.cos(a) * r);
            const z = r2(ext.center[1] + Math.sin(a) * r);
            patches.push({ op: 'add', entity: { id, name: 'Lantern', tags: ['light', 'quality-refine'], transform: { position: [x, 0, z], rotation: [0, 0, 0], scale: [1, 1, 1] }, shape: { kind: 'procedural', generator: 'lamp-post', params: { height: 3.2, lightColor: '#ffcf8a' } }, physics: { body: 'static' } } });
            patches.push({ op: 'add', entity: { id: lightId, name: 'Lantern light', parent: id, transform: { position: [0, 3.1, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, light: { type: 'point', color: '#ffcf8a', intensity: 4, range: 16 } } });
        }
        applied.push('added warm lanterns to light the night');
    }
    if (fixes.has('golden-hour') && sky === 'day' && world.environment.timeOfDay === undefined) {
        patches.push({ op: 'setEnvironment', set: { timeOfDay: 16.5 } });
        applied.push('lowered the sun for warmer, longer shadows');
    }
    return { patches, applied };
}
