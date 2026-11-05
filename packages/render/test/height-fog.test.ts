import { describe, expect, it } from 'vitest';
import { FogExp2, Scene } from 'three';
import { HeightFog, layerHeight, layerShare } from '../src/environment/height-fog';
import { shaftHeightShare } from '../src/world-renderer';

describe('height fog', () => {
  it('keeps the ground layer and thins the air above it', () => {
    expect(layerShare(0, 0)).toBe(1);
    expect(layerShare(-1, -2)).toBe(1);
    expect(layerShare(2, 0)).toBeCloseTo((1 - Math.exp(-2)) / 2, 6);
    expect(layerShare(0, 2)).toBeCloseTo(layerShare(2, 0), 9);
    expect(layerShare(3, 3)).toBeCloseTo(Math.exp(-3), 9);
    expect(layerHeight(10)).toBe(60);
    expect(layerHeight(150)).toBe(150);
  });

  it('offers its node only while the scene fog is its own', () => {
    const scene = new Scene();
    const fog = new FogExp2('#ffffff', 0.01);
    new HeightFog(scene, fog);
    const s = scene as unknown as { fogNode: unknown };
    expect(s.fogNode).toBeNull();
    scene.fog = fog;
    expect(s.fogNode).not.toBeNull();
    scene.fog = new FogExp2('#000000', 0.1);
    expect(s.fogNode).toBeNull();
  });

  it('keeps the shafts at street height and gives them up from a drone', () => {
    expect(shaftHeightShare(2, 50)).toBe(0);
    expect(shaftHeightShare(18, 50)).toBe(0);
    expect(shaftHeightShare(200, 50)).toBe(1);
  });
});
