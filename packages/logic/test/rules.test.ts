import { describe, expect, it } from 'vitest';
import type { RuleInput } from '@aether/core';
import { LogicRuntime, MAX_EMIT_DEPTH, MAX_FIRINGS_PER_TICK, describeTrigger, type PhysicsEventLike } from '../src';
import { DT, FakeHost, input, keys, logText, run, worldOf } from './helpers';

const NO_EVENTS: PhysicsEventLike[] = [];

function setup(rules: RuleInput[], extraEntities: Parameters<typeof worldOf>[0] = [], state: Record<string, number> = { score: 0 }) {
  const host = new FakeHost();
  const w = worldOf(
    [
      { id: 'player', transform: { position: [0, 1, 0] } },
      { id: 'zone', shape: { kind: 'primitive', primitive: 'box', size: [2, 2, 2] }, transform: { position: [10, 1, 0] } },
      { id: 'crate', tags: ['box'], physics: { body: 'dynamic' }, transform: { position: [0, 5, 0] } },
      { id: 'coin-tpl', template: true, tags: ['coin'], state: { value: 1 }, transform: { position: [1, 1, 1] } },
      ...extraEntities,
    ],
    rules,
    { state },
  );
  host.player = 'player';
  host.place('player', [0, 1, 0]);
  const rt = new LogicRuntime(w, host);
  return { host, rt, w };
}

describe('triggers', () => {
  it('start fires once on start()', () => {
    const { rt } = setup([{ id: 's', when: { on: 'start' }, then: [{ do: 'add', key: 'score', amount: 1 }] }]);
    rt.start();
    rt.start();
    run(rt, 3);
    expect(rt.readState('score')).toBe(1);
  });

  it('first tick starts the runtime implicitly', () => {
    const { rt } = setup([{ id: 's', when: { on: 'start' }, then: [{ do: 'set', key: 'ready', value: true }] }]);
    rt.tick(DT, input(), NO_EVENTS);
    expect(rt.readState('ready')).toBe(true);
  });

  it('tick fires every N seconds using an accumulator', () => {
    const { rt } = setup([{ id: 't', when: { on: 'tick', every: 0.5 }, then: [{ do: 'add', key: 'score', amount: 1 }] }]);
    run(rt, 60); // 1 s
    expect(rt.readState('score')).toBe(2);
    run(rt, 30);
    expect(rt.readState('score')).toBe(3);
  });

  it('timer fires once at time t', () => {
    const { rt } = setup([{ id: 'tm', when: { on: 'timer', at: 1 }, then: [{ do: 'add', key: 'score', amount: 5 }] }]);
    run(rt, 59);
    expect(rt.readState('score')).toBe(0);
    run(rt, 2);
    expect(rt.readState('score')).toBe(5);
    run(rt, 120);
    expect(rt.readState('score')).toBe(5);
  });

  it('collision matches selectors in either order and respects minImpulse', () => {
    const { rt } = setup([{ id: 'hit', when: { on: 'collision', a: '#box', b: 'player', minImpulse: 2 }, then: [{ do: 'add', key: 'score', amount: 1 }] }]);
    rt.tick(DT, input(), [{ type: 'collisionStart', a: 'player', b: 'crate', impulse: 5 }]);
    expect(rt.readState('score')).toBe(1);
    rt.tick(DT, input(), [{ type: 'collisionStart', a: 'crate', b: 'player', impulse: 1 }]);
    expect(rt.readState('score')).toBe(1);
    rt.tick(DT, input(), [{ type: 'collisionStart', a: 'crate', b: 'player' }]);
    expect(rt.readState('score')).toBe(1);
    rt.tick(DT, input(), [{ type: 'collisionEnd', a: 'crate', b: 'player', impulse: 50 }]);
    expect(rt.readState('score')).toBe(1);
    expect(logText(rt.log)).toContain("rule 'hit' fired: crate hit player (impulse 5)");
  });

  it('enter/exit via geometric fallback (no physics zone)', () => {
    const { rt, host } = setup([
      { id: 'in', when: { on: 'enter', zone: 'zone', who: 'player' }, then: [{ do: 'add', key: 'score', amount: 1 }] },
      { id: 'out', when: { on: 'exit', zone: 'zone' }, then: [{ do: 'add', key: 'score', amount: 10 }] },
    ]);
    run(rt, 2);
    expect(rt.readState('score')).toBe(0);
    host.place('player', [10.5, 1.5, 0.5]);
    run(rt, 3);
    expect(rt.readState('score')).toBe(1);
    host.place('player', [20, 1, 0]);
    run(rt, 1);
    expect(rt.readState('score')).toBe(11);
    expect(logText(rt.log)).toContain("rule 'in' fired: player entered zone");
    expect(logText(rt.log)).toContain("rule 'out' fired: player left zone");
  });

  it('enter/exit via sensor events', () => {
    const { rt } = setup(
      [{ id: 'in', when: { on: 'enter', zone: 'sensor', who: '#box' }, then: [{ do: 'add', key: 'score', amount: 1 }] }],
      [{ id: 'sensor', physics: { body: 'static', sensor: true }, transform: { position: [100, 0, 0] } }],
    );
    rt.tick(DT, input(), [{ type: 'sensorEnter', a: 'sensor', b: 'crate' }]);
    rt.tick(DT, input(), NO_EVENTS);
    expect(rt.readState('score')).toBe(1);
    rt.tick(DT, input(), [{ type: 'sensorExit', a: 'crate', b: 'sensor' }]);
    rt.tick(DT, input(), [{ type: 'sensorEnter', a: 'crate', b: 'sensor' }]);
    expect(rt.readState('score')).toBe(2);
  });

  it('key triggers are edge-triggered and normalized', () => {
    const { rt } = setup([
      { id: 'k', when: { on: 'key', key: 'e' }, then: [{ do: 'add', key: 'score', amount: 1 }] },
      { id: 'sp', when: { on: 'key', key: 'Space' }, then: [{ do: 'add', key: 'score', amount: 100 }] },
    ]);
    rt.tick(DT, keys('KeyE'), NO_EVENTS);
    rt.tick(DT, keys('KeyE'), NO_EVENTS);
    rt.tick(DT, keys('e'), NO_EVENTS);
    expect(rt.readState('score')).toBe(1);
    rt.tick(DT, keys(), NO_EVENTS);
    rt.tick(DT, keys('E', ' '), NO_EVENTS);
    expect(rt.readState('score')).toBe(102);
  });

  it('click triggers fire at the next tick for matching targets', () => {
    const { rt } = setup([{ id: 'c', when: { on: 'click', target: '#box' }, then: [{ do: 'add', key: 'score', amount: 1 }] }]);
    rt.click('crate');
    rt.click('player');
    expect(rt.readState('score')).toBe(0);
    rt.tick(DT, input(), NO_EVENTS);
    expect(rt.readState('score')).toBe(1);
  });

  it('state triggers are edge-triggered', () => {
    const { rt } = setup([
      { id: 'inc', when: { on: 'tick', every: 0.1 }, then: [{ do: 'add', key: 'score', amount: 1 }] },
      { id: 'hi', when: { on: 'state', key: 'score', op: '>=', value: 3 }, then: [{ do: 'add', key: 'hits', amount: 1 }] },
      { id: 'reset-score', when: { on: 'state', key: 'score', op: '>=', value: 5 }, then: [{ do: 'set', key: 'score', value: 0 }] },
    ]);
    run(rt, 30); // 0.5 s → score cycles 0..5 → reset
    expect(rt.readState('hits')).toBe(1);
    run(rt, 30);
    expect(rt.readState('hits')).toBe(2);
  });

  it('event triggers via emit, including delayed emits', () => {
    const { rt } = setup([
      { id: 'go', when: { on: 'start' }, then: [{ do: 'emit', event: 'now' }, { do: 'emit', event: 'later', delay: 1 }] },
      { id: 'now', when: { on: 'event', name: 'now' }, then: [{ do: 'add', key: 'score', amount: 1 }] },
      { id: 'later', when: { on: 'event', name: 'later' }, then: [{ do: 'add', key: 'score', amount: 10 }] },
    ]);
    rt.start();
    expect(rt.readState('score')).toBe(1);
    run(rt, 59);
    expect(rt.readState('score')).toBe(1);
    run(rt, 2);
    expect(rt.readState('score')).toBe(11);
  });

  it('external emit() is processed at the next tick', () => {
    const { rt } = setup([{ id: 'e', when: { on: 'event', name: 'ping' }, then: [{ do: 'add', key: 'score', amount: 1 }] }]);
    rt.emit('ping');
    expect(rt.readState('score')).toBe(0);
    run(rt, 1);
    expect(rt.readState('score')).toBe(1);
  });

  it('fallBelow fires once per fall and re-arms', () => {
    const { rt, host } = setup([{ id: 'f', when: { on: 'fallBelow', target: '#box', y: -5 }, then: [{ do: 'add', key: 'score', amount: 1 }] }]);
    host.place('crate', [0, -6, 0]);
    run(rt, 5);
    expect(rt.readState('score')).toBe(1);
    host.place('crate', [0, 1, 0]);
    run(rt, 1);
    host.place('crate', [0, -10, 0]);
    run(rt, 1);
    expect(rt.readState('score')).toBe(2);
  });
});

describe('conditions, once and enabled', () => {
  it('if-conditions gate firing', () => {
    const { rt } = setup([
      { id: 'k', when: { on: 'key', key: 'e' }, if: [{ key: 'unlocked', op: '==', value: true }], then: [{ do: 'add', key: 'score', amount: 1 }] },
    ]);
    rt.tick(DT, keys('e'), NO_EVENTS);
    rt.tick(DT, keys(), NO_EVENTS);
    expect(rt.readState('score')).toBe(0);
    rt.updateWorld(worldOf([{ id: 'player' }], [{ id: 'k', when: { on: 'key', key: 'e' }, if: [{ key: 'unlocked', op: '==', value: true }], then: [{ do: 'add', key: 'score', amount: 1 }] }], { state: { unlocked: true } }));
    rt.tick(DT, keys('e'), NO_EVENTS);
    expect(rt.readState('score')).toBe(1);
  });

  it('once rules fire a single time; disabled rules never fire', () => {
    const { rt } = setup([
      { id: 'o', once: true, when: { on: 'tick', every: 0.1 }, then: [{ do: 'add', key: 'score', amount: 1 }] },
      { id: 'off', enabled: false, when: { on: 'tick', every: 0.1 }, then: [{ do: 'add', key: 'score', amount: 100 }] },
    ]);
    run(rt, 60);
    expect(rt.readState('score')).toBe(1);
  });
});

describe('actions', () => {
  it('set / add on world and entity state with readable log', () => {
    const { rt } = setup(
      [
        {
          id: 'coin-pickup',
          when: { on: 'start' },
          then: [
            { do: 'add', key: 'score', amount: 3 },
            { do: 'set', key: 'door.open', value: true },
            { do: 'add', key: 'door.hits', amount: 2 },
          ],
        },
      ],
      [{ id: 'door', state: { open: false } }],
    );
    rt.start();
    expect(rt.readState('score')).toBe(3);
    expect(rt.entityState('door')).toEqual({ open: true, hits: 2 });
    expect(rt.readState('door.open')).toBe(true);
    const entry = rt.log.find((e) => e.rule === 'coin-pickup');
    expect(entry?.text).toBe("rule 'coin-pickup' fired: world started → score 0→3; door.open false→true; door.hits unset→2");
  });

  it('add on a non-number is reported, not thrown', () => {
    const { rt } = setup([{ id: 'bad', when: { on: 'start' }, then: [{ do: 'add', key: 'name', amount: 1 }] }], [], { score: 0 });
    rt.updateWorld(worldOf([], [{ id: 'bad', when: { on: 'start' }, then: [{ do: 'add', key: 'name', amount: 1 }] }], { state: { name: 'x' } as never }));
    expect(() => rt.start()).not.toThrow();
    expect(logText(rt.log)).toContain("error in add: 'name' is not a number");
  });

  it('spawn clones templates with unique ids, spread and selector positions', () => {
    const { rt, host } = setup([
      { id: 'sp', when: { on: 'start' }, then: [{ do: 'spawn', template: 'coin-tpl', at: [0, 2, 0], count: 3, spread: 2 }] },
      { id: 'sp2', when: { on: 'key', key: 'e' }, then: [{ do: 'spawn', template: 'coin-tpl', at: 'player' }] },
    ]);
    rt.start();
    expect(host.spawned.map((e) => e.id)).toEqual(['coin-tpl-1', 'coin-tpl-2', 'coin-tpl-3']);
    for (const e of host.spawned) {
      expect(e.template).toBe(false);
      expect(e.tags).toEqual(['coin']);
      const [x, y, z] = e.transform.position;
      expect(y).toBe(2);
      expect(Math.hypot(x, z)).toBeLessThanOrEqual(2);
    }
    expect(new Set(host.spawned.map((e) => e.transform.position.join(','))).size).toBe(3);
    rt.tick(DT, keys('e'), NO_EVENTS);
    expect(host.spawned[3]?.id).toBe('coin-tpl-4');
    expect(host.spawned[3]?.transform.position).toEqual([0, 1, 0]);
    // Spawned entities are live: selectors and state see them.
    expect(rt.readState('coin-tpl-2.value')).toBe(1);
  });

  it('spawn is deterministic for the same seed', () => {
    const positions = (seed: number) => {
      const host = new FakeHost();
      const w = worldOf([{ id: 'tpl', template: true }], [{ id: 's', when: { on: 'start' }, then: [{ do: 'spawn', template: 'tpl', at: [0, 0, 0], count: 5, spread: 10 }] }]);
      const rt = new LogicRuntime(w, host, { seed });
      rt.start();
      return host.spawned.map((e) => e.transform.position);
    };
    expect(positions(7)).toEqual(positions(7));
    expect(positions(7)).not.toEqual(positions(8));
  });

  it('spawn of an unknown template is logged', () => {
    const { rt } = setup([{ id: 's', when: { on: 'start' }, then: [{ do: 'spawn', template: 'nope' }] }]);
    rt.start();
    expect(logText(rt.log)).toContain("unknown template 'nope'");
  });

  it('destroy, impulse, setVelocity, teleport, setProperty go through the host', () => {
    const { rt, host } = setup([
      {
        id: 'all',
        when: { on: 'start' },
        then: [
          { do: 'impulse', target: '#box', vector: [0, 5, 0] },
          { do: 'setVelocity', target: 'crate', vector: [1, 0, 0] },
          { do: 'teleport', target: 'crate', to: 'zone' },
          { do: 'teleport', target: 'player', to: [1, 2, 3] },
          { do: 'setProperty', target: 'zone', path: 'material.color', value: '#ff0000' },
          { do: 'destroy', target: '#box' },
        ],
      },
    ]);
    rt.start();
    expect(host.callsOf('applyImpulse')[0]?.args).toEqual(['crate', [0, 5, 0]]);
    expect(host.callsOf('setVelocity')[0]?.args).toEqual(['crate', [1, 0, 0]]);
    expect(host.callsOf('teleport').map((c) => c.args)).toEqual([
      ['crate', [10, 1, 0]],
      ['player', [1, 2, 3]],
    ]);
    expect(host.properties).toEqual([{ id: 'zone', path: 'material.color', value: '#ff0000' }]);
    expect(host.destroyed).toEqual(['crate']);
    expect(rt.entityState('crate')).toEqual({});
  });

  it('setProperty rejects unsafe paths', () => {
    const { rt, host } = setup([
      { id: 'evil', when: { on: 'start' }, then: [{ do: 'setProperty', target: 'zone', path: '__proto__.polluted', value: 1 }] },
      { id: 'evil2', when: { on: 'start' }, then: [{ do: 'setProperty', target: 'zone', path: 'constructor', value: 1 }] },
    ]);
    rt.start();
    expect(host.properties).toEqual([]);
    expect(logText(rt.log)).toContain('invalid property path');
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('state writes reject prototype-pollution keys', () => {
    const { rt } = setup([
      { id: 'p1', when: { on: 'start' }, then: [{ do: 'set', key: '__proto__', value: { polluted: true } }] },
      { id: 'p2', when: { on: 'start' }, then: [{ do: 'set', key: 'zone.constructor.prototype', value: 1 }] },
    ]);
    rt.start();
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    expect(rt.readState('__proto__')).toBeUndefined();
    expect(logText(rt.log)).toMatch(/forbidden state key/);
  });

  it('enableBehavior toggles behaviors by type', () => {
    const { rt, host } = setup(
      [{ id: 'off', when: { on: 'key', key: 'x' }, then: [{ do: 'enableBehavior', target: 'fan', behavior: 'spin', enabled: false }] }],
      [{ id: 'fan', behaviors: [{ type: 'spin', params: { speed: 90 } }] }],
    );
    run(rt, 2);
    const writes = host.callsOf('setKinematic').length;
    expect(writes).toBe(2);
    rt.tick(DT, keys('x'), NO_EVENTS);
    run(rt, 5);
    expect(host.callsOf('setKinematic').length).toBe(writes);
    expect(logText(rt.log)).toContain('disable spin (1)');
  });

  it('explode, setGravity, message, sound go through the host', () => {
    const { rt, host } = setup([
      {
        id: 'fx',
        when: { on: 'start' },
        then: [
          { do: 'explode', at: 'crate', force: 30, radius: 4 },
          { do: 'explode', at: [1, 2, 3] },
          { do: 'setGravity', vector: [0, -1.6, 0] },
          { do: 'message', text: 'hello', duration: 2 },
          { do: 'sound', sound: 'bell' },
        ],
      },
    ]);
    rt.start();
    expect(host.callsOf('explode').map((c) => c.args)).toEqual([
      [[0, 5, 0], 30, 4],
      [[1, 2, 3], 20, 5],
    ]);
    expect(host.callsOf('setGravity')[0]?.args).toEqual([[0, -1.6, 0]]);
    expect(host.messages).toEqual(['hello']);
    expect(host.sounds).toEqual(['bell']);
  });

  it('win ends the session; further rules and lose do nothing', () => {
    const { rt, host } = setup([
      { id: 'w', when: { on: 'timer', at: 0.1 }, then: [{ do: 'win', text: 'Yay' }, { do: 'lose' }] },
      { id: 't', when: { on: 'tick', every: 0.05 }, then: [{ do: 'add', key: 'score', amount: 1 }] },
    ]);
    run(rt, 30);
    expect(rt.status).toBe('won');
    expect(host.gameOverResult).toEqual({ result: 'win', text: 'Yay' });
    expect(host.callsOf('gameOver')).toHaveLength(1);
    const score = rt.readState('score');
    run(rt, 30);
    expect(rt.readState('score')).toBe(score);
  });

  it('lose sets status lost', () => {
    const { rt, host } = setup([{ id: 'l', when: { on: 'start' }, then: [{ do: 'lose' }] }]);
    rt.start();
    expect(rt.status).toBe('lost');
    expect(host.gameOverResult).toEqual({ result: 'lose', text: 'Game over' });
  });

  it('reset restores initial state, re-fires start and calls host.reset', () => {
    const { rt, host } = setup([
      { id: 's', when: { on: 'start' }, then: [{ do: 'add', key: 'starts', amount: 1 }] },
      { id: 'once', once: true, when: { on: 'timer', at: 0.05 }, then: [{ do: 'add', key: 'score', amount: 1 }, { do: 'spawn', template: 'coin-tpl' }] },
      { id: 'r', when: { on: 'key', key: 'r' }, then: [{ do: 'reset' }] },
    ]);
    run(rt, 10);
    expect(rt.readState('score')).toBe(1);
    rt.tick(DT, keys('r'), NO_EVENTS);
    expect(host.resets).toBe(1);
    expect(rt.time).toBe(0);
    expect(rt.readState('score')).toBe(0);
    expect(rt.readState('starts')).toBeUndefined();
    run(rt, 10);
    expect(rt.readState('starts')).toBe(1);
    expect(rt.readState('score')).toBe(1);
    // spawn counters restart after reset
    expect(host.spawned.map((e) => e.id)).toEqual(['coin-tpl-1', 'coin-tpl-1']);
  });
});

describe('safety limits', () => {
  it(`caps rule firings at ${MAX_FIRINGS_PER_TICK} per tick`, () => {
    const rules: RuleInput[] = [];
    for (let i = 0; i < 100; i++) rules.push({ id: `r${i}`, when: { on: 'start' }, then: [{ do: 'add', key: 'score', amount: 1 }] });
    const { rt } = setup(rules);
    rt.tick(DT, input(), NO_EVENTS);
    expect(rt.readState('score')).toBe(MAX_FIRINGS_PER_TICK);
    expect(logText(rt.log)).toContain('more than 64 rule firings');
  });

  it(`drops emit chains deeper than ${MAX_EMIT_DEPTH}`, () => {
    const { rt } = setup([
      { id: 'kick', when: { on: 'start' }, then: [{ do: 'emit', event: 'loop' }] },
      { id: 'loop', when: { on: 'event', name: 'loop' }, then: [{ do: 'add', key: 'score', amount: 1 }, { do: 'emit', event: 'loop' }] },
    ]);
    expect(() => rt.start()).not.toThrow();
    expect(rt.readState('score')).toBe(MAX_EMIT_DEPTH);
    expect(logText(rt.log)).toContain('emit chain deeper than 8');
  });

  it('a self-re-emitting delayed event runs once per delay without blowing up', () => {
    const { rt } = setup([
      { id: 'kick', when: { on: 'start' }, then: [{ do: 'emit', event: 'pulse', delay: 0.1 }] },
      { id: 'pulse', when: { on: 'event', name: 'pulse' }, then: [{ do: 'add', key: 'score', amount: 1 }, { do: 'emit', event: 'pulse', delay: 0.1 }] },
    ]);
    run(rt, 61);
    expect(rt.readState('score')).toBeGreaterThanOrEqual(9);
    expect(rt.readState('score')).toBeLessThanOrEqual(10);
  });

  it('bounds the delayed event queue', () => {
    const then = Array.from({ length: 300 }, () => ({ do: 'emit' as const, event: 'x', delay: 5 }));
    const { rt } = setup([{ id: 'flood', when: { on: 'start' }, then }]);
    rt.start();
    expect(logText(rt.log)).toContain('event queue is full');
  });

  it('tick never throws, even with hostile input and events', () => {
    const { rt } = setup([{ id: 'x', when: { on: 'collision', a: '*', b: '*' }, then: [{ do: 'add', key: 'score', amount: 1 }] }]);
    const bad = [null, { type: 'collisionStart', a: 1, b: {} }, { type: 'weird', a: 'a', b: 'b' }] as unknown as PhysicsEventLike[];
    expect(() => rt.tick(NaN, null as never, bad)).not.toThrow();
    expect(() => rt.tick(-1, input({ forward: Infinity, keys: 'nope' as never }), bad)).not.toThrow();
    expect(() => rt.tick(1e9, input(), NO_EVENTS)).not.toThrow();
    expect(rt.time).toBeLessThanOrEqual(0.25);
  });

  it('a throwing host is contained and logged', () => {
    const { rt, host } = setup([{ id: 'boom', when: { on: 'start' }, then: [{ do: 'sound', sound: 'hit' }, { do: 'add', key: 'score', amount: 1 }] }]);
    host.sound = () => {
      throw new Error('audio broken');
    };
    expect(() => rt.start()).not.toThrow();
    expect(rt.readState('score')).toBe(1);
    expect(logText(rt.log)).toContain('error in sound: audio broken');
  });
});

describe('describeTrigger', () => {
  it('describes every trigger kind', () => {
    expect(describeTrigger({ on: 'start' })).toBe('start');
    expect(describeTrigger({ on: 'tick', every: 2 })).toBe('every 2s');
    expect(describeTrigger({ on: 'enter', zone: 'z', who: 'player' })).toBe('player enters z');
    expect(describeTrigger({ on: 'fallBelow', target: 'player', y: -5 })).toBe('player below y=-5');
  });
});
