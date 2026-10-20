import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import type { EntityInput } from '@aether/core';
import { OCCLUDER_MIN_HEIGHT, OccluderGrid, partBounds, posesFromMatrices } from '../src/view/occluders';
import { boomFreeDistance, CameraRig, MIN_FOLLOW_DISTANCE } from '../src/view/camera-rig';
import { makeSync, world } from './helpers';

/** A pine-like generator output: a thin trunk (0..2 m) and a wide crown (1.5..8 m), in local space. */
function pineParts(): Array<{ positions: Float32Array }> {
  const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => ({ positions: new Float32Array([x0, y0, z0, x1, y1, z1]) });
  return [box(-0.2, 0, -0.2, 0.2, 2, 0.2), box(-2, 1.5, -2, 2, 8, 2)];
}

function pose(x: number, y: number, z: number, yaw = 0, s = 1): number[] {
  return [x, y, z, Math.cos(yaw) * s, Math.sin(yaw) * s];
}

describe('OccluderGrid', () => {
  it('stands in for each part of each tall instance and finds where a segment enters a crown', () => {
    const grid = OccluderGrid.fromScatter(new Float32Array(pose(0, 0, 0)), 1, partBounds(pineParts()))!;
    expect(grid.count).toBe(2);
    // A boom from z = 6 toward the tree at the crown's height enters the (narrowed) crown box at z = 1.5.
    const t = grid.segmentEntry(0, 3, 6, 0, 3, -6);
    expect(t * 12).toBeCloseTo(6 - 2 * 0.75, 5);
    // Above the crown and beside it: clear.
    expect(grid.segmentEntry(0, 9, 6, 0, 9, -6)).toBe(Number.POSITIVE_INFINITY);
    expect(grid.segmentEntry(5, 3, 6, 5, 3, -6)).toBe(Number.POSITIVE_INFINITY);
    // A segment that ends short of the tree is clear.
    expect(grid.segmentEntry(0, 3, 6, 0, 3, 3)).toBe(Number.POSITIVE_INFINITY);
  });

  it('ignores a box that already holds the segment start (pulling in cannot get out of it)', () => {
    const grid = OccluderGrid.fromScatter(new Float32Array(pose(0, 0, 0)), 1, partBounds(pineParts()))!;
    expect(grid.segmentEntry(0, 3, 0, 0, 3, 6)).toBe(Number.POSITIVE_INFINITY);
  });

  it('leaves out instances lower than the minimum height (grass, reeds, pebbles)', () => {
    const grass = [{ positions: new Float32Array([-0.5, 0, -0.5, 0.5, OCCLUDER_MIN_HEIGHT * 0.6, 0.5]) }];
    expect(OccluderGrid.fromScatter(new Float32Array(pose(0, 0, 0)), 1, partBounds(grass))).toBeNull();
    // Scaled up past the threshold it counts.
    expect(OccluderGrid.fromScatter(new Float32Array(pose(0, 0, 0, 0, 2)), 1, partBounds(grass))).not.toBeNull();
  });

  it('follows the instance yaw, scale and height (a tree on a hill)', () => {
    const parts = [{ positions: new Float32Array([-0.1, 0, -3, 0.1, 4, 3]) }];
    // Yawed 90°, the long axis lies along x; the instance stands at y = 10 and is twice as big.
    const grid = OccluderGrid.fromScatter(new Float32Array(pose(0, 10, 0, Math.PI / 2, 2)), 1, partBounds(parts))!;
    expect(grid.segmentEntry(4, 12, 6, 4, 12, -6)).toBeLessThan(1);
    expect(grid.segmentEntry(4, 5, 6, 4, 5, -6)).toBe(Number.POSITIVE_INFINITY);
    expect(grid.segmentEntry(0, 12, 6, 0, 12, -6)).toBeLessThan(1);
  });

  it('reads poses from instance matrices and finds trees across a large forest grid', () => {
    const n = 400;
    const m = new Float32Array(n * 16);
    for (let i = 0; i < n; i++) {
      const o = i * 16;
      m[o] = 1;
      m[o + 5] = 1;
      m[o + 10] = 1;
      m[o + 15] = 1;
      m[o + 12] = (i % 20) * 10;
      m[o + 14] = Math.floor(i / 20) * 10;
    }
    const grid = OccluderGrid.fromScatter(posesFromMatrices(m, n), n, partBounds(pineParts()))!;
    expect(grid.count).toBe(n * 2);
    // Between two rows of trees: clear; through the tree at (100, 100): blocked.
    expect(grid.segmentEntry(95, 3, 105, 95, 3, 95)).toBe(Number.POSITIVE_INFINITY);
    expect(grid.segmentEntry(100, 3, 105, 100, 3, 95)).toBeLessThan(1);
    // A segment longer than the query cell cap still answers (brute force).
    expect(grid.segmentEntry(-10, 3, 100, 300, 3, 100)).toBeLessThan(1);
  });
});

describe('SceneSync scatter occlusion', () => {
  const tall: EntityInput = { id: 'pines', shape: { kind: 'scatter', of: { kind: 'primitive', primitive: 'cone', size: [3, 8, 3] }, count: 1, area: [1, 1], seed: 1, scaleRange: [1, 1], points: [[0, 0, 0]] } };
  const grass: EntityInput = { id: 'grass', shape: { kind: 'scatter', of: { kind: 'primitive', primitive: 'box', size: [1, 0.6, 1] }, count: 1, area: [1, 1], seed: 1, scaleRange: [1, 1], points: [[0, 0, 10]] } };

  it('blocks a boom through a scattered tree, not through low ground cover, and forgets removed or hidden layers', async () => {
    const { sync } = makeSync();
    await sync.setWorld(world([tall, grass]));
    sync.root.updateMatrixWorld(true);
    const through = sync.scatterOcclusion(new Vector3(0, 3, 6), new Vector3(0, 3, -6));
    expect(through).toBeGreaterThan(0);
    expect(through).toBeLessThan(0.5);
    expect(sync.scatterOcclusion(new Vector3(0, 0.3, 14), new Vector3(0, 0.3, 6))).toBe(Number.POSITIVE_INFINITY);
    sync.node('pines')!.object.visible = false;
    expect(sync.scatterOcclusion(new Vector3(0, 3, 6), new Vector3(0, 3, -6))).toBe(Number.POSITIVE_INFINITY);
    sync.node('pines')!.object.visible = true;
    await sync.setWorld(world([grass]));
    expect(sync.scatterOcclusion(new Vector3(0, 3, 6), new Vector3(0, 3, -6))).toBe(Number.POSITIVE_INFINITY);
  });

  it('keeps the chase camera out of a scattered crown', async () => {
    const { sync } = makeSync();
    await sync.setWorld(world([tall]));
    sync.root.updateMatrixWorld(true);
    const query = (from: Vector3, to: Vector3): number => {
      const t = sync.scatterOcclusion(from, to);
      return t === Number.POSITIVE_INFINITY ? t : t * from.distanceTo(to);
    };
    const cam = new PerspectiveCamera();
    const rig = new CameraRig(cam, null);
    rig.occlusion = query;
    // The player stands 3 m in front of the tree, facing away from it (yaw π): the boom points into the crown.
    rig.setMode('follow', (out) => {
      out.set(0, 0, 3.2);
      return Math.PI;
    });
    const look = new Vector3(0, 1.3, 3.2);
    for (let i = 0; i < 90; i++) {
      rig.update(1 / 60);
      expect(query(look, cam.position)).toBe(Number.POSITIVE_INFINITY);
    }
    expect(boomFreeDistance(query, look, cam.position)).toBe(Number.POSITIVE_INFINITY);
    expect(cam.position.distanceTo(look)).toBeGreaterThanOrEqual(MIN_FOLLOW_DISTANCE - 1e-6);
    expect(cam.position.z).toBeGreaterThan(1.1);
  });
});
