/**
 * planFineEdit — the local fast path for small edits.
 *
 *   text ──parse──▶ commands ──resolve──▶ ops on a Draft ──▶ minimal patches
 *
 * No model round trip: "make the sofa dark green velvet" is understood,
 * resolved against the world, applied as a property-level patch, diffed and
 * guarded in a few milliseconds. Anything it does not fully understand is
 * returned as `none` so the model handles the whole request (with a compact
 * slice of the world and the same minimal-patch guard).
 */
import { furnitureById } from '@aether/arch';
import { applyPatches } from '@aether/core';
import { getCatalog, searchAssets } from '@aether/assets';
import { changedEntityIds, worldChanges } from './changes';
import { describeChanges, diffLineText } from './describe';
import { EMPTY_MEMORY } from './memory';
import { Draft, leafPaths } from './draft';
import { parseEdit } from './parse';
import { ROOM_WORDS } from './parse-ref';
import { planEnv, planBehavior, planDialogue, planDoor, planGame, planLight, planPhysics, planRename, planSpeed, planVisibility } from './ops-world';
import { planAdd, planDensity, planDuplicate, planRemove } from './ops-entity';
import { planPaint } from './ops-paint';
import { planMove, planResize, planRotate, planScale, planShape } from './ops-transform';
import { ask, failed, outcome } from './ops-types';
import { isVoxelWorld, voxelGame, voxelPaint, voxelStructureOp } from './ops-voxel';
import { resolveRef } from './resolve';
import { sceneOf } from './scene';
function none(base, memory, t0) {
    return { kind: 'none', patches: [], summary: '', changes: [], diff: [], targets: [], scope: [], added: [], cosmetic: true, notes: [], memory, unparsed: [], ms: performance.now() - t0, ...base };
}
function genInfos(list) {
    const out = [];
    for (const g of list ?? []) {
        if (typeof g !== 'object' || g === null)
            continue;
        const r = g;
        if (typeof r['id'] !== 'string')
            continue;
        out.push({ id: r['id'], description: typeof r['description'] === 'string' ? r['description'] : '', category: typeof r['category'] === 'string' ? r['category'] : 'props', params: typeof r['params'] === 'object' && r['params'] !== null ? r['params'] : {} });
    }
    return out;
}
const PRIMITIVE_NOUNS = {
    ball: { primitive: 'sphere', size: [0.8, 0.8, 0.8], color: '#e63946', radius: 0.6 },
    sphere: { primitive: 'sphere', size: [1, 1, 1], color: '#8d99ae', radius: 0.7 },
    crate: { primitive: 'box', size: [1, 1, 1], color: '#a47148', radius: 0.9 },
    box: { primitive: 'box', size: [1, 1, 1], color: '#a47148', radius: 0.9 },
    cube: { primitive: 'box', size: [1, 1, 1], color: '#8d99ae', radius: 0.9 },
    pillar: { primitive: 'cylinder', size: [0.8, 4, 0.8], color: '#c9c3b8', radius: 0.7 },
    column: { primitive: 'cylinder', size: [0.8, 4, 0.8], color: '#c9c3b8', radius: 0.7 },
    platform: { primitive: 'box', size: [4, 0.4, 4], color: '#7a8691', radius: 2.2 },
    ramp: { primitive: 'box', size: [3, 0.3, 5], color: '#7a8691', radius: 2.5 },
    cylinder: { primitive: 'cylinder', size: [1, 1.5, 1], color: '#8d99ae', radius: 0.8 },
    cone: { primitive: 'cone', size: [1, 1.5, 1], color: '#e07a2f', radius: 0.8 },
};
/** Build the parameter-spec lookup for the ops. */
export function makeParamCatalog(world, catalogs) {
    const gens = new Map(genInfos(catalogs?.generators).map((g) => [g.id, g.params]));
    return (id) => furnitureById(id)?.params ?? gens.get(id) ?? (Object.hasOwn(world.generators, id) ? world.generators[id]?.params : undefined);
}
/** Build the "what can be added" lookup. */
export function makeAddable(catalogs, world) {
    const gens = genInfos(catalogs?.generators);
    return (noun) => {
        const n = noun.toLowerCase().trim();
        const title = n.replace(/\b[a-z]/g, (c) => c.toUpperCase());
        const words = n.split(/\s+/);
        // Whole-world flags: an id/name match among generators.
        const cands = [n.replace(/\s+/g, '-'), words[words.length - 1]];
        for (const c of cands) {
            const hit = gens.find((g) => g.id === c) ?? gens.find((g) => g.id.endsWith(`-${c}`)) ?? gens.find((g) => g.id.startsWith(`${c}-`));
            if (hit)
                return { name: title, shape: { kind: 'procedural', generator: hit.id, params: {} }, radius: hit.category === 'architecture' ? 4 : hit.category === 'nature' ? 1.6 : 1, tags: [c] };
        }
        const prim = PRIMITIVE_NOUNS[words[words.length - 1]];
        if (prim)
            return { name: title, shape: { kind: 'primitive', primitive: prim.primitive, size: prim.size }, radius: prim.radius, tags: [words[words.length - 1]], physics: { body: 'dynamic', mass: 2 }, ...{} };
        const catalog = getCatalog();
        if (catalog && catalog.entries.length > 0) {
            const hit = searchAssets(catalog, { text: n, kind: 'model', limit: 1 })[0];
            if (hit && hit.score >= 18)
                return { name: title, shape: { kind: 'asset', id: hit.entry.id }, radius: Math.max(0.4, Math.max(hit.entry.size[0], hit.entry.size[2]) / 2), tags: [words[words.length - 1]] };
        }
        void world;
        return null;
    };
}
// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------
function runOp(env, cmd) {
    if (isVoxelWorld(env.base)) {
        const v = cmd.op === 'paint' ? voxelPaint(env, cmd) : voxelStructureOp(env, cmd);
        if (v)
            return v;
    }
    switch (cmd.op) {
        case 'paint':
            return planPaint(env, cmd);
        case 'move':
            return planMove(env, cmd);
        case 'rotate':
            return planRotate(env, cmd);
        case 'scale':
            return planScale(env, cmd);
        case 'resize':
            return planResize(env, cmd);
        case 'shape':
            return planShape(env, cmd);
        case 'remove':
            return planRemove(env, cmd);
        case 'add':
            return planAdd(env, cmd);
        case 'duplicate':
            return planDuplicate(env, cmd);
        case 'density':
            return planDensity(env, cmd);
        case 'rename':
            return planRename(env, cmd);
        case 'visibility':
            return planVisibility(env, cmd);
        case 'light':
            return planLight(env, cmd);
        case 'speed':
            return planSpeed(env, cmd);
        case 'behavior':
            return planBehavior(env, cmd);
        case 'door':
            return planDoor(env, cmd);
        case 'dialogue':
            return planDialogue(env, cmd);
        case 'env':
            return planEnv(env, cmd);
        case 'game':
            return planGame(env, cmd);
        case 'physics':
            return planPhysics(env, cmd);
        case 'voxel':
            return failed('That block edit is not supported yet');
        case 'repeat':
        case 'undo':
        case 'redo':
            return failed('internal: handled by the caller');
    }
}
/** Recorded edits survive a re-compile of generated buildings: mirror changed pieces into `arch.overrides`. */
function mirrorOverrides(base, draft) {
    for (const id of Object.keys(draft.world.entities)) {
        const before = base.entities[id];
        const after = draft.world.entities[id];
        if (!before || !after || before === after || !after.arch)
            continue;
        const role = after.arch.role;
        if (role === 'building' || role === 'level')
            continue;
        const a = { ...before };
        const b = { ...after };
        delete a['arch'];
        delete b['arch'];
        const la = leafPaths(a);
        const lb = leafPaths(b);
        const set = {};
        for (const [path, v] of Object.entries(lb)) {
            if (path === 'id' || path === 'parent')
                continue;
            if (!Object.hasOwn(la, path) || JSON.stringify(la[path]) !== JSON.stringify(v))
                set[path] = v;
        }
        if (Object.keys(set).length === 0)
            continue;
        const ent = draft.entity(id);
        if (ent.arch)
            ent.arch = { ...ent.arch, overrides: { ...(before.arch?.overrides ?? {}), ...set } };
    }
}
function replaceRef(cmd, ref) {
    if ('ref' in cmd && cmd.ref)
        return { ...cmd, ref };
    return cmd;
}
/** Plan a small edit locally. Never throws. */
export function planFineEdit(input) {
    const t0 = performance.now();
    const memory = input.memory ?? EMPTY_MEMORY;
    try {
        return planFineEditUnsafe(input, memory, t0);
    }
    catch (e) {
        return none({ reason: 'failed', detail: e instanceof Error ? e.message.slice(0, 200) : 'unexpected error' }, memory, t0);
    }
}
function planFineEditUnsafe(input, memory, t0) {
    const world = input.world;
    const text = input.text.trim();
    if (!text)
        return none({ reason: 'empty' }, memory, t0);
    const index = sceneOf(world);
    const ctx = { selection: input.selection ?? [], focus: memory.targets, heading: input.heading ?? 0, excluded: memory.handled, focusRooms: memory.rooms ?? [] };
    const draft = new Draft(world);
    const env = { base: world, index, ctx, params: makeParamCatalog(world, input.catalogs), draft, addable: makeAddable(input.catalogs, world) };
    // Block-world game settings are phrased too freely for the clause grammar.
    if (isVoxelWorld(world)) {
        const v = voxelGame(env, text.toLowerCase());
        if (v?.ok)
            return finish(world, draft, [v], [], memory, t0, ctx);
    }
    const parsed = parseEdit(text);
    if (parsed.question)
        return none({ reason: 'question' }, memory, t0);
    if (parsed.newWorld)
        return none({ reason: 'new-world' }, memory, t0);
    if (parsed.commands.length === 0)
        return none({ reason: 'not-understood', unparsed: parsed.unparsed }, memory, t0);
    // "make the whole apartment warmer" is about everything: the model's job.
    if (parsed.commands.some((c) => 'ref' in c && c.ref?.whole === true))
        return none({ reason: 'not-understood' }, memory, t0);
    if (parsed.unparsed.length > 0)
        return none({ reason: 'partial', unparsed: parsed.unparsed, detail: `not understood: ${parsed.unparsed[0]}` }, memory, t0);
    const first = parsed.commands[0];
    if (parsed.commands.length === 1 && first.op === 'undo')
        return { ...none({ reason: 'not-understood' }, memory, t0), kind: 'undo', summary: 'undid the last change' };
    if (parsed.commands.length === 1 && first.op === 'redo')
        return { ...none({ reason: 'not-understood' }, memory, t0), kind: 'redo', summary: 'redid the change' };
    const outcomes = [];
    const commands = [];
    let focus = [...memory.targets];
    for (let cmd of parsed.commands) {
        if (cmd.op === 'repeat') {
            if (!memory.last)
                return none({ reason: 'failed', detail: 'There is nothing to repeat yet' }, memory, t0);
            const lastCmd = memory.last;
            const prev = 'ref' in lastCmd ? lastCmd.ref : undefined;
            const wanted = cmd.ref;
            const other = wanted.other === true || /\bother\b/.test(wanted.text);
            let ref;
            if (wanted.pronoun === 'same' && !wanted.noun)
                ref = { text: prev?.text ?? 'it', noun: prev?.noun ?? '', adjectives: prev?.adjectives ?? [], ...(prev?.side ? { side: prev.side } : {}), ...(prev?.room ? { room: prev.room } : {}), ...(prev?.part ? { part: prev.part } : {}), other: true, ...(prev?.all ? { all: true } : {}) };
            else if (wanted.noun && ROOM_WORDS.has(wanted.noun) && prev && (prev.noun === 'wall' || prev.noun === 'floor' || prev.room))
                ref = { ...prev, room: { ...wanted, other }, ...(prev.ordinal !== undefined ? {} : {}) };
            else
                ref = { ...wanted, ...(wanted.part ? {} : prev?.part ? { part: prev.part } : {}), other };
            cmd = replaceRef(lastCmd, ref);
        }
        const out = runOp({ ...env, ctx: { ...ctx, focus } }, cmd);
        if (out.question)
            return { ...none({ reason: 'failed' }, memory, t0), kind: 'question', question: out.question, detail: out.failure ?? out.question.text, summary: out.question.text, memory: { ...memory, last: cmd } };
        if (!out.ok)
            return none({ reason: out.final ? 'refused' : 'failed', detail: out.failure ?? 'could not apply' }, memory, t0);
        outcomes.push(out);
        commands.push(cmd);
        if (out.targets.length > 0)
            focus = out.targets;
    }
    return finish(world, draft, outcomes, commands, memory, t0, ctx);
}
function finish(world, draft, outcomes, commands, memory, t0, ctx) {
    mirrorOverrides(world, draft);
    const target = draft.done();
    // Minimal patch list = the property-level difference.
    const patches = patchesFor(world, target);
    const applied = applyPatches(world, patches, { atomic: true });
    if (applied.errors.length > 0)
        return none({ reason: 'invalid', detail: applied.errors[0]?.message.slice(0, 200) ?? 'invalid result' }, memory, t0);
    const result = applied.world;
    const changes = worldChanges(world, result);
    if (changes.length === 0) {
        const what = outcomes.map((o) => o.summary).filter(Boolean).join('; ').replace(/^made /, '');
        return none({ reason: 'refused', detail: `That is already how it looks, so nothing changed${what ? ` (${what})` : ''}.` }, memory, t0);
    }
    const targets = [...new Set(outcomes.flatMap((o) => o.targets))];
    const added = [...new Set(outcomes.flatMap((o) => o.added))];
    const index = sceneOf(world);
    const scope = new Set([...targets, ...outcomes.flatMap((o) => o.also), ...added]);
    // A target's parts may change with it; bookkeeping entities (a building holding tombstones) may not drag their whole subtree in.
    for (const id of [...targets, ...added, ...outcomes.flatMap((o) => o.also)])
        if (Object.hasOwn(world.entities, id) && !(world.entities[id]?.arch?.role === 'building'))
            for (const s of index.subtree(id))
                scope.add(s);
    // Guard: nothing outside the named things may have changed.
    const stray = changedEntityIds(changes).filter((id) => Object.hasOwn(world.entities, id) && !scope.has(id));
    const wholeWorld = outcomes.some((o) => o.summary.startsWith('set ') && o.targets.length === 0 && stray.length === 0);
    void wholeWorld;
    if (stray.length > 0)
        return none({ reason: 'over-edit', detail: `would also change ${stray.slice(0, 4).join(', ')}` }, memory, t0);
    const diff = describeChanges(world, result, changes);
    const notes = outcomes.flatMap((o) => o.notes);
    const summary = outcomes.map((o) => o.summary).filter(Boolean).join('; ');
    const last = commands[commands.length - 1];
    const rooms = [...new Set(outcomes.flatMap((o) => o.rooms ?? []))];
    const next = {
        ...(last ? { last } : {}),
        targets: targets.length > 0 ? targets : added.length > 0 ? added : memory.targets,
        handled: last && 'ref' in last && last.ref?.other ? [...memory.handled, ...targets] : targets,
        ...(rooms.length > 0 ? { rooms: [...(last && 'ref' in last && last.ref?.other ? (memory.rooms ?? []) : []), ...rooms] } : {}),
    };
    void ctx;
    return {
        kind: 'edit',
        patches,
        world: result,
        summary: summary.charAt(0).toUpperCase() + summary.slice(1),
        changes,
        diff,
        targets,
        scope: [...scope],
        added,
        cosmetic: outcomes.every((o) => o.cosmetic),
        notes,
        memory: next,
        unparsed: [],
        ms: performance.now() - t0,
    };
}
function patchesFor(before, after) {
    // Imported lazily by name to keep this module's surface small.
    return patchesBetweenImpl(before, after);
}
import { patchesBetween as patchesBetweenImpl } from '@aether/core';
export { diffLineText, EMPTY_MEMORY };
export { ask, outcome };
