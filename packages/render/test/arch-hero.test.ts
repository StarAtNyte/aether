import { describe, expect, it } from 'vitest';
import type { Vec3 } from '@aether/core';
import { boxSightTest, type FramingItem } from '../src/view/framing';
import { archFacades, archHeroViewsSteps, scoreArchHero, type ArchBuilding, type ArchHeroMeasure, type ArchOpening } from '../src/view/arch-hero';
import { ARCH_COVER_ZONE, drainSteps, nearestInView, rankOpeningViews, type OpeningProbe } from '../src/view/opening-view';

const W = 12; // along X
const D = 8; // along Z
const H = 6;
const house: FramingItem = { min: [-W / 2, 0, -D / 2], max: [W / 2, H, D / 2], focus: true };

/** A plain house: the entrance and two windows on +Z, three windows on +X, one small one on −X, a blank back (−Z). */
function building(extra: Partial<ArchBuilding> = {}): ArchBuilding {
  const o = (center: Vec3, normal: [number, number], area: number, kind: ArchOpening['kind']): ArchOpening => ({ center, normal, area, kind });
  return {
    min: house.min,
    max: house.max,
    openings: [
      o([0, 1.05, D / 2], [0, 1], 2.5, 'entrance'),
      o([-3.5, 1.6, D / 2], [0, 1], 2.4, 'window'),
      o([3.5, 1.6, D / 2], [0, 1], 2.4, 'window'),
      o([W / 2, 1.6, -2], [1, 0], 2, 'window'),
      o([W / 2, 1.6, 0], [1, 0], 2, 'window'),
      o([W / 2, 1.6, 2], [1, 0], 2, 'window'),
      o([-W / 2, 1.8, 0], [-1, 0], 0.6, 'window'),
    ],
    ...extra,
  };
}

function probeOf(solids: FramingItem[], cover: FramingItem[] = []): OpeningProbe {
  return {
    surface(x, z) {
      for (const b of solids) if (x >= b.min[0] && x <= b.max[0] && z >= b.min[2] && z <= b.max[2]) return { y: b.max[1], kind: 'blocked' };
      return { y: 0, kind: 'ground' };
    },
    sight: boxSightTest(solids),
    cover: boxSightTest([...solids, ...cover]),
  };
}

const input = (b: ArchBuilding) => ({ framing: { center: [0, 3, 0] as Vec3, radius: 16 }, items: [house], fovDeg: 50, aspect: 16 / 9, arch: true, building: b });

/** Degrees between the view direction (building to eye) and +Z, signed toward +X. */
const azimuth = (p: Vec3): number => (Math.atan2(p[0], p[2]) * 180) / Math.PI;

describe('arch hero view', () => {
  it('finds the front: the entrance side, then the glazing', () => {
    const f = archFacades(building());
    const best = [...f].sort((a, b) => b.score - a.score)[0]!;
    expect(best.normal[1]).toBeCloseTo(1, 5);
    expect(best.entrance).toBe(true);
    const back = f.find((s) => s.normal[1] < -0.9)!;
    expect(back.score).toBe(0);
    expect(back.richness).toBe(0);
  });

  it('counts the approach and the plan’s own front', () => {
    const plain = building({ openings: building().openings.filter((o) => o.kind !== 'entrance') });
    const toward = archFacades({ ...plain, approach: [[-20, 0]] });
    const west = toward.find((s) => s.normal[0] < -0.9)!;
    expect(west.score).toBeGreaterThan(archFacades(plain).find((s) => s.normal[0] < -0.9)!.score + 1);
    const named = archFacades({ ...plain, front: [0, -1] });
    expect([...named].sort((a, b) => b.score - a.score)[0]!.normal[1]).toBeCloseTo(-1, 5);
  });

  it('frames the front at a three-quarter angle toward the richer side, at eye height, level, filling half to three quarters of the width and at most about 60 % of the height', () => {
    const b = building();
    const views = drainSteps(archHeroViewsSteps(input(b), b, probeOf([house]), 3));
    expect(views.length).toBeGreaterThan(0);
    const v = views[0]!;
    const az = azimuth(v.position);
    // Off the front (+Z) by 28–46 degrees, swung toward +X (the side with three windows), never the blank back.
    expect(az).toBeGreaterThanOrEqual(26);
    expect(az).toBeLessThanOrEqual(47);
    expect(v.position[1]).toBeCloseTo(1.65, 2);
    const flat = Math.hypot(v.target[0] - v.position[0], v.target[2] - v.position[2]);
    const pitch = Math.atan2(v.target[1] - v.position[1], flat);
    expect(pitch).toBeLessThan(0);
    expect(pitch).toBeGreaterThan(-0.13);
    expect(v.measure.share).toBeGreaterThanOrEqual(0.45);
    expect(v.measure.height!).toBeLessThanOrEqual(0.65);
    expect(v.measure.share).toBeLessThanOrEqual(0.8);
    expect(v.measure.topCut).toBe(false);
    expect(v.measure.richness).toBeGreaterThan(0.4);
    expect(v.measure.sky).toBeGreaterThan(0.05);
  });

  it('is what the opening search returns for a building', () => {
    const b = building();
    const [v] = rankOpeningViews(input(b), probeOf([house]), 1);
    const [h] = drainSteps(archHeroViewsSteps(input(b), b, probeOf([house]), 1));
    expect(v!.position).toEqual(h!.position);
    expect(v!.target).toEqual(h!.target);
  });

  it('keeps clear of tall grass by the lens and goes round to the other side of the front', () => {
    const b = building();
    const clear = drainSteps(archHeroViewsSteps(input(b), b, probeOf([house]), 1))[0]!;
    // A meadow of tall grass all over the +X side of the front: the view swings to the −X side of the entrance.
    const grass: FramingItem[] = [];
    for (let x = 0; x < 40; x += 2) for (let z = 4.5; z < 40; z += 2) grass.push({ min: [x, 0, z], max: [x + 2, 1.2, z + 2] });
    const v = drainSteps(archHeroViewsSteps(input(b), b, probeOf([house], grass), 1))[0]!;
    expect(azimuth(clear.position)).toBeGreaterThan(0);
    expect(azimuth(v.position)).toBeLessThan(0);
    expect(Math.abs(azimuth(v.position))).toBeGreaterThanOrEqual(26);
    expect(nearestInView(probeOf([house], grass).cover!, v.position, v.target, 50, 16 / 9, ARCH_COVER_ZONE)).toBeGreaterThanOrEqual(ARCH_COVER_ZONE);
  });

  it('never opens on the blank back wall, even when the front is walled in', () => {
    const b = building();
    // A tall hedge right along the front and its corners: no spot sees the front's openings.
    const hedge: FramingItem = { min: [-14, 0, D / 2 + 1], max: [14, 5, D / 2 + 1.6] };
    const views = drainSteps(archHeroViewsSteps(input(b), b, probeOf([house, hedge]), 4));
    expect(views.length).toBeGreaterThan(0);
    for (const v of views) {
      // The view direction is never within 45 degrees of the back's normal (−Z).
      expect(Math.abs(azimuth(v.position))).toBeLessThan(135);
    }
    // The best of them looks at the side with the windows (+X).
    expect(views[0]!.position[0]).toBeGreaterThan(0);
  });

  it('scores the three-quarter view over the frontal one, and a blank wall worst', () => {
    const base: ArchHeroMeasure = { frontness: 1, offAngle: 36, share: 0.65, topCut: false, richness: 0.6, occluded: 0, foliage: 0, sky: 0.2, paved: false, inCover: false, raised: false };
    const three = scoreArchHero(base).total;
    expect(three).toBeGreaterThan(scoreArchHero({ ...base, offAngle: 4 }).total);
    expect(three).toBeGreaterThan(scoreArchHero({ ...base, share: 1.1 }).total);
    expect(three).toBeGreaterThan(scoreArchHero({ ...base, foliage: 0.6 }).total);
    expect(three).toBeGreaterThan(scoreArchHero({ ...base, raised: true }).total);
    expect(scoreArchHero({ ...base, paved: true }).total).toBeGreaterThan(three);
    const blank = scoreArchHero({ ...base, frontness: 0, richness: 0 }).total;
    expect(blank).toBeLessThan(scoreArchHero({ ...base, offAngle: 4, share: 0.95 }).total);
  });

  it('keeps to the entrance front even when the back has more glass', () => {
    const glassyBack = building({
      openings: [
        { center: [0, 1.05, D / 2], normal: [0, 1], area: 2.5, kind: 'entrance' },
        ...[-4.5, -1.5, 1.5, 4.5].map((x): ArchOpening => ({ center: [x, 1.6, -D / 2], normal: [0, -1], area: 4, kind: 'window' })),
      ],
    });
    const [v] = drainSteps(archHeroViewsSteps(input(glassyBack), glassyBack, probeOf([house]), 1));
    expect(v!.position[2]).toBeGreaterThan(D / 2);
    expect(v!.measure.frontness).toBe(1);
  });

  it('is deterministic', () => {
    const b = building();
    const a = drainSteps(archHeroViewsSteps(input(b), b, probeOf([house]), 2));
    const c = drainSteps(archHeroViewsSteps(input(b), b, probeOf([house]), 2));
    expect(a).toEqual(c);
  });
});
