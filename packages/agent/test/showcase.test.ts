/**
 * Flagship showcase plans of the offline planner: each one is found by its
 * name, builds a valid world with no rejected patch, compiles its building
 * (architecture flagships) without refused ops, and ships a title card,
 * verification tests and — for games — an objective the player can reach.
 */
import { applyArchOps } from '@aether/arch';
import { applyPatches, createWorld, summarizeWorld, validateWorld, type WorldDoc } from '@aether/core';
import { describe, expect, it } from 'vitest';
import { planMock } from '../src/providers/mock/planner';
import { FLAGSHIPS, findFlagship, planShowcase } from '../src/providers/mock/showcase/index';

/** Apply a flagship plan (patches, then architecture ops) to a world. */
function build(id: string, start: WorldDoc = createWorld()): { world: WorldDoc; patchErrors: string[]; archErrors: string[] } {
  const f = FLAGSHIPS.find((x) => x.id === id);
  if (!f) throw new Error(`no flagship ${id}`);
  const plan = f.plan();
  const r = applyPatches(start, plan.patches);
  let world = r.world;
  const archErrors: string[] = [];
  if (plan.arch) {
    const a = applyArchOps(world, plan.arch.ops);
    archErrors.push(...a.errors.map((e) => `${e.code}: ${e.message}`));
    const r2 = applyPatches(world, a.patches);
    archErrors.push(...r2.errors.map((e) => e.message));
    world = r2.world;
  }
  return { world, patchErrors: r.errors.map((e) => e.message), archErrors };
}

describe('flagship showcase plans', () => {
  it('have unique ids and titles', () => {
    expect(new Set(FLAGSHIPS.map((f) => f.id)).size).toBe(FLAGSHIPS.length);
    expect(new Set(FLAGSHIPS.map((f) => f.title)).size).toBe(FLAGSHIPS.length);
  });

  it.each(FLAGSHIPS.map((f) => [f.id] as const))('%s builds a valid, complete world', (id) => {
    const { world, patchErrors, archErrors } = build(id);
    expect(patchErrors).toEqual([]);
    expect(archErrors).toEqual([]);
    expect(validateWorld(world).ok).toBe(true);
    // Rich content: many entities, or a block world with many builds.
    expect(Object.keys(world.entities).length + (world.voxel?.edits.length ?? 0)).toBeGreaterThan(20);
    expect(world.intro?.title).toBe(FLAGSHIPS.find((f) => f.id === id)?.title);
    expect(world.intro?.controls.length).toBeGreaterThan(0);
    expect(world.description.length).toBeGreaterThan(10);
  });

  it.each(FLAGSHIPS.map((f) => [f.id] as const))('%s is deterministic', (id) => {
    const f = FLAGSHIPS.find((x) => x.id === id);
    expect(JSON.stringify(f?.plan())).toBe(JSON.stringify(f?.plan()));
  });

  it('answers to its name and its manifest prompt, and replaces a world only when asked to build', () => {
    expect(findFlagship('Sakura River Journey: a canoe ride')?.id).toBe('sakura-river');
    expect(findFlagship('build the skyline penthouse')?.id).toBe('skyline-penthouse');
    expect(findFlagship('a river with a canoe')).toBeNull();
    const world = build('sakura-river').world;
    const summary = summarizeWorld(world);
    // An edit that mentions the name is not a rebuild…
    expect(planShowcase('the sakura river journey looks nice', summary)).toBeNull();
    // …but an explicit request is.
    expect(planShowcase('open the sakura river journey again', summary)).not.toBeNull();
    // planMock routes flagship names before every other planner.
    const plan = planMock('Skyline Penthouse', '');
    expect(plan.arch?.message).toBe('Skyline Penthouse');
  });

  it('starts from a clear, so a flagship replaces whatever was there', () => {
    const before = applyPatches(createWorld(), [{ op: 'add', entity: { id: 'old-thing' } }, { op: 'setMeta', intro: { title: 'Old' } }]).world;
    const { world } = build('sakura-river', before);
    expect(world.entities['old-thing']).toBeUndefined();
    expect(world.intro?.title).toBe('Sakura River Journey');
  });
});

describe('architecture flagships start the walkthrough inside, facing the house', () => {
  it.each(['casa-patio', 'skyline-penthouse', 'dusk-lake-house'])('%s', (id) => {
    const { world } = build(id);
    const building = Object.values(world.entities).find((e) => e.arch?.role === 'building');
    expect(building).toBeDefined();
    const walls = Object.values(world.entities).filter((e) => e.arch?.role === 'wall' && e.arch.kind !== undefined);
    expect(walls.length).toBeGreaterThan(0);
    const yaw = world.player.yaw;
    expect(yaw).toBeDefined();
    // The spawn is inside the footprint of the exterior walls (their bounding box), not on the doorstep outside.
    const xs: number[] = [];
    const zs: number[] = [];
    for (const e of Object.values(world.entities)) {
      if (e.arch?.role !== 'wall' || !e.tags.includes('exterior')) continue;
      xs.push(e.transform.position[0] + (building?.transform.position[0] ?? 0));
      zs.push(e.transform.position[2] + (building?.transform.position[2] ?? 0));
    }
    expect(world.player.spawn[0]).toBeGreaterThan(Math.min(...xs) - 0.5);
    expect(world.player.spawn[0]).toBeLessThan(Math.max(...xs) + 0.5);
    expect(world.player.spawn[2]).toBeGreaterThan(Math.min(...zs) - 0.5);
    expect(world.player.spawn[2]).toBeLessThan(Math.max(...zs) + 0.5);
  });

  it('the Skyline Penthouse has a skyline: towers that rise above the roof deck', () => {
    const { world } = build('skyline-penthouse');
    const towers = Object.values(world.entities).filter((e) => e.tags.includes('city'));
    expect(towers.length).toBeGreaterThanOrEqual(40);
    // fitSize is the tower height; they stand on streets 40 m below the deck.
    const tall = towers.filter((t) => {
      const s = t.shape;
      return s.kind === 'asset' && (s.fitSize ?? 0) > 60;
    });
    expect(tall.length).toBeGreaterThanOrEqual(30);
  });

  it('the Dusk House has its lake and mountains', () => {
    const { world } = build('dusk-lake-house');
    expect(world.entities['lake-1']).toBeDefined();
    expect(Object.values(world.entities).filter((e) => e.tags.includes('backdrop')).length).toBeGreaterThanOrEqual(3);
  });
});
