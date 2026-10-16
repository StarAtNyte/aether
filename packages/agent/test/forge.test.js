import { describe, expect, it } from 'vitest';
import { FORGE_GATE, forgeGenerator, forgeScore, parseCritique } from '../src/forge';
const SRC = 'const m = api.material({ color: params.color }); api.box(1, params.height, 1, m); return api.build();';
function submit(height, id = 'x') {
    return { content: [{ type: 'tool_use', id: `t${height}`, name: 'submit_generator', input: { id, description: `chair, height ${height}`, params: { height: { type: 'number', default: height, min: 0.1, max: 5 }, color: { type: 'color', default: '#884422' } }, source: SRC } }], stopReason: 'tool_use', usage: { inputTokens: 10, outputTokens: 5 } };
}
function critique(s, fixes = ['make the backrest 20 % taller']) {
    return { content: [{ type: 'text', text: JSON.stringify({ scores: { silhouette: s, proportions: s, parts: s, colours: s }, matched: ['four legs'], missing: ['armrests'], fixes, summary: `score ${s}` }) }], stopReason: 'end' };
}
/** Provider replaying scripted responses per role, recording requests. */
function scripted(coder, critic) {
    const requests = [];
    return {
        name: 'scripted',
        requests,
        async complete(req) {
            requests.push(JSON.parse(JSON.stringify(req)));
            const r = (req.role === 'critic' ? critic : coder).shift();
            if (!r)
                throw new Error(`no scripted ${req.role} reply`);
            return r;
        },
    };
}
function deps(provider, extra = {}) {
    return {
        provider,
        coderSystem: 'coder',
        validate: async (def) => (def.source.includes('api.build') ? { ok: true } : { ok: false, error: 'must return api.build()' }),
        render: async () => 'data:image/jpeg;base64,AAAA',
        usage: { calls: 0, inputTokens: 0, outputTokens: 0 },
        vision: true,
        ...extra,
    };
}
describe('asset forge', () => {
    it('iterates build → render → critique until the gate passes, keeping the best', async () => {
        const p = scripted([submit(1), submit(1.2)], [critique(5), critique(9)]);
        const seen = [];
        const r = await forgeGenerator(deps(p, { onIteration: (it) => seen.push(it.index) }), { id: 'chair-1', description: 'a wooden chair', reference: 'data:image/png;base64,REF' });
        expect(r.passed).toBe(true);
        expect(r.reason).toBe('passed');
        expect(r.iterations).toHaveLength(2);
        expect(seen).toEqual([0, 1]);
        expect(r.def?.id).toBe('chair-1');
        expect(r.def?.params['height']?.default).toBe(1.2);
        expect(r.best?.score).toBeGreaterThanOrEqual(FORGE_GATE);
        // The coder saw the reference once; the critique came back as text with the concrete fixes.
        const coderReqs = p.requests.filter((q) => q.role === 'coder');
        const images = (q) => q.messages.flatMap((m) => (Array.isArray(m.content) ? m.content.filter((b) => b.type === 'image') : []));
        expect(images(coderReqs[1])).toHaveLength(1);
        expect(JSON.stringify(coderReqs[1].messages.at(-1))).toContain('backrest 20 % taller');
        expect(JSON.stringify(coderReqs[1].messages.at(-1))).toContain('armrests');
        // The critic gets the reference and the contact sheet.
        expect(images(p.requests.find((q) => q.role === 'critic'))).toHaveLength(2);
        expect(p.requests[0].system).toContain('OBSERVE');
    });
    it('repairs invalid code within an iteration', async () => {
        const bad = { content: [{ type: 'tool_use', id: 'b', name: 'submit_generator', input: { id: 'x', description: 'd', params: {}, source: 'oops' } }], stopReason: 'tool_use' };
        const p = scripted([bad, submit(1)], [critique(9)]);
        const r = await forgeGenerator(deps(p), { id: 'thing', description: 'a thing' });
        expect(r.passed).toBe(true);
        expect(JSON.stringify(p.requests[1].messages.at(-1))).toContain('must return api.build()');
    });
    it('stops at the iteration budget and returns the best version, not the last', async () => {
        const p = scripted([submit(1), submit(2), submit(3)], [critique(4), critique(7), critique(6)]);
        const r = await forgeGenerator(deps(p, { maxIterations: 3 }), { id: 'thing-x', description: 'x' });
        expect(r.passed).toBe(false);
        expect(r.reason).toBe('iterations');
        expect(r.def?.params['height']?.default).toBe(2);
    });
    it('respects the model-call budget', async () => {
        const p = scripted([submit(1), submit(2), submit(3)], [critique(4), critique(4)]);
        const r = await forgeGenerator(deps(p, { maxCalls: 3 }), { id: 'thing-x', description: 'x' });
        expect(r.reason).toBe('calls');
        expect(p.requests).toHaveLength(3);
        expect(r.ok).toBe(true);
    });
    it('without vision: one validated build, no critique, said plainly', async () => {
        const p = scripted([submit(1)], []);
        const r = await forgeGenerator(deps(p, { vision: false }), { id: 'thing-x', description: 'x' });
        expect(r.reason).toBe('no-vision');
        expect(r.ok).toBe(true);
        expect(r.best?.score).toBeNull();
    });
    it('change requests start from the existing generator', async () => {
        const p = scripted([submit(1.4)], [critique(9)]);
        const base = { id: 'chair-1', description: 'chair', params: {}, source: SRC };
        await forgeGenerator(deps(p), { id: 'chair-1', description: 'taller, walnut', base });
        expect(JSON.stringify(p.requests[0].messages[0])).toContain('taller, walnut');
        expect(JSON.stringify(p.requests[0].messages[0])).toContain('api.box');
    });
    it('reports failure when no valid generator arrives', async () => {
        const nothing = { content: [{ type: 'text', text: 'sorry' }], stopReason: 'end' };
        const p = scripted([nothing, nothing], []);
        const r = await forgeGenerator(deps(p, { maxIterations: 1 }), { id: 'thing-x', description: 'x' });
        expect(r.ok).toBe(false);
        expect(r.reason).toBe('failed');
        expect(r.error).toContain('did not submit');
    });
    it('parses and weighs critiques defensively', () => {
        expect(parseCritique('noise {"scores":{"silhouette":12,"proportions":"x","parts":5}} more')).toMatchObject({ scores: { silhouette: 10, proportions: 0, parts: 5, colours: 0 } });
        expect(parseCritique('not json')).toBeNull();
        expect(parseCritique('{"scores":{}}')).toBeNull();
        expect(parseCritique('{"scores":{"silhouette":8,"colors":6}}')?.scores.colours).toBe(6);
        expect(forgeScore({ silhouette: 10, proportions: 10, parts: 10, colours: 10 })).toBe(1);
        expect(forgeScore({ silhouette: 10, proportions: 0, parts: 0, colours: 0 })).toBeCloseTo(0.35, 6);
    });
    it('propagates aborts', async () => {
        const ctrl = new AbortController();
        const p = { name: 'abort', complete: async () => { ctrl.abort(); throw Object.assign(new Error('aborted'), { name: 'AbortError' }); } };
        await expect(forgeGenerator(deps(p, { signal: ctrl.signal }), { id: 'thing-x', description: 'x' })).rejects.toThrow('aborted');
    });
});
