import { describe, expect, it } from 'vitest';
import { Box3, Vector3 } from 'three';
import { CONTACT_SPREAD, ContactShadows, MAX_CONTACT_SHADOWS, planContactShadows } from '../src/view/contact-shadows';

const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Box3 => new Box3(new Vector3(x0, y0, z0), new Vector3(x1, y1, z1));

describe('contact shadows', () => {
  it('puts a wider footprint under pieces standing on a floor, none under wall-hung or odd pieces', () => {
    const prints = planContactShadows(
      [
        box(0, 0, 0, 2, 0.8, 1), // sofa on the ground floor
        box(5, 3.02, 0, 6, 3.5, 1), // chair upstairs (on a rug)
        box(0, 1.5, 3, 1, 2.2, 3.05), // frame on a wall: no floor under it
        box(0, 0, 0, 0.05, 1, 0.05), // too thin
        box(0, 0, 0, 20, 1, 20), // not a piece
        new Box3(), // empty
        box(Number.NaN, 0, 0, 1, 1, 1),
      ],
      [0, 3],
    );
    expect(prints.length).toBe(2);
    expect(prints[0]!.sx).toBeCloseTo(2 + 2 * CONTACT_SPREAD, 6);
    expect(prints[0]!.y).toBe(0);
    expect(prints[1]!.y).toBeCloseTo(3.02, 6);
    expect(prints[0]!.strength).toBeGreaterThan(prints[1]!.strength);
    expect(planContactShadows([box(0, 0, 0, 1, 1, 1)], [])).toEqual([]);
  });

  it('caps the count and draws one instanced mesh', () => {
    const many = Array.from({ length: MAX_CONTACT_SHADOWS + 10 }, (_, i) => box(i, 0, 0, i + 0.5, 0.5, 0.5));
    const prints = planContactShadows(many, [0]);
    expect(prints.length).toBe(MAX_CONTACT_SHADOWS);
    const c = new ContactShadows();
    c.set(prints);
    expect(c.mesh.count).toBe(MAX_CONTACT_SHADOWS);
    expect(c.mesh.visible).toBe(true);
    c.set([]);
    expect(c.mesh.visible).toBe(false);
    c.dispose();
  });
});
