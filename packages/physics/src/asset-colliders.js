import { assetInfo, effectiveAssetId, fitScale, loadCatalog } from '@aether/assets';
/** Collider descriptions for an asset shape, or null when the asset is unknown or is a generator. */
export function assetColliderDescs(shape) {
    const info = assetInfo(effectiveAssetId(shape));
    if (!info || info.kind === 'hdri' || info.kind === 'generator' || info.kind === 'material')
        return null;
    const s = fitScale(info.size, shape.fitSize);
    const w = Math.max(0.02, info.size[0] * s);
    const h = Math.max(0.02, info.size[1] * s);
    const d = Math.max(0.02, info.size[2] * s);
    const c = info.collider;
    if (c.type === 'capsule') {
        // Rigged characters are measured in their bind pose (arms out): the body is far narrower than the box.
        const r = Math.min(Math.max(Math.min(w, d) / 2, 0.05), h * 0.22);
        return [{ kind: 'capsule', halfHeight: Math.max(0, h / 2 - r), radius: r, offset: [0, h / 2, 0] }];
    }
    if (c.type === 'hull') {
        const pts = new Float32Array(c.points.length);
        for (let i = 0; i < c.points.length; i++)
            pts[i] = c.points[i] * 0.01 * s;
        return [{ kind: 'hull', points: pts, offset: [0, 0, 0] }];
    }
    return [{ kind: 'box', halfExtents: [w / 2, h / 2, d / 2], offset: [0, h / 2, 0] }];
}
/** The procedural shape behind a generator asset (library hero generators), or null. */
export function assetGeneratorShape(shape) {
    const info = assetInfo(effectiveAssetId(shape));
    const g = info?.entry?.generator;
    if (!info || info.kind !== 'generator' || !g)
        return null;
    return { kind: 'procedural', generator: g.id, params: { ...g.params } };
}
/** True when a world references any asset (so the catalog must be loaded before colliders are derived). */
export function usesAssets(world) {
    for (const id in world.entities)
        if (world.entities[id]?.shape.kind === 'asset')
            return true;
    return false;
}
/** Load the asset catalog when the world needs it (no-op otherwise, never throws). */
export async function ensureAssetCatalog(world) {
    if (usesAssets(world))
        await loadCatalog();
}
