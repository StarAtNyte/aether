import { describe, expect, it } from 'vitest';
import { EMPTY_INPUT, LogicRuntime, MAX_LIVE_SPAWNED, MAX_LOG_ENTRIES, RULE_DOCS, normalizeKey } from '../src';
import { DT, FakeHost, input, keys, logText, run, worldOf } from './helpers';
function gameWorld(seed) {
    const entities = [
        { id: 'hero', physics: { body: 'dynamic' }, behaviors: [{ type: 'playerController' }] },
        { id: 'sheep', behaviors: [{ type: 'wander', params: { radius: 6 } }, { type: 'bob' }] },
        { id: 'coin', template: true, tags: ['coin'], behaviors: [{ type: 'spin' }, { type: 'collectible' }] },
        { id: 'gen', behaviors: [{ type: 'spawner', params: { template: 'coin', interval: 0.3, max: 6, spread: 4 } }] },
    ];
    const rules = [
        { id: 'rain', when: { on: 'tick', every: 0.5 }, then: [{ do: 'spawn', template: 'coin', at: [0, 3, 0], count: 2, spread: 5 }] },
        { id: 'jump', when: { on: 'key', key: 'space' }, then: [{ do: 'add', key: 'jumps', amount: 1 }, { do: 'emit', event: 'jumped', delay: 0.2 }] },
        { id: 'echo', when: { on: 'event', name: 'jumped' }, then: [{ do: 'message', text: 'boing' }] },
        { id: 'win', when: { on: 'state', key: 'score', op: '>=', value: 3 }, then: [{ do: 'win' }] },
    ];
    return worldOf(entities, rules, { seed, state: { score: 0 } });
}
function simulate(seed) {
    const host = new FakeHost();
    host.place('hero', [0, 1, 0]);
    const rt = new LogicRuntime(gameWorld(seed), host);
    for (let i = 0; i < 300; i++) {
        const inp = input({ forward: Math.sin(i / 20), right: Math.cos(i / 33), keys: new Set(i % 40 < 3 ? ['Space'] : []) });
        const events = i % 50 === 0 ? [{ type: 'collisionStart', a: 'hero', b: 'sheep', impulse: i / 10 }] : [];
        // drift the hero along its commanded velocity so pickups happen
        const v = host.velocities.get('hero');
        const t = host.getTransform('hero');
        if (v && t)
            host.place('hero', [t.position[0] + v[0] * DT, 1, t.position[2] + v[2] * DT]);
        rt.tick(DT, inp, events);
    }
    return { log: rt.log.map((e) => `${e.t}|${e.rule ?? ''}|${e.text}`), state: JSON.stringify(rt.state), calls: JSON.stringify(host.calls), status: rt.status };
}
describe('determinism', () => {
    it('same seed + same inputs → identical logs, state and host calls', () => {
        const a = simulate(1234);
        const b = simulate(1234);
        expect(a.log.length).toBeGreaterThan(10);
        expect(a).toEqual(b);
    });
    it('a different seed changes the outcome', () => {
        expect(simulate(1).calls).not.toEqual(simulate(2).calls);
    });
    it('does not use Math.random', () => {
        const original = Math.random;
        Math.random = () => {
            throw new Error('Math.random used');
        };
        try {
            expect(() => simulate(5)).not.toThrow();
            expect(logText(new LogicRuntime(gameWorld(5), new FakeHost()).log)).not.toContain('Math.random');
        }
        finally {
            Math.random = original;
        }
    });
});
describe('state access', () => {
    it('exposes world and entity state and never mutates the source document', () => {
        const w = worldOf([{ id: 'door', state: { open: false, stats: { hp: 3 } } }], [{ id: 'r', when: { on: 'start' }, then: [{ do: 'set', key: 'door.stats.hp', value: 1 }, { do: 'add', key: 'lives', amount: -1 }] }], {
            state: { lives: 3, cfg: { level: 2 } },
        });
        const before = JSON.stringify(w);
        const rt = new LogicRuntime(w, new FakeHost());
        rt.start();
        expect(rt.readState('door.stats.hp')).toBe(1);
        expect(rt.readState('cfg.level')).toBe(2);
        expect(rt.state).toEqual({ lives: 2, cfg: { level: 2 } });
        expect(rt.entityState('door')).toEqual({ open: false, stats: { hp: 1 } });
        expect(rt.entityState('nope')).toEqual({});
        expect(rt.readState('nope.x')).toBeUndefined();
        expect(JSON.stringify(w)).toBe(before);
    });
});
describe('log', () => {
    it(`is a bounded ring buffer of ${MAX_LOG_ENTRIES} entries with rule ids`, () => {
        const w = worldOf([], [{ id: 'chatty', when: { on: 'tick', every: 0.001 }, then: [{ do: 'add', key: 'n', amount: 1 }] }]);
        const rt = new LogicRuntime(w, new FakeHost());
        run(rt, 400);
        expect(rt.log).toHaveLength(MAX_LOG_ENTRIES);
        expect(rt.log.at(-1)?.rule).toBe('chatty');
        expect(rt.log.at(-1)?.t).toBeCloseTo(400 * DT, 3); // log times are rounded to ms
    });
});
describe('hot reload (updateWorld)', () => {
    it('preserves state, once-flags and spawned entities; applies new rules and behaviors', () => {
        const rulesV1 = [
            { id: 'once', once: true, when: { on: 'start' }, then: [{ do: 'add', key: 'score', amount: 10 }] },
            { id: 'tick', when: { on: 'tick', every: 0.5 }, then: [{ do: 'add', key: 'score', amount: 1 }] },
            { id: 'spawn', once: true, when: { on: 'start' }, then: [{ do: 'spawn', template: 'tpl' }] },
        ];
        const host = new FakeHost();
        const v1 = worldOf([{ id: 'tpl', template: true }, { id: 'fan', behaviors: [{ type: 'spin', params: { speed: 90 } }] }, { id: 'old' }], rulesV1, { state: { score: 0 } });
        const rt = new LogicRuntime(v1, host);
        run(rt, 60);
        expect(rt.readState('score')).toBe(12);
        const rulesV2 = [
            ...rulesV1.slice(0, 1),
            { id: 'tick', when: { on: 'tick', every: 0.5 }, then: [{ do: 'add', key: 'score', amount: 100 }] },
            { id: 'new', when: { on: 'key', key: 'n' }, then: [{ do: 'set', key: 'pressed', value: true }] },
        ];
        const v2 = worldOf([{ id: 'tpl', template: true }, { id: 'fan', behaviors: [{ type: 'bob', params: { amplitude: 1 } }] }, { id: 'fresh', state: { hp: 5 } }], rulesV2, { state: { score: 0, level: 1 } });
        rt.updateWorld(v2);
        expect(rt.readState('score')).toBe(12); // preserved
        expect(rt.readState('level')).toBe(1); // new key added
        expect(rt.readState('fresh.hp')).toBe(5);
        expect(rt.entityState('old')).toEqual({});
        expect(rt.readState('tpl-1.x')).toBeUndefined();
        run(rt, 30);
        expect(rt.readState('score')).toBe(112); // 'once' did not re-fire; changed 'tick' uses the new amount
        rt.tick(DT, keys('n'), []);
        expect(rt.readState('pressed')).toBe(true);
        // fan switched from spin to bob: its pose now moves vertically, no rotation
        const t = host.getTransform('fan');
        expect(t?.quaternion).toEqual([0, 0, 0, 1]);
        expect(logText(rt.log)).toContain('world updated (hot reload)');
    });
});
describe('limits and robustness', () => {
    it(`caps live spawned entities at ${MAX_LIVE_SPAWNED}`, () => {
        const host = new FakeHost();
        const w = worldOf([{ id: 'tpl', template: true }], [{ id: 'flood', when: { on: 'tick', every: 0.01 }, then: [{ do: 'spawn', template: 'tpl', count: 500 }] }]);
        const rt = new LogicRuntime(w, host);
        run(rt, 30);
        expect(host.spawned.length).toBe(MAX_LIVE_SPAWNED);
        expect(logText(rt.log)).toContain('spawn limit reached');
    });
    it('dispose stops all processing', () => {
        const host = new FakeHost();
        const w = worldOf([{ id: 'fan', behaviors: [{ type: 'spin' }] }], [{ id: 't', when: { on: 'tick', every: 0.1 }, then: [{ do: 'add', key: 'n', amount: 1 }] }]);
        const rt = new LogicRuntime(w, host);
        run(rt, 10);
        const writes = host.kinematicWrites;
        rt.dispose();
        rt.dispose();
        run(rt, 30);
        expect(host.kinematicWrites).toBe(writes);
        expect(() => rt.click('fan')).not.toThrow();
    });
    it('a behavior that throws is disabled and logged without stopping others', () => {
        const host = new FakeHost();
        const w = worldOf([
            { id: 'a', behaviors: [{ type: 'pulseLight' }] },
            { id: 'b', behaviors: [{ type: 'spin' }] },
        ]);
        host.setProperty = () => {
            throw new Error('renderer gone');
        };
        const rt = new LogicRuntime(w, host);
        run(rt, 10);
        expect(logText(rt.log)).toContain('behavior pulseLight on a disabled after error: renderer gone');
        expect(host.kinematicWrites).toBe(10);
    });
    it('falls back to a playerController entity as the player when the host has none', () => {
        const host = new FakeHost();
        const w = worldOf([
            { id: 'hero', behaviors: [{ type: 'playerController' }] },
            { id: 'flag', transform: { position: [0, 0, -3] }, behaviors: [{ type: 'goal' }] },
        ]);
        const rt = new LogicRuntime(w, host);
        run(rt, 40, input({ forward: 1 }));
        expect(rt.status).toBe('won');
    });
    it('EMPTY_INPUT is frozen', () => {
        expect(Object.isFrozen(EMPTY_INPUT)).toBe(true);
    });
    it('normalizes key names', () => {
        expect(normalizeKey('KeyW')).toBe('w');
        expect(normalizeKey(' ')).toBe('space');
        expect(normalizeKey('Digit3')).toBe('3');
        expect(normalizeKey('ArrowUp')).toBe('arrowup');
        expect(normalizeKey('ShiftLeft')).toBe('shift');
        expect(normalizeKey('__proto__')).toBe('__proto__');
    });
});
describe('RULE_DOCS', () => {
    it('documents every trigger and action kind with an example', () => {
        for (const on of ['start', 'tick', 'timer', 'collision', 'enter', 'exit', 'key', 'click', 'state', 'event', 'fallBelow']) {
            expect(RULE_DOCS).toContain(`"on":"${on}"`);
        }
        for (const d of ['set', 'add', 'spawn', 'destroy', 'impulse', 'setVelocity', 'teleport', 'setProperty', 'enableBehavior', 'explode', 'setGravity', 'emit', 'message', 'sound', 'win', 'lose', 'reset']) {
            expect(RULE_DOCS).toContain(`"do":"${d}"`);
        }
        expect(RULE_DOCS.length).toBeLessThan(6000);
    });
});
describe('performance', () => {
    it('1000 entities with spin + bob tick in < 2 ms on average', () => {
        const entities = [];
        for (let i = 0; i < 1000; i++) {
            entities.push({ id: `e-${i}`, transform: { position: [i % 40, 1, Math.floor(i / 40)] }, behaviors: [{ type: 'spin', params: { speed: 45 + (i % 7) } }, { type: 'bob', params: { phase: (i % 10) / 10 } }] });
        }
        const host = new FakeHost();
        host.recordKinematic = false;
        const rt = new LogicRuntime(worldOf(entities), host);
        run(rt, 30); // warm-up (JIT)
        const ticks = 300;
        const t0 = performance.now();
        run(rt, ticks);
        const avg = (performance.now() - t0) / ticks;
        expect(host.kinematicWrites).toBe(1000 * (ticks + 30));
        expect(avg).toBeLessThan(process.env.CI ? 8 : 2);
    });
});
