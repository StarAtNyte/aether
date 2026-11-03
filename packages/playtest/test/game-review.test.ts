/**
 * Game checks on Kestrel Outpost (the shooter template) and two broken copies of it: one whose first wave a beginner
 * cannot survive, one saved mid-game so a restart does not reset. Headless physics; a couple of seeded runs each.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createWorld, type Entity, type WorldDoc } from '@aether/core';
import { initPhysics } from '@aether/physics';
import { beforeAll, describe, expect, it } from 'vitest';
import { gameShape, isGameWorld, reviewGame } from '../src/game';

const FILE = fileURLToPath(new URL('../../../apps/studio/public/templates/worlds/kestrel-outpost.json', import.meta.url));
const kestrel = (): WorldDoc => createWorld((JSON.parse(readFileSync(FILE, 'utf8')) as { world: WorldDoc }).world);

/** Kestrel with a first wave no beginner survives: dead-eye riflemen that hit hard, three times as many. */
function tooHard(): WorldDoc {
  const w = kestrel();
  for (const id of ['raider-n', 'raider-e']) {
    const npc = (w.entities[id] as Entity).npc;
    if (npc?.attack) npc.attack = { ...npc.attack, accuracy: 1, damage: 30, cooldown: 0.6, range: 30 };
  }
  for (const r of w.rules) {
    if (r.id !== 'wave-1' && r.id !== 'wave-1-group-1') continue;
    for (const a of r.then) {
      if (a.do === 'spawn') a.count = 8;
      if (a.do === 'add' && a.key === 'alive') a.amount = 8;
    }
  }
  return w;
}

/** Kestrel saved in the middle of a game: a restart (a fresh session from this document) begins at wave 3 with 40 health. */
function savedMidGame(): WorldDoc {
  const w = kestrel();
  w.state = { ...w.state, score: 1200, wave: 3, health: 40, kills: 12 };
  return w;
}

beforeAll(async () => {
  await initPhysics();
});

describe('game shape', () => {
  it('reads Kestrel as a game: weapon, waves, hostile templates, the relay to keep, win and lose rules, pickups', () => {
    const s = gameShape(kestrel());
    expect(s.isGame).toBe(true);
    expect(s.waveKey).toBe('wave');
    expect(s.waves).toBe(5);
    expect(s.waveSpawns.get(1)?.map((x) => x.template)).toEqual(['raider-n', 'raider-e']);
    expect(s.objectives).toEqual(['relay']);
    expect(s.winPaths.length).toBeGreaterThan(0);
    expect(s.losePaths.length).toBeGreaterThan(0);
    expect(s.pickups.some((p) => p.key === 'health')).toBe(true);
  });

  it('skips a world that is not a game', async () => {
    const w = createWorld();
    expect(isGameWorld(w)).toBe(false);
    const r = await reviewGame(w);
    expect(r.ran).toBe(false);
    expect(r.findings).toEqual([]);
  });
});

describe('game review', () => {
  it('passes Kestrel Outpost: a beginner lives through wave 1, the lose and win screens come, restart resets', async () => {
    const r = await reviewGame(kestrel(), { seeds: 3, budgetMs: 60_000 });
    // eslint-disable-next-line no-console
    console.log(r.summary.join('\n'));
    const codes = r.findings.map((f) => f.code);
    expect(codes).not.toContain('game_novice_dies_early');
    expect(codes).not.toContain('game_restart_state');
    expect(codes).not.toContain('game_restart_dirty');
    expect(codes).not.toContain('game_ends_at_start');
    expect(codes).not.toContain('game_lose_unreached');
    expect(codes).not.toContain('game_message_under_title');
    expect(r.runs.some((x) => x.outcome === 'lose')).toBe(true);
    expect(r.findings.filter((f) => f.severity === 'error')).toEqual([]);
  }, 180_000);

  it('catches a first wave a beginner cannot survive, naming the attacker and real params to change', async () => {
    const r = await reviewGame(tooHard(), { seeds: 2, flow: false, budgetMs: 60_000 });
    const f = r.findings.find((x) => x.code === 'game_novice_dies_early');
    expect(f, r.summary.join('\n')).toBeDefined();
    expect(f?.message).toMatch(/wave 1/);
    expect(f?.entities[0]).toMatch(/^raider-[ne]$/);
    expect(f?.fix).toMatch(/npc\.attack\.accuracy 1 → 0\.\d+/);
    expect(f?.fix).toMatch(/rule wave-1(-group-1)? action \d \(spawn raider-[ne]\) count 8 → \d with action \d add alive 8 → \d/);
  }, 180_000);

  it('catches a restart that does not reset (a world saved mid-game)', async () => {
    const r = await reviewGame(savedMidGame(), { balance: false, budgetMs: 60_000 });
    const f = r.findings.find((x) => x.code === 'game_restart_state');
    expect(f).toBeDefined();
    expect(f?.severity).toBe('error');
    for (const k of ['health 40', 'wave 3', 'kills 12']) expect(f?.message).toContain(k);
    // The saved score, plus whatever the mid-game state sets off at once (a "wave cleared" bonus).
    expect(f?.message).toMatch(/score (1200|1700)/);
    expect(f?.fix).toContain('health 100');
    expect(f?.fix).toContain('wave 0');
    expect(f?.fix).toContain('score 0');
  }, 180_000);

  it('catches a wave whose enemy counter is out of step with what it spawns', async () => {
    const w = kestrel();
    for (const r of w.rules) {
      if (r.id !== 'wave-1') continue;
      for (const a of r.then) {
        if (a.do === 'spawn') a.count = 8;
        if (a.do === 'add' && a.key === 'alive') a.amount = 3;
      }
    }
    const r = await reviewGame(w, { balance: false, budgetMs: 30_000, maxSeconds: 30 });
    const f = r.findings.find((x) => x.code === 'game_counter_mismatch');
    expect(f?.message).toContain('rule wave-1 spawns 8 raider-n but adds 3 to "alive"');
    expect(f?.fix).toContain('add alive 3 → 8');
  }, 120_000);

    it('catches a game that cannot be won and one whose lose screen never comes', async () => {
    const w = kestrel();
    w.rules = w.rules.filter((r) => !r.then.some((a) => a.do === 'win' || a.do === 'lose'));
    for (const e of Object.values(w.entities)) if (e.npc?.attack) e.npc.attack = { ...e.npc.attack, damage: 0 };
    w.intro = undefined;
    const r = await reviewGame(w, { balance: false, budgetMs: 60_000, maxSeconds: 60 });
    const codes = r.findings.map((f) => f.code);
    expect(codes).toContain('game_win_unreached');
    expect(codes).toContain('game_lose_unreached');
  }, 180_000);
});
