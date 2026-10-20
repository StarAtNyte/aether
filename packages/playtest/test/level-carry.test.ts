/** place_level_items moving an object carries what belongs to it (its light, goal zone and plinth). */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyPatches, type EntityInput } from '@aether/core';
import { initPhysics } from '@aether/physics';
import { runLevelTool } from '../src';
import { coin, gameWorld, winAt } from './helpers';

beforeAll(async () => {
  await initPhysics();
});

const HILL: EntityInput = { id: 'hill', name: 'Hill', shape: { kind: 'primitive', primitive: 'cylinder', size: [12, 6, 12] }, transform: { position: [0, 3, -40] }, physics: { body: 'static' } };

function forest(): ReturnType<typeof gameWorld> {
  return gameWorld(
    [
      HILL,
      coin('c1', [3, 1, 0]),
      { id: 'gate', name: 'Shrine', shape: { kind: 'primitive', primitive: 'box', size: [4, 4, 0.6] }, transform: { position: [0, 2.3, -10] }, physics: { body: 'static' } },
      { id: 'goal-plinth', name: 'Shrine platform', shape: { kind: 'primitive', primitive: 'cylinder', size: [6, 0.3, 6] }, transform: { position: [0, 0.15, -10] }, physics: { body: 'static' } },
      { id: 'goal-zone', name: 'Shrine goal', visible: false, shape: { kind: 'primitive', primitive: 'box', size: [3, 3, 3] }, transform: { position: [0, 1.8, -10] }, physics: { body: 'static', sensor: true }, behaviors: [{ type: 'goal', params: { text: 'win' } }] },
      { id: 'gate-light', shape: { kind: 'none' }, transform: { position: [0, 5, -9] }, light: { type: 'point', color: '#ffd27a', intensity: 2, range: 10 } },
    ],
    { rules: [winAt(1)], state: { score: 0 } },
  );
}

describe('place_level_items carries dependents', () => {
  it('moving the shrine onto the hill brings its plinth, goal zone and light, its plinth on the summit', async () => {
    const w = forest();
    const r = await runLevelTool(w, 'place_level_items', { items: [{ id: 'gate', x: 0, z: -40 }] });
    expect(r.ok, r.text).toBe(true);
    expect(r.text).toMatch(/Moved with their owner: .*goal-zone \(belongs to gate\)/);
    const after = applyPatches(w, r.patches).world;
    const plinth = after.entities['goal-plinth']?.transform.position ?? [0, 0, 0];
    const gate = after.entities['gate']?.transform.position ?? [0, 0, 0];
    expect(gate[2]).toBe(-40);
    expect(plinth[2]).toBe(-40);
    expect(after.entities['goal-zone']?.transform.position[2]).toBe(-40);
    expect(after.entities['gate-light']?.transform.position[2]).toBe(-39);
    // The group's bottom (the plinth) sits on the summit at y = 6, and the offsets inside the group are kept.
    expect(plinth[1] - 0.15).toBeCloseTo(6, 1);
    expect(gate[1] - plinth[1]).toBeCloseTo(2.15, 2);
    expect(Object.keys(after.entities).length).toBe(Object.keys(w.entities).length);
  });

  it('does not drag a dependent the call places itself', async () => {
    const w = forest();
    const r = await runLevelTool(w, 'place_level_items', { items: [{ id: 'gate', x: 0, z: -40 }, { id: 'goal-zone', role: 'goal', x: 5, z: 5, reach: false }] });
    const after = applyPatches(w, r.patches).world;
    expect(after.entities['goal-zone']?.transform.position[0]).toBe(5);
  });
});
