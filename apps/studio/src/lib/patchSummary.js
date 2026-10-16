/** Most ids listed per category (the rest are counted only). */
export const MAX_LISTED_IDS = 40;
function push(list, id) {
    if (list.length < MAX_LISTED_IDS && !list.includes(id))
        list.push(id);
}
/** Summarize validated patches. Unknown ops are counted under `world`. */
export function summarizePatches(patches) {
    const s = {
        added: [],
        updated: [],
        removed: [],
        addedCount: 0,
        updatedCount: 0,
        removedCount: 0,
        rules: 0,
        generators: [],
        scripts: [],
        tests: 0,
        world: 0,
        total: patches.length,
    };
    for (const p of patches) {
        switch (p.op) {
            case 'add':
                s.addedCount++;
                push(s.added, p.entity.id);
                break;
            case 'update':
                s.updatedCount++;
                push(s.updated, p.id);
                break;
            case 'rename':
                s.updatedCount++;
                push(s.updated, `${p.id} → ${p.newId}`);
                break;
            case 'remove':
                s.removedCount++;
                push(s.removed, p.id);
                break;
            case 'addRule':
            case 'updateRule':
            case 'removeRule':
                s.rules++;
                break;
            case 'defineGenerator':
                push(s.generators, p.generator.id);
                break;
            case 'removeGenerator':
                push(s.generators, `−${p.id}`);
                break;
            case 'defineScript':
                push(s.scripts, p.script.id);
                break;
            case 'removeScript':
                push(s.scripts, `−${p.id}`);
                break;
            case 'addTest':
            case 'removeTest':
                s.tests++;
                break;
            default:
                s.world++;
        }
    }
    return s;
}
/** Chip labels in display order, e.g. ["＋ 12 entities", "✎ 3", "rules 2"]. Empty categories are omitted. */
export function patchChips(s) {
    const out = [];
    if (s.addedCount > 0)
        out.push(`＋ ${s.addedCount} ${s.addedCount === 1 ? 'entity' : 'entities'}`);
    if (s.updatedCount > 0)
        out.push(`✎ ${s.updatedCount}`);
    if (s.removedCount > 0)
        out.push(`− ${s.removedCount}`);
    if (s.rules > 0)
        out.push(`rules ${s.rules}`);
    if (s.generators.length > 0)
        out.push(`generators ${s.generators.length}`);
    if (s.scripts.length > 0)
        out.push(`scripts ${s.scripts.length}`);
    if (s.tests > 0)
        out.push(`tests ${s.tests}`);
    if (s.world > 0)
        out.push(`world ${s.world}`);
    return out;
}
/** Single-line label: "＋ 12 entities · ✎ 3 · rules 2" (or "no changes"). */
export function patchLabel(s) {
    const chips = patchChips(s);
    return chips.length > 0 ? chips.join(' · ') : 'no changes';
}
