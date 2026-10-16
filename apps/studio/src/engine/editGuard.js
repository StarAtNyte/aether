/**
 * Protects the user's hand edits from the agent: patches that would change a
 * locked entity are refused (with an explanation the model can act on), and
 * agent changes to properties the user set by hand are reported back to the
 * model ("tell the user") and shown in the chat. Pure.
 */
import { getEntity, hasOwn, isPlainObject, meshUsers, overlappingPaths } from '@aether/core';
function str(v) {
    return typeof v === 'string' ? v : null;
}
function lockedDescendant(world, id) {
    const queue = [id];
    for (let i = 0; i < queue.length && i < 5000; i++) {
        const cur = queue[i];
        if (cur !== id && world.entities[cur]?.locked)
            return cur;
        for (const e of Object.values(world.entities))
            if (e.parent === cur)
                queue.push(e.id);
    }
    return null;
}
/** Why the agent may not apply `raw` (a locked entity is involved), or null. */
export function lockedReason(world, raw) {
    if (!isPlainObject(raw))
        return null;
    const op = str(raw['op']);
    const isLocked = (id) => !!id && !!getEntity(world, id)?.locked;
    const refuse = (id) => `entity '${id}' is locked by the user — leave it unchanged (or ask the user to unlock it)`;
    switch (op) {
        case 'update':
        case 'rename': {
            const id = str(raw['id']);
            return id && isLocked(id) ? refuse(id) : null;
        }
        case 'remove': {
            const id = str(raw['id']);
            if (!id)
                return null;
            if (isLocked(id))
                return refuse(id);
            const child = raw['recursive'] === false ? null : lockedDescendant(world, id);
            return child ? `removing '${id}' would delete '${child}', which the user locked — move or keep it` : null;
        }
        case 'setMesh': {
            const mesh = isPlainObject(raw['mesh']) ? str(raw['mesh']['id']) : null;
            if (!mesh || !hasOwn(world.meshes, mesh))
                return null;
            const user = meshUsers(world.entities, mesh).find((id) => world.entities[id]?.locked);
            return user ? refuse(user) : null;
        }
        case 'clear': {
            const locked = Object.values(world.entities).filter((e) => e.locked).map((e) => e.id);
            return locked.length > 0 ? `the world contains objects the user locked (${locked.slice(0, 5).join(', ')}); remove other objects individually instead of clearing` : null;
        }
        default:
            return null;
    }
}
/** Split a batch into allowed patches (with their original indices) and refusals. */
export function screenLocked(world, patches) {
    const allowed = [];
    const indices = [];
    const refused = [];
    patches.forEach((raw, i) => {
        const reason = lockedReason(world, raw);
        if (reason)
            refused.push({ index: i, op: isPlainObject(raw) && typeof raw['op'] === 'string' ? raw['op'].slice(0, 32) : 'unknown', message: reason });
        else {
            allowed.push(raw);
            indices.push(i);
        }
    });
    return { allowed, indices, refused };
}
/** Hand-edited properties that applied agent patches overwrote: "tower: transform.position". */
export function overwrittenEdits(applied, marks) {
    const out = [];
    for (const p of applied) {
        if (p.op === 'update') {
            const m = marks.get(p.id);
            if (!m)
                continue;
            const hit = overlappingPaths(m.paths, p.set);
            if (hit.length > 0)
                out.push(`${p.id}: ${hit.join(', ')}`);
        }
        else if (p.op === 'remove' && marks.has(p.id))
            out.push(`${p.id}: removed`);
    }
    return out.slice(0, 12);
}
