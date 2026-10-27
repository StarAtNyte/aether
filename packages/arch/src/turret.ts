/**
 * Turret roofs: a conical, polygonal-pyramid or domed cap over a round turret, with an optional turret wall and narrow
 * windows below it and a finial on the tip.
 *
 * Local frame: centred on the axis; y = 0 is the eave line (the top of the turret wall); the cap rises to `height`. The
 * eaves overhang the wall by `overhang` and end in a fascia band; a soffit closes the underside.
 */
import { Geom, cylinder, lathe, sphere } from './mesh';
import { PartSet } from './parts';
import type { TurretRoofParams } from './params';
import type { ArchOutput } from './types';
import type { P2 } from './math2';

type V3 = [number, number, number];

/** Fascia band at the eaves (m). */
const FASCIA = 0.11;

/** Profile of the cap: `[radius, y]` from the eaves to the tip. */
export function turretProfile(p: Pick<TurretRoofParams, 'radius' | 'overhang' | 'height' | 'profile'>, steps = 14): P2[] {
  const R = p.radius + p.overhang;
  const out: P2[] = [];
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    let r = R * (1 - u);
    let y = p.height * u;
    if (p.profile === 'bell') y = p.height * Math.pow(u, 1.7);
    else if (p.profile === 'dome') {
      r = R * Math.cos((u * Math.PI) / 2);
      y = p.height * Math.sin((u * Math.PI) / 2);
    } else if (p.profile === 'ogee') y = p.height * (u - 0.07 * Math.sin(2 * Math.PI * u));
    out.push([Math.max(0.003, r), y]);
  }
  return out;
}

/** Faceted surface of revolution with `sides` flat facets, from a profile, flat shaded. */
function pyramid(profile: readonly P2[], sides: number, phase: number): Geom {
  const g = new Geom();
  for (let s = 0; s < sides; s++) {
    const a0 = phase + (s / sides) * 2 * Math.PI;
    const a1 = phase + ((s + 1) / sides) * 2 * Math.PI;
    for (let j = 0; j + 1 < profile.length; j++) {
      const p0 = profile[j] as P2;
      const p1 = profile[j + 1] as P2;
      const c = (r: number, a: number, y: number): V3 => [r * Math.cos(a), y, r * Math.sin(a)];
      // Normal faces outward and up: (c1 - c0) x (c3 - c0) with c0 low-left, c1 low-right, c3 high-left.
      g.quadAuto(c(p0[0], a1, p0[1]), c(p0[0], a0, p0[1]), c(p1[0], a0, p1[1]), c(p1[0], a1, p1[1]));
    }
  }
  return g;
}

/** Turret roof. */
export function buildTurretRoof(p: TurretRoofParams): ArchOutput {
  const set = new PartSet();
  const profile = turretProfile(p);
  const R = p.radius + p.overhang;
  const cap = p.sides >= 3 ? pyramid(profile, p.sides, Math.PI / p.sides) : lathe(profile, 36);
  set.add(cap, p.finish);

  const trim = new Geom();
  const round = p.sides < 3;
  // Fascia band round the eaves and the soffit under the overhang.
  if (round) {
    trim.merge(cylinder(R, R, FASCIA, 36, { top: false, bottom: false }).translate(0, -FASCIA, 0));
    const soffit = lathe([[p.radius * 0.999, 0], [R, 0]], 36);
    trim.merge(soffit);
  } else {
    trim.merge(pyramid([[R, -FASCIA], [R, 0]], p.sides, Math.PI / p.sides));
  }
  set.add(trim, p.trim);

  // Finial.
  if (p.finial > 0) {
    const tip = p.height;
    const f = new Geom();
    f.merge(sphere(0.06, 10).translate(0, tip + 0.02, 0));
    f.merge(cylinder(0.018, 0.0, p.finial, 8).translate(0, tip + 0.06, 0));
    set.add(f, p.metal);
  }

  // The turret wall and its slits.
  if (p.wallHeight > 0) {
    const w = new Geom();
    if (round) w.merge(cylinder(p.radius, p.radius, p.wallHeight, 36, { top: false }).translate(0, -p.wallHeight, 0));
    else w.merge(pyramid([[p.radius, -p.wallHeight], [p.radius, 0]], p.sides, Math.PI / p.sides));
    set.add(w, p.wall);
    if (p.slits > 0) {
      const slits = new Geom();
      const h = Math.min(0.8, p.wallHeight * 0.4);
      const y0 = -p.wallHeight * 0.55 - h / 2;
      for (let k = 0; k < p.slits; k++) {
        const a = ((k + 0.5) / p.slits) * 360;
        const g = new Geom();
        g.quadAuto([p.radius + 0.012, y0, 0.05], [p.radius + 0.012, y0, -0.05], [p.radius + 0.012, y0 + h, -0.05], [p.radius + 0.012, y0 + h, 0.05]);
        slits.merge(g.rotateY(-a));
      }
      set.add(slits, { finish: 'glass' });
    }
    const pts: number[] = [];
    const m = round ? 16 : p.sides;
    for (let i = 0; i < m; i++) {
      const a = (i / m) * 2 * Math.PI + (round ? 0 : Math.PI / p.sides);
      for (const y of [-p.wallHeight, 0]) pts.push(p.radius * Math.cos(a), y, p.radius * Math.sin(a));
    }
    set.hull(pts);
  }

  // Collider of the cap: its eaves ring, the profile's knees and the tip as one hull (a convex cone / dome).
  const pts: number[] = [];
  const m = round ? 20 : p.sides;
  for (let i = 0; i < m; i++) {
    const a = (i / m) * 2 * Math.PI + (round ? 0 : Math.PI / p.sides);
    for (const q of profile.filter((_, k) => k % 3 === 0 || k === profile.length - 1)) pts.push(q[0] * Math.cos(a), q[1], q[0] * Math.sin(a));
  }
  set.hull(pts);
  return set.build();
}
