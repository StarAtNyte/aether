import { describe, expect, it } from 'vitest';
import { circleSegments, primitiveOutput } from '../src/output';

const tris = (size: [number, number, number], primitive: 'cylinder' | 'torus' | 'cone'): number =>
  primitiveOutput({ kind: 'primitive', primitive, size }).parts.reduce((n, p) => n + p.indices.length / 3, 0);

describe('round primitives scale their facets with their width', () => {
  it('keeps hand-sized discs at 24 sides and gives wide discs more, up to a cap', () => {
    expect(circleSegments(1)).toBe(24);
    expect(circleSegments(8)).toBe(24);
    expect(circleSegments(44)).toBeGreaterThan(48);
    expect(circleSegments(500)).toBe(96);
    expect(circleSegments(Number.NaN)).toBe(24);
    expect(circleSegments(Number.POSITIVE_INFINITY)).toBe(96);
  });

  it('a station-sized cylinder, cone and torus carry visibly more triangles than a prop-sized one', () => {
    for (const p of ['cylinder', 'cone'] as const) expect(tris([44, 1.2, 44], p)).toBeGreaterThan(tris([1, 1.2, 1], p) * 2);
    expect(tris([45, 0.5, 45], 'torus')).toBeGreaterThan(tris([1, 0.2, 1], 'torus'));
  });

  it('is deterministic for the same size', () => {
    expect(tris([30, 2, 30], 'cylinder')).toBe(tris([30, 2, 30], 'cylinder'));
  });
});
