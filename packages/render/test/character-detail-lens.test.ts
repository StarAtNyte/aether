/**
 * A body's pose detail follows how large the lens makes it, not only its distance: Cloudwatch's long-lens shot of Kaho
 * running down the harbour road (fov 8, 30 to 51 m away) dropped her to the mixer alone past 42 m, and her run became a
 * slide (no procedural gait, no foot placement, no skirt springs).
 */
import { describe, expect, it } from 'vitest';
import { lensDetailScale, LOD_MID, LOD_NEAR, LOD_REF_FOV, MAX_FULL_DETAIL, poseDetail, WALK_DETAIL_PX } from '../src/characters/system';

describe('lensDetailScale', () => {
  it('is 1 for the reference lens and wider ones', () => {
    expect(lensDetailScale(LOD_REF_FOV)).toBeCloseTo(1, 6);
    expect(lensDetailScale(75)).toBe(1);
    expect(lensDetailScale(Number.NaN)).toBe(1);
  });

  it('brings a long-lens body to full detail at the distance it fills the frame from', () => {
    const k = lensDetailScale(8);
    expect(k).toBeGreaterThan(0.12);
    expect(k).toBeLessThan(0.15);
    // the harbour road: 51 m away through an 8-degree lens is posed like a body 7 m away
    expect(51 * k).toBeLessThan(LOD_NEAR);
    // through the player's own lens the same distance stays at the mixer-only level
    expect(51 * lensDetailScale(LOD_REF_FOV)).toBeGreaterThan(LOD_MID);
  });

  it('counts the camera zoom', () => {
    expect(lensDetailScale(LOD_REF_FOV, 2)).toBeCloseTo(0.5, 6);
  });
});

describe('poseDetail', () => {
  it('keeps the walk of a moving body that is still visible on screen, beyond the mixer-only distance', () => {
    // Kaho walking down the path in a wide high shot: 60 m away, about 40 px tall
    expect(poseDetail(60, 40, 1.4, 0, 0)).toEqual({ detail: 1, walker: true });
  });

  it('leaves a standing or tiny far body on the mixer alone', () => {
    expect(poseDetail(60, 40, 0, 0, 0)).toEqual({ detail: 0, walker: false });
    expect(poseDetail(60, WALK_DETAIL_PX - 1, 1.4, 0, 0)).toEqual({ detail: 0, walker: false });
  });

  it('caps the kept walkers like full detail', () => {
    expect(poseDetail(60, 40, 1.4, 0, MAX_FULL_DETAIL)).toEqual({ detail: 0, walker: false });
  });

  it('is unchanged near and mid', () => {
    expect(poseDetail(LOD_NEAR - 1, 300, 1.4, 0, 0)).toEqual({ detail: 2, walker: false });
    expect(poseDetail(LOD_NEAR - 1, 300, 1.4, MAX_FULL_DETAIL, 0)).toEqual({ detail: 1, walker: false });
    expect(poseDetail(LOD_MID - 1, 60, 1.4, 0, 0)).toEqual({ detail: 1, walker: false });
  });
});
