import { describe, expect, it } from 'vitest';
import { createWorld } from '@aether/core';
import { briefChecklistText, briefSystem, richnessSnapshot, type Brief } from '../src/brief';

const BRIEF: Brief = {
  elaboration: 'elaborate',
  elaboration_reason: 'a general prompt',
  kind: 'harbour',
  summary: 'A working harbour.',
  scale: '80 x 60 m',
  zones: [{ name: 'Quay', purpose: 'berths', size: '80 x 12 m' }],
  elements: [{ name: 'Quay bollard', count: 8, size: '0.4 m', note: 'one per 10 m of quay edge', find: ['bollard'], how: 'along' }],
  materials: ['stone'],
  lighting: 'golden dusk',
  richness: { kinds: 20, pieces: 200, basis: '80 m quay at 10 m per bollard' },
} as unknown as Brief;

describe('outdoor worlds in the brief', () => {
  it('asks for the defining elements, edges and counts from the area', () => {
    const t = briefSystem();
    expect(t).toContain('DEFINING ELEMENTS');
    expect(t).toContain('bollard per 8 to 12 m of quay edge');
    expect(t).toContain('not a carpet');
  });
  it('builds edges in one call each and keeps draw calls down', () => {
    const t = briefChecklistText(BRIEF);
    expect(t).toContain('OUTDOOR worlds');
    expect(t).toContain('under 400');
  });
  it('looks at a large open world from spots well inside its edge, not at the rim', () => {
    const w = createWorld({ name: 'quay' });
    for (const [x, z] of [[0, 0], [80, 0], [0, 60], [80, 60], [40, 30]] as const) {
      (w.entities as Record<string, unknown>)[`e${x}_${z}`] = { id: `e${x}_${z}`, name: 'p', parent: null, tags: [], transform: { position: [x, 0, z], rotation: [0, 0, 0], scale: [1, 1, 1] } };
    }
    const snap = richnessSnapshot(w, { maxViews: 4, withViews: true });
    const near = snap.views.find((v) => v.name === 'eye-near');
    expect(near).toBeDefined();
    expect(near!.pose.position[2]).toBeGreaterThan(5);
  });
});
