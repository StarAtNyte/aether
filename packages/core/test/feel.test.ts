/**
 * Game feel in the World IR: schema (backward compatible), patches (setMeta.feel, entity vfx, effect actions), undo,
 * diff, summary and the preset resolution.
 */
import { describe, expect, it } from 'vitest';
import {
  Action,
  applyPatches,
  createWorld,
  describeFeel,
  diffWorlds,
  FEEL_EVENTS,
  FeelEvent,
  FeelSpec,
  invertPatches,
  patchesBetween,
  resolveFeelCue,
  summarizeWorld,
  validateWorld,
  type WorldDoc,
} from '../src';

describe('feel schema', () => {
  it('is optional: worlds without it validate and stay without it', () => {
    const w = createWorld({ name: 'plain' });
    expect(w.feel).toBeUndefined();
    const v = validateWorld(JSON.parse(JSON.stringify(w)));
    expect(v.ok).toBe(true);
    if (v.ok) expect('feel' in v.world).toBe(false);
  });

  it('parses tiers, per-event cues and rejects out-of-range values', () => {
    const f = FeelSpec.parse({ preset: 'punchy', events: { hit: { shake: 0.8, hitStop: 0.1, vfx: 'sparks', vfxColor: '#ff0000' } } });
    expect(f.events.hit?.vfx).toBe('sparks');
    expect(FeelSpec.parse({}).preset).toBe('normal');
    expect(FeelSpec.safeParse({ preset: 'extreme' }).success).toBe(false);
    expect(FeelSpec.safeParse({ events: { hit: { shake: 3 } } }).success).toBe(false);
    expect(FeelSpec.safeParse({ events: { hit: { hitStop: 1 } } }).success).toBe(false);
    expect(FeelSpec.safeParse({ events: { hit: { vfx: 'lasers' } } }).success).toBe(false);
    expect(FeelSpec.safeParse({ events: { hit: { flashColor: 'red' } } }).success).toBe(false);
  });

  it('entity vfx and the effect action are validated', () => {
    const w = createWorld({ entities: { torch: { id: 'torch', vfx: { preset: 'fire', rate: 30, color: '#ffaa00', offset: [0, 0.4, 0] } } } });
    expect(w.entities['torch']?.vfx?.enabled).toBe(true);
    expect(validateWorld({ ...w, entities: { torch: { ...w.entities['torch'], vfx: { preset: 'fire', rate: 1e6 } } } }).ok).toBe(false);
    const a = Action.parse({ do: 'effect', at: 'anvil', feel: 'hit' });
    expect(a).toMatchObject({ do: 'effect', vfx: 'sparks', at: 'anvil', feel: 'hit' });
    expect(Action.safeParse({ do: 'effect', vfx: 'sparks', scale: 99 }).success).toBe(false);
  });
});

describe('feel patches', () => {
  it('setMeta sets, replaces and removes the feel; undo restores the previous one', () => {
    const w0 = createWorld({});
    const r1 = applyPatches(w0, [{ op: 'setMeta', feel: { preset: 'punchy', events: { hit: { shake: 0.9 } } } }]);
    expect(r1.errors).toEqual([]);
    expect(r1.world.feel?.preset).toBe('punchy');
    expect(diffWorlds(w0, r1.world).feelChanged).toBe(true);
    const inv = invertPatches(w0, r1.applied);
    const back = applyPatches(r1.world, inv);
    expect(back.world.feel).toBeUndefined();
    const r2 = applyPatches(r1.world, [{ op: 'setMeta', feel: null }]);
    expect(r2.world.feel).toBeUndefined();
    const bad = applyPatches(w0, [{ op: 'setMeta', feel: { preset: 'loud' } }]);
    expect(bad.errors.length).toBe(1);
  });

  it('patchesBetween carries feel and entity vfx changes; clear keeps the feel', () => {
    const a: WorldDoc = createWorld({ entities: { t: { id: 't' } } });
    const b: WorldDoc = createWorld({ feel: { preset: 'subtle' }, entities: { t: { id: 't', vfx: { preset: 'smoke' } } } });
    const ps = patchesBetween(a, b);
    const r = applyPatches(a, ps);
    expect(r.errors).toEqual([]);
    expect(r.world.feel).toEqual(b.feel);
    expect(r.world.entities['t']?.vfx).toEqual(b.entities['t']?.vfx);
    const cleared = applyPatches(r.world, [{ op: 'clear' }]);
    expect(cleared.world.feel?.preset).toBe('subtle');
  });

  it('rules can carry effect actions', () => {
    const w = applyPatches(createWorld({}), [{ op: 'addRule', rule: { id: 'boom', when: { on: 'key', key: 'f' }, then: [{ do: 'effect', vfx: 'explosion', at: [0, 1, 0], feel: 'explosion' }] } }]);
    expect(w.errors).toEqual([]);
    expect(w.world.rules[0]?.then[0]).toMatchObject({ do: 'effect', vfx: 'explosion' });
  });
});

describe('feel presets', () => {
  it('every event resolves at every tier; tiers order their strength', () => {
    for (const ev of FeelEvent.options) {
      const off = resolveFeelCue({ preset: 'off', events: {} }, ev);
      const subtle = resolveFeelCue({ preset: 'subtle', events: {} }, ev);
      const normal = resolveFeelCue(undefined, ev);
      const punchy = resolveFeelCue({ preset: 'punchy', events: {} }, ev);
      expect(off.shake + off.flash + off.hitStop + off.rumble).toBe(0);
      expect(off.vfx).toBe('none');
      expect(subtle.shake).toBeLessThanOrEqual(normal.shake);
      expect(normal.shake).toBeLessThanOrEqual(punchy.shake);
      expect(subtle.hitStop).toBeLessThanOrEqual(punchy.hitStop);
      expect(punchy.shake).toBeLessThanOrEqual(1);
      expect(punchy.hitStop).toBeLessThanOrEqual(0.25);
    }
    expect(FEEL_EVENTS).toEqual(FeelEvent.options);
  });

  it('written cue fields win over the tier; intensity scales the tier values only', () => {
    const feel = FeelSpec.parse({ preset: 'subtle', events: { land: { shake: 0.9, vfx: 'shockwave' }, hit: { tier: 'punchy' } } });
    const land = resolveFeelCue(feel, 'land', 2);
    expect(land.shake).toBe(0.9);
    expect(land.vfx).toBe('shockwave');
    expect(resolveFeelCue(feel, 'hit').tier).toBe('punchy');
    const soft = resolveFeelCue(undefined, 'land', 0.5);
    const hard = resolveFeelCue(undefined, 'land', 2);
    expect(hard.shake).toBeGreaterThan(soft.shake);
    expect(hard.squash).toBeGreaterThan(soft.squash);
  });

  it('describes a feel for the planner and the world summary', () => {
    const feel = FeelSpec.parse({ preset: 'punchy', events: { pickup: { vfx: 'sparks' } } });
    expect(describeFeel(feel)).toBe('feel punchy; pickup: sparks');
    expect(describeFeel(undefined)).toBe('');
    const w = createWorld({ feel, entities: { torch: { id: 'torch', vfx: { preset: 'fire' } } } });
    const s = summarizeWorld(w);
    expect(s).toContain('feel punchy; pickup: sparks');
    expect(s).toContain('vfx fire');
  });
});
