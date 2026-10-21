/**
 * Wall geometry without CSG: each side face is tiled into rectangles around
 * the openings (doorways, window holes), the openings get reveal faces
 * (jambs, head, sill), and the ends follow the mitres / butt joints computed
 * by the join solver (`wall-joins.ts`). Skirting boards run along interior
 * faces and stop at doorways. Colliders are boxes for the solid parts only,
 * so doorways stay walkable while window holes stay blocked (glass).
 *
 * Local frame: the wall runs along +X from 0 to `length`; side A faces −Z,
 * side B faces +Z; base at y = 0. UVs are metres (u along the wall, v up).
 */
import type { MaterialSpec } from '@aether/core';
import { Geom, box } from './mesh';
import { PartSet } from './parts';
import type { WallOpening, WallParams } from './params';
import type { P2 } from './math2';
import type { ArchOutput } from './types';
import { buildNiche, extrudeProfile, freeStretches, nicheSpan, panelDetail, pictureRailSection, skirtingSection, usableNiches, type NicheSpec } from './wall-trim';

/** Skirting board height and projection (metres). */
export const SKIRTING_HEIGHT = 0.08;
export const SKIRTING_DEPTH = 0.012;
/** How far a wall face runs past a joined corner into its neighbour (metres), so the two faces overlap instead of meeting on a crack. */
export const CORNER_SEAM = 0.004;

/** An opening clipped to the wall: x range and y range. */
export interface OpeningSpan {
  kind: WallOpening['kind'];
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/**
 * Openings clipped to the wall (inside [0, length], below the top, at least
 * 2 cm of wall between neighbours; overlapping openings are merged).
 */
export function openingSpans(p: Pick<WallParams, 'length' | 'height' | 'openings'>): OpeningSpan[] {
  const spans: OpeningSpan[] = [];
  for (const o of p.openings) {
    const x0 = Math.max(0.02, o.offset - o.width / 2);
    const x1 = Math.min(p.length - 0.02, o.offset + o.width / 2);
    const y0 = Math.max(0, o.sill);
    const y1 = Math.min(p.height, o.sill + o.height);
    if (x1 - x0 < 0.05 || y1 - y0 < 0.05) continue;
    spans.push({ kind: o.kind, x0, x1, y0, y1 });
  }
  spans.sort((a, b) => a.x0 - b.x0);
  const merged: OpeningSpan[] = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s.x0 < last.x1 + 0.02) {
      last.x1 = Math.max(last.x1, s.x1);
      last.y0 = Math.min(last.y0, s.y0);
      last.y1 = Math.max(last.y1, s.y1);
      if (s.kind === 'door' || last.kind === 'door') last.kind = 'door';
    } else merged.push({ ...s });
  }
  return merged;
}

/** Solid vertical intervals of [0, h] in the x-strip (a, b) given the openings. */
function solidIntervals(spans: readonly OpeningSpan[], a: number, b: number, h: number, passableOnly = false): Array<[number, number]> {
  const holes: Array<[number, number]> = [];
  const mid = (a + b) / 2;
  for (const s of spans) {
    if (mid <= s.x0 || mid >= s.x1) continue;
    if (passableOnly && s.kind === 'window') continue;
    holes.push([s.y0, s.y1]);
  }
  holes.sort((p, q) => p[0] - q[0]);
  const out: Array<[number, number]> = [];
  let y = 0;
  for (const [h0, h1] of holes) {
    if (h0 > y + 1e-4) out.push([y, Math.min(h0, h)]);
    y = Math.max(y, h1);
  }
  if (y < h - 1e-4) out.push([y, h]);
  return out;
}

/** Sorted, de-duplicated x breakpoints of a face from xs0 to xs1. */
function breakpoints(spans: readonly OpeningSpan[], xs0: number, xs1: number): number[] {
  const xs = [xs0, xs1];
  for (const s of spans) {
    if (s.x0 > xs0 && s.x0 < xs1) xs.push(s.x0);
    if (s.x1 > xs0 && s.x1 < xs1) xs.push(s.x1);
  }
  xs.sort((p, q) => p - q);
  return xs.filter((x, i) => i === 0 || x - (xs[i - 1] as number) > 1e-5);
}

/** Clip a convex plan polygon to the x range [x0, x1]. */
export function clipConvexX(poly: readonly P2[], x0: number, x1: number): P2[] {
  const clip = (pts: readonly P2[], x: number, keepGreater: boolean): P2[] => {
    const out: P2[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i] as P2;
      const b = pts[(i + 1) % pts.length] as P2;
      const ina = keepGreater ? a[0] >= x : a[0] <= x;
      const inb = keepGreater ? b[0] >= x : b[0] <= x;
      if (ina) out.push(a);
      if (ina !== inb) {
        const t = (x - a[0]) / (b[0] - a[0]);
        out.push([x, a[1] + (b[1] - a[1]) * t]);
      }
    }
    return out;
  };
  return clip(clip(poly, x0, true), x1, false);
}

/** Material of the cut face of a sectioned wall (architectural poche). */
export const SECTION_CAP: Readonly<MaterialSpec> = Object.freeze({ finish: 'paint', color: '#2b2d31', roughness: 0.9 });

/** Build a wall (see the module docs). */
export function buildWall(p: WallParams): ArchOutput {
  const set = new PartSet();
  const L = p.length;
  const cut = p.cut !== undefined && p.cut < p.height ? p.cut : null;
  const H = cut ?? p.height;
  const t = p.thickness / 2;
  // A section fills window holes (the glass is hidden) and keeps doorways open.
  const spans = openingSpans({ length: L, height: H, openings: cut === null ? p.openings : p.openings.filter((o) => o.kind !== 'window') });
  const aStart = -p.startA;
  const aEnd = L + p.endA;
  const bStart = -p.startB;
  const bEnd = L + p.endB;
  const geomA = new Geom();
  const geomB = new Geom();
  const geomEdge = new Geom();
  const dadoGeomA = new Geom();
  const dadoGeomB = new Geom();
  // Details (panel moulding, picture rails, niches) are left out of exploded section cuts.
  const detail = cut === null;
  const nichesA = detail ? usableNiches((p.nichesA ?? []) as NicheSpec[], spans, L, H) : [];
  const nichesB = detail ? usableNiches((p.nichesB ?? []) as NicheSpec[], spans, L, H) : [];
  const skirtH = p.skirtingStyle ? Math.min(p.skirtingStyle.height, H) : SKIRTING_HEIGHT;

  // Side faces, tiled around openings (and the niches of that face); a dado splits each face at its height.
  const face = (g: Geom, xs0: number, xs1: number, side: -1 | 1, dado: { height: number; rail: boolean; geom: Geom; style: string; panels: number } | null, niches: readonly NicheSpec[]): void => {
    const fs = niches.length > 0 ? [...spans, ...niches.map(nicheSpan)] : spans;
    const xs = breakpoints(fs, xs0, xs1);
    const quad = (target: Geom, a: number, b: number, y0: number, y1: number): void => {
      if (side < 0) target.quadAuto([b, y0, -t], [a, y0, -t], [a, y1, -t], [b, y1, -t], -b, y0);
      else target.quadAuto([a, y0, t], [b, y0, t], [b, y1, t], [a, y1, t], a, y0);
    };
    const fullHeight = dado !== null && dado.height >= H - 0.01;
    const dh = dado ? (fullHeight ? H : Math.min(dado.height, H - 0.05)) : 0;
    for (let k = 0; k + 1 < xs.length; k++) {
      const a = xs[k] as number;
      const b = xs[k + 1] as number;
      for (const [y0, y1] of solidIntervals(fs, a, b, H)) {
        if (!dado || y0 >= dh) quad(g, a, b, y0, y1);
        else if (y1 <= dh) quad(dado.geom, a, b, y0, y1);
        else {
          quad(dado.geom, a, b, y0, dh);
          quad(g, a, b, dh, y1);
        }
      }
      // Chair rail: a small moulding standing off the face along the top of the dado.
      if (dado?.rail && b - a > 0.02) {
        const solidAtRail = solidIntervals(fs, a, b, H).some(([y0, y1]) => y0 <= dh && y1 >= dh - (fullHeight ? 0.05 : 0));
        if (solidAtRail) {
          const z0 = side < 0 ? -t - 0.018 : t;
          const z1 = side < 0 ? -t : t + 0.018;
          if (fullHeight) dado.geom.merge(box(a, dh - 0.05, z0, b, dh, z1, { bottom: true }));
          else dado.geom.merge(box(a, dh - 0.012, z0, b, dh + 0.028, z1, { bottom: true }));
        }
      }
    }
    if (dado && detail && dado.style !== 'flat') {
      dado.geom.merge(panelDetail({ style: dado.style as 'shaker', panels: dado.panels, side, t, x0: xs0, x1: xs1, top: dh, skirt: skirtH, rail: dado.rail, spans: fs }));
    }
  };
  // At a joined (mitred) end the faces run a few millimetres past the corner, into the neighbour: two faces that only
  // meet on a line leave sub-pixel cracks there, and with a dim room exposed up the bright sky sparkled through them.
  const joinedStart = p.startA !== 0 || p.startB !== 0 ? CORNER_SEAM : 0;
  const joinedEnd = p.endA !== 0 || p.endB !== 0 ? CORNER_SEAM : 0;
  face(geomA, aStart - joinedStart, aEnd + joinedEnd, -1, p.dadoA ? { height: p.dadoA.height, rail: p.dadoA.rail, geom: dadoGeomA, style: p.dadoA.style, panels: p.dadoA.panels } : null, nichesA);
  face(geomB, bStart - joinedStart, bEnd + joinedEnd, 1, p.dadoB ? { height: p.dadoB.height, rail: p.dadoB.rail, geom: dadoGeomB, style: p.dadoB.style, panels: p.dadoB.panels } : null, nichesB);
  // Niches: the recess itself (back, returns, shelves) in the niche colour, or in the wall's own finish.
  const nicheGeoms: Array<{ geom: Geom; color: string }> = [];
  const dadoTop = (d: { height: number } | undefined): number => (d ? (d.height >= H - 0.01 ? H : Math.min(d.height, H - 0.05)) : 0);
  for (const [list, side, faceGeom, dadoGeom, dado] of [[nichesA, -1, geomA, dadoGeomA, p.dadoA], [nichesB, 1, geomB, dadoGeomB, p.dadoB]] as const) {
    for (const n of list) {
      // A niche set inside the dado has its spandrels (arched head) in the dado's material.
      const wallGeom = n.sill + n.height <= dadoTop(dado) ? dadoGeom : faceGeom;
      if (n.color) {
        const slot = nicheGeoms.find((q) => q.color === n.color) ?? { geom: new Geom(), color: n.color };
        if (!nicheGeoms.includes(slot)) nicheGeoms.push(slot);
        buildNiche(wallGeom, slot.geom, n, side, t);
      } else buildNiche(wallGeom, wallGeom, n, side, t);
    }
  }

  // Reveals: jambs, head, sill (edge material = side A's).
  for (const s of spans) {
    geomEdge.quadAuto([s.x0, s.y0, t], [s.x0, s.y0, -t], [s.x0, s.y1, -t], [s.x0, s.y1, t], -t, s.y0);
    geomEdge.quadAuto([s.x1, s.y0, -t], [s.x1, s.y0, t], [s.x1, s.y1, t], [s.x1, s.y1, -t], -t, s.y0);
    if (s.y1 < H - 1e-4) geomEdge.quadAuto([s.x0, s.y1, -t], [s.x1, s.y1, -t], [s.x1, s.y1, t], [s.x0, s.y1, t], s.x0, -t);
    if (s.y0 > 1e-4) geomEdge.quadAuto([s.x0, s.y0, t], [s.x1, s.y0, t], [s.x1, s.y0, -t], [s.x0, s.y0, -t], s.x0, t);
  }

  // Top and bottom: the mitred footprint, minus full-height openings on top.
  const footprint: P2[] = [
    [aStart, -t],
    [aEnd, -t],
    [bEnd, t],
    [bStart, t],
  ];
  const topCuts = spans.filter((s) => s.y1 >= H - 1e-4).map((s) => [s.x0, s.x1] as [number, number]);
  const fx0 = Math.min(aStart, bStart);
  const fx1 = Math.max(aEnd, bEnd);
  let cursor = fx0;
  const topPieces: Array<[number, number]> = [];
  for (const [c0, c1] of topCuts) {
    if (c0 > cursor) topPieces.push([cursor, c0]);
    cursor = Math.max(cursor, c1);
  }
  if (cursor < fx1) topPieces.push([cursor, fx1]);
  const geomTop = cut === null ? geomEdge : new Geom();
  for (const [x0, x1] of topPieces) {
    const piece = clipConvexX(footprint, x0, x1);
    if (piece.length >= 3) geomTop.flatPolygon(piece, H, true);
  }
  // Bottom: visible in exploded views and from below.
  const bottomCuts = spans.filter((s) => s.y0 <= 1e-4).map((s) => [s.x0, s.x1] as [number, number]);
  cursor = fx0;
  for (const [c0, c1] of bottomCuts) {
    if (c0 > cursor) {
      const piece = clipConvexX(footprint, cursor, c0);
      if (piece.length >= 3) geomEdge.flatPolygon(piece, 0, false);
    }
    cursor = Math.max(cursor, c1);
  }
  if (cursor < fx1) {
    const piece = clipConvexX(footprint, cursor, fx1);
    if (piece.length >= 3) geomEdge.flatPolygon(piece, 0, false);
  }

  // End caps (hidden inside a neighbour when joined; they close free ends and exploded views).
  geomEdge.quadAuto([aStart, 0, -t], [bStart, 0, t], [bStart, H, t], [aStart, H, -t], 0, 0);
  geomEdge.quadAuto([bEnd, 0, t], [aEnd, 0, -t], [aEnd, H, -t], [bEnd, H, t], 0, 0);

  set.add(geomA, p.finishA);
  set.add(geomB, p.finishB);
  if (p.dadoA) set.add(dadoGeomA, p.dadoA.material);
  if (p.dadoB) set.add(dadoGeomB, p.dadoB.material);
  for (const q of nicheGeoms) set.add(q.geom, { finish: 'paint', color: q.color });
  set.add(geomEdge, p.finishA);
  if (geomTop !== geomEdge) set.add(geomTop, { ...SECTION_CAP });

  // Skirting boards, interrupted by doorways.
  if (p.skirting !== 'none') {
    const skirt = new Geom();
    const run = (xs0: number, xs1: number, side: -1 | 1): void => {
      const doors = spans.filter((s) => s.y0 <= 1e-4);
      let x = xs0;
      const pieces: Array<[number, number]> = [];
      for (const d of doors) {
        if (d.x0 > x) pieces.push([x, Math.min(d.x0, xs1)]);
        x = Math.max(x, d.x1);
      }
      if (x < xs1) pieces.push([x, xs1]);
      for (const [x0, x1] of pieces) {
        if (x1 - x0 < 0.03) continue;
        if (p.skirtingStyle) {
          extrudeProfile(skirt, x0, x1, side, t, skirtingSection(p.skirtingStyle.profile, skirtH, p.skirtingStyle.depth));
          continue;
        }
        const z0 = side < 0 ? -t - SKIRTING_DEPTH : t;
        const z1 = side < 0 ? -t : t + SKIRTING_DEPTH;
        skirt.merge(box(x0, 0, z0, x1, Math.min(SKIRTING_HEIGHT, H), z1, { bottom: false }));
      }
    };
    // Each run follows its face (mitred / trimmed ends), so inside corners meet cleanly.
    if (p.skirting === 'a' || p.skirting === 'both') run(aStart, aEnd, -1);
    if (p.skirting === 'b' || p.skirting === 'both') run(bStart, bEnd, 1);
    set.add(skirt, p.skirtingMaterial);
  }

  // Picture rails: a slim moulding along a face, broken where an opening reaches its height.
  if (detail) {
    for (const [rail, side, a0, a1] of [[p.railA, -1, aStart, aEnd], [p.railB, 1, bStart, bEnd]] as const) {
      if (!rail || rail.y > H - 0.03) continue;
      const g = new Geom();
      const y = rail.y - 0.0225;
      for (const [x0, x1] of freeStretches(spans, a0, a1, y, y + 0.045, 0)) extrudeProfile(g, x0, x1, side, t, pictureRailSection(), y);
      set.add(g, rail.material);
    }
  }

  // Plinth / base course: a band standing off one face from below the wall base up to its height, stopping at every
  // opening that reaches down into it (doorways, low picture windows) so it never covers glass or a threshold.
  if (p.base && cut === null) {
    const b = p.base;
    const side: -1 | 1 = b.side === 'a' ? -1 : 1;
    const xs0 = (side < 0 ? aStart : bStart) - b.depth;
    const xs1 = (side < 0 ? aEnd : bEnd) + b.depth;
    const top = Math.min(b.height, H);
    const gaps = spans.filter((s) => s.y0 < top - 1e-4).map((s) => [s.x0, s.x1] as [number, number]);
    const band = new Geom();
    let x = xs0;
    const pieces: Array<[number, number]> = [];
    for (const [g0, g1] of gaps) {
      if (g0 > x) pieces.push([x, Math.min(g0, xs1)]);
      x = Math.max(x, g1);
    }
    if (x < xs1) pieces.push([x, xs1]);
    for (const [x0, x1] of pieces) {
      if (x1 - x0 < 0.03) continue;
      const z0 = side < 0 ? -t - b.depth : t - 0.002;
      const z1 = side < 0 ? -t + 0.002 : t + b.depth;
      band.merge(box(x0, -b.drop, z0, x1, top, z1, { bottom: false }));
    }
    set.add(band, b.material);
  }

  // Colliders: solid parts along the centreline (window holes stay solid: glass blocks).
  const cx0 = Math.max(aStart, bStart, -t);
  const cx1 = Math.min(aEnd, bEnd, L + t);
  const xs = breakpoints(spans, Math.min(0, cx0), Math.max(L, cx1));
  for (let k = 0; k + 1 < xs.length; k++) {
    const a = xs[k] as number;
    const b = xs[k + 1] as number;
    if (b - a < 0.01) continue;
    for (const [y0, y1] of solidIntervals(spans, a, b, H, true)) {
      if (y1 - y0 < 0.01) continue;
      set.boxMinMax(a, y0, -t, b, y1, t);
    }
  }
  return set.build();
}

/** Material of a wall side as stored (for views that recolour walls). */
export function wallSideMaterial(p: WallParams, side: 'a' | 'b'): MaterialSpec {
  return side === 'a' ? p.finishA : p.finishB;
}
