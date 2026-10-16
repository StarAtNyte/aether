/**
 * `setVoxel` and `voxelEdit`: the patch operations of voxel terrain.
 *
 * - `setVoxel {set}` deep-merges `set` into the current terrain (or into the
 *   defaults when the world has none yet); arrays (`edits`, `blocks`, game
 *   lists) replace. `set: null` removes the terrain.
 * - `voxelEdit {edits}` appends block edits. It needs existing terrain.
 *
 * Both check every block / item id against the built-in registry plus the
 * world's custom blocks (with "did you mean" hints), and bound the work an
 * edit can cause: at most {@link LIMITS.MAX_VOXEL_PATCH_BLOCKS} blocks per
 * patch and {@link LIMITS.MAX_VOXEL_TOTAL_BLOCKS} for the whole world (upper
 * bounds from {@link voxelEditVolume}), and {@link LIMITS.MAX_VOXEL_EDITS}
 * edits.
 */
import { VoxelTerrain as VoxelTerrainSchema, voxelEditBlocks, voxelEditVolume } from '../voxel-schema';
import { isBuiltinBlock, isBuiltinItem, VOXEL_BLOCK_IDS, VOXEL_ITEM_IDS } from '../voxel-ids';
import { LIMITS } from '../limits';
import { closestMatch, deepEqual, truncate } from '../json';
import { findUnknownKeys, issuesText, zodIssues } from '../issues';
import { deepMerge, VOXEL_MERGE } from '../merge';
/** Total upper-bound volume of a list of edits. */
export function voxelEditsVolume(edits) {
    let total = 0;
    for (const e of edits)
        total += voxelEditVolume(e);
    return total;
}
function customIds(t) {
    return new Set(t.blocks.map((b) => b.id));
}
function unknownId(id, kind, custom, d) {
    const pool = kind === 'block' ? [...VOXEL_BLOCK_IDS, ...custom, 'air'] : [...VOXEL_BLOCK_IDS, ...VOXEL_ITEM_IDS, ...custom];
    const hint = d.takeHint() ? closestMatch(id, pool) : undefined;
    return `unknown ${kind} '${truncate(id, 32)}'${hint ? ` — did you mean '${hint}'?` : ''} (define custom blocks in voxel.blocks)`;
}
/** First problem with the ids an edit references, or null. */
function checkEditIds(e, custom, d) {
    for (const id of voxelEditBlocks(e)) {
        if (id === 'air' || isBuiltinBlock(id) || custom.has(id))
            continue;
        return unknownId(id, 'block', custom, d);
    }
    return null;
}
/** Whole-terrain consistency: custom ids, item ids, edit ids and limits. Returns an error message or null. */
export function checkVoxelTerrain(t, d) {
    const seen = new Set();
    for (const b of t.blocks) {
        if (b.id === 'air')
            return "'air' cannot be redefined";
        if (seen.has(b.id))
            return `custom block '${b.id}' is defined twice`;
        if (isBuiltinItem(b.id))
            return `'${b.id}' is an item id; choose another block id`;
        seen.add(b.id);
        if (b.drops !== undefined && b.drops !== null && !isBuiltinBlock(b.drops) && !isBuiltinItem(b.drops) && !t.blocks.some((o) => o.id === b.drops)) {
            return `block '${b.id}' drops ${unknownId(b.drops, 'item', seen, d)}`;
        }
    }
    const custom = customIds(t);
    const isItem = (id) => isBuiltinBlock(id) || isBuiltinItem(id) || custom.has(id);
    for (const s of t.game.startItems)
        if (!isItem(s.item))
            return `game.startItems: ${unknownId(s.item, 'item', custom, d)}`;
    for (const r of t.game.recipes) {
        for (const s of [...r.inputs, r.output])
            if (!isItem(s.item))
                return `recipe '${r.id}': ${unknownId(s.item, 'item', custom, d)}`;
    }
    const recipeIds = new Set();
    for (const r of t.game.recipes) {
        if (recipeIds.has(r.id))
            return `recipe '${r.id}' is defined twice`;
        recipeIds.add(r.id);
    }
    if (t.edits.length > LIMITS.MAX_VOXEL_EDITS)
        return `too many voxel edits (${t.edits.length}, max ${LIMITS.MAX_VOXEL_EDITS}); merge small edits into boxes`;
    for (let i = 0; i < t.edits.length; i++) {
        const bad = checkEditIds(t.edits[i], custom, d);
        if (bad)
            return `edits[${i}]: ${bad}`;
    }
    const volume = voxelEditsVolume(t.edits);
    if (volume > LIMITS.MAX_VOXEL_TOTAL_BLOCKS)
        return `voxel edits would write up to ${volume} blocks (max ${LIMITS.MAX_VOXEL_TOTAL_BLOCKS}); use fewer or smaller edits`;
    return null;
}
/** Apply `setVoxel`. Returns an error message or null. */
export function applySetVoxel(d, set) {
    const prev = d.world.voxel;
    if (set === null) {
        d.setVoxel(undefined);
        return null;
    }
    const merged = deepMerge(prev ?? {}, set, VOXEL_MERGE);
    const issues = findUnknownKeys(merged, VoxelTerrainSchema);
    const parsed = VoxelTerrainSchema.safeParse(merged);
    if (!parsed.success)
        issues.push(...zodIssues(parsed.error));
    if (issues.length > 0 || !parsed.success)
        return issuesText(issues);
    const next = parsed.data;
    if (prev && deepEqual(prev, next))
        return null;
    const bad = checkVoxelTerrain(next, d);
    if (bad)
        return bad;
    d.setVoxel(next);
    return null;
}
/** Apply `voxelEdit`. Returns an error message or null. */
export function applyVoxelEdit(d, edits) {
    const prev = d.world.voxel;
    if (!prev)
        return 'this world has no voxel terrain — create it first with {"op":"setVoxel","set":{"preset":"survival"}}';
    const custom = customIds(prev);
    for (let i = 0; i < edits.length; i++) {
        const bad = checkEditIds(edits[i], custom, d);
        if (bad)
            return `edits[${i}]: ${bad}`;
    }
    const volume = voxelEditsVolume(edits);
    if (volume > LIMITS.MAX_VOXEL_PATCH_BLOCKS) {
        return `these edits would write up to ${volume} blocks (max ${LIMITS.MAX_VOXEL_PATCH_BLOCKS} per patch); split them or make them smaller`;
    }
    const count = prev.edits.length + edits.length;
    if (count > LIMITS.MAX_VOXEL_EDITS)
        return `too many voxel edits (${count}, max ${LIMITS.MAX_VOXEL_EDITS}); merge small edits into boxes`;
    const total = voxelEditsVolume(prev.edits) + volume;
    if (total > LIMITS.MAX_VOXEL_TOTAL_BLOCKS)
        return `voxel edits would write up to ${total} blocks in total (max ${LIMITS.MAX_VOXEL_TOTAL_BLOCKS})`;
    d.setVoxel({ ...prev, edits: [...prev.edits, ...edits] });
    return null;
}
