/**
 * Advisory evidence about the inventory objects, measured from the built room: where each object's built pieces project
 * in the photo's camera against the box the photo gives, and the scene relations of the piece (height off the floor,
 * distance to the wall, gaps to its neighbours). Written next to the object as a hint for the judges and the fixing model;
 * nothing here passes or fails an object.
 */
import { PHOTO_BUILDING_ID } from '@aether/arch/photo';
import { entityGeometry, projectGeometry, readScene, type EntityGeometry, type ImageBox, type ReviewPose } from '@aether/arch';
import type { WorldDoc } from '@aether/core';
import { boxCentre, boxIou, type Box, type InventoryItem, type ObjectLedger } from './objects';
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

export function projectBuilt(world: WorldDoc, pose: ReviewPose, aspect: number): Projection {
  const geometry = entityGeometry(world, PHOTO_BUILDING_ID);
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
