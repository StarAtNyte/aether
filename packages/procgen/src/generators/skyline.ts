/**
 * Skyline generator: a believable distant (or street-level) high-rise built from a few stacked, setback
 * volumes. Walls use the `facade` finish (a window grid with recessed glass and mullions that lights up
 * after dark, see `finish-pixels.ts`), roofs are concrete decks with plant rooms, a water tank and an
 * mast (above 45 m). Geometry stays below 150 triangles, so a skyline of sixty towers costs nothing; the
 * facade's metre UVs are authored so the 3 m window grid lines up with the floors, whatever the size.
 */
import type { MaterialSpec } from '@aether/core';
import type { InternalApi } from '../api';
import type { Mesh } from '../kernel/mesh';
import { boxCollider } from '../colliders';
import { defineGenerator, pColor, pInt, pNum, pVariant } from './kit';

/** Floor height and bay width of the facade texture (metres). */
export const FLOOR_HEIGHT = 3;
/** Bounds on the tower so one parameter set stays cheap. */
const MAX_SECTIONS = 4;

/** One stacked volume of a tower. */
export interface TowerSection {
  /** Footprint (m), multiples of the 3 m bay. */
  width: number;
  depth: number;
  /** Centre offset from the tower axis (m). */
  dx: number;
  dz: number;
  /** Bottom and top (m); multiples of the 3 m floor. */
  y0: number;
  y1: number;
}

/** Deterministic section layout of a tower: setbacks narrow the footprint towards the top. */
export function towerSections(width: number, depth: number, height: number, setbacks: number, random: () => number): TowerSection[] {
  const bay = FLOOR_HEIGHT;
  const snap = (v: number): number => Math.max(bay * 2, Math.round(v / bay) * bay);
  const floors = Math.max(2, Math.round(height / FLOOR_HEIGHT));
  const count = Math.max(1, Math.min(MAX_SECTIONS, 1 + Math.floor(setbacks)));
  const sections: TowerSection[] = [];
  let w = snap(width);
  let d = snap(depth);
  let y = 0;
  let remaining = floors;
  for (let i = 0; i < count; i++) {
    const last = i === count - 1;
    // The podium is low and wide; each upper volume carries on up and gets narrower.
    const share = last ? remaining : Math.max(1, Math.round(remaining * (i === 0 && count > 1 ? 0.35 : 0.55)));
    const take = Math.min(remaining, share);
    // An upper volume sits inside the footprint of the one below it (offset by a random share of the slack, never overhanging).
    const below = sections[i - 1];
    const slackX = below ? Math.max(0, (below.width - w) / 2) : 0;
    const slackZ = below ? Math.max(0, (below.depth - d) / 2) : 0;
    sections.push({
      width: w,
      depth: d,
      dx: below ? below.dx + (random() * 2 - 1) * slackX : 0,
      dz: below ? below.dz + (random() * 2 - 1) * slackZ : 0,
      y0: y * FLOOR_HEIGHT,
      y1: (y + take) * FLOOR_HEIGHT,
    });
    y += take;
    remaining -= take;
    if (remaining <= 0) break;
    w = snap(w * (0.62 + random() * 0.18));
    d = snap(d * (0.62 + random() * 0.18));
  }
  return sections;
}

/**
 * Overwrite the UVs of a box mesh with metre coordinates measured from its corner (`x0`, `z0`) and floor (`y0`),
 * so the facade tile's window grid lines up with the box's edges and floors.
 */
export function facadeUvs(mesh: Mesh, x0: number, y0: number, z0: number, offsetU = 0, offsetV = 0): void {
  const p = mesh.positions;
  const n = mesh.normals;
  const uv = mesh.uvs;
  for (let i = 0; i < p.length / 3; i++) {
    const x = (p[i * 3] as number) - x0;
    const y = (p[i * 3 + 1] as number) - y0;
    const z = (p[i * 3 + 2] as number) - z0;
    const nx = Math.abs(n[i * 3] as number);
    const ny = Math.abs(n[i * 3 + 1] as number);
    const nz = Math.abs(n[i * 3 + 2] as number);
    let u: number;
    let v: number;
    if (ny >= nx && ny >= nz) {
      u = x;
      v = z;
    } else if (nz >= nx) {
      u = x;
      v = y;
    } else {
      u = z;
      v = y;
    }
    uv[i * 2] = u + offsetU;
    uv[i * 2 + 1] = v + offsetV;
  }
}

const STYLES = ['glass', 'concrete', 'brick'] as const;
type Style = (typeof STYLES)[number];

/** Wall materials per style: glass towers are dark and reflective, concrete ones pale, brick ones warm. */
function facadeMaterial(style: Style, color: string, roughness: number): MaterialSpec {
  const finish = style === 'brick' ? 'brick' : 'facade';
  if (style === 'brick') return { finish, color, roughness };
  return { finish, color, roughness: style === 'glass' ? roughness * 0.7 : roughness };
}

const skylineTower = defineGenerator({
  id: 'skyline-tower',
  description: 'City high-rise with a window-grid facade that lights up at night, setbacks and a roof deck. Use many for a skyline.',
  category: 'architecture',
  params: {
    width: pNum(24, 6, 80, 'base width (x), meters'),
    depth: pNum(24, 6, 80, 'base depth (z), meters'),
    height: pNum(80, 12, 400, 'height, meters'),
    setbacks: pInt(1, 0, 3, 'setbacks (0 = slab)'),
    variant: pVariant(2, '0 glass, 1 concrete, 2 brick'),
    color: pColor('#b9b2a6', 'wall color'),
  },
  run(p, api: InternalApi) {
    const sections = towerSections(p.num('width'), p.num('depth'), p.num('height'), p.int('setbacks'), () => api.range(0, 1));
    const style: Style = STYLES[p.int('variant')] ?? 'glass';
    const color = p.color('color');
    const wall = facadeMaterial(style, color, style === 'concrete' ? 0.7 : 0.55);
    const roof: MaterialSpec = { finish: 'concrete', color: '#8f8c86' };
    const dark: MaterialSpec = { finish: 'black-metal' };
    // A random whole-bay phase per tower, so towers built from the same tile do not share a window pattern.
    const phaseU = api.range(0, 4) | 0;
    const phaseV = api.range(0, 4) | 0;
    let top = 0;
    let topSection: TowerSection | null = null;
    for (const s of sections) {
      const x0 = s.dx - s.width / 2;
      const z0 = s.dz - s.depth / 2;
      const body = api.box(s.width, s.y1 - s.y0, s.depth).translate(s.dx, (s.y0 + s.y1) / 2, s.dz);
      facadeUvs(body, x0, s.y0, z0, phaseU * FLOOR_HEIGHT, phaseV * FLOOR_HEIGHT);
      api.add(body, wall);
      // Roof slab with a low parapet ring (four boxes).
      const t = s.y1;
      api.add(api.box(s.width + 0.5, 0.6, s.depth + 0.5).translate(s.dx, t + 0.3, s.dz), roof);
      if (t >= top) {
        top = t;
        topSection = s;
      }
    }
    if (topSection) {
      const s = topSection;
      // Plant room and stair bulkhead on the roof deck, a water tank, and the mast.
      const pw = Math.max(3, s.width * 0.34);
      const pd = Math.max(3, s.depth * 0.3);
      api.add(api.box(pw, 3.4, pd).translate(s.dx - s.width * 0.18, top + 0.6 + 1.7, s.dz + s.depth * 0.14), roof);
      api.add(api.box(Math.max(2, s.width * 0.14), 2.4, Math.max(2, s.depth * 0.14)).translate(s.dx + s.width * 0.28, top + 0.6 + 1.2, s.dz - s.depth * 0.2), roof);
      if (s.width >= 12) api.add(api.cylinder(1.4, 1.4, 3.2, 10).translate(s.dx + s.width * 0.2, top + 0.6 + 1.6, s.dz + s.depth * 0.22), dark);
      if (top >= 45) api.add(api.cylinder(0.12, 0.3, Math.min(40, 6 + top * 0.12), 6).translate(s.dx, top + 0.6 + Math.min(40, 6 + top * 0.12) / 2, s.dz), dark);
    }
    const base = sections[0];
    if (base) api.collider(boxCollider(base.dx, top / 2, base.dz, base.width, top, base.depth));
    return api.build();
  },
});

/** Skyline generators. */
export const SKYLINE_GENERATORS = [skylineTower];
