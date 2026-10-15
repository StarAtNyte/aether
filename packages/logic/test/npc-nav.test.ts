import { describe, expect, it } from 'vitest';
import { NavGrid, NAV_MAX_PATH, buildNavFor, collectObstacles, type Obstacle } from '../src';
import { worldOf } from './helpers';

const wall = (cx: number, cz: number, hx: number, hz: number, top = 3, bottom = 0): Obstacle => ({ cx, cz, hx, hz, cos: 1, sin: 0, circle: false, bottom, top });

function grid(obstacles: Obstacle[], over: Partial<Parameters<typeof NavGrid.build>[1]> = {}): NavGrid {
  return NavGrid.build(obstacles, { minX: -20, minZ: -20, maxX: 20, maxZ: 20, refY: 0, radius: 0.4, height: 1.8, step: 0.55, ground: 0, groundHalf: 100, ...over });
}

describe('NavGrid', () => {
  it('finds a straight path across open ground and smooths it to few points', () => {
    const g = grid([]);
    const out = new Float32Array(NAV_MAX_PATH * 2);
    const n = g.findPath(-10, -10, 10, 8, out);
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(2);
    expect(out[(n - 1) * 2]).toBeCloseTo(10, 5);
    expect(out[(n - 1) * 2 + 1]).toBeCloseTo(8, 5);
  });

  it('routes around a wall and every segment stays clear', () => {
    const g = grid([wall(0, 0, 0.5, 8)]);
    const out = new Float32Array(NAV_MAX_PATH * 2);
    const n = g.findPath(-5, 0, 5, 0, out);
    expect(n).toBeGreaterThan(1);
    let px = -5;
    let pz = 0;
    let total = 0;
    for (let i = 0; i < n; i++) {
      const x = out[i * 2] as number;
      const z = out[i * 2 + 1] as number;
      expect(g.lineClear(px, pz, x, z)).toBe(true);
      total += Math.hypot(x - px, z - pz);
      px = x;
      pz = z;
    }
    expect(total).toBeGreaterThan(16); // had to walk past the wall's end at z = ±8
  });

  it('reports unreachable goals (enclosed room) with 0 points and bounded work', () => {
    const g = grid([wall(0, 3, 3, 0.4), wall(0, -3, 3, 0.4), wall(3, 0, 0.4, 3), wall(-3, 0, 0.4, 3)]);
    const out = new Float32Array(NAV_MAX_PATH * 2);
    expect(g.findPath(0, 0, 12, 12, out)).toBe(0);
    expect(g.lastExpansions).toBeLessThan(9000);
  });

  it('treats low steps as floor and tall solids as blocking', () => {
    const g = grid([wall(0, 0, 1, 1, 0.3), wall(5, 0, 1, 1, 1.2)]);
    expect(g.walkable(0, 0)).toBe(true);
    expect(g.floorAt(0, 0, -1)).toBeCloseTo(0.3, 5);
    expect(g.walkable(5, 0)).toBe(false);
  });

  it('inflates obstacles by the agent radius but not the sight mask', () => {
    const g = grid([wall(0, 0, 1, 1)]);
    expect(g.walkable(1.3, 0)).toBe(false); // within 0.4 of the wall
    expect(g.walkable(1.7, 0)).toBe(true);
    expect(g.lineOfSight(-5, 0, 5, 0)).toBe(false);
    expect(g.lineOfSight(-5, 3, 5, 3)).toBe(true);
  });

  it('does not let low cover (a crate under 1 m) block line of sight', () => {
    const g = grid([wall(0, 0, 1, 1, 0.9)]);
    expect(g.lineOfSight(-5, 0, 5, 0)).toBe(true);
  });

  it('has no floor over a void when the world has no ground', () => {
    const g = grid([wall(0, 0, 4, 4, 0)], { ground: Number.NaN });
    expect(g.walkable(0, 0)).toBe(true);
    expect(g.walkable(10, 10)).toBe(false);
    const out = new Float32Array(NAV_MAX_PATH * 2);
    expect(g.findPath(0, 0, 6, 0, out)).toBeGreaterThan(0); // snaps the goal to the platform edge
    expect(g.findPath(0, 0, 14, 0, out)).toBe(0); // too far over the void to snap
  });

  it('is deterministic', () => {
    const obs = [wall(0, 0, 0.5, 8), wall(4, 3, 2, 0.5)];
    const a = new Float32Array(NAV_MAX_PATH * 2);
    const b = new Float32Array(NAV_MAX_PATH * 2);
    const na = grid(obs).findPath(-8, -2, 9, 6, a);
    const nb = grid(obs).findPath(-8, -2, 9, 6, b);
    expect(na).toBe(nb);
    expect(Array.from(a.slice(0, na * 2))).toEqual(Array.from(b.slice(0, nb * 2)));
  });

  it('handles a large open grid within the expansion budget', () => {
    const g = grid([], { minX: -80, minZ: -80, maxX: 80, maxZ: 80 });
    const out = new Float32Array(NAV_MAX_PATH * 2);
    expect(g.findPath(-70, -70, 70, 70, out)).toBeGreaterThan(0);
  });
});

describe('collectObstacles / buildNavFor', () => {
  it('rasterizes static primitives, ignores sensors, dynamic bodies and decor without physics', () => {
    const w = worldOf([
      { id: 'wall', shape: { kind: 'primitive', primitive: 'box', size: [1, 3, 10] }, transform: { position: [0, 1.5, 0] }, physics: { body: 'static' } },
      { id: 'zone', shape: { kind: 'primitive', primitive: 'box', size: [4, 3, 4] }, transform: { position: [8, 1.5, 0] }, physics: { body: 'static', sensor: true } },
      { id: 'ball', shape: { kind: 'primitive', primitive: 'sphere', size: [1, 1, 1] }, transform: { position: [0, 0.5, 6] }, physics: { body: 'dynamic' } },
      { id: 'decor', shape: { kind: 'primitive', primitive: 'box', size: [2, 3, 2] }, transform: { position: [-8, 1.5, 0] } },
    ]);
    const obs = collectObstacles(w, { minX: -30, minZ: -30, maxX: 30, maxZ: 30 }, 0.4);
    expect(obs).toHaveLength(1);
    const g = buildNavFor(w, { refY: 0, radius: 0.4, height: 1.8, points: [[0, 0, 0]] });
    expect(g.walkable(0, 0)).toBe(false);
    expect(g.walkable(8, 0)).toBe(true);
    expect(g.walkable(-8, 0)).toBe(true);
  });

  it('honours rotation: a wall turned 90 degrees blocks the other axis', () => {
    const w = worldOf([{ id: 'wall', shape: { kind: 'primitive', primitive: 'box', size: [10, 3, 1] }, transform: { position: [0, 1.5, 0], rotation: [0, 90, 0] }, physics: { body: 'static' } }]);
    const g = buildNavFor(w, { refY: 0, radius: 0.1, height: 1.8, points: [[0, 0, 0]] });
    expect(g.walkable(0, 4)).toBe(false); // along z now
    expect(g.walkable(4, 0)).toBe(true);
  });

  it('uses host bounds for generated shapes', () => {
    const w = worldOf([{ id: 'house', shape: { kind: 'procedural', generator: 'house', params: {} }, transform: { position: [0, 0, 0] }, physics: { body: 'static' } }]);
    const bounds = { getBounds: () => ({ min: [-3, 0, -3] as [number, number, number], max: [3, 6, 3] as [number, number, number] }) };
    const g = buildNavFor(w, { refY: 0, radius: 0.3, height: 1.8, points: [[10, 0, 10]] }, bounds);
    expect(g.walkable(0, 0)).toBe(false);
    expect(g.walkable(8, 8)).toBe(true);
  });
});
