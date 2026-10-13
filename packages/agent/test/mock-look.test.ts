/**
 * Art direction of the offline planner's worlds: the right setting for the
 * words, the camera on the mechanic, a clear view, clouds out of the way,
 * mountains rising out of the ground.
 */
import { describe, expect, it } from 'vitest';
import type { Entity, WorldDoc } from '@aether/core';
import { parseIntent } from '../src/providers/mock/intent';
import { CLOUD_ALTITUDE, CLOUD_RING, inViewCorridor, VIEW_BEARING, VIEW_CORRIDOR_START } from '../src/providers/mock/decor';
import { CHASE_POCKET_OFFSET, CHASE_POCKET_RADIUS } from '../src/providers/mock/planner';
import { mockApply } from './helpers';

async function build(prompt: string): Promise<WorldDoc> {
  const { result } = await mockApply(prompt);
  expect(result.errors).toEqual([]);
  return result.world;
}

const all = (w: WorldDoc): Entity[] => Object.values(w.entities);
const settingIds = (prompt: string): string[] => parseIntent(prompt).settings.map((t) => t.id);

describe('keyword matching', () => {
  it('an asteroid field is space, not farmland', () => {
    expect(settingIds('an asteroid field in space')).toEqual(['space']);
    expect(settingIds('Low-gravity asteroid field with glowing crystals')).toEqual(['space']);
    expect(settingIds('a force field around a debris field')).toEqual([]);
    expect(settingIds('a farm with wheat fields')).toContain('farm');
  });

  it('a bell tower or a tower of blocks is not a castle', () => {
    expect(settingIds('Build a domino run that knocks over a bell tower')).toEqual([]);
    expect(settingIds('knock down a tower of blocks')).toEqual([]);
    expect(settingIds('a castle with tall towers')).toEqual(['castle']);
    expect(settingIds('a wizard tower on a hill')).toContain('castle');
  });
});

describe('space worlds', () => {
  it('contain no farm or forest props', async () => {
    const w = await build('an asteroid field in space');
    for (const e of all(w)) {
      expect(e.id).not.toMatch(/^(windmill|tree|sheep|hay|tractor|barn)/);
    }
    expect(w.environment.sky).toBe('space');
  });
});

describe('activities own the camera', () => {
  it('a domino run focuses its first and last domino and the bell; the setting around it has no focus', async () => {
    const w = await build('a domino run that knocks over a bell');
    const focus = all(w).filter((e) => e.tags.includes('focus'));
    expect(focus.some((e) => e.tags.includes('bell'))).toBe(true);
    expect(focus.filter((e) => e.tags.includes('domino'))).toHaveLength(2);
    expect(focus.every((e) => e.tags.includes('domino') || e.tags.includes('bell'))).toBe(true);
    // Dressed as a set-piece in a meadow, on a deck.
    expect(w.entities['domino-deck-1']).toBeDefined();
    expect(all(w).some((e) => e.id.startsWith('mountain'))).toBe(true);
  });

  it('"…a bell tower" puts a belfry behind the bell instead of a castle', async () => {
    const w = await build('Build a domino run that knocks over a bell tower');
    expect(w.entities['bell-tower-1']).toBeDefined();
    expect(all(w).some((e) => e.id.startsWith('keep') || e.id.startsWith('castle-wall'))).toBe(false);
  });

  it('without an activity the setting keeps its focus', async () => {
    const w = await build('a medieval castle');
    expect(all(w).some((e) => e.tags.includes('focus'))).toBe(true);
  });
});

describe('neon bowling night', () => {
  it('is a night scene with lit lamps, neon lanes and a focused lane', async () => {
    const w = await build('a bowling alley with ten pins');
    expect(w.environment.sky).toBe('night');
    const lamps = all(w).filter((e) => e.tags.includes('lamp'));
    expect(lamps.length).toBeGreaterThan(0);
    for (const l of lamps) expect(all(w).some((e) => e.parent === l.id && e.light)).toBe(true);
    expect(w.entities['lane-1']?.tags).toContain('focus');
    expect(all(w).filter((e) => e.id.startsWith('pin-'))).toHaveLength(10);
    expect(all(w).filter((e) => e.id.startsWith('deco-pin')).every((e) => !e.physics)).toBe(true);
  });
});

describe('composition helpers', () => {
  it('the view corridor opens toward the default camera only', () => {
    const rad = (VIEW_BEARING * Math.PI) / 180;
    expect(inViewCorridor(Math.sin(rad) * 40, Math.cos(rad) * 40)).toBe(true);
    expect(inViewCorridor(Math.sin(rad) * (VIEW_CORRIDOR_START - 1), Math.cos(rad) * (VIEW_CORRIDOR_START - 1))).toBe(false);
    expect(inViewCorridor(-Math.sin(rad) * 40, -Math.cos(rad) * 40)).toBe(false);
    expect(inViewCorridor(40, -10)).toBe(false);
  });

  it('forests leave the corridor free of trees and lay a trail through it', async () => {
    const w = await build('a cozy forest camp with a campfire and tents');
    for (const e of all(w)) {
      const [x, , z] = e.transform.position;
      const isTree = e.tags.includes('tree') || (e.shape.kind === 'scatter' && e.shape.of.kind === 'procedural' && e.shape.of.generator.startsWith('tree'));
      if (isTree) expect(inViewCorridor(x, z), e.id).toBe(false);
    }
    expect(all(w).some((e) => e.id.startsWith('path') && inViewCorridor(e.transform.position[0], e.transform.position[2]))).toBe(true);
  });

  it('clouds float on a distant high ring, never where the camera flies', async () => {
    const w = await build('a sunny mountain meadow');
    const clouds = all(w).filter((e) => e.id.startsWith('cloud'));
    expect(clouds.length).toBeGreaterThan(0);
    for (const c of clouds) {
      const [x, y, z] = c.transform.position;
      expect(y).toBeGreaterThanOrEqual(CLOUD_ALTITUDE[0]);
      expect(Math.hypot(x, z)).toBeGreaterThanOrEqual(CLOUD_RING[0] - 1);
      // Self-lit by day.
      expect(c.material?.emissiveIntensity ?? 0).toBeGreaterThan(0);
    }
  });

  it('backdrop mountains rise out of the world ground color', async () => {
    const w = await build('a sunny mountain meadow');
    const ground = w.environment.ground?.material.color;
    const mountains = all(w).filter((e) => e.id.startsWith('mountain'));
    expect(mountains.length).toBeGreaterThan(0);
    for (const m of mountains) expect(m.shape.kind === 'procedural' && m.shape.params['groundColor']).toBe(ground);
  });
});

describe('chase camera pocket', () => {
  it('keeps trees, palms and rocks out of the spot behind the player spawn', async () => {
    for (const prompt of ['A coin collecting game on a tropical island — collect 10 coins in 60 seconds', 'a cozy forest camp with a campfire and tents', 'a snowy winter village']) {
      const w = await build(prompt);
      if (w.player.mode === 'orbit') continue;
      const [sx, , sz] = w.player.spawn;
      for (const e of all(w)) {
        if (!e.tags.some((t) => t === 'tree' || t === 'rock') || e.parent) continue;
        const [x, , z] = e.transform.position;
        expect(Math.hypot(x - sx, z - (sz + CHASE_POCKET_OFFSET)), `${prompt}: ${e.id}`).toBeGreaterThan(CHASE_POCKET_RADIUS);
      }
    }
  });
});
