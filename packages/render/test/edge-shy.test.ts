import { describe, expect, it } from 'vitest';
import { aboveRelief, edgeShy, type GroundSheet } from '../src/view/edge-shy';

const sheet: GroundSheet = { minX: -160, maxX: 160, minZ: -160, maxZ: 160, minY: 0, maxY: 44 };

/** The ground point the view's top-centre ray lands on (plane at the sheet's mid height), or null when it leaves it. */
function topRay(pos: [number, number, number], target: [number, number, number], fovDeg: number): [number, number] | null {
  const d = [target[0] - pos[0], target[1] - pos[1], target[2] - pos[2]];
  const len = Math.hypot(...(d as [number, number, number]));
  const pitch = Math.asin(-d[1]! / len);
  const top = pitch - (fovDeg * Math.PI) / 360;
  if (top <= 0.03) return null;
  const t = (pos[1] - 22) / Math.sin(top);
  const yaw = Math.atan2(d[0]!, d[2]!);
  return [pos[0] + Math.sin(yaw) * Math.cos(top) * t, pos[2] + Math.cos(yaw) * Math.cos(top) * t];
}

describe('edgeShy', () => {
  it('tilts a high view down until its frame lies on the sheet', () => {
    const pos: [number, number, number] = [100, 120, 200];
    const target: [number, number, number] = [0, 10, 0];
    const out = edgeShy(pos, target, sheet, 50, 16 / 9);
    const hit = topRay(out.pos, out.target, 50);
    expect(hit).not.toBeNull();
    expect(Math.abs(hit![0])).toBeLessThan(160);
    expect(Math.abs(hit![1])).toBeLessThan(160);
    // The camera keeps its direction (yaw) and distance to the target.
    const a = Math.atan2(target[0] - pos[0], target[2] - pos[2]);
    const b = Math.atan2(out.target[0] - out.pos[0], out.target[2] - out.pos[2]);
    expect(b).toBeCloseTo(a, 5);
    expect(Math.hypot(out.target[0] - out.pos[0], out.target[1] - out.pos[1], out.target[2] - out.pos[2])).toBeCloseTo(Math.hypot(...(target.map((v, i) => v - pos[i]!) as [number, number, number])), 5);
  });

  it('leaves eye-level views alone (the relief hides the rim)', () => {
    const pos: [number, number, number] = [0, 6, 130];
    expect(aboveRelief(pos, sheet)).toBe(false);
    expect(edgeShy(pos, [0, 6, 0], sheet, 50, 16 / 9).pos).toBe(pos);
  });

  it('walks a camera hanging past the rim in over the sheet', () => {
    const pos: [number, number, number] = [0, 130, 260];
    const out = edgeShy(pos, [0, 20, 0], sheet, 50, 16 / 9);
    expect(out.pos).not.toBe(pos);
    expect(out.pos[2]).toBeLessThan(260);
  });

  it('keeps a view that already sees only ground', () => {
    const pos: [number, number, number] = [0, 150, 0];
    const target: [number, number, number] = [0, 0, 0];
    expect(edgeShy(pos, target, sheet, 50, 16 / 9).pos).toBe(pos);
  });
});
