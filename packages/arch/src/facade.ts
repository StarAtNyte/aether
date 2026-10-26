/**
 * The front of a building: what turns a box into a place you arrive at. An entrance with a door surround and a canopy (on
 * columns), a sign with emissive lettering, a cornice at the roofline, a paved forecourt, lamp posts, planters and a bench,
 * and the light over the door. Everything is emitted into the building's subtree in the plan frame, deterministic for a plan,
 * and driven by `plan.facade` (all parts optional, on by default once a facade is asked for).
 */
import type { EntityInput, Json, MaterialSpec } from '@aether/core';
import type { ExteriorPalette } from './style';
import { signTextWidth } from './sign';
import { pointInPolygon, yawOf, type P2 } from './math2';

export interface FacadeInput {
  bid: string;
  facade: {
    sign?: string | undefined;
    signColor: string;
    signPanel: string;
    canopy: boolean;
    doorSurround: boolean;
    cornice: boolean;
    pilasters: boolean;
    forecourt: boolean;
    lamps: boolean;
    planters: boolean;
    bench: boolean;
    light: boolean;
  };
  /** Main entrance: door centre, outward normal, width, height (plan frame). */
  door: { c: P2; n: P2; width: number; height: number } | null;
  /** Half the exterior wall thickness. */
  ext: number;
  /** Height of the ground floor above the ground. */
  plinth: number;
  /** Ceiling height of the ground floor. */
  ceiling: number;
  /** Top of the top storey's walls above the ground. */
  wallTop: number;
  /** Outline loops of the top storey (wall centrelines). */
  topLoops: readonly (readonly P2[])[];
  /** Outline loops of the ground floor (wall centrelines). */
  groundLoops: readonly (readonly P2[])[];
  xp: ExteriorPalette;
  /** The wall that carries the entrance: start, unit direction, length and openings (centre along it, width). */
  frontWall?: { a: P2; dir: P2; len: number; openings: ReadonlyArray<{ offset: number; width: number }> } | undefined;
}

const r3 = (n: number): number => Math.round(n * 1000) / 1000;
const PAVING: MaterialSpec = { finish: 'stone', color: '#bdb5a7' };
const SITE = { role: 'site' as const };

export function compileFacade(g: FacadeInput): EntityInput[] {
  const out: EntityInput[] = [];
  const f = g.facade;
  const tag = ['arch', 'site', 'facade'];
  const trim = g.xp.trim;
  const add = (e: EntityInput): void => void out.push(e);

  // --- roofline: a cornice band on the outer face of every edge of the top storey -------------------------------------
  if (f.cornice) {
    g.topLoops.forEach((loop, li) => {
      loop.forEach((a, k) => {
        const b = loop[(k + 1) % loop.length] as P2;
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 0.4) return;
        const ux = (b[0] - a[0]) / len;
        const uz = (b[1] - a[1]) / len;
        // Outward is the side of the edge that is outside the loop.
        let nx = uz;
        let nz = -ux;
        const probe: P2 = [(a[0] + b[0]) / 2 + nx * 0.3, (a[1] + b[1]) / 2 + nz * 0.3];
        const inside = pointInPolygon(probe[0], probe[1], loop as P2[]);
        // A courtyard loop sits inside the outer one: its cornice faces into the courtyard.
        const courtyard = g.topLoops.some((o, oi) => oi !== li && pointInPolygon((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, o as P2[]));
        if (inside !== courtyard) {
          nx = -nx;
          nz = -nz;
        }
        const mid: P2 = [(a[0] + b[0]) / 2 + nx * g.ext, (a[1] + b[1]) / 2 + nz * g.ext];
        add({
          id: `${g.bid}-cornice${li}-${k}`,
          parent: g.bid,
          name: 'Cornice',
          transform: { position: [r3(mid[0]), r3(g.wallTop - 0.11), r3(mid[1])], rotation: [0, r3(yawOf(ux, uz)), 0] },
          shape: { kind: 'primitive', primitive: 'box', size: [r3(len + 2 * g.ext + 0.3), 0.22, 0.34] },
          material: trim,
          arch: { ...SITE, kind: 'cornice', name: 'Cornice' },
          tags: tag,
        });
      });
    });
  }

  const d = g.door;
  if (!d) return out;
  const n = d.n;
  const t: P2 = [-n[1], n[0]];
  const o = g.ext;
  const at = (u: number, dd: number): P2 => [r3(d.c[0] + t[0] * u + n[0] * dd), r3(d.c[1] + t[1] * u + n[1] * dd)];
  const yawT = r3(yawOf(t[0], t[1]));
  const yawOut = r3((Math.atan2(n[0], n[1]) * 180) / Math.PI);
  const doorTop = g.plinth + d.height;
  const room = g.ceiling - d.height;
  const hasCanopy = f.canopy && room > 0.35;
  const textW = f.sign ? signTextWidth(f.sign, 0.55 * 0.72 / 7) : 0;
  const hw = Math.max(d.width / 2 + 1.0, Math.min(5, textW / 2 + 0.5));
  const depth = 1.9;
  const canopyY = r3(Math.min(g.plinth + g.ceiling - 0.05, doorTop + 0.32));

  // --- door surround: two pilasters and a lintel with a keystone block ---------------------------------------------------
  if (f.doorSurround) {
    for (const s of [-1, 1] as const) {
      const p = at(s * (d.width / 2 + 0.2), o + 0.09);
      add({ id: `${g.bid}-door-pilaster${s > 0 ? 'r' : 'l'}`, parent: g.bid, name: 'Door pilaster', transform: { position: [p[0], 0, p[1]], rotation: [0, yawT, 0] }, shape: { kind: 'procedural', generator: 'arch-column', params: { shape: 'square', size: 0.26, height: r3(doorTop + 0.2), finish: trim } as unknown as Record<string, Json> }, arch: { ...SITE, kind: 'door-surround', name: 'Door pilaster' }, tags: tag });
    }
    const p = at(0, o + 0.11);
    add({ id: `${g.bid}-door-lintel`, parent: g.bid, name: 'Door lintel', transform: { position: [p[0], r3(doorTop + 0.1), p[1]], rotation: [0, yawT, 0] }, shape: { kind: 'primitive', primitive: 'box', size: [r3(d.width + 0.9), 0.26, 0.3] }, material: trim, arch: { ...SITE, kind: 'door-surround', name: 'Door lintel' }, tags: tag });
  }

  // --- canopy on two columns, with the light under it ---------------------------------------------------------------------
  if (hasCanopy) {
    const corner = (u: number, dd: number): [number, number] => at(u, dd);
    add({
      id: `${g.bid}-portico`,
      parent: g.bid,
      name: 'Entrance canopy',
      transform: { position: [0, canopyY, 0] },
      shape: { kind: 'procedural', generator: 'arch-slab', params: { polygon: [corner(-hw, o - 0.02), corner(hw, o - 0.02), corner(hw, o + depth), corner(-hw, o + depth)], thickness: 0.16, finish: trim, edge: trim, bottom: true } as unknown as Record<string, Json> },
      arch: { ...SITE, kind: 'canopy', name: 'Entrance canopy' },
      tags: tag,
    });
    for (const s of [-1, 1] as const) {
      const p = at(s * (hw - 0.22), o + depth - 0.22);
      add({ id: `${g.bid}-portico-col${s > 0 ? 'r' : 'l'}`, parent: g.bid, name: 'Canopy column', transform: { position: [p[0], 0, p[1]] }, shape: { kind: 'procedural', generator: 'arch-column', params: { shape: 'round', size: 0.2, height: r3(canopyY), finish: trim } as unknown as Record<string, Json> }, physics: { body: 'static' }, arch: { ...SITE, kind: 'canopy', name: 'Canopy column' }, tags: tag });
    }
    if (f.light) {
      const p = at(0, o + depth * 0.55);
      add({ id: `${g.bid}-entry-light`, parent: g.bid, name: 'Entrance light', transform: { position: [p[0], r3(canopyY - 0.25), p[1]] }, shape: { kind: 'none' }, light: { type: 'point', color: '#ffd9a0', intensity: 1.6, range: 9, angle: 60, castShadow: false }, arch: { ...SITE, kind: 'light', name: 'Entrance light' }, tags: [...tag, 'light'] });
    }
  }

  // --- sign: emissive lettering on a panel standing on the canopy, or flush above the door ---------------------------------
  if (f.sign) {
    const signH = 0.55;
    const onCanopy = hasCanopy;
    const p = onCanopy ? at(0, o + depth - 0.12) : at(0, o + 0.05);
    const y = onCanopy ? canopyY + 0.08 : r3(Math.min(g.plinth + g.ceiling - signH - 0.1, doorTop + 0.45));
    add({
      id: `${g.bid}-sign`,
      parent: g.bid,
      name: `Sign: ${f.sign}`,
      transform: { position: [p[0], r3(y), p[1]], rotation: [0, yawOut, 0] },
      shape: { kind: 'procedural', generator: 'arch-sign', params: { text: f.sign, height: signH, letters: f.signColor, panel: { finish: 'paint', color: f.signPanel }, ...(onCanopy ? { width: r3(Math.min(hw * 2 - 0.3, 9)) } : {}) } as unknown as Record<string, Json> },
      arch: { ...SITE, kind: 'sign', name: 'Sign' },
      tags: [...tag, 'sign'],
    });
    if (f.light) {
      const q = at(0, o + (onCanopy ? depth + 0.9 : 1.1));
      add({ id: `${g.bid}-sign-light`, parent: g.bid, name: 'Sign light', transform: { position: [q[0], r3(y + 0.9), q[1]] }, shape: { kind: 'none' }, light: { type: 'point', color: '#ffe3b0', intensity: 1.4, range: 8, angle: 60, castShadow: false }, arch: { ...SITE, kind: 'light', name: 'Sign light' }, tags: [...tag, 'light'] });
    }
  }

  // --- rhythm: shallow pilasters between the openings of the front wall, so a long front is not one blank sheet --------------
  const fwl = g.frontWall;
  if (f.pilasters && fwl && fwl.len >= 7) {
    const bays = Math.max(2, Math.round(fwl.len / 4.2));
    const h = g.wallTop - g.plinth - 0.3;
    for (let k = 1; k < bays; k++) {
      const tt = (fwl.len * k) / bays;
      if (fwl.openings.some((q) => Math.abs(q.offset - tt) < q.width / 2 + 0.5)) continue;
      const p: P2 = [r3(fwl.a[0] + fwl.dir[0] * tt + n[0] * (o + 0.07)), r3(fwl.a[1] + fwl.dir[1] * tt + n[1] * (o + 0.07))];
      add({ id: `${g.bid}-pilaster${k}`, parent: g.bid, name: 'Facade pilaster', transform: { position: [p[0], r3(g.plinth + h / 2), p[1]], rotation: [0, r3(yawOf(fwl.dir[0], fwl.dir[1])), 0] }, shape: { kind: 'primitive', primitive: 'box', size: [0.42, r3(h), 0.16] }, material: trim, arch: { ...SITE, kind: 'pilaster', name: 'Facade pilaster' }, tags: tag });
    }
  }

  // --- forecourt: paving in front of the entrance, with lamps, planters and a bench ------------------------------------------
  const fw = Math.max(7, hw * 2 + 3);
  const fd = 5.5;
  const inFront = (p: P2): boolean => g.groundLoops.some((l) => pointInPolygon(p[0], p[1], l as P2[]));
  if (f.forecourt) {
    const poly = [at(-fw / 2, o + 0.02), at(fw / 2, o + 0.02), at(fw / 2, o + fd), at(-fw / 2, o + fd)];
    if (!poly.some(inFront)) {
      add({
        id: `${g.bid}-forecourt`,
        parent: g.bid,
        name: 'Forecourt',
        transform: { position: [0, r3(g.plinth - 0.05), 0] },
        shape: { kind: 'procedural', generator: 'arch-slab', params: { polygon: poly, thickness: r3(g.plinth + 0.15), finish: PAVING, edge: PAVING } as unknown as Record<string, Json> },
        physics: { body: 'static', collider: 'auto' },
        arch: { ...SITE, kind: 'forecourt', name: 'Forecourt' },
        tags: tag,
      });
    }
  }
  const py = r3(g.plinth - 0.04);
  if (f.lamps) {
    for (const s of [-1, 1] as const) {
      const p = at(s * (fw / 2 - 0.6), o + fd - 0.7);
      add({ id: `${g.bid}-lamp${s > 0 ? 'r' : 'l'}`, parent: g.bid, name: 'Lamp post', transform: { position: [p[0], py, p[1]] }, shape: { kind: 'procedural', generator: 'lamp-post', params: { height: 3.4, variant: 0 } as unknown as Record<string, Json> }, physics: { body: 'static' }, arch: { ...SITE, kind: 'lamp', name: 'Lamp post' }, tags: tag });
      add({ id: `${g.bid}-lamp${s > 0 ? 'r' : 'l'}-light`, parent: g.bid, name: 'Lamp light', transform: { position: [p[0], r3(py + 3.1), p[1]] }, shape: { kind: 'none' }, light: { type: 'point', color: '#ffd27a', intensity: 1.8, range: 10, angle: 60, castShadow: false }, arch: { ...SITE, kind: 'light', name: 'Lamp light' }, tags: [...tag, 'light'] });
    }
  }
  if (f.planters) {
    for (const s of [-1, 1] as const) {
      const p = at(s * (d.width / 2 + 1.5), o + 0.4);
      if (p && !inFront(p)) add({ id: `${g.bid}-planter${s > 0 ? 'r' : 'l'}`, parent: g.bid, name: 'Planter', transform: { position: [p[0], py, p[1]], rotation: [0, yawT, 0] }, shape: { kind: 'procedural', generator: 'furn-planter', params: { variant: 'trough', plants: 'shrub', length: 1.4, height: 0.6 } as unknown as Record<string, Json> }, physics: { body: 'static' }, arch: { ...SITE, kind: 'planter', name: 'Planter' }, tags: tag });
      const q = at(s * (fw / 2 - 0.7), o + 1.2);
      add({ id: `${g.bid}-urn${s > 0 ? 'r' : 'l'}`, parent: g.bid, name: 'Urn planter', transform: { position: [q[0], py, q[1]] }, shape: { kind: 'procedural', generator: 'furn-planter', params: { variant: 'urn', plants: 'flowers', length: 0.8, height: 0.7 } as unknown as Record<string, Json> }, physics: { body: 'static' }, arch: { ...SITE, kind: 'planter', name: 'Urn planter' }, tags: tag });
    }
  }
  if (f.bench) {
    for (const s of [-1, 1] as const) {
      const p = at(s * (hw + 0.9), o + 4.0);
      add({ id: `${g.bid}-bench${s > 0 ? 'r' : 'l'}`, parent: g.bid, name: 'Bench', transform: { position: [p[0], py, p[1]], rotation: [0, yawOut, 0] }, shape: { kind: 'procedural', generator: 'bench', params: { length: 1.8, variant: 0 } as unknown as Record<string, Json> }, physics: { body: 'static' }, arch: { ...SITE, kind: 'bench', name: 'Bench' }, tags: tag });
    }
  }
  return out;
}
