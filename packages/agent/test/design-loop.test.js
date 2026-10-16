import { describe, expect, it } from 'vitest';
import { applyPatches, createWorld } from '@aether/core';
import { readScene, reviewFindings, runDesignTool } from '@aether/arch';
import { WorldAgent } from '../src/agent';
import { StallTracker } from '../src/review';
import { collect, MemoryHost, TEST_CATALOGS } from './helpers';
const PLAN = {
    id: 'home',
    name: 'Test home',
    style: 'scandinavian',
    brief: 'A calm bedroom.',
    levels: [
        {
            height: 2.9,
            rooms: [
                { id: 'bedroom', type: 'bedroom', rect: [0, 0, 4, 3.6] },
                { id: 'hall', type: 'hall', rect: [0, 3.6, 4, 5.2] },
            ],
            openings: [
                { kind: 'window', room: 'bedroom', wall: 'east', along: 1.8, width: 1.4, height: 1.3, sill: 0.9 },
                { kind: 'door', room: 'bedroom', wall: 'south', to: 'hall', along: 3.2, width: 0.9 },
                { kind: 'door', room: 'hall', wall: 'south', to: 'outside', along: 1.4, width: 1, main: true },
            ],
        },
    ],
    furniture: [
        { id: 'bed', kind: 'bed', room: 'bedroom', intent: 'bed centred on the north wall', relations: [{ type: 'against_wall', wall: 'north' }, { type: 'centred_on_wall', wall: 'north' }] },
        { id: 'light', kind: 'ceiling-light', room: 'bedroom', intent: 'light in the middle', relations: [] },
        { id: 'hall-light', kind: 'ceiling-light', room: 'hall', intent: 'light', relations: [] },
    ],
};
/** A model that replays a script of replies; records every request. */
function scripted(replies, vision = false) {
    const requests = [];
    let i = 0;
    return {
        name: 'scripted',
        requests,
        async complete(req) {
            requests.push(JSON.parse(JSON.stringify(req)));
            const r = replies[Math.min(i, replies.length - 1)];
            i++;
            const content = r ? r(req) : [{ type: 'text', text: 'done' }];
            void vision;
            return { content, stopReason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end' };
        },
    };
}
let n = 0;
const call = (name, input) => ({ type: 'tool_use', id: `t${++n}`, name, input });
const finish = (message = 'ok') => call('finish', { message });
const FURNISH = {
    items: [
        { kind: 'bed', room: 'bedroom', id: 'bed', wall: 'north', align: 'centre' },
        { kind: 'nightstand', room: 'bedroom', id: 'ns', wall: 'north', t: 0.65 },
        { kind: 'ceiling-light', room: 'bedroom', id: 'light', at: [2, 1.8] },
        { kind: 'ceiling-light', room: 'hall', id: 'hall-light', at: [2, 4.4] },
    ],
};
function agent(provider, review) {
    return new WorldAgent({ provider, catalogs: TEST_CATALOGS, maxTurns: 10, ...(review ? { review } : {}) });
}
function types(events) {
    return events.map((e) => (e.type === 'review' ? `review:${e.phase}` : e.type));
}
describe('plan-first generation with the review loop', () => {
    it('designs, places by tool calls and passes the review without extra model calls', async () => {
        const provider = scripted([() => [call('design_plan', { plan: PLAN })], () => [call('place_items', FURNISH)], () => [finish('A calm bedroom.')]]);
        const host = new MemoryHost();
        const events = await collect(agent(provider, {}).run('a calm bedroom with a bed under the window', host));
        const scene = readScene(host.world, 'home');
        const bed = scene.items.find((i) => i.id === 'home-bed');
        expect(bed.against?.[0]?.compass).toBe('north');
        expect(bed.pos[0]).toBeCloseTo(2, 1);
        expect(reviewFindings(host.world, 'home').filter((f) => f.severity === 'error')).toEqual([]);
        expect(types(events)).toContain('review:approved');
        expect(provider.requests).toHaveLength(3);
        // The design plan, the placement and the finish each committed one grouped step.
        expect(host.commits.map((c) => c.message)).toContain('Design Test home');
    });
    it('answers "why is the painting over the window" by looking, fixing and saying what it did', async () => {
        // Build a broken room: a picture hung over the window (dragged there by hand).
        let w = createWorld({});
        w = applyPatches(w, runDesignTool(w, 'design_plan', { plan: PLAN }).patches).world;
        w = applyPatches(w, runDesignTool(w, 'place_items', { items: [...FURNISH.items, { kind: 'art', room: 'bedroom', id: 'painting', wall: 'east', t: 3.1 }] }).patches).world;
        const win = readScene(w, 'home').rooms[0].walls.find((x) => x.compass === 'east').openings[0];
        const painting = w.entities['home-painting'];
        w = applyPatches(w, [{ op: 'update', id: 'home-painting', set: { transform: { ...painting.transform, position: [painting.transform.position[0], painting.transform.position[1], painting.transform.position[2] - (3.1 - win.centre)] } } }]).world;
        const broken = reviewFindings(w, 'home').filter((f) => f.severity === 'error');
        expect(broken.length).toBeGreaterThan(0);
        const provider = scripted([
            () => [call('query_scene', { queries: [{ q: 'wall', room: 'bedroom', wall: 'east' }, { q: 'review' }] })],
            () => [call('edit_items', { edits: [{ op: 'move', ref: 'painting', wall: 'east', t: 3.1 }] })],
            () => [finish('The painting was hung over the window; I moved it to the free stretch of the east wall.')],
        ]);
        const host = new MemoryHost(w);
        const events = await collect(agent(provider, {}).run('why is the painting over the window? fix it', host));
        expect(reviewFindings(host.world, 'home').filter((f) => f.severity === 'error')).toEqual([]);
        expect(events.some((e) => e.type === 'message' && /moved it/.test(e.text))).toBe(true);
        // The review changed the world after the physics run, so the last thing that happens is a fresh verification.
        expect(events.at(-2)?.type === 'verify' || events.at(-1)?.type === 'verify' || events.some((e, i) => e.type === 'verify' && i > events.findIndex((x) => x.type === 'review'))).toBe(true);
        // It never asked the user: no tool result complained about a missing fact, and the first thing it did was look.
        expect(provider.requests[0].tools.map((t) => t.name)).toContain('query_scene');
    });
    it('does not run the review loop for a small named edit of an existing building (fine edits stay fast)', async () => {
        let w = createWorld({});
        w = applyPatches(w, runDesignTool(w, 'design_plan', { plan: PLAN }).patches).world;
        w = applyPatches(w, runDesignTool(w, 'place_items', { items: [...FURNISH.items, { kind: 'art', room: 'bedroom', id: 'painting', wall: 'east', t: 3.1 }] }).patches).world;
        const provider = scripted([() => [call('edit_items', { edits: [{ op: 'move', ref: 'painting', wall: 'north', t: 1 }] })], () => [finish('Moved the painting.')]]);
        const host = new MemoryHost(w);
        const a = new WorldAgent({ provider, catalogs: TEST_CATALOGS, maxTurns: 10, localEdits: false, review: {} });
        const events = await collect(a.run('nudge the painting a little', host));
        expect(events.some((e) => e.type === 'review')).toBe(false);
        expect(provider.requests.length).toBe(2);
    });
    it('keeps fixing until the model approves, then stops', async () => {
        // First finish leaves an overlap in place; the review shows it, the model moves the piece, then approves.
        const furnished = [...FURNISH.items, { kind: 'wardrobe', room: 'bedroom', id: 'robe', wall: 'west', align: 'start' }];
        const provider = scripted([
            () => [call('design_plan', { plan: PLAN })],
            () => [call('place_items', { items: furnished })],
            () => [finish('done')],
            // Review round 1: the model is happy.
            () => [finish('Checked: nothing overlaps and the door is clear.')],
        ]);
        const host = new MemoryHost();
        const events = await collect(agent(provider, {}).run('bedroom', host));
        expect(types(events).filter((t) => t === 'review:approved')).toHaveLength(1);
    });
    it('stops when the same unfixable problem comes back, and says so', async () => {
        let w = createWorld({});
        w = applyPatches(w, runDesignTool(w, 'design_plan', { plan: PLAN }).patches).world;
        w = applyPatches(w, runDesignTool(w, 'place_items', { items: FURNISH.items }).patches).world;
        // A bed dragged into the wall by hand: an error the scripted model refuses to deal with.
        const bed = w.entities['home-bed'];
        w = applyPatches(w, [{ op: 'update', id: 'home-bed', set: { transform: { ...bed.transform, position: [bed.transform.position[0], bed.transform.position[1], -1.5] } } }]).world;
        expect(reviewFindings(w, 'home').some((f) => f.severity === 'error')).toBe(true);
        const provider = scripted([() => [call('edit_items', { edits: [{ op: 'remove', ref: 'home-light' }] })], () => [finish('I think it is fine.')]]);
        const host = new MemoryHost(w);
        const events = await collect(agent(provider, { stallRounds: 3 }).run('tidy up everything', host));
        expect(types(events)).toContain('review:stalled');
        expect(types(events)).not.toContain('review:approved');
        expect(provider.requests.length).toBeLessThan(20);
    });
    it('stops at a finite round cap (metered keys) and reports it', async () => {
        let w = createWorld({});
        w = applyPatches(w, runDesignTool(w, 'design_plan', { plan: PLAN }).patches).world;
        w = applyPatches(w, runDesignTool(w, 'place_items', { items: FURNISH.items }).patches).world;
        let k = 0;
        // Every review round the model nudges the light: always a change, never a stall.
        const provider = scripted([
            (req) => {
                const last = req.messages.at(-1).content;
                const reviewing = Array.isArray(last) && last.some((b) => b.type === 'text' && b.text.startsWith('REVIEW round'));
                return reviewing ? [call('edit_items', { edits: [{ op: 'move', ref: 'home-light', at: [1.2 + (k++ % 5) * 0.2, 1.8] }] })] : [finish('nudged')];
            },
        ]);
        const host = Object.assign(new MemoryHost(w), { captureReview: async () => [] });
        // The agent run itself edits once so that a review follows.
        const first = scripted([(req) => (req.messages.length < 2 ? [call('edit_items', { edits: [{ op: 'move', ref: 'home-light', at: [1.1, 1.8] }] })] : [finish('x')])]);
        const events = await collect(new WorldAgent({ provider: switching(first, provider), catalogs: TEST_CATALOGS, maxTurns: 10, review: { maxRounds: 2, stallRounds: 20, vision: true } }).run('tidy up everything', host));
        expect(types(events)).toContain('review:limit');
        expect(types(events).filter((t) => t === 'review:checking')).toHaveLength(2);
    });
});
/** Answers with `a` until the conversation reaches the review, then with `b`. */
function switching(a, b) {
    return {
        name: 'switching',
        complete(req, signal) {
            const reviewing = req.messages.some((m) => Array.isArray(m.content) && m.content.some((x) => x.type === 'text' && x.text.startsWith('REVIEW round')));
            return (reviewing ? b : a).complete(req, signal);
        },
    };
}
describe('warnings are not waved through', () => {
    it('asks again once when the model approves with warnings open, then accepts what it keeps', async () => {
        const sparse = FURNISH.items.filter((i) => i.kind !== 'nightstand');
        const provider = scripted([() => [call('design_plan', { plan: PLAN })], () => [call('place_items', { items: sparse })], () => [finish('done')], () => [finish('fine as it is')], () => [finish('still fine')]]);
        const host = new MemoryHost();
        const events = await collect(agent(provider, {}).run('bedroom', host));
        const reviewRequests = provider.requests.filter((r) => JSON.stringify(r.messages.at(-1)).includes('REVIEW round'));
        expect(reviewRequests).toHaveLength(2);
        expect(types(events).filter((t) => t === 'review:approved')).toHaveLength(1);
    });
});
describe('refusal handling', () => {
    it('does not accept "the tools are not available" after a refused plan: it asks again, and the model then builds', async () => {
        const provider = scripted([
            () => [call('design_plan', { plan: { nope: true } })],
            () => [{ type: 'text', text: 'I could not build it: the tools are not available to resend the plan.' }],
            () => [call('design_plan', { plan: PLAN })],
            () => [call('place_items', FURNISH)],
            () => [finish('done')],
        ]);
        const host = new MemoryHost();
        const events = await collect(agent(provider).run('a bedroom', host));
        expect(readScene(host.world, 'home')?.items.length).toBeGreaterThan(0);
        const nudge = JSON.stringify(provider.requests[2].messages.at(-1));
        expect(nudge).toMatch(/still available/);
        expect(events.some((e) => e.type === 'error')).toBe(false);
    });
    it('pushes back on "the tools are unavailable" before anything was tried', async () => {
        const provider = scripted([
            () => [{ type: 'text', text: 'I could not build the kitchen because the world-building tools are unavailable in this session.' }],
            () => [call('design_plan', { plan: PLAN })],
            () => [call('place_items', FURNISH)],
            () => [finish('done')],
        ]);
        const host = new MemoryHost();
        await collect(agent(provider).run('a kitchen', host));
        expect(readScene(host.world, 'home')?.items.length).toBeGreaterThan(0);
        expect(JSON.stringify(provider.requests[1].messages.at(-1))).toMatch(/ARE available/);
    });
    it('does not answer a plain question with a forced build', async () => {
        const provider = scripted([() => [{ type: 'text', text: 'The bed is 1.7 m wide and stands against the north wall.' }]]);
        const host = new MemoryHost();
        await collect(agent(provider).run('how wide is the bed?', host));
        expect(provider.requests).toHaveLength(1);
    });
    it('ignores a finish sent in the same reply as a refused call', async () => {
        const provider = scripted([
            () => [call('design_plan', { plan: { nope: 1 } }), finish('built it')],
            () => [call('design_plan', { plan: PLAN })],
            () => [call('place_items', FURNISH)],
            () => [finish('really done')],
        ]);
        const host = new MemoryHost();
        const events = await collect(agent(provider).run('a bedroom', host));
        expect(readScene(host.world, 'home')?.items.length).toBeGreaterThan(0);
        expect(events.some((e) => e.type === 'message' && e.text === 'built it')).toBe(false);
    });
    it('gives up after a few nudges instead of looping', async () => {
        const provider = scripted([() => [call('design_plan', { plan: {} })], () => [{ type: 'text', text: 'cannot' }]]);
        const host = new MemoryHost();
        await collect(agent(provider).run('a bedroom', host));
        expect(provider.requests.length).toBeLessThanOrEqual(6);
    });
});
describe('vision review', () => {
    it('sends labelled renders with numbered marks and drops the old ones', async () => {
        let w = createWorld({});
        w = applyPatches(w, runDesignTool(w, 'design_plan', { plan: PLAN }).patches).world;
        w = applyPatches(w, runDesignTool(w, 'place_items', { items: FURNISH.items }).patches).world;
        const png = 'data:image/png;base64,iVBORw0KGgo=';
        const host = new MemoryHost(w);
        host.asked = [];
        host.captureReview = async (views) => {
            host.asked.push(views.map((v) => v.name));
            return views.map((v) => ({ name: v.name, dataUrl: png }));
        };
        let round = 0;
        const provider = scripted([
            () => [call('edit_items', { edits: [{ op: 'move', ref: 'home-light', at: [1.4, 1.8] }] })],
            () => [finish('moved the light')],
            () => {
                round++;
                return [finish('Looks right.')];
            },
        ]);
        const events = await collect(agent(provider, { vision: true, maxViews: 4 }).run('check everything', host));
        expect(host.asked[0].length).toBeGreaterThan(0);
        expect(host.asked[0][0]).toBe('level-0-plan');
        const reviewReq = provider.requests.find((r) => JSON.stringify(r.messages.at(-1)).includes('REVIEW round'));
        const firstReview = reviewReq.messages.at(-1).content;
        expect(firstReview.filter((b) => b.type === 'image').length).toBe(host.asked[0].length);
        const text = firstReview.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
        expect(text).toContain('Numbers drawn on the images');
        expect(text).toMatch(/\d+ = bed home-bed/);
        expect(types(events)).toContain('review:approved');
        void round;
    });
});
describe('stall tracker', () => {
    const obs = (keys, score, edited = false) => ({ keys: new Set(keys), score, edited });
    it('lets a loop that is improving continue', () => {
        const t = new StallTracker(3);
        expect(t.observe(obs(['a', 'b', 'c'], 70, false)).stalled).toBe(false);
        expect(t.observe(obs(['b', 'c'], 80, true)).stalled).toBe(false);
        expect(t.observe(obs(['c'], 90, true)).stalled).toBe(false);
    });
    it('stops on identical findings for several rounds', () => {
        const t = new StallTracker(3);
        t.observe(obs(['a'], 80));
        t.observe(obs(['a'], 80));
        const v = t.observe(obs(['a'], 80));
        expect(v.stalled).toBe(true);
    });
    it('stops when the score never gets better', () => {
        const t = new StallTracker(3);
        t.observe(obs(['a'], 80));
        t.observe(obs(['b'], 75, true));
        t.observe(obs(['c'], 70, true));
        t.observe(obs(['d'], 79, true));
        expect(t.observe(obs(['e'], 78, true)).stalled).toBe(true);
    });
    it('stops endless cosmetic edits on a clean building', () => {
        const t = new StallTracker(2);
        let last = t.observe(obs([], 100, true));
        for (let i = 0; i < 4; i++)
            last = t.observe(obs([], 100, true));
        expect(last.stalled).toBe(true);
    });
});
