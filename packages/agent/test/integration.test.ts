/**
 * Integration: worlds produced by the offline mock planner pass the real
 * headless verification (Rapier physics + logic rules). This is what visitors
 * see when no API key is configured, so it must hold for the showcase themes.
 */
import { applyPatches, createWorld, worldTransform, type WorldDoc } from '@aether/core';
import { EMPTY_INPUT, LogicRuntime, type LogicHost } from '@aether/logic';
import { initPhysics, verify, type LogicHook, type PhysicsWorld } from '@aether/physics';
import { beforeAll, describe, expect, it } from 'vitest';
import { PROMPT_EXAMPLES } from '../src/examples';
import { askMock, patchesOf } from './helpers';

/** Minimal LogicHost over a PhysicsWorld (what the studio wires up for real). */
function logicHook(world: WorldDoc) {
  return (pw: PhysicsWorld): LogicHook => {
    const host: LogicHost = {
      getTransform: (id) => {
        const s = pw.getState(id);
        if (s) return { position: s.position, quaternion: s.quaternion };
        if (!world.entities[id]) return undefined;
        const t = worldTransform(world, id);
        return { position: t.position, quaternion: t.quaternion };
      },
      setKinematic: (id, p, q) => pw.setKinematicTarget(id, p, q),
      applyImpulse: (id, v) => pw.applyImpulse(id, v),
      setVelocity: (id, v) => pw.setVelocity(id, v),
      getVelocity: (id) => pw.getState(id)?.linvel,
      teleport: (id, p) => pw.teleport(id, p),
      explode: (c, f, r) => pw.explode(c, f, r),
      setGravity: (v) => pw.setGravity(v),
      spawn: (e) => pw.addEntity(e),
      destroy: (id) => pw.removeEntity(id),
      setProperty: () => undefined,
      message: () => undefined,
      sound: () => undefined,
      gameOver: () => undefined,
      reset: () => undefined,
      playerId: () => undefined,
    };
    const rt = new LogicRuntime(world, host);
    rt.start();
    return { tick: (dt, _pw, events) => rt.tick(dt, EMPTY_INPUT, events), readState: (k) => rt.readState(k) };
  };
}

describe('mock worlds pass physics + logic verification', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it.each([
    'a domino run that knocks over a bell',
    'collect 8 coins before time runs out',
    'a bowling alley',
    'knock down a tower of crates with a cannonball',
    'an obstacle course over lava',
    'a space station among asteroids',
    'a park with a playground',
    'a haunted castle in a snowy forest at night',
  ])('%s', async (prompt) => {
    const result = applyPatches(createWorld(), patchesOf(await askMock(prompt)));
    expect(result.errors).toEqual([]);
    const report = await verify(result.world, { maxSeconds: 25, budgetMs: 20_000, logic: logicHook(result.world) });
    expect(report.results.filter((r) => !r.passed)).toEqual([]);
    expect(report.diagnostics.filter((d) => d.severity !== 'info')).toEqual([]);
    expect(report.passed).toBe(true);
  });
});

// Regression: the domino few-shot example (shown to every live model) failed its own
// "chain-falls" test — the last domino came to rest leaning on the bell at 35°.
describe('few-shot prompt examples pass their own verification', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it.each(PROMPT_EXAMPLES.filter((ex) => !ex.request.startsWith('(edit)')).map((ex) => [ex.request, ex] as const))('%s', async (_request, ex) => {
    const result = applyPatches(createWorld(), ex.patches);
    expect(result.errors).toEqual([]);
    const report = await verify(result.world, { maxSeconds: 25, budgetMs: 20_000, logic: logicHook(result.world) });
    expect(report.results.filter((r) => !r.passed)).toEqual([]);
    expect(report.passed).toBe(true);
  });
});
