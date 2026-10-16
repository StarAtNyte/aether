/**
 * Real-world priors applied to a room description before it is built.
 *
 * A vision model measures from a flat picture, so its numbers are plausible but sometimes break what is true of every
 * room: a socket at eye height, a picture hung into the ceiling, two pieces on one wall standing in each other, a
 * "palm frond" built as a whole fig tree, a window sill below the floor of the next storey. These are the structural
 * errors that kept the first pass from its bar, and they repeat, so they are repaired here, once, for every photo.
 *
 * Each repair is small, moves a value only as far as the prior needs, and is reported ("fixes") so the user and the
 * model can see what was changed and why. Nothing here invents a piece or removes one the photo showed.
 */
import { furnitureByKind, furnitureSize } from '../furniture/index';
import type { Json } from '@aether/core';
import type { PhotoItem, PhotoOpening, RoomDescription } from './description';

/** Metres: usual heights of wall fittings above the floor (centre-bottom of the plate), min and max. */
const FITTING_BOTTOM: Readonly<Record<string, readonly [number, number, number]>> = {
  // [typical, min, max]
  switch: [1.1, 0.9, 1.4],
  socket: [0.3, 0.15, 0.5],
};

const round2 = (v: number): number => Math.round(v * 100) / 100;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

type Wall = 'north' | 'south' | 'east' | 'west';

function wallLength(d: RoomDescription, wall: Wall): number {
  return wall === 'north' || wall === 'south' ? d.footprint.width : d.footprint.depth;
}

function widthOf(it: PhotoItem): number {
  const def = furnitureByKind(it.kind);
  if (!def) return 0.5;
  const w = it.params['width'];
  if (typeof w === 'number' && Number.isFinite(w) && w > 0) return w;
  return furnitureSize(def, it.params as Record<string, Json>)[0];
}

/** Repairs of the openings: sills and heights that cannot be true. */
function repairOpenings(d: RoomDescription, fixes: string[]): PhotoOpening[] {
  const ceiling = d.footprint.ceiling;
  return d.openings.map((o) => {
    let { sill, height } = o;
    let glow = o.glow;
    if (o.kind === 'window') {
      if (glow === undefined && /glow|sunlit|sun-lit|overexpos|blown|bright(ly)? lit|backlit|light (streaming|pouring|flooding)/.test(`${o.note}`.toLowerCase())) {
        glow = true;
        fixes.push(`window ${o.id}: described as glowing; the daylight beyond the glass is lit`);
      }
      if (sill !== undefined && sill > 0 && sill < 0.08) {
        fixes.push(`window ${o.id}: a sill of ${round2(sill)} m is a floor-length window; sill set to 0`);
        sill = 0;
      }
      if (height !== undefined && sill !== undefined && sill + height < 0.9) {
        fixes.push(`window ${o.id}: ends ${round2(sill + height)} m above the floor, below any real window head; raised to 1.2 m tall`);
        height = 1.2;
      }
    } else if (o.kind === 'door') {
      if (height !== undefined && (height < 1.8 || height > 2.6)) {
        const h = clamp(height, 1.9, Math.min(2.5, ceiling - 0.1));
        fixes.push(`door ${o.id}: ${round2(height)} m tall is not a door height; set to ${round2(h)} m`);
        height = h;
      }
    }
    return { ...o, ...(sill !== undefined ? { sill } : {}), ...(height !== undefined ? { height } : {}), ...(glow !== undefined ? { glow } : {}) };
  });
}

/** Repairs of one piece. */
function repairItem(d: RoomDescription, it: PhotoItem, fixes: string[], ids: ReadonlySet<string>): PhotoItem {
  let { kind, bottom, aboveGap } = it;
  const params: Record<string, string | number | boolean> = { ...it.params };
  const label = `${kind} ${it.id}`;
  const ceiling = d.footprint.ceiling;
  const text = `${it.label} ${it.id}`.toLowerCase();

  if (kind === 'switch') {
    const isSocket = /socket|outlet|plug/.test(text);
    const [typ, lo, hi] = FITTING_BOTTOM[isSocket ? 'socket' : 'switch'] as readonly [number, number, number];
    const b = bottom ?? typ;
    const c = clamp(b, lo, hi);
    if (bottom === undefined || Math.abs(c - b) > 0.005) {
      fixes.push(`${label}: ${isSocket ? 'sockets' : 'switches'} sit ${lo}-${hi} m above the floor; ${bottom === undefined ? 'height' : `${round2(b)} m`} set to ${round2(c)} m`);
      bottom = c;
    }
  }
  if (kind === 'art' || kind === 'mirror') {
    const h = typeof params['height'] === 'number' ? params['height'] : 1;
    if (bottom !== undefined) {
      const maxBottom = ceiling - 0.2 - h;
      const b = clamp(bottom, Math.min(0.5, Math.max(0, maxBottom)), Math.max(0.5, maxBottom));
      if (Math.abs(b - bottom) > 0.005) {
        fixes.push(`${label}: hung ${round2(bottom)} m up, ${h} m tall under a ${ceiling} m ceiling; bottom set to ${round2(b)} m`);
        bottom = b;
      }
    }
    if (aboveGap !== undefined && (aboveGap < 0.08 || aboveGap > 0.7)) {
      const g = clamp(aboveGap, 0.08, 0.7);
      fixes.push(`${label}: hung ${round2(aboveGap)} m above its piece; a picture hangs ${0.08}-${0.7} m above furniture, set to ${round2(g)} m`);
      aboveGap = g;
    }
    const w = typeof params['width'] === 'number' ? params['width'] : 0.8;
    if (h > 0.2 && (h > 2.2 || w > 3)) fixes.push(`${label}: ${w} x ${h} m is very large for a picture; check the photo`);
  }
  if (kind === 'plant') {
    const sp = typeof params['species'] === 'string' ? params['species'] : 'fig';
    if (/frond|palm|fern|leaves|branch/.test(text) && sp === 'fig') {
      params['species'] = 'palm';
      fixes.push(`${label}: described as fronds, built as a palm (a fig would be a whole tree)`);
    }
    const hgt = typeof params['height'] === 'number' ? params['height'] : 1.4;
    if (/(single|one|a) frond\b|cutting|in a vase/.test(text) && hgt > 0.9) {
      params['height'] = 0.6;
      fixes.push(`${label}: a frond is not a whole plant; height set to 0.6 m`);
    }
    if (hgt > ceiling - 0.3) {
      params['height'] = round2(ceiling - 0.4);
      fixes.push(`${label}: ${round2(hgt)} m tall under a ${ceiling} m ceiling; set to ${round2(ceiling - 0.4)} m`);
    }
  }
  if (kind === 'rug' && params['pattern'] === undefined) {
    if (/zig-?zag|chevron/.test(text)) {
      params['pattern'] = 'zigzag';
      fixes.push(`${label}: a zigzag rug is built with chevron bands`);
    } else if (/stripe/.test(text)) {
      params['pattern'] = 'stripes';
      fixes.push(`${label}: a striped rug is built with bands`);
    }
  }
  if (kind === 'bed') {
    const set = (k: string, v: string | number | boolean, why: string): void => {
      if (params[k] === undefined) {
        params[k] = v;
        fixes.push(`${label}: ${why}`);
      }
    };
    if (params['throw'] === undefined) {
      // The part's own throw is a brown blanket: a bed the photo shows with plain linen has no contrasting runner.
      params['throw'] = typeof params['linen'] === 'string' ? params['linen'] : '#f1eee8';
      fixes.push(`${label}: no throw blanket was described; the folded throw takes the colour of the linen instead of the library's brown`);
    }
    if (/four[- ]?poster|canopy|posts/.test(text)) set('canopy', true, 'the photo shows a four-poster; posts and a top frame added');
    if (/tufted|quilted|diamond|button/.test(text)) set('headboardStyle', 'tufted', 'a quilted headboard is built as a diamond-tufted panel');
    else if (/slat|timber headboard|wooden headboard/.test(text)) set('headboardStyle', 'slats', 'a timber headboard is built as slats');
    else if (/panel|tall headboard|floating/.test(text)) set('headboardStyle', 'panel', 'a tall panel headboard is built as a panel');
    if (/floral|flower|botanical|leaf print|leaves print/.test(text)) set('pattern', 'floral', 'a floral duvet is printed, not a flat colour');
    else if (/stripe/.test(text)) set('pattern', 'stripe', 'a striped duvet is printed, not a flat colour');
    else if (/damask|patterned|pattern/.test(text)) set('pattern', 'damask', 'a patterned duvet is printed, not a flat colour');
  }
  if (kind === 'nightstand' && params['style'] === undefined) {
    if (/wire|metal frame|tray|open frame/.test(text)) {
      params['style'] = 'wire';
      fixes.push(`${label}: a wire-frame side table is built as one (round tray top on a slim frame)`);
    } else if (/round|pedestal|tripod|drum/.test(text)) {
      params['style'] = 'round';
      fixes.push(`${label}: a round side table is built as one`);
    }
  }
  if (kind === 'curtain') {
    const h = typeof params['height'] === 'number' ? params['height'] : undefined;
    if (h !== undefined && h > ceiling - 0.02) {
      params['height'] = round2(ceiling - 0.05);
      fixes.push(`${label}: ${round2(h)} m is taller than the room; set to ${round2(ceiling - 0.05)} m`);
    }
  }
  if (kind === 'tv-set' && (!it.on || !ids.has(it.on)) && it.wall && it.along !== undefined) {
    // A television with no piece to stand on is a wall-mounted one (it cannot float on nothing).
    kind = 'tv';
    bottom = bottom !== undefined ? clamp(bottom, 0.6, ceiling - 0.9) : 1.0;
    fixes.push(`${label}: stands on no piece of the room, so it is built as a wall-mounted TV at ${round2(bottom)} m`);
  }
  if (kind === 'tv') {
    const inches = typeof params['inches'] === 'number' ? params['inches'] : 55;
    params['inches'] = clamp(inches, 32, 100);
  }
  if (kind === 'tv-set') {
    const inches = typeof params['inches'] === 'number' ? params['inches'] : 22;
    if (inches > 75) {
      params['inches'] = 65;
      fixes.push(`${label}: ${inches} inches is not a home television; set to 65`);
    }
  }
  if (kind === 'bed' && it.wall && it.along !== undefined) {
    // A bed is a standard width (handled by its size param); keep it inside its wall.
    const half = widthOf({ ...it, params: params as PhotoItem['params'] }) / 2;
    const len = wallLength(d, it.wall);
    if (half * 2 < len && (it.along < half || it.along > len - half)) {
      const c = clamp(it.along, half, len - half);
      fixes.push(`${label}: its centre ${round2(it.along)} m put the bed through a corner of the ${it.wall} wall; moved to ${round2(c)} m`);
      return { ...it, kind, params, ...(bottom !== undefined ? { bottom } : {}), ...(aboveGap !== undefined ? { aboveGap } : {}), along: c };
    }
  }
  return { ...it, kind, params, ...(bottom !== undefined ? { bottom } : {}), ...(aboveGap !== undefined ? { aboveGap } : {}) };
}

/**
 * Pieces that stand against one wall may not stand in each other: when two overlap along the wall, the smaller one is
 * moved away from the larger (towards the nearer corner side it already leans to), as little as it takes plus a
 * finger's gap, and not past the wall's end. A piece that cannot be moved clear is left where it was (the builder then
 * reports the refusal to the compare loop).
 */
function separateAlongWalls(d: RoomDescription, items: PhotoItem[], fixes: string[]): PhotoItem[] {
  const out = items.map((i) => ({ ...i }));
  for (const wall of ['north', 'south', 'east', 'west'] as const) {
    const len = wallLength(d, wall);
    const onWall = out
      .filter((i) => {
        const def = furnitureByKind(i.kind);
        return def?.mount === 'floor' && i.wall === wall && i.along !== undefined && (i.gap ?? 0.02) <= 0.15;
      })
      .sort((a, b) => widthOf(b) - widthOf(a));
    const placed: PhotoItem[] = [];
    for (const it of onWall) {
      const w = widthOf(it);
      let c = it.along as number;
      for (const other of placed) {
        const ow = widthOf(other);
        const oc = other.along as number;
        const need = (w + ow) / 2 + 0.03;
        const dist = c - oc;
        if (Math.abs(dist) < need - 1e-6) {
          const dir = dist === 0 ? (oc > len / 2 ? -1 : 1) : Math.sign(dist);
          const moved = oc + dir * need;
          if (moved - w / 2 >= -1e-6 && moved + w / 2 <= len + 1e-6) c = moved;
        }
      }
      if (Math.abs(c - (it.along as number)) > 0.005) {
        fixes.push(`${it.kind} ${it.id}: stood in another piece on the ${wall} wall; moved ${round2(Math.abs(c - (it.along as number)))} m along the wall`);
        it.along = round2(c);
      }
      placed.push(it);
    }
  }
  return out;
}

/** What {@link applyReality} gives back. */
export interface RealityResult {
  description: RoomDescription;
  /** Each repair in words. */
  fixes: string[];
}

/**
 * Apply the real-world priors to a (validated) description. Pure: the input is not changed. Camera values are bounded to
 * what a handheld photo can be.
 */
export function applyReality(d: RoomDescription): RealityResult {
  const fixes: string[] = [];
  const openings = repairOpenings(d, fixes);
  const items = separateAlongWalls(
    d,
    d.items.map((it) => repairItem(d, it, fixes, new Set(d.items.map((x) => x.id)))),
    fixes,
  );
  let camera = d.camera;
  if (camera.height < 0.5 || camera.height > 2.1) {
    const h = clamp(camera.height, 0.5, 2.1);
    fixes.push(`camera: an eye height of ${round2(camera.height)} m is not a handheld photo; set to ${round2(h)} m`);
    camera = { ...camera, height: h };
  }
  return { description: { ...d, openings, items, camera }, fixes };
}
