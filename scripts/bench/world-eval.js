/**
 * Shared world-generation and checking helpers of the benchmark: run the
 * real `WorldAgent` loop against any provider, record what the model said
 * and cost, capture the world before and after repair, and judge the result
 * against the structural expectations of a prompt.
 */
import { scatterCount, stableStringify } from '@aether/core';
import { WorldAgent, formatUserTurn } from '@aether/agent';
import { summarizeWorld } from '@aether/core';
import { loadLibraryGenerator } from '@aether/procgen';
import { CATALOGS, NodeAgentHost, runVerify } from '../lib/headless-world';
import { estimateTokens, jsonTokens } from './metrics';
/** Wrap `inner`: record every call, refuse beyond `maxCalls` (shared across the run). */
export function recordingProvider(inner, maxCalls = Infinity) {
    const records = [];
    return {
        name: inner.name,
        records,
        calls: () => records.length,
        async complete(req, signal) {
            if (records.length >= maxCalls)
                throw new Error(`call budget exhausted (${maxCalls})`);
            const res = await inner.complete(req, signal);
            const last = [...req.messages].reverse().find((m) => m.role === 'user');
            const userText = last ? (typeof last.content === 'string' ? last.content : stableStringify(last.content)) : '';
            const patches = [];
            for (const b of res.content) {
                if (b.type === 'tool_use' && b.name === 'apply_patches') {
                    const input = b.input;
                    if (Array.isArray(input.patches))
                        patches.push(...input.patches);
                }
            }
            records.push({
                role: req.role,
                outputTokens: res.usage?.outputTokens ?? estimateTokens(stableStringify(res.content)),
                userTurnTokens: estimateTokens(userText),
                patches,
            });
            return res;
        },
    };
}
/** A host that remembers the world at its first verification (before any repair). */
export class BenchHost extends NodeAgentHost {
    firstVerified;
    firstVerdict;
    verdicts = [];
    /** Extra verification (e.g. a playtest) folded into every verdict. */
    extra;
    async verify(world) {
        const std = await super.verify(world);
        let r = std;
        if (this.extra) {
            const x = await this.extra(world);
            r = { report: std.report, summary: [std.passed ? '' : std.summary, x.passed ? '' : x.summary].filter(Boolean).join('\n') || std.summary, passed: std.passed && x.passed };
        }
        this.firstVerified ??= world;
        this.firstVerdict ??= r.passed;
        this.verdicts.push(r.passed);
        return r;
    }
}
/** Run the real agent loop for `prompt`. Never throws. */
export async function runAgent(prompt, opts) {
    const host = opts.host ?? new BenchHost(opts.sandbox, opts.initial);
    if (opts.verifyOverride) {
        const override = opts.verifyOverride;
        host.extra = async (w) => {
            const r = await override(w);
            return { summary: r.summary, passed: r.passed };
        };
    }
    const agent = new WorldAgent({ provider: opts.provider, catalogs: CATALOGS, resolveGenerator: loadLibraryGenerator, maxRepairs: opts.maxRepairs ?? 2 });
    const before = opts.provider.records.length;
    const t0 = performance.now();
    let applied = 0;
    let rejected = 0;
    let repairs = 0;
    let error;
    const events = [];
    for await (const ev of agent.run(prompt, host)) {
        if (ev.type === 'patches') {
            applied += ev.result.applied;
            rejected += ev.result.errors.length;
        }
        else if (ev.type === 'repair')
            repairs++;
        else if (ev.type === 'error')
            error = ev.text.slice(0, 200);
        if (ev.type !== 'patches' && events.length < 200)
            events.push(ev);
    }
    const ms = performance.now() - t0;
    const mine = opts.provider.records.slice(before);
    const world = host.getWorld();
    return {
        world,
        firstPass: host.firstVerified ?? world,
        firstPassVerified: host.firstVerdict ?? false,
        verdicts: [...host.verdicts],
        repairs,
        calls: mine.length,
        outputTokens: mine.reduce((s, r) => s + r.outputTokens, 0),
        inputTokens: mine.reduce((s, r) => s + r.userTurnTokens, 0),
        patches: mine.flatMap((r) => r.patches),
        patchesApplied: applied,
        patchesRejected: rejected,
        ms,
        ...(error ? { error } : {}),
        events,
    };
}
/** The world summary the planner reads (what an edit request costs on the input side). */
export function summaryTokens(world, request) {
    return estimateTokens(formatUserTurn(summarizeWorld(world, { maxEntities: 200 }), request));
}
/** Whole-document tokens: the input a "regenerate everything" model must read to preserve the world. */
export function worldTokens(world) {
    return jsonTokens(world);
}
/** Text a person would search for nouns in: entity ids, names, tags, generators, descriptions, environment. */
export function haystack(world) {
    // The world's description is the user's own request echoed back, so it is not evidence; name and content are.
    const parts = [world.name, JSON.stringify(world.environment), world.voxel ? 'voxel block world' : ''];
    for (const e of Object.values(world.entities)) {
        parts.push(e.id, e.name, e.description ?? '', e.tags.join(' '));
        if (e.shape.kind === 'procedural')
            parts.push(e.shape.generator);
        if (e.shape.kind === 'primitive')
            parts.push(e.shape.primitive);
    }
    for (const r of world.rules)
        parts.push(r.id);
    return parts.join(' ').toLowerCase();
}
/** Fraction of `mustHave` patterns found in the world, plus the missing ones. */
export function fidelity(world, mustHave) {
    if (mustHave.length === 0)
        return { score: 1, missing: [] };
    const text = haystack(world);
    const missing = mustHave.filter((m) => !new RegExp(m, 'i').test(text));
    return { score: (mustHave.length - missing.length) / mustHave.length, missing };
}
const count = (w) => Object.keys(w.entities).length;
/**
 * Does the world have the shape its kind of request needs? Games need a win
 * condition, physics scenes a meaningful test beyond "nothing overlaps",
 * voxel prompts voxel terrain, houses a built plan, scenes enough content.
 */
export function structure(kind, world, winnable) {
    switch (kind) {
        case 'game':
            return winnable ? { ok: true, why: 'has a win condition' } : { ok: false, why: 'no win condition (no win rule, no goal)' };
        case 'physics': {
            const meaningful = world.tests.filter((t) => t.kind !== 'noOverlap');
            const dynamic = Object.values(world.entities).filter((e) => e.physics?.body === 'dynamic').length;
            if (dynamic === 0)
                return { ok: false, why: 'no dynamic bodies' };
            return meaningful.length > 0 ? { ok: true, why: `${dynamic} dynamic bodies, ${meaningful.length} behavioural tests` } : { ok: false, why: 'only the overlap test' };
        }
        case 'voxel':
            return world.voxel ? { ok: true, why: 'voxel terrain present' } : { ok: false, why: 'no voxel terrain' };
        case 'house': {
            const nav = world.tests.some((t) => t.kind === 'navigable');
            return count(world) >= 30 && nav ? { ok: true, why: `${count(world)} entities, navigable test` } : { ok: false, why: `${count(world)} entities${nav ? '' : ', no navigable test'}` };
        }
        case 'scene': {
            // A scatter is one entity but hundreds of objects: count what is on screen, not only the document's entries.
            const objects = count(world) + Object.values(world.entities).reduce((n, e) => n + Math.max(0, scatterCount(e) - 1), 0);
            return objects >= 25 ? { ok: true, why: `${objects} objects` } : { ok: false, why: `only ${objects} objects` };
        }
    }
}
/** Generic-fallback detector: the planner's default meadow means it understood nothing. */
export function isDefaultFallback(world) {
    return /^mountain meadow$/i.test(world.name.trim());
}
export { runVerify };
