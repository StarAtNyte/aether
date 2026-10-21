/**
 * Game feel by prompt and by tool: the local edit engine's feel commands, the tune_feel tool (validation, merge,
 * emitters, one undo step), and the defaults generated games get.
 */
import { describe, expect, it } from 'vitest';
import { applyPatches, createWorld, resolveFeelCue, type WorldDoc } from '@aether/core';
import { catalog } from '@aether/procgen';
import { defaultEmitterPatches, feelPatches, feelTierFor, isGameWorld, mergeFeel, TuneFeelInput } from '../src/feel-edit';
import { planFineEdit, type FineEditResult } from '../src/refine/plan';
import { parseEdit } from '../src/refine/parse';
import { parseFeel } from '../src/refine/ops-feel';
import { AGENT_TOOLS } from '../src/tools';
import { buildSystemPrompt } from '../src/prompt';
import { WorldAgent } from '../src/agent';
import { createMockProvider } from '../src/providers/mock';
import { collect, MemoryHost, TEST_CATALOGS } from './helpers';

const generators = catalog();

function game(): WorldDoc {
  return createWorld({
    name: 'Coin run',
    entities: {
      ground: { id: 'ground', shape: { kind: 'primitive', primitive: 'box', size: [40, 1, 40] }, physics: { body: 'static' } },
      'coin-1': { id: 'coin-1', name: 'Coin', tags: ['coin'], transform: { position: [2, 1, 0] }, behaviors: [{ type: 'collectible' }] },
      'coin-2': { id: 'coin-2', name: 'Coin', tags: ['coin'], transform: { position: [4, 1, 0] }, behaviors: [{ type: 'collectible' }] },
      'torch-1': { id: 'torch-1', name: 'Torch', tags: ['torch'], transform: { position: [0, 0.9, 4] }, shape: { kind: 'primitive', primitive: 'cylinder', size: [0.1, 1.8, 0.1] } },
      'torch-2': { id: 'torch-2', name: 'Torch', tags: ['torch'], transform: { position: [3, 0.9, 4] }, shape: { kind: 'primitive', primitive: 'cylinder', size: [0.1, 1.8, 0.1] } },
      chimney: { id: 'chimney', name: 'Chimney', transform: { position: [8, 3, 0] }, shape: { kind: 'primitive', primitive: 'box', size: [0.6, 2, 0.6] } },
      flag: { id: 'flag', name: 'Goal flag', transform: { position: [10, 1, 0] }, behaviors: [{ type: 'goal' }] },
    },
  });
}

function edit(world: WorldDoc, text: string): FineEditResult {
  return planFineEdit({ world, text, catalogs: { generators } });
}

function apply(world: WorldDoc, r: FineEditResult): WorldDoc {
  expect(r.kind, `${r.reason ?? ''} ${r.detail ?? ''}`).toBe('edit');
  const res = applyPatches(world, r.patches);
  expect(res.errors).toEqual([]);
  return res.world;
}

describe('feel by prompt (local edit engine)', () => {
  it('"make hits feel punchy" sets the hit and damage tiers, nothing else', () => {
    const w = game();
    const r = edit(w, 'make hits feel punchy');
    const after = apply(w, r);
    expect(after.feel?.events.hit?.tier).toBe('punchy');
    expect(after.feel?.events.damage?.tier).toBe('punchy');
    expect(after.feel?.events.pickup).toBeUndefined();
    expect(r.cosmetic).toBe(true);
    expect(r.patches).toEqual([{ op: 'setMeta', feel: after.feel }]);
    expect(r.summary.toLowerCase()).toContain('punchy');
    expect(resolveFeelCue(after.feel, 'hit').shake).toBeGreaterThan(resolveFeelCue(undefined, 'hit').shake);
  });

  it('"add sparks when coins are collected" and "dust when landing" set the event bursts', () => {
    const w = game();
    const a = apply(w, edit(w, 'add sparks when coins are collected'));
    expect(a.feel?.events.pickup?.vfx).toBe('sparks');
    const b = apply(a, edit(a, 'dust when landing'));
    expect(b.feel?.events.land?.vfx).toBe('dust');
    expect(b.feel?.events.pickup?.vfx).toBe('sparks');
    // Dust without an event or a target is not a feel edit (the weather and add parsers keep it).
    expect(parseFeel('add dust')).toBeNull();
    expect(parseEdit('make it dusty').commands[0]?.op).not.toBe('feel');
  });

  it('knobs: less shake halves it everywhere, no flashes turns them off, the game can be made subtle or punchy', () => {
    const w = game();
    const less = apply(w, edit(w, 'less screen shake'));
    expect(less.feel?.events.hit?.shake).toBeCloseTo(resolveFeelCue(undefined, 'hit').shake * 0.5, 3);
    expect(less.feel?.events.explosion?.shake).toBeCloseTo(resolveFeelCue(undefined, 'explosion').shake * 0.5, 3);
    const noFlash = apply(less, edit(less, 'no screen flashes'));
    expect(resolveFeelCue(noFlash.feel, 'damage').flash).toBe(0);
    expect(resolveFeelCue(noFlash.feel, 'win').flash).toBe(0);
    const punchy = apply(w, edit(w, 'make the game feel juicier'));
    expect(punchy.feel?.preset).toBe('punchy');
    const off = apply(w, edit(w, 'turn off the effects'));
    expect(off.feel?.preset).toBe('off');
    const quiet = apply(w, edit(w, 'no footstep dust'));
    expect(quiet.feel?.footsteps).toBe(false);
  });

  it('emitters on things: "add fire to the torches", "make the chimney smoke", "remove the fire from the torches"', () => {
    const w = game();
    const lit = apply(w, edit(w, 'add fire to the torches'));
    expect(lit.entities['torch-1']?.vfx).toMatchObject({ preset: 'fire', offset: [0, 0.9, 0] });
    expect(lit.entities['torch-2']?.vfx?.preset).toBe('fire');
    const smoky = apply(lit, edit(lit, 'make the chimney smoke'));
    expect(smoky.entities['chimney']?.vfx?.preset).toBe('smoke');
    const out = apply(smoky, edit(smoky, 'remove the fire from the torches'));
    expect(out.entities['torch-1']?.vfx).toBeUndefined();
    expect(out.entities['chimney']?.vfx?.preset).toBe('smoke');
  });

  it('leaves non-feel clauses to the other parsers', () => {
    expect(parseFeel('add a campfire')).toBeNull();
    expect(parseFeel('make the sofa red')).toBeNull();
    expect(parseFeel('make it night')).toBeNull();
    expect(parseEdit('make the fire red').commands[0]?.op).toBe('paint');
  });
});

describe('tune_feel tool', () => {
  it('is offered to the model with a schema and documented in the system prompt', () => {
    const tool = AGENT_TOOLS.find((t) => t.name === 'tune_feel');
    expect(tool).toBeDefined();
    expect(AGENT_TOOLS[AGENT_TOOLS.length - 1]?.name).toBe('finish');
    const prompt = buildSystemPrompt({ generators: [], behaviors: [], ruleDocs: '', generatorApiDts: '', generatorExamples: [], scriptApiDts: '' });
    expect(prompt).toContain('## Game feel and effects');
    expect(prompt).toContain('tune_feel');
  });

  it('merges cues, attaches emitters by tag, refuses unknown targets and validates input', () => {
    const w = game();
    const input = TuneFeelInput.parse({ preset: 'punchy', events: { pickup: { vfx: 'sparks', shake: 0.2 } }, emitters: [{ target: '#torch', vfx: 'fire', offset: [0, 0.9, 0] }, { target: 'ghost', vfx: 'smoke' }] });
    const r = feelPatches(w, input);
    expect(r.refused).toEqual(['ghost: matches nothing in the world']);
    const after = applyPatches(w, r.patches);
    expect(after.errors).toEqual([]);
    expect(after.world.feel).toMatchObject({ preset: 'punchy', events: { pickup: { vfx: 'sparks', shake: 0.2 } } });
    expect(after.world.entities['torch-2']?.vfx?.preset).toBe('fire');
    expect(r.summary).toContain('fire on torch-1, torch-2');
    // Changing one field keeps the others; null drops the event.
    const again = feelPatches(after.world, TuneFeelInput.parse({ events: { pickup: { shake: 0.5 } } }));
    const w2 = applyPatches(after.world, again.patches).world;
    expect(w2.feel?.events.pickup).toEqual({ vfx: 'sparks', shake: 0.5 });
    const drop = applyPatches(w2, feelPatches(w2, TuneFeelInput.parse({ events: { pickup: null } })).patches).world;
    expect(drop.feel?.events.pickup).toBeUndefined();
    // Nothing to do: no patches.
    expect(feelPatches(drop, TuneFeelInput.parse({ preset: 'punchy' })).patches).toEqual([]);
    expect(TuneFeelInput.safeParse({ events: { hit: { shake: 7 } } }).success).toBe(false);
    expect(TuneFeelInput.safeParse({ emitters: [{ target: '#torch', vfx: 'laser' }] }).success).toBe(false);
    expect(feelPatches(w, TuneFeelInput.parse({ emitters: [{ target: '*', vfx: 'fire' }] })).refused[0]).toContain('#tag');
    expect(mergeFeel(w2.feel, { reset: true })).toBeUndefined();
  });
});

describe('defaults for generated games', () => {
  it('the tier follows the genre', () => {
    expect(feelTierFor('a zombie arena shooter')).toBe('punchy');
    expect(feelTierFor('a kart race in a canyon')).toBe('punchy');
    expect(feelTierFor('a cozy garden walk')).toBe('subtle');
    expect(feelTierFor('collect the coins')).toBe('normal');
  });

  it('torches burn, chimneys smoke, and only games count as games', () => {
    const w = game();
    const ps = defaultEmitterPatches(w);
    const after = applyPatches(w, ps).world;
    expect(after.entities['torch-1']?.vfx?.preset).toBe('fire');
    expect(after.entities['chimney']?.vfx?.preset).toBe('smoke');
    expect(after.entities['coin-1']?.vfx).toBeUndefined();
    expect(defaultEmitterPatches(after)).toEqual([]);
    expect(isGameWorld(w)).toBe(true);
    expect(isGameWorld(createWorld({ entities: { a: { id: 'a' } } }))).toBe(false);
  });
});

describe('offline planner', () => {
  it('a new game gets a feel for its genre and fire on its campfires, as one more undo step', async () => {
    const host = new MemoryHost(createWorld());
    const agent = new WorldAgent({ provider: createMockProvider(), catalogs: TEST_CATALOGS });
    const events = await collect(agent.run('A coin collecting game on a tropical island — collect 10 coins in 60 seconds', host));
    const feelEdit = events.find((e) => e.type === 'patches' && e.message === 'Game feel');
    expect(feelEdit).toBeDefined();
    const w = host.getWorld();
    expect(w.feel?.preset).toBe('normal');
    const arena = new MemoryHost(createWorld());
    await collect(new WorldAgent({ provider: createMockProvider(), catalogs: TEST_CATALOGS }).run('obstacle course with moving platforms, lava and a goal flag, arcade action', arena));
    expect(arena.getWorld().feel?.preset).toBe('punchy');
  });

  it('a scene that is not a game gets no feel, but its campfire burns', async () => {
    const host = new MemoryHost(createWorld());
    await collect(new WorldAgent({ provider: createMockProvider(), catalogs: TEST_CATALOGS }).run('a cozy lakeside camp at sunset with a campfire and tents', host));
    const w = host.getWorld();
    expect(w.feel).toBeUndefined();
    const fires = Object.values(w.entities).filter((e) => e.vfx?.preset === 'fire');
    expect(fires.length).toBeGreaterThan(0);
    expect(fires.every((e) => /campfire/.test(`${e.id} ${e.name}`.toLowerCase()))).toBe(true);
  });
});
