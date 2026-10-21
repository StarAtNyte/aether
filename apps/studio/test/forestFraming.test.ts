/**
 * The automatic first view of generated woods: the offline planner's forest worlds are synced into a real scene
 * (real generator geometry, scattered trees with their occluder boxes) and the framer must pick a camera that
 * sees the content without a tree trunk or crown in the foreground.
 */
import { describe, expect, it } from 'vitest';
import { applyPatches, createWorld, summarizeWorld, type WorldDoc } from '@aether/core';
import { collectFramingItems, contentFraming, createProcgenGeometrySource, DEFAULT_FRAMING_AZIMUTH, foregroundBlockage, framingPose, GeometryCache, MaterialCache, pickClearView, sceneSightTest, SceneSync, viewCandidates, type FramingPoseOptions } from '@aether/render';
import { planMock } from '../../../packages/agent/src/providers/mock/planner';

function plan(request: string): WorldDoc {
  const p = planMock(request, summarizeWorld(createWorld()));
  const r = applyPatches(createWorld(), p.patches);
  expect(r.errors).toEqual([]);
  return r.world;
}

async function synced(world: WorldDoc): Promise<SceneSync> {
  const sync = new SceneSync({ source: createProcgenGeometrySource(), materials: new MaterialCache(), geometries: new GeometryCache() });
  await sync.setWorld(world);
  await sync.whenIdle();
  sync.root.updateMatrixWorld(true);
  return sync;
}

const BASE: FramingPoseOptions = { fovDeg: 50, aspect: 16 / 9, groundY: 0 };

describe('automatic framing of generated woods', () => {
  const blocked: number[] = [];
  for (const prompt of ['a dense pine forest', 'a forest camp with a campfire and tents', 'a misty woodland clearing']) {
    it(`looks past the foreground trees: ${prompt}`, async () => {
      const sync = await synced(plan(prompt));
      try {
        const framing = contentFraming(collectFramingItems(sync));
        expect(framing).not.toBeNull();
        if (!framing) return;
        const sight = sceneSightTest(sync);
        const preferred = framingPose(framing, { ...BASE, azimuthDeg: DEFAULT_FRAMING_AZIMUTH });
        const before = foregroundBlockage(preferred.position, framing, sight);
        blocked.push(before);
        const view = pickClearView(framing, BASE, viewCandidates(DEFAULT_FRAMING_AZIMUTH), sight);
        expect(view).not.toBeNull();
        if (!view) return;
        expect(view.blockage).toBeLessThanOrEqual(0.05);
        expect(view.blockage).toBeLessThanOrEqual(before);
        if (before > 0.05) expect(view.index).toBeGreaterThan(0);
        // Independently of the score: the line from the chosen camera to the content center is clear until the content.
        const eye = view.pose.position;
        const toCenter = Math.hypot(eye[0] - framing.center[0], eye[1] - framing.center[1], eye[2] - framing.center[2]);
        expect(sight(eye, framing.center)).toBeGreaterThan(toCenter - framing.radius);
        expect(eye[1]).toBeGreaterThan(1);
      } finally {
        sync.dispose();
      }
    }, 120_000);
  }

  it('found the preferred view of the dense forest behind a tree (the case this guards)', () => {
    expect(blocked[0] ?? 0).toBeGreaterThan(0.2);
  });
});
