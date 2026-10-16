import { isWinnableKind, playtest } from './autoplay';
import { estimateTokens, isRegression, jsonTokens, projectedLatencyMs, scoreChange, worldChanges } from './metrics';
import { recordingProvider, runAgent, runVerify, worldTokens } from './world-eval';
/** Tags that are structure, not things a person would name. */
const SKIP_TAGS = new Set(['focus', 'backdrop', 'sky', 'library', 'hazard', 'character', 'npc', 'traffic', 'player-car', 'toy', 'ball', 'ground', 'water', 'path']);
const IRREGULAR = { domino: 'dominoes', cactus: 'cacti', ghost: 'ghosts' };
function plural(noun) {
    const irregular = IRREGULAR[noun];
    if (irregular)
        return irregular;
    return /(s|x|ch|sh)$/.test(noun) ? `${noun}es` : `${noun}s`;
}
const COLOR_PATHS = [/^material\.color$/, /^shape\.params\.color$/, /^shape\.of\.params\.color$/];
// A resize is either the transform scale or, for shapes sized by their own parameters (a tree's height, a rock's size), that parameter.
const SCALE_PATHS = [/^transform\.scale\.[012]$/, /^transform\.position\.1$/, /^shape\.params\.(size|height|radius|width|depth|length|scale)(\.[012])?$/];
const GLOW_PATHS = [/^material\.emissive/, /^shape\.params\.emissive/];
/** Things a person names in a world: top-level entity tags with 2..40 instances, most frequent first. */
export function namedThings(world) {
    const top = Object.values(world.entities).filter((e) => e.parent === null);
    const nouns = new Set();
    for (const e of top)
        for (const t of e.tags)
            if (!SKIP_TAGS.has(t) && /^[a-z]{3,12}$/.test(t))
                nouns.add(t);
    return [...nouns]
        .map((noun) => ({ noun, ids: top.filter((e) => isA(e, noun)).map((e) => e.id) }))
        .filter((t) => t.ids.length >= 2 && t.ids.length <= 40)
        .sort((a, b) => b.ids.length - a.ids.length || a.noun.localeCompare(b.noun));
}
/**
 * "Is this a noun?" as a person reading the outliner would say it: the noun
 * starts a word in the entity's id, name, tags, generator (also inside a
 * scatter) or primitive.
 */
export function isA(e, noun) {
    const gen = e.shape.kind === 'procedural' ? e.shape.generator : e.shape.kind === 'scatter' && e.shape.of.kind === 'procedural' ? e.shape.of.generator : '';
    const prim = e.shape.kind === 'primitive' ? e.shape.primitive : '';
    const text = [e.id, e.name, e.tags.join(' '), gen, prim].join(' ').toLowerCase();
    return new RegExp(`(^|[^a-z])${noun}`).test(text);
}
/** Build the edit cases for one base world (deterministic). `limit` caps the number per world. */
export function editsFor(baseId, world, limit = 9) {
    const things = namedThings(world);
    const out = [];
    const push = (c) => {
        out.push({ ...c, id: `${baseId}-${String(out.length + 1).padStart(2, '0')}`, baseId });
    };
    const [a, b, c] = things;
    if (a) {
        push({ kind: 'recolor', noun: a.noun, request: `make all the ${plural(a.noun)} red`, intent: { targets: a.ids, allowedPaths: COLOR_PATHS } });
        push({ kind: 'bigger', noun: a.noun, request: `make all the ${plural(a.noun)} bigger`, intent: { targets: a.ids, allowedPaths: SCALE_PATHS } });
    }
    if (b) {
        push({ kind: 'recolor', noun: b.noun, request: `paint all the ${plural(b.noun)} blue`, intent: { targets: b.ids, allowedPaths: COLOR_PATHS } });
        push({ kind: 'remove', noun: b.noun, request: `remove all the ${plural(b.noun)}`, intent: { targets: b.ids, expectRemoved: b.ids } });
    }
    if (c) {
        push({ kind: 'smaller', noun: c.noun, request: `make all the ${plural(c.noun)} smaller`, intent: { targets: c.ids, allowedPaths: SCALE_PATHS } });
        push({ kind: 'glow', noun: c.noun, request: `make all the ${plural(c.noun)} glow`, intent: { targets: c.ids, allowedPaths: GLOW_PATHS, allowedSections: { environment: [/^bloom$/] } } });
    }
    // Edits that would be no-ops (already night, already raining) are not asked.
    const env = world.environment;
    const tod = env.timeOfDay;
    const alreadyNight = env.sky === 'night' || (tod !== undefined && (tod >= 21 || tod <= 4));
    if (!alreadyNight)
        push({ kind: 'night', request: 'make it night', intent: { targets: [], requireSections: ['environment'], allowedSections: { environment: [/./] } } });
    push({ kind: 'add', request: 'add 3 rocks', intent: { targets: [], expectAdded: { min: 1, match: /./ } } });
    if (env.weather !== 'rain')
        push({ kind: 'rain', request: 'make it rain', intent: { targets: [], requireSections: ['environment'], allowedSections: { environment: [/./] } } });
    if (out.length <= limit)
        return out;
    // A smaller sample keeps the mix of edit kinds: evenly spaced picks.
    return Array.from({ length: limit }, (_, i) => out[Math.floor((i * out.length) / limit)]);
}
/** Prepare a base: its prompt, generated world, verdicts. */
export async function prepareBase(id, prompt, world) {
    const verified = (await runVerify(world)).passed;
    const winnable = isWinnableKind(world) ? (await playtest(world)).won : null;
    return { id, prompt, world, verified, winnable };
}
function touched(patches) {
    const ids = new Set();
    for (const p of patches) {
        const q = p;
        if (q.id)
            ids.add(q.id);
        else if (q.entity?.id)
            ids.add(q.entity.id);
        else if (q.op === 'clear')
            ids.add('*');
    }
    return ids.size;
}
async function judge(base, after, verifiedAfter, intent) {
    const collateral = scoreChange(worldChanges(base.world, after), intent);
    const verifyAfter = verifiedAfter ?? (after === base.world ? base.verified : (await runVerify(after)).passed);
    let winnableAfter = null;
    if (base.winnable !== null)
        winnableAfter = after === base.world ? base.winnable : isWinnableKind(after) ? (await playtest(after)).won : false;
    return {
        satisfied: collateral.satisfied,
        collateral,
        verifyBefore: base.verified,
        verifyAfter,
        verifyRegression: isRegression({ before: base.verified, after: verifyAfter }),
        winnableBefore: base.winnable,
        winnableAfter,
        playRegression: base.winnable !== null && winnableAfter !== null ? isRegression({ before: base.winnable, after: winnableAfter }) : false,
    };
}
/** Assumed generation speed for the projected latency (tokens per second of a hosted model). */
export const ASSUMED_TOKENS_PER_SECOND = 60;
/** Run one edit case through all three arms. */
export async function runEdit(base, c, mock, sandbox) {
    // --- Aether: the real loop on the existing world.
    const provider = recordingProvider(mock());
    const run = await runAgent(c.request, { provider, sandbox, initial: base.world });
    const finalVerified = run.verdicts.length > 0 ? run.verdicts[run.verdicts.length - 1] : undefined;
    const aetherJudged = await judge(base, run.world, finalVerified, c.intent);
    const aether = {
        ...aetherJudged,
        outputTokens: run.outputTokens,
        inputTokens: run.inputTokens,
        patchOps: run.patches.length,
        entitiesTouched: touched(run.patches),
        localMs: run.ms,
        projectedMs: projectedLatencyMs(run.ms, run.outputTokens, ASSUMED_TOKENS_PER_SECOND),
    };
    // --- Regenerate (oracle): re-emit the whole edited document, copied perfectly.
    const doc = worldTokens(run.world);
    const oracleVerifyStart = performance.now();
    await runVerify(run.world);
    const oracleLocal = performance.now() - oracleVerifyStart;
    const oracleScored = scoreChange(worldChanges(base.world, run.world), c.intent);
    const regenOracle = {
        satisfied: aether.satisfied,
        outputTokens: doc,
        inputTokens: worldTokens(base.world) + estimateTokens(c.request),
        patchOps: Object.keys(run.world.entities).length,
        entitiesTouched: Object.keys(run.world.entities).length,
        localMs: oracleLocal,
        projectedMs: projectedLatencyMs(oracleLocal, doc, ASSUMED_TOKENS_PER_SECOND),
        // Perfect copying: nothing outside the intent differs from Aether's own result.
        collateral: { ...oracleScored, completion: aether.collateral.completion, collateralLeaves: 0, collateralEntities: 0, collateralRemoved: 0, collateralAdded: 0, examples: [] },
        verifyBefore: aether.verifyBefore,
        verifyAfter: aether.verifyAfter,
        verifyRegression: aether.verifyRegression,
        winnableBefore: aether.winnableBefore,
        winnableAfter: aether.winnableAfter,
        playRegression: aether.playRegression,
    };
    // --- Regenerate (fresh): ask for the whole scene again with the edit folded in.
    const freshProvider = recordingProvider(mock());
    const freshPrompt = `${base.prompt}, and ${c.request}`;
    const fresh = await runAgent(freshPrompt, { provider: freshProvider, sandbox });
    const freshVerified = fresh.verdicts.length > 0 ? fresh.verdicts[fresh.verdicts.length - 1] : undefined;
    const freshJudged = await judge(base, fresh.world, freshVerified, c.intent);
    const regenFresh = {
        ...freshJudged,
        outputTokens: fresh.outputTokens,
        inputTokens: fresh.inputTokens,
        patchOps: fresh.patches.length,
        entitiesTouched: Object.keys(fresh.world.entities).length,
        localMs: fresh.ms,
        projectedMs: projectedLatencyMs(fresh.ms, fresh.outputTokens, ASSUMED_TOKENS_PER_SECOND),
    };
    return { case: c, baseEntities: Object.keys(base.world.entities).length, aether, regenOracle, regenFresh };
}
export { jsonTokens };
