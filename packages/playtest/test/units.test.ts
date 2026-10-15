import { describe, expect, it } from 'vitest';
import { createWorld, type EntityInput, type WorldDoc } from '@aether/core';
import {
  PLAYTEST_LIMITS,
  deriveGoals,
  downsample,
  dropReach,
  hashWorld,
  jumpHeight,
  jumpReach,
  parseProof,
  parseReport,
  playtest,
  proofTrace,
  toProof,
  unsupportedReason,
  withoutEntities,
  type PlaytestReport,
} from '../src';
import { withDoorsOpen } from '../src/doorpose';
import { coin, gameWorld, goalAt, pickup, slab, winAt } from './helpers';

const abilities = { radius: 0.35, height: 1.7, stepHeight: 0.35, maxSlopeDeg: 50, speed: 6, jumpSpeed: 6, gravity: 9.81 };

describe('goal derivation', () => {
  it('a pickup is required when a winning rule or a door reads its key, otherwise a bonus', () => {
    const world = gameWorld(
      [coin('c1', [2, 1, 0]), pickup('gem', [4, 1, 0], 'gems'), pickup('key', [6, 1, 0], 'keys'), goalAt('exit', [8, 1, 0]), { id: 'door', shape: { kind: 'primitive', primitive: 'box', size: [2, 2, 0.3] }, transform: { position: [0, 1, 5] }, physics: { body: 'kinematic' }, behaviors: [{ type: 'door', params: { trigger: 'state', stateKey: 'keys' } }] }],
      { rules: [winAt(1)], state: { score: 0 } },
    );
    const g = deriveGoals(world);
    const byId = Object.fromEntries(g.objectives.map((o) => [o.id, o]));
    expect(byId['collect:c1']?.required).toBe(true);
    expect(byId['collect:key']?.required).toBe(true);
    expect(byId['collect:gem']?.required).toBe(false);
    expect(byId['goal:exit']?.required).toBe(true);
    expect(g.winDefined).toBe(true);
    expect(g.doors.map((d) => [d.id, d.trigger, d.stateKey])).toEqual([['door', 'state', 'keys']]);
    expect(g.producible.get('keys')).toBe(1);
  });

  it('without any win condition every pickup is the point', () => {
    const g = deriveGoals(gameWorld([coin('a', [1, 1, 0]), coin('b', [2, 1, 0])]));
    expect(g.winDefined).toBe(false);
    expect(g.objectives.every((o) => o.required)).toBe(true);
  });

  it('knows hazards, movers and timers', () => {
    const world = gameWorld(
      [
        { id: 'lava', shape: { kind: 'primitive', primitive: 'box', size: [3, 0.2, 3] }, transform: { position: [0, 0.1, 0] }, physics: { body: 'static', sensor: true }, behaviors: [{ type: 'hazard', params: { mode: 'lose' } }] },
        { id: 'lift', shape: { kind: 'primitive', primitive: 'box', size: [2, 0.3, 2] }, transform: { position: [5, 1, 0] }, physics: { body: 'kinematic' }, behaviors: [{ type: 'patrol', params: { waypoints: [[0, 0, 0], [0, 2, 0]], relative: true } }] },
      ],
      { rules: [{ id: 'survive', when: { on: 'timer', at: 30 }, then: [{ do: 'win', text: 'made it' }] }] },
    );
    const g = deriveGoals(world);
    expect(g.hazards.map((h) => h.id)).toEqual(['lava']);
    expect(g.movers).toEqual(['lift']);
    expect(g.timerSeconds).toBe(30);
  });
});

describe('player abilities', () => {
  it('reach and height follow ballistics', () => {
    expect(jumpHeight(abilities)).toBeCloseTo(1.835, 2);
    expect(jumpReach(abilities, 0)).toBeCloseTo(7.34, 1);
    // Landing as high as the apex leaves no flight time to cover distance; above it is unreachable.
    expect(jumpReach(abilities, 1.8)).toBeLessThan(jumpReach(abilities, 0));
    expect(jumpReach(abilities, 2)).toBe(0);
    expect(jumpReach(abilities, -3)).toBeGreaterThan(jumpReach(abilities, 0));
    expect(dropReach(abilities, -2)).toBeCloseTo(6 * Math.sqrt(4 / 9.81), 3);
    expect(dropReach(abilities, 1)).toBe(0);
  });
});

describe('the proof', () => {
  it('quantises the trace within a centimetre and keeps the events', async () => {
    const report = await playtest(gameWorld([coin('c1', [4, 1, 0]), coin('c2', [-4, 1, 2])], { rules: [winAt(2)], state: { score: 0 } }));
    expect(report.trace).toBeDefined();
    const proof = toProof(report);
    const back = proofTrace(proof);
    expect(back?.frames).toBe(report.trace?.frames);
    let worst = 0;
    for (let i = 0; i < (back?.poses.length ?? 0); i++) if (i % 4 !== 3) worst = Math.max(worst, Math.abs((back?.poses[i] as number) - (report.trace?.poses[i] as number)));
    expect(worst).toBeLessThan(0.01);
    expect(back?.events.length).toBe(report.trace?.events.length);
    expect(parseProof(JSON.parse(JSON.stringify(proof)))?.worldHash).toBe(report.worldHash);
  }, 60_000);

  it('rejects malformed, oversized and inconsistent proofs', async () => {
    const report = await playtest(gameWorld([coin('c1', [4, 1, 0])], { rules: [winAt(1)], state: { score: 0 } }));
    const proof = toProof(report);
    expect(parseProof(null)).toBeNull();
    expect(parseProof({ ...proof, status: 'great' })).toBeNull();
    expect(parseProof({ ...proof, worldHash: 'XYZ' })).toBeNull();
    expect(parseProof({ ...proof, extra: 1 })).not.toBeNull(); // unknown keys are ignored, not trusted
    expect(parseProof({ ...proof, trace: { ...proof.trace!, frames: proof.trace!.frames + 1 } })).toBeNull();
    expect(parseProof({ ...proof, objectives: Array.from({ length: PLAYTEST_LIMITS.MAX_OBJECTIVES + 1 }, () => proof.objectives[0]) })).toBeNull();
    expect(parseProof({ ...proof, trace: { ...proof.trace!, data: 'AAAA!' } })).toBeNull();
  }, 60_000);

  it('a report that crossed a boundary is validated', async () => {
    const report = await playtest(gameWorld([coin('c1', [4, 1, 0])], { rules: [winAt(1)], state: { score: 0 } }));
    const ok = parseReport(structuredClone(report));
    expect(ok?.status).toBe('passed');
    expect(parseReport({ ...report, status: 'maybe' })).toBeNull();
    expect(parseReport({ ...report, seconds: Number.NaN })).toBeNull();
    const bad = structuredClone(report) as PlaytestReport;
    if (bad.trace) bad.trace.poses = new Float32Array(3);
    expect(parseReport(bad)).toBeNull();
    // Long texts are clipped, not trusted.
    const wordy = structuredClone(report);
    wordy.summary = 'x'.repeat(5000);
    expect(parseReport(wordy)?.summary.length).toBe(600);
  }, 60_000);

  it('the content hash ignores looks and tracks gameplay', () => {
    const a = gameWorld([coin('c1', [4, 1, 0]), slab('s', [0, 0.5, 3], [2, 1, 2])], { rules: [winAt(1)] });
    const looks = structuredClone(a);
    (looks.entities['s'] as { name: string }).name = 'A pretty wall';
    looks.environment.sunIntensity = 5;
    expect(hashWorld(looks)).toBe(hashWorld(a));
    const moved = structuredClone(a);
    (moved.entities['c1'] as { transform: { position: [number, number, number] } }).transform.position = [5, 1, 0];
    expect(hashWorld(moved)).not.toBe(hashWorld(a));
    const rules = structuredClone(a);
    rules.rules = [];
    expect(hashWorld(rules)).not.toBe(hashWorld(a));
  });
});

describe('helpers', () => {
  it('downsample keeps the first and last points', () => {
    const list = Array.from({ length: 1000 }, (_, i) => i);
    const d = downsample(list, 50);
    expect(d).toHaveLength(50);
    expect(d[0]).toBe(0);
    expect(d[49]).toBe(999);
    expect(downsample([1, 2, 3], 50)).toEqual([1, 2, 3]);
  });

  it('removes an entity with its descendants', () => {
    const world = gameWorld([{ id: 'a', shape: { kind: 'none' } }, { id: 'b', parent: 'a', shape: { kind: 'none' } }, { id: 'c', parent: 'b', shape: { kind: 'none' } }, { id: 'd', shape: { kind: 'none' } }]);
    const out = withoutEntities(world, new Set(['a']));
    expect(Object.keys(out.entities).sort()).toEqual(['d']);
    expect(Object.keys(world.entities)).toHaveLength(4);
  });

  it('puts a sliding door in its open pose', () => {
    const door: EntityInput = { id: 'door', shape: { kind: 'primitive', primitive: 'box', size: [2, 2.5, 0.3] }, transform: { position: [0, 1.25, 6] }, physics: { body: 'kinematic' }, behaviors: [{ type: 'door', params: { trigger: 'proximity', slide: [0, 2.6, 0] } }] };
    const world = gameWorld([door, goalAt('exit', [0, 1, 9])]);
    const g = deriveGoals(world);
    const open = withDoorsOpen(world, g.doors);
    expect(open.entities['door']?.transform.position[1]).toBeCloseTo(3.85, 5);
    expect(open.entities['door']?.behaviors).toHaveLength(0);
    expect(world.entities['door']?.transform.position[1]).toBe(1.25);
  });
});

describe('what the bot refuses to guess about', () => {
  it('names the worlds it cannot drive', () => {
    const base = (extra: Partial<WorldDoc['player']>): WorldDoc => createWorld({ player: { mode: 'thirdPerson', spawn: [0, 1, 0], moveSpeed: 6, jumpSpeed: 6, ...extra } });
    expect(unsupportedReason(base({ mode: 'orbit' }))).toMatch(/orbit camera/);
    expect(unsupportedReason(base({ mode: 'vehicle' }))).toMatch(/vehicle/);
    expect(unsupportedReason(base({}))).toBeNull();
  });

  it('is unsupported for an orbit-camera world and inconclusive for a world with nothing to play', async () => {
    const orbit = await playtest(createWorld({ player: { mode: 'orbit', spawn: [0, 1, 0], moveSpeed: 6, jumpSpeed: 6 } }));
    expect(orbit.status).toBe('unsupported');
    expect(orbit.won).toBe(false);
    const nothing = await playtest(gameWorld([slab('s', [0, 0.5, 0], [2, 1, 2])]));
    expect(nothing.status).toBe('inconclusive');
    expect(nothing.summary).toMatch(/Nothing to play/);
  });

  it('reports a world that ran out of time as not verified, never as a pass', async () => {
    const coins: EntityInput[] = [];
    for (let i = 0; i < 30; i++) coins.push(coin(`c${i}`, [(i % 6) * 5 - 12, 1, Math.floor(i / 6) * 5 - 10]));
    const r = await playtest(gameWorld(coins, { rules: [winAt(30)], state: { score: 0 } }), { budgetMs: 500, maxSimSeconds: 5 });
    expect(r.status).not.toBe('passed');
    expect(r.won).toBe(false);
    expect(r.findings.some((f) => f.code === 'budget')).toBe(true);
  }, 60_000);

  it('can be cancelled', async () => {
    const ctrl = new AbortController();
    const run = playtest(gameWorld([coin('c1', [4, 1, 0])], { rules: [winAt(1)], state: { score: 0 } }), { signal: ctrl.signal });
    ctrl.abort();
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('is deterministic: the same world gives the same verdict, time and trace', async () => {
    const world = gameWorld([coin('c1', [4, 1, 0]), coin('c2', [-4, 1, 3])], { rules: [winAt(2)], state: { score: 0 } });
    const a = await playtest(world);
    const b = await playtest(world);
    expect(b.status).toBe(a.status);
    expect(b.seconds).toBe(a.seconds);
    expect(Array.from(b.trace?.poses ?? [])).toEqual(Array.from(a.trace?.poses ?? []));
  }, 60_000);
});

describe('characters and evidence', () => {
  const tree = {
    start: 'hello',
    nodes: {
      hello: { text: 'Hi', choices: [{ text: 'Just looking', next: null }, { text: 'Buy the key', if: [{ key: 'coins', op: '>=', value: 3 }], effects: [{ do: 'openDoor', target: 'gate' }], next: 'thanks' }], next: null },
      thanks: { text: 'Thanks', choices: [], next: null },
    },
  };

  it('plans the shortest option sequence that unlocks a required key, with the conditions it needs', async () => {
    const { planDialogue, needsHold } = await import('../src/goals');
    const { Dialogue } = await import('@aether/core');
    const parsed = Dialogue.parse(tree);
    const plan = planDialogue(parsed, new Set(['gate-unlocked']));
    expect(plan?.steps).toEqual(['Buy the key']);
    expect(plan?.writes).toEqual(['gate-unlocked']);
    expect(planDialogue(parsed, new Set(['nothing-writes-this']))).toBeNull();
    expect(needsHold(plan?.needs ?? [], (k) => (k === 'coins' ? 3 : undefined))).toBe(true);
    expect(needsHold(plan?.needs ?? [], (k) => (k === 'coins' ? 2 : undefined))).toBe(false);
    expect(needsHold(plan?.needs ?? [], () => undefined)).toBe(false);
  });

  it('thins a trace for sealing and keeps the evidence valid, only for passed runs', async () => {
    const { EvidenceWire, evidenceTrace, toEvidence, EVIDENCE_LIMITS } = await import('../src');
    const report = await playtest(gameWorld([slab('floor', [0, -0.25, 0], [20, 0.5, 20]), coin('c1', [2, 1, 0]), coin('c2', [-2, 1, 0])], { rules: [winAt(2)], state: { score: 0 } }));
    expect(report.status).toBe('passed');
    const proof = toProof(report);
    const ev = toEvidence(proof);
    expect(ev).not.toBeNull();
    expect(EvidenceWire.safeParse(ev).success).toBe(true);
    expect((ev?.trace?.frames ?? 0) <= EVIDENCE_LIMITS.MAX_FRAMES).toBe(true);
    const t = evidenceTrace(ev!);
    expect(t?.frames).toBe(ev?.trace?.frames);
    expect(toEvidence({ ...proof, status: 'failed' })).toBeNull();
  }, 60_000);
});
