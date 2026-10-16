/**
 * Eval harness: run an {@link EditCase} through an engine and score the
 * outcome against the minimal correct edit.
 */
import { applyPatches } from '@aether/core';
import { WorldAgent } from '../../src/agent';
import { worldChanges } from '../../src/refine/changes';
import { EMPTY_MEMORY, planFineEdit } from '../../src/refine/plan';
import { sceneOf } from '../../src/refine/scene';
import { roomWalls, wallsBySide } from '../../src/refine/walls';
import { catalog } from '@aether/procgen';
import { createMockProvider } from '../../src/providers/mock/index';
import { MemoryHost, TEST_CATALOGS as STUB_CATALOGS, collect } from '../helpers';
/** The real generator catalogue (parameter specs drive the edits). */
const TEST_CATALOGS = { ...STUB_CATALOGS, generators: catalog() };
import { loadFixture } from './fixtures';
/** The pre-change behaviour: the offline planner through the agent loop, no local fast path. */
export const baselineEngine = {
    name: 'baseline',
    async turn(world, prompt, state) {
        const host = new MemoryHost(world);
        const agent = new WorldAgent({ provider: createMockProvider(), catalogs: TEST_CATALOGS, maxRepairs: 0, fineEdit: false });
        const t0 = performance.now();
        await collect(agent.run(prompt, host, { history: state.history }));
        return { world: host.world, ms: performance.now() - t0, llmCalls: 1, declined: host.commits.length === 0 };
    },
};
/** The fast path alone. */
export const fastEngine = {
    name: 'fast-path',
    async turn(world, prompt, state) {
        const r = planFineEdit({ world, text: prompt, selection: state.selection, memory: state.memory, heading: state.heading, catalogs: { generators: TEST_CATALOGS.generators } });
        state.memory = r.memory;
        if (r.kind === 'edit') {
            const applied = applyPatches(world, r.patches);
            return { world: applied.world, ms: r.ms, llmCalls: 0 };
        }
        if (r.kind === 'question')
            return { world, asked: r.question?.candidates.length ?? 0, ms: r.ms, llmCalls: 0 };
        if (r.kind === 'undo' || r.kind === 'redo')
            return { world, history: r.kind, ms: r.ms, llmCalls: 0 };
        return { world, declined: true, ms: r.ms, llmCalls: 0 };
    },
};
/** The product path: fast path first, the offline planner for the rest. */
export const agentEngine = {
    name: 'agent (fast path + offline planner)',
    async turn(world, prompt, state) {
        const host = new MemoryHost(world);
        const agent = new WorldAgent({ provider: createMockProvider(), catalogs: TEST_CATALOGS, maxRepairs: 0 });
        const t0 = performance.now();
        const events = await collect(agent.run(prompt, host, { history: state.history, selection: state.selection, memory: state.memory, heading: state.heading }));
        const q = events.find((e) => e.type === 'clarify');
        const hist = events.find((e) => e.type === 'history');
        const mem = events.find((e) => e.type === 'memory');
        if (mem && mem.type === 'memory')
            state.memory = mem.memory;
        const llm = events.find((e) => e.type === 'done');
        return {
            world: host.world,
            ms: performance.now() - t0,
            llmCalls: llm && llm.type === 'done' ? llm.usage.calls : 0,
            ...(q && q.type === 'clarify' ? { asked: q.candidates.length } : {}),
            ...(hist && hist.type === 'history' ? { history: hist.action } : {}),
            declined: host.commits.length === 0 && !q && !hist,
        };
    },
};
/**
 * A recorded model. For a case it answers like a capable but careless model:
 * first the right change plus unrelated "tidying" (two other objects nudged),
 * and, once told why that was refused, the minimal patch. The recording is
 * the fast path's own patch, so what is measured is the guard and the loop,
 * not the model.
 */
function recordedModel(world, prompt, selection) {
    const plan = planFineEdit({ world, text: prompt, selection, catalogs: { generators: TEST_CATALOGS.generators } });
    const minimal = plan.kind === 'edit' ? plan.patches : [];
    const index = sceneOf(world);
    const near = new Set(plan.scope.flatMap((id) => (Object.hasOwn(world.entities, id) ? index.subtree(id) : [])));
    const others = Object.values(world.entities).filter((e) => !near.has(e.id) && e.shape.kind !== 'none' && !e.tags.includes('backdrop') && e.arch?.role !== 'building' && e.arch?.role !== 'level');
    const bystanders = [others[0], others[Math.floor(others.length / 2)]]
        .filter((e) => e !== undefined)
        .map((e) => ({ op: 'update', id: e.id, set: { transform: { position: [e.transform.position[0] + 0.5, e.transform.position[1], e.transform.position[2]] } } }));
    const sloppy = [...minimal, ...bystanders];
    let turn = 0;
    return {
        name: 'recorded',
        async complete(req) {
            const last = req.messages[req.messages.length - 1];
            const refused = Array.isArray(last?.content) && last.content.some((b) => b.type === 'tool_result' && b.isError === true);
            const patches = turn++ === 0 ? sloppy : refused || turn > 1 ? minimal : sloppy;
            if (Array.isArray(last?.content) && last.content.some((b) => b.type === 'tool_result' && b.isError !== true))
                return { content: [{ type: 'tool_use', id: `f${turn}`, name: 'finish', input: { message: 'Done.' } }], stopReason: 'tool_use' };
            if (patches.length === 0)
                return { content: [{ type: 'tool_use', id: `f${turn}`, name: 'finish', input: { message: 'Done.' } }], stopReason: 'tool_use' };
            return { content: [{ type: 'tool_use', id: `p${turn}`, name: 'apply_patches', input: { patches, message: 'edit' } }], stopReason: 'tool_use' };
        },
    };
}
/** The recorded model through the loop. `guarded`: the minimal-patch guard is on. */
export function recordedModelEngine(guarded) {
    return {
        name: guarded ? 'model path, guard on' : 'model path, guard off',
        async turn(world, prompt, state) {
            const host = new MemoryHost(world);
            const agent = new WorldAgent({ provider: recordedModel(world, prompt, state.selection), catalogs: TEST_CATALOGS, maxRepairs: 0, maxTurns: 4, localEdits: false, fineEdit: guarded });
            const t0 = performance.now();
            const events = await collect(agent.run(prompt, host, { history: state.history, selection: state.selection }));
            const done = events.find((e) => e.type === 'done');
            return { world: host.world, ms: performance.now() - t0, llmCalls: done && done.type === 'done' ? done.usage.calls : 0, declined: host.commits.length === 0 };
        },
    };
}
function descendants(world, ids) {
    const index = sceneOf(world);
    const out = new Set();
    for (const id of ids)
        if (Object.hasOwn(world.entities, id))
            for (const s of index.subtree(id))
                out.add(s);
    return out;
}
function wallFacesOk(before, changes, w, heading) {
    const index = sceneOf(before);
    const room = index.get(w.room);
    if (!room)
        return { ok: false, why: `no room ${w.room}` };
    let walls = roomWalls(index, room);
    if (w.side)
        walls = wallsBySide(walls, w.side, heading);
    const want = new Set(walls.flatMap((x) => x.faces.map((f) => `${f.wallId}:${f.side === 'a' ? 'finishA' : 'finishB'}`)));
    const got = new Set();
    const strays = [];
    for (const c of changes) {
        if (c.scope !== 'entity' || c.path === '')
            continue;
        const m = /^shape\.params\.(finish[AB])\b/.exec(c.path);
        if (m) {
            const key = `${c.id}:${m[1]}`;
            if (want.has(key))
                got.add(key);
            else
                strays.push(key);
        }
        else if (!c.path.startsWith('arch.'))
            strays.push(`${c.id}.${c.path}`);
    }
    if (strays.length > 0)
        return { ok: false, why: `changed wrong faces: ${strays.slice(0, 3).join(', ')}` };
    if (got.size === 0)
        return { ok: false, why: 'no wall face changed' };
    if (w.all && got.size < want.size) {
        // Faces a previous edit already gave the new colour count as done (long walls are shared between rooms).
        const newColor = changes.map((c) => c.to).find((v) => typeof v === 'string' && /^#/.test(v));
        let already = 0;
        for (const key of want) {
            if (got.has(key))
                continue;
            const [id, slot] = key.split(':');
            const finish = before.entities[id]?.shape?.params?.[slot];
            if (newColor !== undefined && finish?.color === newColor)
                already++;
        }
        if (got.size + already < want.size)
            return { ok: false, why: `only ${got.size + already}/${want.size} faces` };
    }
    return { ok: true, why: '' };
}
/** Score one case outcome. */
export function score(c, before, res) {
    const e = c.expect;
    const base = { id: c.id, ms: res.ms, llmCalls: res.llmCalls };
    const changes = worldChanges(before, res.world);
    const verdict = (ok, why, extra = {}) => ({ ...base, ok, targetOk: ok, pathOk: ok, overEdit: [], why, ...extra });
    if (e.history)
        return verdict(res.history === e.history && changes.length === 0, res.history ? `history ${res.history}` : 'not recognised as undo/redo');
    if (e.ask !== undefined)
        return verdict((res.asked ?? 0) >= e.ask && changes.length === 0, res.asked ? `asked with ${res.asked}` : changes.length > 0 ? 'guessed instead of asking' : 'did not ask');
    if (e.decline)
        return verdict(changes.length === 0, changes.length > 0 ? 'changed the world' : '');
    const changedEntities = new Set(changes.filter((x) => x.scope === 'entity').map((x) => x.id));
    const addedIds = [...changedEntities].filter((id) => !Object.hasOwn(before.entities, id) && Object.hasOwn(res.world.entities, id));
    const removedIds = [...changedEntities].filter((id) => Object.hasOwn(before.entities, id) && !Object.hasOwn(res.world.entities, id));
    const existingChanged = [...changedEntities].filter((id) => Object.hasOwn(before.entities, id) && Object.hasOwn(res.world.entities, id));
    let targetOk = true;
    let pathOk = true;
    const why = [];
    const tset = new Set(e.t ?? []);
    if (e.t && e.t.length > 0) {
        const missing = e.t.filter((id) => !changedEntities.has(id));
        if (missing.length > 0) {
            targetOk = false;
            why.push(`did not change ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? '…' : ''}`);
        }
    }
    if (e.removed) {
        const missing = e.removed.filter((id) => !removedIds.includes(id));
        if (missing.length > 0) {
            targetOk = false;
            why.push(`did not remove ${missing.slice(0, 3).join(', ')}`);
        }
        for (const id of e.removed)
            tset.add(id);
    }
    if (e.added) {
        if (addedIds.length < e.added[0] || addedIds.length > e.added[1]) {
            targetOk = false;
            why.push(`added ${addedIds.length}, expected ${e.added[0]}-${e.added[1]}`);
        }
    }
    const envKeys = changes.filter((x) => x.scope === 'environment').map((x) => x.path.split('.')[0]);
    if (e.env) {
        const missing = e.env.filter((k) => !envKeys.includes(k));
        if (missing.length > 0) {
            targetOk = false;
            why.push(`environment ${missing.join(', ')} unchanged`);
        }
    }
    if (e.player) {
        const keys = changes.filter((x) => x.scope === 'player').map((x) => x.path.split('.')[0]);
        const missing = e.player.filter((k) => !keys.includes(k));
        if (missing.length > 0) {
            targetOk = false;
            why.push(`player ${missing.join(', ')} unchanged`);
        }
    }
    if (e.game) {
        const scopes = new Set(changes.map((x) => x.scope));
        const missing = e.game.filter((k) => !scopes.has(k));
        if (missing.length > 0) {
            targetOk = false;
            why.push(`game ${missing.join(', ')} unchanged`);
        }
    }
    if (e.voxel) {
        const paths = changes.filter((x) => x.scope === 'voxel').map((x) => x.path);
        const missing = e.voxel.filter((p) => !paths.some((q) => q === p || q.startsWith(`${p}.`) || q.startsWith(`${p}`)));
        if (missing.length > 0) {
            targetOk = false;
            why.push(`voxel ${missing.join(', ')} unchanged`);
        }
    }
    if (e.wall) {
        const w = wallFacesOk(before, changes, e.wall, c.heading ?? 0);
        if (!w.ok) {
            targetOk = false;
            why.push(w.why);
        }
    }
    if (e.p) {
        const ids = e.t && e.t.length > 0 ? e.t : [...changedEntities];
        const texts = changes.filter((x) => x.scope === 'entity' && ids.includes(x.id)).map((x) => `${x.path}=${JSON.stringify(x.to ?? null)}`);
        for (const re of e.p) {
            if (!texts.some((t) => new RegExp(re, 'i').test(t))) {
                pathOk = false;
                why.push(`no change matching /${re}/`);
            }
        }
    }
    // Over-edit: existing things changed beyond the allowed set.
    const allowedDesc = descendants(before, [...tset, ...(e.allow ?? []).filter((a) => typeof a === 'string')]);
    const allowRe = (e.allow ?? []).filter((a) => a instanceof RegExp);
    const wallIds = e.wall ? new Set(changes.filter((x) => x.scope === 'entity' && /^shape\.params\.finish[AB]/.test(x.path)).map((x) => x.id)) : new Set();
    const over = [];
    for (const id of existingChanged) {
        if (allowedDesc.has(id) || allowRe.some((r) => r.test(id)) || wallIds.has(id))
            continue;
        if (!e.t && !e.removed && !e.added && !e.wall)
            continue; // env/game-only cases: any entity change is stray
        over.push(id);
    }
    if (!e.t && !e.removed && !e.added && !e.wall)
        for (const id of existingChanged)
            if (!allowRe.some((r) => r.test(id)))
                over.push(id);
    for (const id of removedIds)
        if (!tset.has(id) && !allowedDesc.has(id))
            over.push(id);
    if (!e.env && envKeys.length > 0)
        over.push(`environment.${envKeys[0]}`);
    if (!e.game && !e.removed && changes.some((x) => x.scope === 'rule' || x.scope === 'state' || x.scope === 'hud'))
        over.push('rules/state');
    if (!e.player && changes.some((x) => x.scope === 'player'))
        over.push('player');
    if (!e.voxel && changes.some((x) => x.scope === 'voxel'))
        over.push('voxel');
    const overEdit = [...new Set(over)];
    if (overEdit.length > 0)
        why.push(`also changed ${overEdit.slice(0, 3).join(', ')}${overEdit.length > 3 ? ` (+${overEdit.length - 3})` : ''}`);
    const ok = targetOk && pathOk && overEdit.length === 0;
    return { ...base, ok, targetOk, pathOk, overEdit, why: why.join('; ') };
}
/** Run one case (with its earlier turns) through an engine. */
export async function runCase(engine, c) {
    let world = loadFixture(c.world);
    const state = { memory: EMPTY_MEMORY, history: [], selection: [], heading: c.heading ?? 0 };
    for (const p of c.prior ?? []) {
        const r = await engine.turn(world, p, state);
        world = r.world;
        state.history.push({ role: 'user', content: p }, { role: 'assistant', content: 'Done.' });
    }
    state.selection = c.selection ?? [];
    const before = world;
    const res = await engine.turn(before, c.prompt, state);
    return score(c, before, res);
}
/** Summarise verdicts. */
export function summarise(engine, vs) {
    const ms = vs.map((v) => v.ms).sort((a, b) => a - b);
    const q = (p) => ms[Math.min(ms.length - 1, Math.floor(p * ms.length))] ?? 0;
    return {
        engine,
        total: vs.length,
        passed: vs.filter((v) => v.ok).length,
        targetAccuracy: vs.filter((v) => v.targetOk).length / vs.length,
        overEditRate: vs.filter((v) => v.overEdit.length > 0).length / vs.length,
        p50: q(0.5),
        p95: q(0.95),
        llmCallsPerEdit: vs.reduce((s, v) => s + v.llmCalls, 0) / vs.length,
    };
}
