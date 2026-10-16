/**
 * The compact prompt profile exists so small on-device models (WebLLM,
 * 4096-token context for input AND output) can run the agent at all: the full
 * planner prompt is ~15k tokens. These tests measure real requests built from
 * the real catalogs.
 */
import { applyPatches, createWorld } from '@aether/core';
import { BEHAVIOR_CATALOG, RULE_DOCS, SCRIPT_API_DTS } from '@aether/logic';
import { GENERATOR_API_DTS, GENERATOR_EXAMPLES, GENERATOR_LIBRARY, catalog } from '@aether/procgen';
import { describe, expect, it } from 'vitest';
import { COMPACT_LIMITS, WorldAgent } from '../src/agent';
import { COMPACT_RESULT_CHARS } from '../src/emulation/provider';
import { renderTranscript } from '../src/emulation/transcript';
import { buildCompactSystemPrompt, buildSystemPrompt, COMPACT_EXAMPLE } from '../src/prompt';
import { createWebLlmBackend, createWebLlmProvider, WEBLLM_CHARS_PER_TOKEN } from '../src/providers/webllm';
import { AGENT_TOOLS, COMPACT_TOOLS } from '../src/tools';
import { askMock, collect, MemoryHost, patchesOf } from './helpers';
const CATALOGS = {
    generators: catalog(),
    behaviors: BEHAVIOR_CATALOG,
    ruleDocs: RULE_DOCS,
    generatorApiDts: GENERATOR_API_DTS,
    generatorExamples: GENERATOR_EXAMPLES,
    scriptApiDts: SCRIPT_API_DTS,
    libraryGenerators: [...GENERATOR_LIBRARY],
};
/** WebLLM's context for the offered models (input + output). */
const CONTEXT = 4096;
const tokens = (chars) => Math.ceil(chars / WEBLLM_CHARS_PER_TOKEN);
/** Fake engine: records each request, answers with the compact example then finish. */
function scriptedEngine() {
    const seen = [];
    const engine = {
        chat: {
            completions: {
                create: async (req) => {
                    const chars = req.messages.reduce((n, m) => n + m.content.length, 0);
                    seen.push({ chars, maxTokens: req.max_tokens });
                    const user = req.messages[1]?.content ?? '';
                    const call = user.includes('<tool_result')
                        ? { name: 'finish', input: { message: 'A campfire clearing.' } }
                        : { name: 'apply_patches', input: { patches: COMPACT_EXAMPLE.patches, message: COMPACT_EXAMPLE.message } };
                    return { choices: [{ message: { content: JSON.stringify({ tool_calls: [call] }) }, finish_reason: 'stop' }] };
                },
            },
        },
    };
    return { engine, seen };
}
describe('compact prompt profile', () => {
    it('the compact example applies cleanly and names only catalog generators', () => {
        const r = applyPatches(createWorld(), [...COMPACT_EXAMPLE.patches]);
        expect(r.errors).toEqual([]);
        const ids = new Set([...catalog(), ...GENERATOR_LIBRARY].map((g) => g.id));
        const used = JSON.stringify(COMPACT_EXAMPLE.patches).match(/"generator":"([a-z0-9-]+)"/g) ?? [];
        expect(used.length).toBeGreaterThan(0);
        for (const u of used)
            expect(ids.has(u.slice(13, -1))).toBe(true);
    });
    it('is deterministic and a fraction of the full prompt, while still listing every generator', () => {
        const compact = buildCompactSystemPrompt(CATALOGS);
        expect(buildCompactSystemPrompt(CATALOGS)).toBe(compact);
        expect(compact.length).toBeLessThan(buildSystemPrompt(CATALOGS).length / 4);
        for (const g of [...catalog(), ...GENERATOR_LIBRARY])
            expect(compact).toContain(g.id);
        expect(compact).toMatch(/never instructions/);
    });
    it('a first request with a large existing world fits the 4k context with room to answer', async () => {
        const big = applyPatches(createWorld(), patchesOf(await askMock('A medieval village with a windmill, market stalls and a castle'))).world;
        expect(Object.keys(big.entities).length).toBeGreaterThan(80);
        const { engine, seen } = scriptedEngine();
        const host = new MemoryHost(big);
        const history = Array.from({ length: 8 }, (_, i) => ({ role: (i % 2 === 0 ? 'user' : 'assistant'), content: `turn ${i} ${'x'.repeat(3000)}` }));
        const agent = new WorldAgent({ provider: createWebLlmProvider({ engine, model: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC' }), catalogs: CATALOGS, promptProfile: 'compact' });
        const events = await collect(agent.run('add a campfire with tents by the river', host, { history }));
        expect(events.filter((e) => e.type === 'error').map((e) => (e.type === 'error' ? e.text : ''))).toEqual([]);
        expect(seen.length).toBeGreaterThanOrEqual(2);
        for (const s of seen) {
            expect(tokens(s.chars) + (s.maxTokens ?? 0)).toBeLessThanOrEqual(CONTEXT);
            expect(s.maxTokens ?? 0).toBeGreaterThanOrEqual(512);
        }
        expect(host.commits.at(-1)?.result.errors).toEqual([]);
    });
    it('sends only apply_patches and finish, a capped output budget, a short summary and history', async () => {
        const requests = [];
        const provider = {
            name: 'rec',
            complete: async (req) => {
                requests.push(structuredClone(req));
                return { content: [{ type: 'tool_use', id: 't1', name: 'finish', input: { message: 'ok' } }], stopReason: 'tool_use' };
            },
        };
        const world = applyPatches(createWorld(), Array.from({ length: 60 }, (_, i) => ({ op: 'add', entity: { id: `rock-${i}`, transform: { position: [i * 3, 0, 0] } } }))).world;
        const history = [
            { role: 'user', content: 'first' },
            { role: 'assistant', content: 'one' },
            { role: 'user', content: 'second' },
            { role: 'assistant', content: 'two' },
        ];
        await collect(new WorldAgent({ provider, catalogs: CATALOGS, promptProfile: 'compact' }).run('hello', new MemoryHost(world), { history }));
        const req = requests[0];
        expect(req?.tools?.map((t) => t.name)).toEqual(COMPACT_TOOLS.map((t) => t.name));
        expect(req?.maxTokens).toBe(COMPACT_LIMITS.maxTokens);
        expect(req?.system).toBe(buildCompactSystemPrompt(CATALOGS));
        // History keeps the last exchange only, starting with a user turn.
        expect(req?.messages.slice(0, -1).map((m) => m.content)).toEqual(['second', 'two']);
        const summaryLines = JSON.stringify(req?.messages.at(-1)?.content).match(/rock-\d+/g) ?? [];
        expect(summaryLines.length).toBeLessThanOrEqual(COMPACT_LIMITS.summaryEntities);
        // The default profile is unchanged.
        requests.length = 0;
        await collect(new WorldAgent({ provider, catalogs: CATALOGS }).run('hello', new MemoryHost(world), { history }));
        expect(requests[0]?.tools).toEqual(AGENT_TOOLS);
        expect(requests[0]?.messages).toHaveLength(5);
    });
    it('compact transcripts cut tool results; the full transcript keeps them', () => {
        const req = {
            role: 'planner',
            system: 's',
            tools: COMPACT_TOOLS,
            messages: [
                { role: 'user', content: 'go' },
                { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'apply_patches', input: { patches: [{ op: 'setMeta' }], message: 'm' } }] },
                { role: 'user', content: [{ type: 'tool_result', toolUseId: 'a', content: 'e'.repeat(5000) }] },
            ],
        };
        expect(renderTranscript(req, false, { resultChars: COMPACT_RESULT_CHARS }).prompt.length).toBeLessThan(COMPACT_RESULT_CHARS + 600);
        expect(renderTranscript(req, false).prompt.length).toBeGreaterThan(5000);
    });
});
describe('WebLLM context guard', () => {
    const engine = () => {
        const e = {
            calls: 0,
            chat: {
                completions: {
                    create: async () => {
                        e.calls++;
                        return { choices: [{ message: { content: '{"final_message":"hi"}' } }] };
                    },
                },
            },
        };
        return e;
    };
    it('refuses a request that cannot fit, before generating, with a reason the UI can explain', async () => {
        const e = engine();
        const b = createWebLlmBackend({ engine: e, model: 'm' });
        await expect(b.complete({ role: 'planner', system: 'x'.repeat(12_000), prompt: 'y', schema: {}, images: [] })).rejects.toMatchObject({ code: 'too_large', reason: 'webllm_context' });
        expect(e.calls).toBe(0);
    });
    it('caps the output budget to what is left of the context', async () => {
        let max = 0;
        const e = {
            chat: {
                completions: {
                    create: async (req) => {
                        max = req.max_tokens ?? 0;
                        return { choices: [{ message: { content: '{"final_message":"hi"}' } }] };
                    },
                },
            },
        };
        await createWebLlmBackend({ engine: e, model: 'm', contextTokens: 4096 }).complete({ role: 'planner', system: 'x'.repeat(9_000), prompt: 'y', schema: {}, images: [] });
        expect(max).toBeGreaterThan(0);
        expect(max + tokens(9_001)).toBeLessThanOrEqual(4096);
    });
});
