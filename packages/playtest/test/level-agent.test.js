/**
 * The assistant designs a small course with the real level tools: it first
 * puts a pickup where nobody can get, the tools refuse it with the gap, it
 * moves it, and the finished level is one the verified-playable bot wins.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { WorldAgent } from '@aether/agent';
import { initPhysics } from '@aether/physics';
import { playtest, runLevelTool } from '../src';
import { gameWorld, slab, winAt } from './helpers';
import { MemoryHost, TEST_CATALOGS } from '../../agent/test/helpers';
beforeAll(async () => {
    await initPhysics();
});
class Scripted {
    script;
    name = 'scripted';
    requests = [];
    constructor(script) {
        this.script = script;
    }
    async complete(req) {
        this.requests.push({ ...req, messages: req.messages.map((m) => ({ ...m, content: Array.isArray(m.content) ? [...m.content] : m.content })) });
        const next = this.script.shift();
        return next ? next(req) : { content: [{ type: 'text', text: 'done' }], stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 } };
    }
}
let seq = 0;
const call = (name, input) => ({ type: 'tool_use', id: `c-${++seq}`, name, input });
const turn = (...content) => () => ({ content, stopReason: 'tool_use', usage: { inputTokens: 10, outputTokens: 5 } });
const orb = { shape: { kind: 'primitive', primitive: 'sphere', size: [0.5, 0.5, 0.5] } };
describe('an assistant using the level tools', () => {
    it('is told why a pickup is out of reach, moves it, and ends with a level the bot wins', async () => {
        const start = gameWorld([slab('floor', [0, -0.25, 0], [30, 0.5, 20]), slab('tower', [10, 5, 0], [4, 10, 4], { name: 'Tower' })], { state: { score: 0 }, rules: [winAt(2)] }, [-6, 0.5, 0]);
        const provider = new Scripted([
            turn(call('place_level_items', { items: [{ id: 'orb-1', role: 'pickup', x: -2, z: 3, entity: orb }, { id: 'orb-2', role: 'pickup', x: 10, z: 0, below: 40, entity: orb }] })),
            (req) => {
                const last = JSON.stringify(req.messages.at(-1)?.content);
                // The refusal names the tower's roof and says it is too high; the assistant moves the second orb to the ground.
                expect(last).toContain('orb-2: the player cannot get to');
                expect(last).toContain('too high');
                return { content: [call('place_level_items', { items: [{ id: 'orb-2', role: 'pickup', x: 6, z: -4, entity: orb }] })], stopReason: 'tool_use', usage: { inputTokens: 10, outputTokens: 5 } };
            },
            turn(call('query_level', { op: 'objectives' })),
            turn(call('finish', { message: 'Two orbs to find.' })),
        ]);
        const host = new MemoryHost(start);
        const agent = new WorldAgent({
            provider,
            catalogs: TEST_CATALOGS,
            levelTools: async (world, name, input) => {
                const r = await runLevelTool(world, name, input);
                return { ok: r.ok, text: r.text, patches: r.patches, message: r.message };
            },
        });
        for await (const ev of agent.run('a tiny orb hunt', host))
            void ev;
        expect(Object.keys(host.world.entities)).toEqual(expect.arrayContaining(['orb-1', 'orb-2']));
        expect(host.world.entities['orb-2']?.transform.position[0]).toBe(6);
        const report = await playtest(host.world, { trace: false });
        expect(report.summary).toContain('Verified playable');
    }, 120_000);
});
