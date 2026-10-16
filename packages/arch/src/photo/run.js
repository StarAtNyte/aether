/**
 * Runs a {@link PhotoBuild} through the design tools: the plan first, then the placement steps in phases,
 * each phase one `place_items` call. What can only be known after earlier steps (the built id of a window,
 * the top of the bed a picture hangs above) is resolved from the world between phases.
 *
 * The tool caller is injected: the agent passes one that commits through the host (so the run shows in the
 * chat and the undo history); the default applies the patches to a document in memory (tests, evaluation).
 */
import { applyPatches } from '@aether/core';
import { runDesignTool } from '../scene/dispatch';
import { findItem, isLookupError } from '../scene/facts';
import { readScene } from '../scene/read';
import { PHOTO_BUILDING_ID, PHOTO_ROOM_ID } from './derive';
/** A caller that runs the design tools on a document and applies the patches in memory. */
export function memoryCaller(initial) {
    let world = initial;
    return {
        call: (name, input) => {
            const res = runDesignTool(world, name, input);
            if (res.patches.length > 0)
                world = applyPatches(world, res.patches).world;
            return { world, text: res.text, ok: res.ok || res.accepted > 0 };
        },
        world: () => world,
    };
}
function sceneOf(world) {
    return readScene(world, PHOTO_BUILDING_ID);
}
/** Built ids of the plan's openings, matched by wall and centre. */
export function builtOpenings(world, build) {
    const scene = sceneOf(world);
    const out = {};
    const room = scene?.rooms.find((r) => r.key === PHOTO_ROOM_ID);
    if (!room)
        return out;
    for (const o of build.plan.levels[0]?.openings ?? []) {
        if (!o.id)
            continue;
        const found = room.walls
            .filter((w) => w.compass === o.wall)
            .flatMap((w) => w.openings)
            .find((x) => Math.abs(x.centre - o.along) < 0.35 && (o.kind === 'window') === (x.kind === 'window'));
        if (found)
            out[o.id] = found.id;
    }
    return out;
}
/** The `place_items` items of one phase with their world-dependent fields filled in. */
export function resolveStep(world, step, openings) {
    const item = { ...step.input };
    if (step.openingAlias !== undefined) {
        const built = openings[step.openingAlias];
        if (!built)
            return { error: `window "${step.openingAlias}" was not built, so the curtains have nothing to hang beside` };
        item['opening'] = built;
    }
    if (step.aboveOf) {
        const scene = sceneOf(world);
        const host = scene ? findItem(scene, step.aboveOf.target) : null;
        if (!host || isLookupError(host))
            return { error: `"${step.aboveOf.target}" is not placed, so ${step.id} cannot hang above it` };
        item['y'] = Math.round((host.y1 + step.aboveOf.gap) * 100) / 100;
    }
    return { item };
}
const PHASES = [['rug', 'floor'], ['surface'], ['wall'], ['curtain'], ['ceiling', 'trim']];
/** Build the shell and place every step. Never throws; refusals are in the outcomes. */
export async function runBuild(world, build, call) {
    let current = world;
    const plan = await call('design_plan', { plan: build.plan });
    current = plan.world;
    const outcomes = [];
    if (!plan.ok)
        return { world: current, shellOk: false, shellText: plan.text, outcomes, openings: {} };
    const openings = builtOpenings(current, build);
    // An opening the builder dropped (it says so in a note) must not pass unnoticed: the compare loop is told.
    for (const o of build.plan.levels[0]?.openings ?? []) {
        if (o.id && !openings[o.id])
            outcomes.push({ id: o.id, kind: o.kind, ok: false, text: `the ${o.kind} ${o.id} on the ${o.wall} wall was not built (${(plan.text.split('\n').find((l) => /^Note:/.test(l)) ?? 'it did not fit the wall').slice(0, 200)})` });
    }
    for (const phases of PHASES) {
        const steps = build.steps.filter((s) => phases.includes(s.phase));
        // Pieces hung above another need that piece placed first: split the phase when one names a piece of the same phase.
        const now = steps.filter((s) => !s.aboveOf);
        const later = steps.filter((s) => s.aboveOf);
        for (const group of [now, later]) {
            if (group.length === 0)
                continue;
            const items = [];
            for (const step of group) {
                const r = resolveStep(current, step, openings);
                if ('error' in r)
                    outcomes.push({ id: step.id, kind: String(step.input['kind']), ok: false, text: r.error });
                else
                    items.push({ step, item: r.item });
            }
            if (items.length === 0)
                continue;
            const reply = await call('place_items', { items: items.map((i) => i.item), message: `Place ${items.map((i) => i.step.id).slice(0, 4).join(', ')}${items.length > 4 ? '…' : ''}` });
            current = reply.world;
            const refused = refusedByIndex(reply.text);
            items.forEach(({ step }, k) => {
                const bad = refused.get(k + 1) ?? (reply.ok || reply.text.includes('applied') ? undefined : reply.text.slice(0, 300));
                outcomes.push({ id: step.id, kind: String(step.input['kind']), ok: bad === undefined, text: bad ?? '' });
            });
        }
    }
    return { world: current, shellOk: true, shellText: plan.text, outcomes, openings };
}
/** The refusal reason of each item index (1-based, as the tool numbers them) that `place_items` reported refused. */
function refusedByIndex(text) {
    const out = new Map();
    // A refusal can span lines (a heading and one line per problem): split before each `[n …]` label.
    for (const block of text.split(/\n(?=\[\d+[^\]]*\] )/)) {
        const m = /^\[(\d+)[^\]]*\] refused: ([\s\S]*)$/.exec(block);
        if (m)
            out.set(Number(m[1]), (m[2] ?? '').replace(/\s*\n\s*/g, ' ').slice(0, 400));
    }
    return out;
}
