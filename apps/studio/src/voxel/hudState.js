/**
 * What the voxel game HUD shows: a plain, comparable snapshot pushed from
 * the session to the UI store only when something visible changed.
 */
function iconEq(a, b) {
    if (a.kind === 'block' && b.kind === 'block')
        return a.top === b.top && a.side === b.side && a.flat === b.flat;
    if (a.kind === 'item' && b.kind === 'item')
        return a.index === b.index;
    return false;
}
function slotEq(a, b) {
    if (a === null || b === null)
        return a === b;
    return a.item === b.item && a.count === b.count && a.label === b.label && iconEq(a.icon, b.icon);
}
/** Value equality of two HUD snapshots (cheap; recipes compared by craftability and counts). */
export function hudEqual(a, b) {
    if (a === null || b === null)
        return a === b;
    if (a.mode !== b.mode || a.loading !== b.loading || a.health !== b.health || a.hunger !== b.hunger || a.air !== b.air || a.dead !== b.dead ||
        a.deathCause !== b.deathCause || a.selected !== b.selected || a.inventoryOpen !== b.inventoryOpen || a.nearTable !== b.nearTable || a.hour !== b.hour ||
        a.day !== b.day || a.capture !== b.capture || a.touch !== b.touch || a.view !== b.view || a.flying !== b.flying || a.target !== b.target || a.atlasUrl !== b.atlasUrl ||
        a.itemsUrl !== b.itemsUrl || a.toast !== b.toast || a.position[0] !== b.position[0] || a.position[1] !== b.position[1] || a.position[2] !== b.position[2]) {
        return false;
    }
    if (a.slots.length !== b.slots.length)
        return false;
    for (let i = 0; i < a.slots.length; i++)
        if (!slotEq(a.slots[i] ?? null, b.slots[i] ?? null))
            return false;
    if (a.recipes.length !== b.recipes.length)
        return false;
    for (let i = 0; i < a.recipes.length; i++) {
        const x = a.recipes[i];
        const y = b.recipes[i];
        if (x.id !== y.id || x.craftable !== y.craftable || x.inputs.length !== y.inputs.length)
            return false;
        for (let k = 0; k < x.inputs.length; k++)
            if (x.inputs[k].have !== y.inputs[k].have)
                return false;
    }
    return true;
}
