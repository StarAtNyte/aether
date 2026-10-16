/**
 * The bundled outdoor worlds are alive: measured groups of animals (deer, birds, fish, butterflies...), wind that moves
 * grass and water, rivers that flow. Counts are floors: the placement refuses what does not fit, so a world that loses
 * its animals to a terrain change fails here instead of going quiet.
 */
import { applyPatches, createWorld, findStandIns, type WorldDoc } from '@aether/core';
import { describe, expect, it } from 'vitest';
import { FLAGSHIPS } from '../src/providers/mock/showcase/index';

function build(id: string): WorldDoc {
  const f = FLAGSHIPS.find((x) => x.id === id);
  if (!f) throw new Error(`no flagship ${id}`);
  const r = applyPatches(createWorld(), f.plan().patches);
  expect(r.errors.map((e) => e.message)).toEqual([]);
  return r.world;
}

function census(world: WorldDoc): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of Object.values(world.entities)) {
    if (!e.tags.includes('life')) continue;
    const species = e.tags[2] ?? '?';
    out[species] = (out[species] ?? 0) + 1;
  }
  return out;
}

/** Minimum animals per species for each outdoor flagship. */
const EXPECTED: Record<string, Record<string, number>> = {
  'highland-trail': { deer: 2, doe: 2, bird: 4, crow: 2, hawk: 1, butterfly: 4, fish: 3 },
  'lantern-isles': { butterfly: 6, bird: 7, parrot: 2, hawk: 1 },
  'sakura-river': { duck: 3, fish: 6, bird: 8, crow: 2, hawk: 1, butterfly: 4, deer: 1 },
};

describe('flagship life', () => {
  it.each(Object.entries(EXPECTED))('%s has its measured animals', (id, min) => {
    const world = build(id);
    const got = census(world);
    for (const [species, n] of Object.entries(min)) expect(got[species] ?? 0, `${id}: ${species} in ${JSON.stringify(got)}`).toBeGreaterThanOrEqual(n);
    // Every animal is a modelled library creature (never a primitive), and the stand-in lint stays quiet.
    for (const e of Object.values(world.entities)) if (e.tags.includes('life')) expect(e.shape.kind).toBe('asset');
    expect(findStandIns(world)).toEqual([]);
  });

  it('highland trail sets its wind and a flowing river', () => {
    const world = build('highland-trail');
    expect(world.environment.wind?.speed).toBeGreaterThan(0);
    const river = Object.values(world.entities).find((e) => e.name === 'River');
    expect(river?.material?.waterKind).toBe('river');
    expect(river?.material?.waterFlow).toBeTruthy();
  });

  it('keeps fish under water in the river bed and flyers above the ground', () => {
    const world = build('highland-trail');
    for (const e of Object.values(world.entities)) {
      if (!e.tags.includes('life')) continue;
      const y = e.transform.position[1];
      if (e.tags.includes('fish')) expect(y).toBeLessThan(0.38);
      if (e.tags.includes('hawk')) expect(y).toBeGreaterThan(20);
    }
  });
});
