/**
 * Behaviour of the benchmark's moving parts: the playtest bot, the fault
 * catalogue and scripted repairer, the edit-case generator and the quick
 * benchmark as a whole (the same run CI performs).
 */
import { applyPatches, createWorld, type PatchInput, type WorldDoc } from '@aether/core';
import { createMockProvider } from '@aether/agent';
import { initScripting } from '@aether/logic';
import { initPhysics } from '@aether/physics';
import { GENERATOR_LIBRARY } from '@aether/procgen';
import { createNodeSandbox } from '@aether/procgen/node';
import type { SandboxRunner } from '@aether/procgen';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GENERATOR_DRY_RUN_MS } from '../lib/headless-world';
import { isWinnableKind, playtest } from './autoplay';
import { editsFor, isA, namedThings } from './edit-study';
import { FAULTS, healthy, repairStudy, scriptedModel } from './repair-study';
import { check, runBench } from './run';
import { PROMPTS, QUICK_PROMPTS } from './suite';
import { fidelity, recordingProvider, runAgent, structure } from './world-eval';

let sandbox: SandboxRunner;

beforeAll(async () => {
  await initPhysics();
  await initScripting().catch(() => undefined);
  sandbox = createNodeSandbox({ timeoutMs: GENERATOR_DRY_RUN_MS });
});

afterAll(() => sandbox.dispose());

async function build(prompt: string): Promise<WorldDoc> {
  const r = await runAgent(prompt, { provider: recordingProvider(createMockProvider({ library: GENERATOR_LIBRARY })), sandbox });
  return r.world;
}

describe('suite', () => {
  it('has 60+ distinct prompts with unique ids across the five kinds', () => {
    expect(PROMPTS.length).toBeGreaterThanOrEqual(60);
    expect(new Set(PROMPTS.map((p) => p.id)).size).toBe(PROMPTS.length);
    expect(new Set(PROMPTS.map((p) => p.prompt)).size).toBe(PROMPTS.length);
    expect(new Set(PROMPTS.map((p) => p.kind))).toEqual(new Set(['game', 'physics', 'voxel', 'house', 'scene']));
    for (const p of PROMPTS) for (const m of p.mustHave) expect(() => new RegExp(m, 'i')).not.toThrow();
  });

  it('marks a CI quick subset that covers every kind', () => {
    expect(QUICK_PROMPTS.length).toBeGreaterThanOrEqual(5);
    expect(new Set(QUICK_PROMPTS.map((p) => p.kind)).size).toBe(5);
  });
});

describe('world checks', () => {
  it('measures fidelity against what the world contains, not against the prompt echoed in its description', async () => {
    const w = await build('a coin collecting game: grab 8 coins before time runs out');
    expect(w.description.toLowerCase()).toContain('coin');
    expect(fidelity(w, ['coin']).score).toBe(1);
    expect(fidelity(w, ['coin', 'submarine']).missing).toEqual(['submarine']);
    const meadow = await build('a submarine rescue game with oxygen management');
    expect(meadow.description.toLowerCase()).toContain('submarine');
    expect(fidelity(meadow, ['submarine']).score).toBe(0);
  });

  it('requires a win condition for games and a behavioural test for physics scenes', async () => {
    const coins = await build('collect 8 coins');
    expect(structure('game', coins, isWinnableKind(coins)).ok).toBe(true);
    const meadow = await build('a marble run down a spiral ramp');
    expect(structure('game', meadow, isWinnableKind(meadow)).ok).toBe(false);
    expect(structure('physics', meadow, false).ok).toBe(false);
    const domino = await build('a domino run that knocks over a bell');
    expect(structure('physics', domino, false).ok).toBe(true);
    expect(structure('voxel', domino, false).ok).toBe(false);
  });
});

describe('playtest bot', () => {
  it('wins a generated coin game and a parkour course through real physics and rules', async () => {
    const coins = await playtest(await build('a coin collecting game: grab 8 coins before time runs out'));
    expect(coins.won).toBe(true);
    expect(coins.finalState['score']).toBe(8);
    const course = await playtest(await build('a sky parkour course over lava'));
    expect(course.won).toBe(true);
    expect(course.seconds).toBeGreaterThan(3);
  }, 60_000);

  it('does not win a world with no way to win, and says so', async () => {
    const w = await build('a cozy forest camp with a campfire and tents');
    expect(isWinnableKind(w)).toBe(false);
    const r = await playtest(w);
    expect(r.won).toBe(false);
    expect(r.summary).toMatch(/no rule or goal/);
  }, 60_000);

  it('names the pickup it cannot reach and the rule that cannot be met', async () => {
    const clean = await build('a coin collecting game: grab 8 coins before time runs out');
    const unreachable = FAULTS.find((f) => f.id === 'unreachable-pickup')?.inject(clean) as WorldDoc;
    const r = await playtest(unreachable);
    expect(r.won).toBe(false);
    expect(r.failed.length).toBeGreaterThan(0);
    expect(r.summary).toContain(r.failed[0]?.id as string);
    const inflated = FAULTS.find((f) => f.id === 'inflated-threshold')?.inject(clean) as WorldDoc;
    const r2 = await playtest(inflated);
    expect(r2.won).toBe(false);
    expect(r2.summary).toMatch(/needs score >= 11/);
  }, 120_000);
});

describe('faults and the scripted repairer', () => {
  it('every fault returns a valid but unhealthy world, or null when it does not apply', async () => {
    const coins = await build('a coin collecting game: grab 8 coins before time runs out');
    const domino = await build('a domino run that knocks over a bell');
    expect(FAULTS.find((f) => f.id === 'unreachable-goal')?.inject(coins)).toBeNull();
    expect(FAULTS.find((f) => f.id === 'broken-chain')?.inject(coins)).toBeNull();
    expect((await healthy(coins)).ok).toBe(true);
    expect((await healthy(domino)).ok).toBe(true);
    const broken = FAULTS.find((f) => f.id === 'broken-chain')?.inject(domino) as WorldDoc;
    expect((await healthy(broken)).ok).toBe(false);
  }, 60_000);

  it('abstains unless the failing report names the problem', async () => {
    const fix: PatchInput[] = [{ op: 'setMeta', name: 'fixed' }];
    const model = scriptedModel([{ op: 'setMeta', name: 'built' }], fix, /domino-7/);
    const ask = (text: string) => model.complete({ role: 'planner', system: '', messages: [{ role: 'user', content: text }] });
    const first = await ask('<request>build</request>');
    expect(first.content.some((b) => b.type === 'tool_use' && b.name === 'apply_patches')).toBe(true);
    const vague = await ask('Verification FAILED (repair 1/2): something is wrong');
    expect(vague.content.some((b) => b.type === 'tool_use')).toBe(false);
    const told = await ask('Verification FAILED (repair 1/2): domino-7 did not topple');
    expect(told.content.some((b) => b.type === 'tool_use' && b.name === 'apply_patches')).toBe(true);
  });

  it('the loop repairs a physics fault from the test report alone, and a winnability fault only with a playtest in the loop', async () => {
    const domino = await repairStudy('domino', await build('a domino run that knocks over a bell'), sandbox);
    const chain = domino.find((r) => r.fault === 'broken-chain');
    expect(chain?.effective).toBe(true);
    expect(chain?.verifyOnly).toMatchObject({ detected: true, repaired: true, repairTurns: 1 });

    const coins = await repairStudy('coins', await build('a coin collecting game: grab 8 coins before time runs out'), sandbox);
    const stuck = coins.find((r) => r.fault === 'unreachable-pickup');
    expect(stuck?.effective).toBe(true);
    expect(stuck?.verifyOnly).toMatchObject({ detected: false, repaired: false, repairTurns: 0 });
    expect(stuck?.withPlaytest).toMatchObject({ detected: true, repaired: true });
  }, 120_000);
});

describe('edit cases', () => {
  it('names things the way a person reads the outliner and ignores structure', async () => {
    const w = await build('a cozy forest camp with a campfire and tents');
    const things = namedThings(w);
    expect(things.length).toBeGreaterThan(0);
    for (const t of things) {
      expect(t.ids.length).toBeGreaterThanOrEqual(2);
      expect(['focus', 'backdrop', 'sky']).not.toContain(t.noun);
    }
    const tree = things.find((t) => t.noun === 'tree');
    expect(tree).toBeDefined();
    const treeScatter = Object.values(w.entities).find((e) => e.shape.kind === 'scatter' && e.shape.of.kind === 'procedural' && e.shape.of.generator.includes('tree'));
    expect(treeScatter).toBeDefined();
    expect(isA(treeScatter as WorldDoc['entities'][string], 'tree')).toBe(true);
    expect(isA(treeScatter as WorldDoc['entities'][string], 'rock')).toBe(false);
  }, 30_000);

  it('builds deterministic edit cases with intents, skipping no-op environment edits', async () => {
    const w = await build('a cozy forest camp with a campfire and tents');
    const a = editsFor('camp', w);
    const b = editsFor('camp', w);
    expect(a.map((c) => c.request)).toEqual(b.map((c) => c.request));
    expect(new Set(a.map((c) => c.id)).size).toBe(a.length);
    expect(a.length).toBeGreaterThanOrEqual(6);
    const night = applyPatches(w, [{ op: 'setEnvironment', set: { sky: 'night' } }]).world;
    expect(editsFor('camp', night).some((c) => c.kind === 'night')).toBe(false);
    expect(editsFor('camp', w, 3)).toHaveLength(3);
    expect(editsFor('camp', createWorld())).toHaveLength(3);
  }, 30_000);
});

describe('the quick benchmark', () => {
  it('runs end to end, keeps the claims in check() and renders', async () => {
    const results = await runBench({ quick: true, sandbox });
    expect(results.mode).toBe('quick');
    expect(results.prompts).toHaveLength(QUICK_PROMPTS.length);
    expect(results.edits.rows.length).toBeGreaterThanOrEqual(10);
    expect(check(results)).toEqual([]);
    // The headline claims, as numbers.
    expect(results.edits.summary.aether.outputTokensMedian).toBeLessThan(results.edits.summary.regenOracle.outputTokensMedian / 3);
    expect(results.speed.summary.forkDriftMax).toBe(0);
    const bad = structuredClone(results);
    bad.speed.summary.forkDriftMax = 0.5;
    expect(check(bad).some((m) => m.includes('fork'))).toBe(true);
  }, 180_000);
});
