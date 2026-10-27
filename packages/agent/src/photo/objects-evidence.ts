/**
 * Advisory evidence about the inventory objects, measured from the built room: where each object's built pieces project
 * in the photo's camera against the box the photo gives, and the scene relations of the piece (height off the floor,
 * distance to the wall, gaps to its neighbours). Written next to the object as a hint for the judges and the fixing model;
 * nothing here passes or fails an object.
 */
import { PHOTO_BUILDING_ID } from '@aether/arch/photo';
import { entityGeometry, planDeltaOfWorld, planDelta, projectGeometry, readScene, renderInstanceIds, unprojectToPlane, type EntityGeometry, type ImageBox, type ReviewPose } from '@aether/arch';
import type { Vec3, WorldDoc } from '@aether/core';
import { boxCentre, boxIou, openAspects, type Box, type InventoryItem, type ObjectLedger } from './objects';
import type { Raster } from './score';

const m2 = (v: number): string => (Math.round(v * 100) / 100).toString();

/** The built pieces as a list for the first inventory seat: id, kind, place, size. */
export function builtPiecesText(world: WorldDoc, limit = 70): string {
  const scene = readScene(world, PHOTO_BUILDING_ID);
  if (!scene) return '';
  const lines: string[] = [];
  for (const r of scene.rooms) {
    for (const w of r.walls) {
      for (const o of w.openings) lines.push(`- ${o.id}: ${o.kind} on the ${w.compass} wall`);
    }
  }
  for (const it of scene.items) {
    const place = it.wall ? `on the ${it.wall.compass} wall at ${m2(it.wall.t)} m along, ${m2(it.y0)} m up` : `at x ${m2(it.pos[0])}, z ${m2(it.pos[2])}${it.against && it.against.length > 0 ? `, against the ${it.against.map((a) => a.compass).join('/')} wall` : ''}`;
    lines.push(`- ${it.id}: ${it.kind}${it.name && it.name !== it.kind ? ` (${it.name})` : ''}, ${place}, ${m2(it.size[0])} x ${m2(it.size[1])} x ${m2(it.size[2])} m`);
  }
  return lines.slice(0, limit).join('\n');
}

/** Ids of the entities the inventory may link to (built pieces and openings). */
export function knownEntityIds(world: WorldDoc): Set<string> {
  const scene = readScene(world, PHOTO_BUILDING_ID);
  const ids = new Set<string>();
  if (!scene) return ids;
  for (const it of scene.items) ids.add(it.id);
  for (const r of scene.rooms) for (const w of r.walls) for (const o of w.openings) ids.add(o.id);
  for (const id of Object.keys(world.entities)) if (id.startsWith(PHOTO_BUILDING_ID + '-')) ids.add(id);
  return ids;
}

function unionBox(boxes: readonly ImageBox[]): Box | null {
  if (boxes.length === 0) return null;
  return [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])), Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3]))];
}

/** The round's geometry: projected box per entity through the photo camera. */
export interface Projection {
  geometry: EntityGeometry[];
  boxes: Map<string, ImageBox>;
  pose: ReviewPose;
  aspect: number;
}

export { renderInstanceIds };

/** The world displacement that moves a point on the floor (through the point's own height) to where the photo shows it; null when the ray misses. */
export function worldShiftOnFloor(pose: ReviewPose, aspect: number, anchor: Vec3, target: readonly [number, number]): Vec3 | null {
  return worldShiftFor(pose, aspect, anchor, target, 'floor');
}

export function projectBuilt(world: WorldDoc, pose: ReviewPose, aspect: number, building: string = PHOTO_BUILDING_ID): Projection {
  const geometry = entityGeometry(world, building);
  return { geometry, boxes: projectGeometry(geometry, pose, aspect), pose, aspect };
}

/**
 * Link objects the first seat gave no piece for to the built piece that projects onto their box (overlap of at least 0.35,
 * the best overlap wins, one piece to one object). A link made this way is marked `projection`: a hint, the judges decide
 * whether the piece is the right one.
 */
export function autoLink(ledger: ObjectLedger, proj: Projection): number {
  const taken = new Set<string>();
  for (const r of ledger.list()) for (const e of r.item.entities) taken.add(e);
  const cands: Array<{ id: string; entity: string; iou: number }> = [];
  for (const r of ledger.list()) {
    if (r.item.entities.length > 0 || r.item.category === 'structure' || r.item.category === 'view') continue;
    for (const [entity, b] of proj.boxes) {
      if (taken.has(entity)) continue;
      const iou = boxIou(r.item.box, b);
      if (iou >= 0.35) cands.push({ id: r.item.id, entity, iou });
    }
  }
  cands.sort((a, b) => b.iou - a.iou);
  let n = 0;
  const done = new Set<string>();
  for (const c of cands) {
    if (done.has(c.id) || taken.has(c.entity)) continue;
    const rec = ledger.get(c.id);
    if (!rec) continue;
    rec.item = { ...rec.item, entities: [c.entity], linkedBy: 'projection' };
    done.add(c.id);
    taken.add(c.entity);
    n++;
  }
  return n;
}

/** The projected box of an object's built pieces (null: not built, or out of frame). */
export function projectedBox(item: InventoryItem, proj: Projection): Box | null {
  return unionBox(item.entities.map((e) => proj.boxes.get(e)).filter((b): b is ImageBox => b !== undefined));
}

/** The advisory line of one object. '' when it has no built piece. */
export function objectEvidence(world: WorldDoc, item: InventoryItem, proj: Projection, px: { w: number; h: number }): string {
  if (item.entities.length === 0) return item.category === 'structure' || item.category === 'view' ? '' : 'no built piece is linked to this object (it may be missing, or the link is unknown).';
  const parts: string[] = [];
  const box = projectedBox(item, proj);
  if (!box) parts.push('its built piece is out of the camera frame or hidden');
  else {
    const [cx, cy] = boxCentre(box);
    const [wx, wy] = boxCentre(item.box);
    const dx = Math.round((cx - wx) * px.w);
    const dy = Math.round((cy - wy) * px.h);
    const rw = (box[2] - box[0]) / Math.max(0.01, item.box[2] - item.box[0]);
    const rh = (box[3] - box[1]) / Math.max(0.01, item.box[3] - item.box[1]);
    parts.push(`its built piece projects ${Math.abs(dx)} px ${dx >= 0 ? 'right' : 'left'} and ${Math.abs(dy)} px ${dy >= 0 ? 'below' : 'above'} the photo box centre (error ${Math.round(Math.hypot(dx, dy))} px), width ${m2(rw)}x and height ${m2(rh)}x of the photo box`);
  }
  const scene = readScene(world, PHOTO_BUILDING_ID);
  const pieces = scene?.items.filter((i) => item.entities.includes(i.id)) ?? [];
  const first = pieces[0];
  if (scene && first) {
    const bits: string[] = [`${m2(first.size[0])} x ${m2(first.size[1])} x ${m2(first.size[2])} m`, `${m2(first.y0)} m off the floor`];
    if (first.wall) bits.push(`on the ${first.wall.compass} wall at ${m2(first.wall.t)} m along`);
    else if (first.against && first.against.length > 0) bits.push(`${first.against.map((a) => `${m2(a.gap)} m from the ${a.compass} wall`).join(', ')}`);
    const fp = (i: { footprint: Array<[number, number]> }): [number, number, number, number] => {
      const xs = i.footprint.map((p) => p[0]);
      const ys = i.footprint.map((p) => p[1]);
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    };
    const a = fp(first as unknown as { footprint: Array<[number, number]> });
    const gaps = scene.items
      .filter((o) => o.id !== first.id && !o.wall)
      .map((o) => {
        const b = fp(o as unknown as { footprint: Array<[number, number]> });
        const gx = Math.max(0, Math.max(a[0], b[0]) - Math.min(a[2], b[2]));
        const gy = Math.max(0, Math.max(a[1], b[1]) - Math.min(a[3], b[3]));
        return { id: o.id, gap: Math.hypot(gx, gy) };
      })
      .sort((x, y) => x.gap - y.gap)
      .slice(0, 2)
      .filter((g) => g.gap < 1.5);
    if (!first.wall && gaps.length > 0) bits.push(`gap ${gaps.map((g) => `${m2(g.gap)} m to ${g.id.replace(`${PHOTO_BUILDING_ID}-`, '')}`).join(', ')}`);
    parts.push(`in the room it is ${bits.join(', ')}`);
  }
  return `${parts.join('; ')}.`;
}

/** The evidence of every linked object, for the text the fixing model reads. */
export function evidenceMap(world: WorldDoc, ledger: ObjectLedger, proj: Projection, px: { w: number; h: number }): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of ledger.list()) {
    const e = objectEvidence(world, r.item, proj, px);
    if (e) out.set(r.item.id, e);
  }
  return out;
}

/** Coarse colours of the box in a raster: a 6 x 6 grid of mean RGB. What "this part of the render changed" is told from. */
export function boxSignature(r: Raster, box: Box, grid = 6): number[] {
  const out: number[] = [];
  const x0 = Math.floor(box[0] * r.width);
  const y0 = Math.floor(box[1] * r.height);
  const w = Math.max(1, Math.floor((box[2] - box[0]) * r.width));
  const h = Math.max(1, Math.floor((box[3] - box[1]) * r.height));
  for (let gy = 0; gy < grid; gy++) {
    for (let gx = 0; gx < grid; gx++) {
      const sx0 = x0 + Math.floor((gx * w) / grid);
      const sx1 = Math.max(sx0 + 1, x0 + Math.floor(((gx + 1) * w) / grid));
      const sy0 = y0 + Math.floor((gy * h) / grid);
      const sy1 = Math.max(sy0 + 1, y0 + Math.floor(((gy + 1) * h) / grid));
      let rr = 0;
      let gg = 0;
      let bb = 0;
      let n = 0;
      for (let y = sy0; y < sy1 && y < r.height; y++) {
        for (let x = sx0; x < sx1 && x < r.width; x++) {
          const o = (y * r.width + x) * 4;
          rr += r.data[o] as number;
          gg += r.data[o + 1] as number;
          bb += r.data[o + 2] as number;
          n++;
        }
      }
      out.push(n === 0 ? 0 : Math.round(rr / n), n === 0 ? 0 : Math.round(gg / n), n === 0 ? 0 : Math.round(bb / n));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------- residual and suggested correction

/**
 * The world displacement that brings `anchor` (a point of the piece) under the picture point `target` (x, y in 0..1), moving it
 * only inside a plane through the anchor: the floor (horizontal) for pieces that stand, or a vertical plane (`normal`) for pieces
 * on a wall. The ray through the target is unprojected onto that plane, so the answer uses the piece's own depth.
 */
export function worldShiftFor(pose: ReviewPose, aspect: number, anchor: Vec3, target: readonly [number, number], plane: 'floor' | { normal: Vec3 }): Vec3 | null {
  const normal: Vec3 = plane === 'floor' ? [0, 1, 0] : plane.normal;
  const hit = unprojectToPlane(pose, aspect, target[0], target[1], { point: anchor, normal });
  return hit ? [hit[0] - anchor[0], hit[1] - anchor[1], hit[2] - anchor[2]] : null;
}

/** How far the projected piece is from the inventory box, and how its size compares. */
export interface Residual {
  /** Pixels between the centres of the two boxes. */
  errPx: number;
  /** Centre offset as a share of the frame (positive: the render is right of / below the photo). */
  offPct: [number, number];
  /** Photo box size over render box size (above 1: the render is smaller). */
  sw: number;
  sh: number;
}

export function residualOf(item: InventoryItem, proj: Projection, px: { w: number; h: number }): Residual | null {
  const box = projectedBox(item, proj);
  if (!box) return null;
  const [cx, cy] = boxCentre(box);
  const [wx, wy] = boxCentre(item.box);
  const dx = (cx - wx) * px.w;
  const dy = (cy - wy) * px.h;
  return {
    errPx: Math.round(Math.hypot(dx, dy)),
    offPct: [Math.round((cx - wx) * 100), Math.round((cy - wy) * 100)],
    sw: Math.round(((item.box[2] - item.box[0]) / Math.max(0.01, box[2] - box[0])) * 100) / 100,
    sh: Math.round(((item.box[3] - item.box[1]) / Math.max(0.01, box[3] - box[1])) * 100) / 100,
  };
}

const r2 = (v: number): number => Math.round(v * 100) / 100;
const signed = (v: number): string => `${v >= 0 ? '+' : ''}${r2(v)}`;

/**
 * A suggested correction for a linked piece, in metres in the building's plan axes (x east, z south), from the inventory box and the
 * piece's own depth: a standing piece is moved on the floor so that the bottom centre of its box lands on the photo's; a wall piece
 * is moved within its wall plane so that the centre lands on the photo's. Also the scale that would match the box. Advisory.
 */
export function suggestCorrection(world: WorldDoc, item: InventoryItem, proj: Projection, px: { w: number; h: number }): string {
  const geo = proj.geometry.filter((g) => item.entities.includes(g.id));
  const pts = geo.flatMap((g) => g.pts);
  const res = residualOf(item, proj, px);
  if (pts.length === 0 || !res) return '';
  const lo: Vec3 = [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.min(...pts.map((p) => p[2]))];
  const hi: Vec3 = [Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[2]))];
  const scene = readScene(world, PHOTO_BUILDING_ID);
  const piece = scene?.items.find((i) => item.entities.includes(i.id));
  const wall = piece?.wall ? scene?.rooms.flatMap((r) => r.walls).find((w) => w.room === piece.wall?.room && w.edge === piece.wall?.edge) : undefined;
  const lines: string[] = [];
  let plan: [number, number] | null = null;
  let dy = 0;
  if (wall) {
    const anchor: Vec3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
    const n = planDelta(world, PHOTO_BUILDING_ID, wall.out);
    const shift = n ? worldShiftFor(proj.pose, proj.aspect, anchor, boxCentre(item.box), { normal: [n[0], 0, n[2]] }) : null;
    const pd = shift ? planDeltaOfWorld(world, PHOTO_BUILDING_ID, shift) : null;
    if (shift && pd) {
      plan = pd;
      dy = shift[1];
      const along = pd[0] * wall.dir[0] + pd[1] * wall.dir[1];
      lines.push(`on the ${wall.compass} wall: ${signed(along)} m along the wall (t from ${piece?.wall ? r2(piece.wall.t) : '?'} to ${piece?.wall ? r2(piece.wall.t + along) : '?'}), ${signed(dy)} m in height (now ${r2(piece?.y0 ?? lo[1])} m off the floor)`);
    }
  } else {
    const anchor: Vec3 = [(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2];
    const shift = worldShiftFor(proj.pose, proj.aspect, anchor, [(item.box[0] + item.box[2]) / 2, item.box[3]], 'floor');
    const pd = shift ? planDeltaOfWorld(world, PHOTO_BUILDING_ID, shift) : null;
    if (shift && pd) {
      plan = pd;
      lines.push(`move ${signed(pd[0])} m in x (east) and ${signed(pd[1])} m in z (south)${piece ? `, from at [${r2(piece.pos[0])}, ${r2(piece.pos[2])}] to at [${r2(piece.pos[0] + pd[0])}, ${r2(piece.pos[2] + pd[1])}]` : ''} so the base of the piece lands where the photo's box ends (the box may be cut by something in front)`);
    }
  }
  const scale: string[] = [];
  if (res.sw < 0.85 || res.sw > 1.18) scale.push(`width x${res.sw}`);
  if (res.sh < 0.85 || res.sh > 1.18) scale.push(`height x${res.sh}`);
  if (scale.length > 0) lines.push(`scale ${scale.join(', ')}`);
  if (!plan && scale.length === 0) return '';
  return `suggested correction (advisory, unprojected through the photo camera at the piece's own depth): ${lines.join('; ')}`;
}

/** The one-line residual of an object: where its piece is in the picture against the photo's box. */
export function residualLine(item: InventoryItem, r: Residual | null): string {
  if (!r) return `${item.label}: its piece is out of the frame or hidden`;
  return `${item.label}: render box ${Math.abs(r.offPct[0])}% ${r.offPct[0] >= 0 ? 'right' : 'left'} and ${Math.abs(r.offPct[1])}% ${r.offPct[1] >= 0 ? 'below' : 'above'} the photo box (${r.errPx} px), size ${r.sw}x width and ${r.sh}x height of the render`;
}

/** Evidence of the objects whose position or size still fails: the base evidence plus the suggested correction. */
export function repairEvidence(world: WorldDoc, ledger: ObjectLedger, proj: Projection, px: { w: number; h: number }): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of ledger.list()) {
    const open = openAspects(r);
    if (!open.includes('position') && !open.includes('size')) continue;
    const parts = [objectEvidence(world, r.item, proj, px), suggestCorrection(world, r.item, proj, px)].filter((x) => x.length > 0);
    if (parts.length > 0) out.set(r.item.id, parts.join(' '));
  }
  return out;
}
