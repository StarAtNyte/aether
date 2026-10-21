/**
 * Feel events (`LogicHost.feedback`): which gameplay moments produce them, and the rule that they never change the
 * simulation — the same world plays identically with no feel layer, a recording one and a throwing one.
 */
import { describe, expect, it } from 'vitest';
import type { EntityInput, RuleInput } from '@aether/core';
import { LogicRuntime, type FeedbackEvent } from '../src';
import { DT, FakeHost, input, keys, worldOf } from './helpers';

class FeelHost extends FakeHost {
  readonly events: Array<Omit<FeedbackEvent, 'at'> & { at?: number[] }> = [];
  feedback(e: FeedbackEvent): void {
    this.events.push({ ...e, ...(e.at ? { at: [...e.at] } : {}) });
  }
}

class ThrowingHost extends FakeHost {
  feedback(): void {
    throw new Error('presentation layer broke');
  }
}

const ENTITIES: EntityInput[] = [
  { id: 'coin', transform: { position: [0, 1, 0] }, behaviors: [{ type: 'collectible', params: { value: 5 } }] },
  { id: 'spikes', transform: { position: [3, 0.5, 0] }, behaviors: [{ type: 'hazard', params: { mode: 'damage', damage: 1, startHealth: 3 } }] },
  { id: 'flag', transform: { position: [6, 1, 0] }, behaviors: [{ type: 'checkpoint' }] },
  { id: 'pad', transform: { position: [9, 0.1, 0] }, shape: { kind: 'primitive', primitive: 'box', size: [2, 0.2, 2] }, behaviors: [{ type: 'launcher', params: { speed: 18 } }] },
  { id: 'finish', transform: { position: [12, 1, 0] }, behaviors: [{ type: 'goal' }] },
];
const RULES: RuleInput[] = [
  { id: 'boom', when: { on: 'key', key: 'f' }, then: [{ do: 'effect', vfx: 'explosion', at: [1, 2, 3], feel: 'explosion', color: '#ffcc00' }, { do: 'add', key: 'booms', amount: 1 }] },
  { id: 'puff', when: { on: 'key', key: 'g' }, then: [{ do: 'effect', vfx: 'smoke' }] },
];

/** Walk the player through every station and press the effect keys; return a fingerprint of the run. */
function play(host: FakeHost): { rt: LogicRuntime; trace: string } {
  host.player = 'avatar';
  host.place('avatar', [-5, 1, 0]);
  const rt = new LogicRuntime(worldOf(ENTITIES, RULES), host, { seed: 7 });
  const stops: Array<[number, number, number]> = [[0, 1, 0], [3, 1, 0], [6, 1, 0], [9, 0.5, 0], [12, 1, 0]];
  for (let i = 0; i < stops.length; i++) {
    host.place('avatar', stops[i]!);
    for (let k = 0; k < 6; k++) rt.tick(DT, k === 2 ? keys(i === 1 ? 'f' : 'g') : input(), []);
  }
  const trace = JSON.stringify({ state: rt.state, status: rt.status, time: rt.time, log: rt.log.map((l) => l.text), calls: host.calls, destroyed: host.destroyed });
  return { rt, trace };
}

describe('feel events', () => {
  it('pickups, damage, checkpoints, launches, wins and effect actions are reported with place and amount', () => {
    const host = new FeelHost();
    const { rt } = play(host);
    const kinds = host.events.map((e) => e.kind);
    expect(kinds).toEqual(['pickup', null, 'damage', 'explosion', 'checkpoint', null, 'launch', null, 'win']);
    const pickup = host.events[0]!;
    expect(pickup).toMatchObject({ kind: 'pickup', source: 'coin', target: 'avatar', amount: 5 });
    expect(pickup.at).toEqual([0, 1, 0]);
    const damage = host.events.find((e) => e.kind === 'damage')!;
    expect(damage).toMatchObject({ source: 'spikes', amount: -1 });
    const boom = host.events.find((e) => e.kind === 'explosion')!;
    expect(boom).toMatchObject({ vfx: 'explosion', color: '#ffcc00', at: [1, 2, 3] });
    // A pure effect without a place plays at the player.
    const puff = host.events.find((e) => e.vfx === 'smoke')!;
    expect(puff.kind).toBeNull();
    expect(puff.at).toEqual([0, 1, 0]);
    // Ticks seed the effects: strictly increasing within the run.
    const ticks = host.events.map((e) => e.tick);
    expect([...ticks].sort((a, b) => a - b)).toEqual(ticks);
    expect(rt.status).toBe('won');
    expect(rt.log.some((l) => l.text.includes('effect explosion (explosion)'))).toBe(true);
  });

  it('the same run reports the same events (deterministic seeds for the effects)', () => {
    const a = new FeelHost();
    const b = new FeelHost();
    play(a);
    play(b);
    expect(b.events).toEqual(a.events);
  });

  it('never changes the simulation: no feel layer, a recording one and a throwing one play identically', () => {
    const plain = play(new FakeHost()).trace;
    expect(play(new FeelHost()).trace).toBe(plain);
    expect(play(new ThrowingHost()).trace).toBe(plain);
  });

  it('a lost game reports death; an explode action reports an explosion scaled by its radius', () => {
    const host = new FeelHost();
    host.player = 'avatar';
    host.place('avatar', [0, 1, 0]);
    const rt = new LogicRuntime(
      worldOf([{ id: 'lava', transform: { position: [0, 0.5, 0] }, behaviors: [{ type: 'hazard' }] }], [{ id: 'kaboom', when: { on: 'start' }, then: [{ do: 'explode', at: [0, 0, 5], radius: 10 }] }]),
      host,
    );
    for (let i = 0; i < 3; i++) rt.tick(DT, input(), []);
    const kinds = host.events.map((e) => e.kind);
    expect(kinds).toContain('explosion');
    expect(kinds).toContain('hit');
    expect(kinds[kinds.length - 1]).toBe('death');
    expect(host.events.find((e) => e.kind === 'explosion')?.intensity).toBe(2);
    expect(rt.status).toBe('lost');
  });
});
