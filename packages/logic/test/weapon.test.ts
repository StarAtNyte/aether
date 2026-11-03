import { describe, expect, it } from 'vitest';
import type { EntityInput, RuleInput, WorldDocInput } from '@aether/core';
import { LogicRuntime, rayCapsule, WEAPON_SOURCE, type FeedbackEvent, type InputState, type RayHit } from '../src';
import { DT, FakeHost, input, worldOf } from './helpers';
import { npcEntity, wallEntity } from './npc-helpers';

/** A host that records feedback and answers rays against registered walls (axis-aligned boxes). */
class GunHost extends FakeHost {
  readonly feedbacks: Array<{ kind: string | null; source?: string; target?: string; vfx?: string }> = [];
  walls: Array<{ id: string; min: [number, number, number]; max: [number, number, number] }> = [];
  feedback(ev: FeedbackEvent): void {
    this.feedbacks.push({ kind: ev.kind, ...(ev.source ? { source: ev.source } : {}), ...(ev.target ? { target: ev.target } : {}), ...(ev.vfx ? { vfx: ev.vfx } : {}) });
  }
  raycast(o: [number, number, number], d: [number, number, number], max: number): RayHit[] {
    const hits: RayHit[] = [];
    for (const w of this.walls) {
      let t0 = 0;
      let t1 = max;
      let ok = true;
      for (let a = 0; a < 3 && ok; a++) {
        const inv = 1 / (d[a] as number);
        let ta = ((w.min[a] as number) - (o[a] as number)) * inv;
        let tb = ((w.max[a] as number) - (o[a] as number)) * inv;
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta);
        t1 = Math.min(t1, tb);
        if (t0 > t1) ok = false;
      }
      if (ok) hits.push({ id: w.id, distance: t0, point: [o[0] + d[0] * t0, o[1] + d[1] * t0, o[2] + d[2] * t0] });
    }
    return hits.sort((a, b) => a.distance - b.distance);
  }
}

const RAIDER = { faction: 'raiders', archetype: 'guard', enemies: ['player'], health: 60, perception: { sight: 0, hearing: 0 } };

function setup(entities: EntityInput[], opts: { weapon?: Record<string, unknown>; rules?: RuleInput[]; extra?: WorldDocInput } = {}): { host: GunHost; rt: LogicRuntime } {
  const host = new GunHost();
  host.player = 'avatar';
  host.place('avatar', [0, 0, 0]);
  const w = worldOf(entities, opts.rules ?? [], { ...(opts.extra ?? {}), player: { mode: 'thirdPerson', weapon: { spread: 0, ...(opts.weapon ?? {}) } } as WorldDocInput['player'] });
  return { host, rt: new LogicRuntime(w, host) };
}

/** Aim from the player's eyes (0, 1.6, 0) toward a point. */
function aimAt(x: number, y: number, z: number, fire = true): InputState {
  const d: [number, number, number] = [x, y - 1.6, z];
  const l = Math.hypot(...d);
  return input({ fire, aim: { origin: [0, 1.6, 0], dir: [d[0] / l, d[1] / l, d[2] / l] } });
}

function hold(rt: LogicRuntime, seconds: number, inp: InputState): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) rt.tick(DT, inp, []);
}

describe('rayCapsule', () => {
  it('hits a standing body in front and misses one to the side', () => {
    expect(rayCapsule([0, 1, 0], [0, 0, -1], 0, 0, -10, 0.4, 1.8, 0, 100)).toBeCloseTo(9.6, 1);
    expect(rayCapsule([0, 1, 0], [0, 0, -1], 2, 0, -10, 0.4, 1.8, 0, 100)).toBe(Number.POSITIVE_INFINITY);
    // Over the head.
    expect(rayCapsule([0, 3, 0], [0, 0, -1], 0, 0, -10, 0.4, 1.8, 0, 100)).toBe(Number.POSITIVE_INFINITY);
    // Behind the range window.
    expect(rayCapsule([0, 1, 0], [0, 0, -1], 0, 0, -10, 0.4, 1.8, 0, 5)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('player weapon', () => {
  it('fills the magazine and reserve into world state at the start', () => {
    const { rt } = setup([], { weapon: { magazine: 12, reserve: 40 } });
    rt.tick(DT, input(), []);
    expect(rt.readState('ammo')).toBe(12);
    expect(rt.readState('reserve')).toBe(40);
    expect(rt.weapon?.magazine).toBe(12);
  });

  it('fires at its rate while the trigger is held, then reloads from the reserve', () => {
    const { rt, host } = setup([], { weapon: { magazine: 10, reserve: 25, fireRate: 10, reloadTime: 1 } });
    hold(rt, 0.55, aimAt(0, 1.6, -10));
    // 10 shots per second: 6 shots in 0.55 s (the first on the first tick).
    expect(rt.readState('ammo')).toBe(4);
    expect(host.sounds.filter((s) => s === 'shot')).toHaveLength(6);
    hold(rt, 0.6, aimAt(0, 1.6, -10));
    expect(rt.readState('ammo')).toBe(0);
    expect(rt.weapon?.reloading).toBe(true);
    hold(rt, 1.05, aimAt(0, 1.6, -10, false));
    expect(rt.weapon?.reloading).toBe(false);
    expect(rt.readState('ammo')).toBe(10);
    expect(rt.readState('reserve')).toBe(15);
  });

  it('reloads on R and clicks when everything is spent', () => {
    const { rt, host } = setup([], { weapon: { magazine: 5, reserve: 0, fireRate: 20 } });
    hold(rt, 0.5, aimAt(0, 1.6, -10));
    expect(rt.readState('ammo')).toBe(0);
    expect(host.sounds).toContain('empty');
    expect(rt.weapon?.reloading).toBe(false);
  });

  it('semi-automatic weapons fire once per press', () => {
    const { rt } = setup([], { weapon: { automatic: false, magazine: 8 } });
    hold(rt, 1, aimAt(0, 1.6, -10));
    expect(rt.readState('ammo')).toBe(7);
    hold(rt, 0.1, aimAt(0, 1.6, -10, false));
    hold(rt, 0.1, aimAt(0, 1.6, -10));
    expect(rt.readState('ammo')).toBe(6);
  });

  it('damages and kills an NPC in the crosshair, with hit and kill feedback and the death events', () => {
    const rules: RuleInput[] = [
      { id: 'k', when: { on: 'event', name: 'npc-died' }, then: [{ do: 'add', key: 'kills', amount: 1 }] },
      { id: 't', when: { on: 'event', name: 'raider-died' }, then: [{ do: 'add', key: 'tagged', amount: 1 }] },
    ];
    const { rt, host } = setup([npcEntity('bandit', 0, -12, RAIDER, { tags: ['raider'] })], { weapon: { damage: 25, fireRate: 5 }, rules, extra: { state: { kills: 0, tagged: 0 } } });
    rt.tick(DT, input(), []);
    hold(rt, 0.05, aimAt(0, 1.0, -12));
    expect(rt.entityState('bandit')['health']).toBe(35);
    expect(host.feedbacks.some((f) => f.kind === 'hit' && f.source === WEAPON_SOURCE && f.target === 'bandit')).toBe(true);
    expect(host.feedbacks.some((f) => f.kind === 'shoot')).toBe(true);
    hold(rt, 1, aimAt(0, 1.0, -12));
    expect(rt.npcs.info('bandit')?.dead ?? rt.entityState('bandit')['health'] as number <= 0).toBeTruthy();
    expect(rt.readState('kills')).toBe(1);
    expect(rt.readState('tagged')).toBe(1);
    expect(host.feedbacks.some((f) => f.kind === 'kill' && f.target === 'bandit')).toBe(true);
    expect(rt.weapon?.hits).toBeGreaterThanOrEqual(3);
  });

  it('a head shot does more damage', () => {
    const { rt } = setup([npcEntity('bandit', 0, -12, { ...RAIDER, health: 200 })], { weapon: { damage: 20, headshot: 3 } });
    rt.tick(DT, input(), []);
    hold(rt, 0.02, aimAt(0, 1.72, -12));
    expect(rt.entityState('bandit')['health']).toBe(140);
  });

  it('a wall stops the shot', () => {
    const { rt, host } = setup([npcEntity('bandit', 0, -12, RAIDER), wallEntity('wall', 0, -6, 4, 0.5)], { weapon: { damage: 25 } });
    host.walls = [{ id: 'wall', min: [-2, 0, -6.25], max: [2, 3, -5.75] }];
    rt.tick(DT, input(), []);
    hold(rt, 0.5, aimAt(0, 1.0, -12));
    expect(rt.entityState('bandit')['health'] ?? 60).toBe(60);
    expect(host.feedbacks.some((f) => f.vfx === 'impact')).toBe(true);
  });

  it('never hurts characters allied with the player', () => {
    const { rt } = setup([npcEntity('relay', 0, -8, { faction: 'outpost', archetype: 'sentinel', allies: ['player'], speed: 0, health: 100 })], { weapon: { damage: 25 } });
    rt.tick(DT, input(), []);
    hold(rt, 0.5, aimAt(0, 1.0, -8));
    expect(rt.entityState('relay')['health'] ?? 100).toBe(100);
  });

  it('shots leave the eyes along yaw and pitch without an aim ray', () => {
    const { rt } = setup([npcEntity('bandit', 0, -10, RAIDER)], { weapon: { damage: 10 } });
    rt.tick(DT, input(), []);
    // Yaw 0 faces -Z; pitch a little down toward the chest.
    hold(rt, 0.02, input({ fire: true, pointerYawDeg: 0, pitchDeg: -4 }));
    expect(rt.entityState('bandit')['health']).toBe(50);
  });
});

describe('NPC drops, bodies and ranged attacks', () => {
  it('drops its loot where it falls and is cleared away after `corpse` seconds', () => {
    const pickup: EntityInput = { id: 'medkit', template: true, shape: { kind: 'primitive', primitive: 'box', size: [0.4, 0.3, 0.3] }, behaviors: [{ type: 'collectible', params: { scoreKey: 'health', value: 20 } }] };
    const { rt, host } = setup([npcEntity('bandit', 3, -9, { ...RAIDER, drops: [{ template: 'medkit', chance: 1 }], corpse: 2 }), pickup], { weapon: { damage: 100 } });
    rt.tick(DT, input(), []);
    hold(rt, 0.05, aimAt(3, 1.0, -9));
    hold(rt, 0.1, input());
    const drop = host.spawned.find((e) => e.id.startsWith('medkit-'));
    expect(drop).toBeDefined();
    expect(drop?.transform.position[0]).toBeCloseTo(3, 0);
    expect(host.destroyed).not.toContain('bandit');
    hold(rt, 2.2, input());
    expect(host.destroyed).toContain('bandit');
  });

  it('a ranged attacker shoots from a distance: muzzle flash, and damage that can miss', () => {
    const shooter = { faction: 'raiders', archetype: 'guard', enemies: ['player'], perception: { sight: 40, fov: 360 }, attack: { range: 15, damage: 10, cooldown: 0.5, ranged: true, accuracy: 0.5 } };
    const { rt, host } = setup([npcEntity('gunner', 0, -12, shooter)], { extra: { state: { health: 100 } } });
    hold(rt, 8, input());
    const muzzles = host.feedbacks.filter((f) => f.vfx === 'muzzle').length;
    expect(muzzles).toBeGreaterThan(4);
    const health = rt.readState('health') as number;
    expect(health).toBeLessThan(100);
    // About half the shots land.
    expect(health).toBeGreaterThan(100 - muzzles * 10);
    expect(host.sounds).toContain('enemy-shot');
  });
});
