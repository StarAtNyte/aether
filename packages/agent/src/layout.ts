/**
 * Layout of repeated pieces for worlds made of free pieces (halls, theatres, classrooms, restaurants, naves, libraries):
 *
 * - `grid`: a block of rows and columns of one generator with optional aisles, as one instanced scatter entity;
 * - `tier`: a raked auditorium, i.e. the stepped floor plus the seats standing on it, each row at the height of its step,
 *   the rise of the steps solved from a sightline to the bottom of the screen (every row sees over the heads in front),
 *   with optional aisles and step lights along them.
 *
 * Both return plain patches (one entity per kind of thing), so a 12 x 10 seat block is one scatter of 120 points sharing one
 * geometry, not 120 meshes. The model decides what, where and how big; this code only does the measuring.
 */
import { furnitureById, furnitureByKind, furnitureSize, tierHeights, TIER_BASE } from '@aether/arch';
import type { Json, PatchInput, WorldDoc } from '@aether/core';
import { Builder, r2, type Mood } from './providers/mock/builder';

const CALM: Mood = { night: false, dusk: false, dawn: false, rain: false, snow: false, fog: false, lowGravity: false, water: false };

/** Directions the pieces look towards (north is -Z, east +X), or a yaw in degrees (0 faces +Z). */
export type Facing = 'north' | 'south' | 'east' | 'west' | number;

const FACING_YAW: Record<string, number> = { south: 0, east: 90, north: 180, west: 270 };

/** Entity yaw (degrees about Y) that turns a piece whose front is +Z to look towards `facing`. */
export function facingYaw(facing: Facing): number {
  return typeof facing === 'number' ? facing : (FACING_YAW[facing] ?? 180);
}

/** World position of a point (x across the front, z along the facing axis) of a layout centred at `at` and turned by `yaw`. */
function toWorld(at: readonly [number, number], yawDeg: number, x: number, z: number): [number, number] {
  const a = (yawDeg * Math.PI) / 180;
  return [at[0] + x * Math.cos(a) + z * Math.sin(a), at[1] - x * Math.sin(a) + z * Math.cos(a)];
}

/** Columns split into blocks by `aisles` equal gaps: local x of each column, centred on 0, and the total width. */
function columnsX(cols: number, pitch: number, aisles: number, aisleWidth: number): { xs: number[]; width: number; aisleX: number[] } {
  const n = Math.max(0, Math.min(aisles, cols - 1));
  const blocks = n + 1;
  const base = Math.floor(cols / blocks);
  const extra = cols % blocks;
  const counts = Array.from({ length: blocks }, (_, b) => base + (b < extra ? 1 : 0));
  const total = cols * pitch + n * aisleWidth;
  const xs: number[] = [];
  const aisleX: number[] = [];
  let x = -total / 2;
  counts.forEach((c, b) => {
    for (let i = 0; i < c; i++) {
      xs.push(x + pitch / 2);
      x += pitch;
    }
    if (b < counts.length - 1) {
      aisleX.push(x + aisleWidth / 2);
      x += aisleWidth;
    }
  });
  return { xs, width: total, aisleX };
}

/** A generator id from what the model wrote: the id itself, else a crafted part's kind or alias ("chair", "painting", "theatre seat"). */
export function resolveGenerator(of: string, known: (id: string) => boolean): string | undefined {
  if (known(of)) return of;
  return furnitureByKind(of.replace(/^furn-/, '').replace(/-/g, ' '))?.id ?? furnitureByKind(of)?.id;
}

/** The footprint of a generator's default piece (width along X, height, depth), when it is a crafted part. */
function pieceSize(of: string, params: Record<string, Json> | undefined): [number, number, number] | undefined {
  const def = furnitureById(of);
  return def ? furnitureSize(def, params) : undefined;
}

export interface GridInput {
  at: [number, number];
  cols: number;
  rows: number;
  of: string;
  params?: Record<string, Json> | undefined;
  spacingX?: number | undefined;
  spacingZ?: number | undefined;
  facing: Facing;
  aisles: number;
  aisleWidth: number;
  y: number;
  name?: string | undefined;
}

export interface LayoutResult {
  patches: PatchInput[];
  summary: string;
  refused?: boolean;
}

/** `grid`: rows x columns of `of` centred at `at`, the pieces looking towards `facing`; aisles split every row into blocks. */
export function gridPatches(world: WorldDoc, input: GridInput, seed: number, known: (id: string) => boolean): LayoutResult {
  const gen = resolveGenerator(input.of, known);
  if (gen) input = { ...input, of: gen };
  if (!gen) return { patches: [], refused: true, summary: `shape_land grid refused: "${input.of}" is not a generator (built-in, crafted furn-*, library or defined). find_model names the crafted parts, e.g. furn-cinema-seat, furn-pew, furn-school-desk, furn-dining-table.` };
  const count = input.cols * input.rows;
  if (count > 3000) return { patches: [], refused: true, summary: `shape_land grid refused: ${count} pieces (limit 3000); split it into blocks.` };
  const size = pieceSize(input.of, input.params);
  const pitchX = input.spacingX ?? (size ? Math.max(0.3, size[0] + 0.05) : 1);
  const pitchZ = input.spacingZ ?? (size ? Math.max(0.3, size[2] + 0.15) : 1);
  const { xs, width, aisleX } = columnsX(input.cols, pitchX, input.aisles, input.aisleWidth);
  const depth = input.rows * pitchZ;
  const yaw = facingYaw(input.facing);
  const pts: Array<[number, number, number]> = [];
  for (let r = 0; r < input.rows; r++) {
    // Row 0 is the front row (nearest where the pieces look); rows go back along -Z in the layout frame.
    const z = depth / 2 - pitchZ / 2 - r * pitchZ;
    for (const x of xs) pts.push([r2(x), input.y, r2(z)]);
  }
  const b = new Builder(seed, Object.keys(world.entities), CALM);
  const id = b.add({
    id: b.id(input.name ? input.name : 'grid-of-' + input.of.replace(/^furn-/, '')),
    name: input.name ?? `${count} x ${input.of.replace(/^furn-/, '')}`,
    transform: { position: [r2(input.at[0]), 0, r2(input.at[1])], rotation: [0, yaw, 0] },
    shape: { kind: 'scatter', of: { kind: 'procedural', generator: input.of, params: input.params ?? {} }, count: pts.length, area: [1, 1], seed: seed % 100_000, scaleRange: [1, 1], randomYaw: false, points: pts },
    tags: ['grid'],
  });
  const c1 = toWorld(input.at, yaw, -width / 2, depth / 2);
  const c2 = toWorld(input.at, yaw, width / 2, -depth / 2);
  return {
    patches: b.build(),
    summary: `Laid "${id}": ${input.rows} rows x ${input.cols} = ${count} x ${input.of}${input.aisles > 0 ? ` in ${input.aisles + 1} blocks with ${input.aisles} aisle${input.aisles > 1 ? 's' : ''} of ${input.aisleWidth} m` : ''}, pitch ${pitchX.toFixed(2)} x ${pitchZ.toFixed(2)} m, one instanced entity, all looking ${typeof input.facing === 'number' ? `yaw ${input.facing}` : input.facing}. The block covers ${width.toFixed(1)} x ${depth.toFixed(1)} m (corners about (${c1[0].toFixed(1)}, ${c1[1].toFixed(1)}) and (${c2[0].toFixed(1)}, ${c2[1].toFixed(1)})). Aisle centres at local x ${aisleX.map((v) => v.toFixed(2)).join(', ') || 'none'}. Read it back with inspect {ids:["${id}"]}; to change it remove it and send the grid again.`,
  };
}

export interface TierInput {
  /** Centre of the FRONT row (the row nearest the screen or stage). */
  at: [number, number];
  rows: number;
  seatsPerRow: number;
  of: string;
  params?: Record<string, Json> | undefined;
  seatWidth?: number | undefined;
  rowDepth: number;
  /** A number fixes the rise per row; "auto" solves the sightline. */
  riser: number | 'auto';
  facing: Facing;
  aisles: number;
  aisleWidth: number;
  /** Side margin beyond the outer seats (m). */
  margin: number;
  /** Distance from the front row's seats to the screen (m) and the height of the bottom of the picture above the front row's floor. */
  screenDistance: number;
  screenBottom: number;
  /** Seated eye height above the tread (m) and the clearance wanted over the head in front. */
  eye: number;
  clearance: number;
  stepLights: boolean;
  finish: 'carpet' | 'concrete' | 'oak' | 'tile';
  color?: string | undefined;
  name?: string | undefined;
}

/**
 * The rise per row (and its growth) that lets every row see the bottom of the screen over the head in front, and the smallest
 * clearance that results. Eye of row k is `eye` above its tread; the line from it to the screen's bottom edge, at the distance
 * of row k-1, must clear row k-1's eye by `clearance`.
 */
export function solveTier(o: { rows: number; rowDepth: number; screenDistance: number; screenBottom: number; eye: number; clearance: number; maxRiser?: number }): { riser: number; growth: number; clearance: number; capped: boolean } {
  const maxRiser = o.maxRiser ?? 0.45;
  const D = (k: number): number => o.screenDistance + k * o.rowDepth;
  const fh = o.screenBottom;
  const R: number[] = [0];
  let eyeY = TIER_BASE + o.eye;
  for (let k = 1; k < o.rows; k++) {
    const need = fh + (eyeY + o.clearance - fh) * (D(k) / D(k - 1));
    const h = Math.max(R[k - 1] as number, need - o.eye - TIER_BASE);
    R.push(h);
    eyeY = TIER_BASE + h + o.eye;
  }
  let growth = 0;
  for (let k = 2; k < o.rows; k++) growth = Math.max(growth, ((R[k] as number) - k * Math.max(0.1, (R[1] as number) ?? 0.1)) / ((k * (k - 1)) / 2));
  growth = Math.min(0.03, Math.max(0, growth));
  let riser = 0.1;
  for (let k = 1; k < o.rows; k++) riser = Math.max(riser, ((R[k] as number) - (growth * k * (k - 1)) / 2) / k);
  let capped = false;
  if (riser > maxRiser) {
    riser = maxRiser;
    capped = true;
  }
  const clear = measureTier({ ...o, riser, growth }).clearance;
  return { riser: Math.round(riser * 1000) / 1000, growth: Math.round(growth * 10000) / 10000, clearance: clear, capped };
}

/** Smallest clearance (m) over the head in front, over all rows, for a given rise and growth. */
export function measureTier(o: { rows: number; rowDepth: number; screenDistance: number; screenBottom: number; eye: number; riser: number; growth: number }): { clearance: number; worstRow: number } {
  const hs = tierHeights(o.rows, o.riser, o.growth);
  let best = Infinity;
  let worst = 0;
  for (let k = 1; k < o.rows; k++) {
    const dk = o.screenDistance + k * o.rowDepth;
    const dp = dk - o.rowDepth;
    const eyeK = (hs[k] as number) + o.eye;
    const eyePrev = (hs[k - 1] as number) + o.eye;
    const lineAtPrev = o.screenBottom + (eyeK - o.screenBottom) * (dp / dk);
    const c = lineAtPrev - eyePrev;
    if (c < best) {
      best = c;
      worst = k;
    }
  }
  return { clearance: best === Infinity ? 1 : Math.round(best * 1000) / 1000, worstRow: worst };
}

/** `tier`: the stepped floor and the seats on it, plus optional aisle step lights; one entity each. */
export function tierPatches(world: WorldDoc, input: TierInput, seed: number, known: (id: string) => boolean): LayoutResult {
  const gen = resolveGenerator(input.of, known);
  if (gen) input = { ...input, of: gen };
  if (!gen) return { patches: [], refused: true, summary: `shape_land tier refused: "${input.of}" is not a generator. Seats are furn-cinema-seat (default), furn-pew, furn-school-desk or any library / defined generator; find_model lists them.` };
  const total = input.rows * input.seatsPerRow;
  if (total > 2000) return { patches: [], refused: true, summary: `shape_land tier refused: ${total} seats (limit 2000); split the auditorium into blocks.` };
  const size = pieceSize(input.of, input.params);
  const pitch = input.seatWidth ?? (size ? Math.max(0.4, size[0]) : 0.56);
  const { xs, width: seatsWidth, aisleX } = columnsX(input.seatsPerRow, pitch, input.aisles, input.aisleWidth);
  const floorWidth = seatsWidth + 2 * input.margin;
  const d = input.rowDepth;
  let riser: number;
  let growth = 0;
  let note = '';
  if (input.riser === 'auto') {
    const s = solveTier({ rows: input.rows, rowDepth: d, screenDistance: input.screenDistance, screenBottom: input.screenBottom, eye: input.eye, clearance: input.clearance });
    riser = s.riser;
    growth = s.growth;
    note = s.capped ? ` The rise was capped at ${riser} m: the back rows see the screen bottom only with ${s.clearance.toFixed(2)} m over the head in front; raise the screen, fewer rows or a larger screenDistance.` : '';
  } else riser = input.riser;
  const m = measureTier({ rows: input.rows, rowDepth: d, screenDistance: input.screenDistance, screenBottom: input.screenBottom, eye: input.eye, riser, growth });
  const heights = tierHeights(input.rows, riser, growth);
  const yaw = facingYaw(input.facing);
  const depthTotal = input.rows * d;
  const b = new Builder(seed, Object.keys(world.entities), CALM);
  // The floor is centred on its footprint; the front row is at the +Z end (towards where the pieces look).
  const centre = toWorld(input.at, yaw, 0, -(depthTotal / 2 - d / 2));
  const rot: [number, number, number] = [0, yaw, 0];
  const floorId = b.add({
    id: b.id('tier-floor'),
    name: `Tiered floor, ${input.rows} rows`,
    transform: { position: [r2(centre[0]), 0, r2(centre[1])], rotation: rot },
    shape: { kind: 'procedural', generator: 'furn-tier-steps', params: { rows: input.rows, width: r2(floorWidth), depth: d, riser, growth, finish: input.finish, ...(input.color ? { color: input.color } : {}) } },
    physics: { body: 'static' },
    tags: ['tier'],
  });
  const seatPts: Array<[number, number, number]> = [];
  for (let k = 0; k < input.rows; k++) {
    const z = depthTotal / 2 - d / 2 - k * d;
    for (const x of xs) seatPts.push([r2(x), r2(heights[k] as number), r2(z)]);
  }
  const seatId = b.add({
    id: b.id('seat-block'),
    name: `${total} seats`,
    transform: { position: [r2(centre[0]), 0, r2(centre[1])], rotation: rot },
    shape: { kind: 'scatter', of: { kind: 'procedural', generator: input.of, params: input.params ?? {} }, count: seatPts.length, area: [1, 1], seed: seed % 100_000, scaleRange: [1, 1], randomYaw: false, points: seatPts },
    tags: ['seats'],
  });
  let lights = 0;
  if (input.stepLights && (aisleX.length > 0 || input.margin >= 0.3)) {
    const pts: Array<[number, number, number]> = [];
    // Along every aisle and, where there is a margin, along both outer edges of the block: the way a hall is marked in the dark.
    const lineX = [...aisleX, ...(input.margin >= 0.3 ? [-(seatsWidth / 2 + 0.12), seatsWidth / 2 + 0.12] : [])];
    for (let k = 1; k < input.rows; k++) {
      const zRiser = depthTotal / 2 - d / 2 - k * d + d / 2;
      for (const ax of lineX) pts.push([r2(ax), r2((heights[k - 1] as number) + 0.07), r2(zRiser + 0.002)]);
    }
    if (pts.length > 0) {
      b.add({
        id: b.id('step-lights'),
        name: `${pts.length} aisle and edge step lights`,
        transform: { position: [r2(centre[0]), 0, r2(centre[1])], rotation: rot },
        shape: { kind: 'scatter', of: { kind: 'procedural', generator: 'furn-step-light', params: {} }, count: pts.length, area: [1, 1], seed: seed % 100_000, scaleRange: [1, 1], randomYaw: false, points: pts },
        tags: ['step-lights'],
      });
      lights = pts.length;
    }
  }
  const back = toWorld(input.at, yaw, 0, -(depthTotal - d));
  const frontEdge = toWorld(input.at, yaw, 0, d / 2);
  const backEdge = toWorld(input.at, yaw, 0, -(depthTotal - d) - d / 2);
  const top = heights[input.rows - 1] as number;
  const summary = [
    `Built a raked auditorium: "${floorId}" (${input.rows} stepped rows, ${floorWidth.toFixed(1)} m wide, rise ${riser} m per row${growth > 0 ? ` growing by ${growth} m per row` : ''}, back row ${top.toFixed(2)} m above the front row) and "${seatId}" (${total} x ${input.of}, ${input.seatsPerRow} per row${input.aisles > 0 ? `, ${input.aisles} aisle${input.aisles > 1 ? 's' : ''} of ${input.aisleWidth} m` : ''}), each seat standing at its row's tread height${lights > 0 ? `, and ${lights} aisle step lights on the risers` : ''}. All look ${typeof input.facing === 'number' ? `yaw ${input.facing}` : input.facing}.`,
    `Front row centre (${input.at[0].toFixed(1)}, ${input.at[1].toFixed(1)}), back row centre (${back[0].toFixed(1)}, ${back[1].toFixed(1)}); the floor runs from ${frontEdge[0].toFixed(1)},${frontEdge[1].toFixed(1)} to ${backEdge[0].toFixed(1)},${backEdge[1].toFixed(1)} along the line of sight. Keep a wall or a rear aisle 1.2 m behind the last row (the ceiling clear of ${(top + 2.4).toFixed(1)} m there) and the screen ${input.screenDistance} m in front of the front row, its bottom ${input.screenBottom} m above the front row's floor.`,
    `Sightline: the tightest row (${m.worstRow}) sees the bottom of the screen ${(m.clearance * 100).toFixed(0)} cm over the head in front (eye ${input.eye} m, wanted ${(input.clearance * 100).toFixed(0)} cm).${note}`,
  ];
  return { patches: b.build(), summary: summary.join(' ') };
}


// ---------------------------------------------------------------------------
// Pieces along a line, hung on a wall, and seated around tables
// ---------------------------------------------------------------------------

type XZ = readonly [number, number];

/** Local coordinates (x, z) of a world point for an entity at `origin` turned by `yawDeg` (the inverse of {@link toWorld}). */
function toLocal(origin: XZ, yawDeg: number, wx: number, wz: number): [number, number] {
  const a = (yawDeg * Math.PI) / 180;
  const dx = wx - origin[0];
  const dz = wz - origin[1];
  return [dx * Math.cos(a) - dz * Math.sin(a), dx * Math.sin(a) + dz * Math.cos(a)];
}

/** Yaw (degrees, 0 faces +Z) of a piece that looks along the unit direction (nx, nz). */
function yawOf(nx: number, nz: number): number {
  return (Math.atan2(nx, nz) * 180) / Math.PI;
}

export interface AlongInput {
  /** `wall` hangs pieces with their back on the line; `along` stands them on it. Same layout, different defaults and words. */
  mode: 'wall' | 'along';
  from: [number, number];
  to: [number, number];
  of: string;
  params?: Record<string, Json> | undefined;
  /** Param sets used in turn (paintings with different subjects, panels in different finishes): one instanced entity per set. */
  variants?: Array<Record<string, Json>> | undefined;
  count?: number | undefined;
  /** Metres from piece centre to piece centre (default: the piece width plus a gap). */
  spacing?: number | undefined;
  /** Height of the bottom of the piece above the floor (wall pieces hang at 1.0 by default). */
  y: number;
  /** Where the pieces look (away from the wall). Default: to the left of the way from `from` to `to`. */
  facing?: Facing | undefined;
  /** Clear space kept at both ends of the line (m). */
  inset: number;
  /** Stretches of the line (metres from `from`) that stay empty: doors, windows, a fireplace. */
  gaps?: Array<[number, number]> | undefined;
  /** Distance the pieces stand off the line, along the way they look (m). */
  offset: number;
  /** Real lights beside the pieces (an instanced piece lights nothing by itself): one for every `every`-th piece, at most 24. */
  light?: LightPlacement | undefined;
  /** A small piece beside every piece, in the same call: wall labels next to paintings, a bollard by each case. */
  labels?: LabelPlacement | undefined;
  name?: string | undefined;
}

export interface LabelPlacement {
  of: string;
  params?: Record<string, Json> | undefined;
  /** Height of the label's origin above the floor (m). */
  y: number;
  /** Which side of each piece it goes, looking at the wall from the room. */
  side: 'right' | 'left';
  /** Clear space between the piece and the label (m). */
  gap: number;
}

export interface LightPlacement {
  every: number;
  type: 'point' | 'spot';
  color: string;
  intensity: number;
  range: number;
  /** Height of the light above the piece's origin (m) and distance from it along the way the piece looks (m). */
  rise: number;
  out: number;
}

/**
 * `wall` and `along`: N pieces at an even pitch on a straight line, all facing the same way, as one instanced entity per
 * variant. A hung gallery (paintings, acoustic panels, sconces, posters) or cases along a hall: the model gives the two ends
 * of the wall (its inner face), a count or a pitch and the height; code does the spacing, the facing and the gaps.
 */
export function alongPatches(world: WorldDoc, input: AlongInput, seed: number, known: (id: string) => boolean): LayoutResult {
  const label = input.mode === 'wall' ? 'wall' : 'along';
  const gen = resolveGenerator(input.of, known);
  if (!gen) return { patches: [], refused: true, summary: `shape_land ${label} refused: "${input.of}" is not a generator. Use a crafted part id or name (furn-frame / "painting", furn-acoustic-panel, furn-vitrine, furn-sconce...) from find_model, a library model's generator, or one you defined.` };
  const dx = input.to[0] - input.from[0];
  const dz = input.to[1] - input.from[1];
  const len = Math.hypot(dx, dz);
  if (len < 0.3) return { patches: [], refused: true, summary: `shape_land ${label} refused: from and to are the same point.` };
  const ux = dx / len;
  const uz = dz / len;
  const variants = input.variants && input.variants.length > 0 ? input.variants.slice(0, 8) : [input.params ?? {}];
  const size = pieceSize(gen, { ...(input.params ?? {}), ...variants[0] });
  const width = size ? size[0] : 0.8;
  const usable = Math.max(0.1, len - 2 * input.inset);
  const count = input.count ?? Math.max(1, Math.floor(usable / (input.spacing ?? width + 0.5)));
  if (count > 400) return { patches: [], refused: true, summary: `shape_land ${label} refused: ${count} pieces on one line (limit 400).` };
  const pitch = input.count !== undefined || input.spacing === undefined ? usable / count : input.spacing;
  // A piece that joins the next one (a rope between posts) gets the pitch as its span unless the call set one.
  const hasSpan = !!furnitureById(gen)?.params['span'];
  const spanNote = hasSpan && (input.params ?? {})['span'] === undefined && !variants.some((v) => v['span'] !== undefined);
  if (spanNote) for (let i = 0; i < variants.length; i++) variants[i] = { ...(variants[i] as Record<string, Json>), span: r2(pitch) };
  const run = pitch * count;
  const start = input.inset + (usable - run) / 2 + pitch / 2;
  // Looks to the left of the way from `from` to `to` unless told otherwise (walking east, left is north).
  const yaw = input.facing !== undefined ? facingYaw(input.facing) : yawOf(uz, -ux);
  const ya = (yaw * Math.PI) / 180;
  const nx = Math.sin(ya);
  const nz = Math.cos(ya);
  const slots: number[] = [];
  let dropped = 0;
  for (let i = 0; i < count; i++) {
    const t = start + i * pitch;
    const half = Math.min(width, pitch) / 2;
    if ((input.gaps ?? []).some(([g0, g1]) => t + half > Math.min(g0, g1) && t - half < Math.max(g0, g1))) dropped++;
    else slots.push(t);
  }
  if (slots.length === 0) return { patches: [], refused: true, summary: `shape_land ${label} refused: every slot falls in a gap or the line is too short (length ${len.toFixed(1)} m, piece width ${width.toFixed(2)} m).` };
  const b = new Builder(seed, Object.keys(world.entities), CALM);
  const origin: XZ = [input.from[0] + nx * input.offset, input.from[1] + nz * input.offset];
  const ids: string[] = [];
  const short = gen.replace(/^furn-/, '');
  variants.forEach((v, vi) => {
    const pts: Array<[number, number, number]> = [];
    slots.forEach((t, i) => {
      if (i % variants.length !== vi) return;
      const [lx, lz] = toLocal(origin, yaw, input.from[0] + ux * t + nx * input.offset, input.from[1] + uz * t + nz * input.offset);
      pts.push([r2(lx), input.y, r2(lz)]);
    });
    if (pts.length === 0) return;
    ids.push(
      b.add({
        id: b.id(input.name ? `${input.name}${variants.length > 1 ? `-${vi + 1}` : ''}` : `${label}-of-${short}`),
        name: `${pts.length} x ${short}${input.mode === 'wall' ? ' on the wall' : ' along a line'}${variants.length > 1 ? ` (set ${vi + 1})` : ''}`,
        transform: { position: [r2(origin[0]), 0, r2(origin[1])], rotation: [0, yaw, 0] },
        shape: { kind: 'scatter', of: { kind: 'procedural', generator: gen, params: { ...(input.params ?? {}), ...v } }, count: pts.length, area: [1, 1], seed: seed % 100_000, scaleRange: [1, 1], randomYaw: false, points: pts },
        tags: [input.mode],
      }),
    );
  });
  let labelled = 0;
  const labelGen = input.labels ? resolveGenerator(input.labels.of, known) : undefined;
  if (input.labels && !labelGen) return { patches: [], refused: true, summary: `shape_land ${label} refused: label piece "${input.labels.of}" is not a generator (furn-plaque is the wall label).` };
  if (input.labels && labelGen) {
    const lsize = pieceSize(labelGen, input.labels.params);
    const lw = lsize ? lsize[0] : 0.2;
    // Seen from the room (looking at the wall, against the way the pieces face) "right" is the direction (nz, -nx).
    const sign = (input.labels.side === 'right' ? 1 : -1) * (nz * ux - nx * uz >= 0 ? 1 : -1);
    const shift = (width / 2 + lw / 2 + input.labels.gap) * sign;
    const pts: Array<[number, number, number]> = [];
    for (const t of slots) {
      const [lx, lz] = toLocal(origin, yaw, input.from[0] + ux * (t + shift) + nx * input.offset, input.from[1] + uz * (t + shift) + nz * input.offset);
      pts.push([r2(lx), input.labels.y, r2(lz)]);
    }
    if (pts.length > 0) {
      ids.push(
        b.add({
          id: b.id(input.name ? `${input.name}-labels` : `${label}-labels`),
          name: `${pts.length} x ${labelGen.replace(/^furn-/, '')} beside the pieces`,
          transform: { position: [r2(origin[0]), 0, r2(origin[1])], rotation: [0, yaw, 0] },
          shape: { kind: 'scatter', of: { kind: 'procedural', generator: labelGen, params: input.labels.params ?? {} }, count: pts.length, area: [1, 1], seed: seed % 100_000, scaleRange: [1, 1], randomYaw: false, points: pts },
          tags: [input.mode, 'labels'],
        }),
      );
      labelled = pts.length;
    }
  }
  let lit = 0;
  const lightIds: string[] = [];
  if (input.light) {
    const every = Math.max(input.light.every, Math.ceil(slots.length / 24));
    slots.forEach((t, i) => {
      if (i % every !== 0) return;
      const x = input.from[0] + ux * t + nx * (input.offset + (input.light?.out ?? 0));
      const z = input.from[1] + uz * t + nz * (input.offset + (input.light?.out ?? 0));
      lightIds.push(
        b.add({
          id: b.id(`${label}-light`),
          name: `${short} light`,
          transform: { position: [r2(x), r2(input.y + (input.light?.rise ?? 0)), r2(z)], rotation: [0, 0, 0], scale: [1, 1, 1] },
          shape: { kind: 'none' },
          light: { type: input.light?.type ?? 'point', color: input.light?.color ?? '#ffd7a6', intensity: input.light?.intensity ?? 0.6, range: input.light?.range ?? 6, angle: 60, castShadow: false },
          tags: ['light', input.mode],
        }),
      );
      lit++;
    });
  }
  const where = input.mode === 'wall' ? `hung on the wall from (${input.from[0]}, ${input.from[1]}) to (${input.to[0]}, ${input.to[1]}), bottom edge ${input.y} m above the floor` : `along (${input.from[0]}, ${input.from[1]}) to (${input.to[0]}, ${input.to[1]}) at y ${input.y}`;
  return {
    patches: b.build(),
    summary: `Laid ${slots.length} x ${gen} ${where}, every ${pitch.toFixed(2)} m, all looking ${input.facing !== undefined ? (typeof input.facing === 'number' ? `yaw ${input.facing}` : input.facing) : 'to the left of the line'}${ids.length > 1 ? `, in ${ids.length} instanced entities (variants taken in turn)` : ', one instanced entity'}${dropped > 0 ? `; ${dropped} slot${dropped > 1 ? 's' : ''} skipped over the gaps` : ''}${lit > 0 ? `; ${lit} real ${input.light?.type ?? 'point'} lights beside them` : ''}${labelled > 0 ? `; ${labelled} labels beside them` : ''}${spanNote ? `; each post's rope spans ${pitch.toFixed(2)} m to the next` : ''}. Entities: ${[...ids, ...lightIds.slice(0, 3)].join(', ')}${lightIds.length > 3 ? ', ...' : ''}. If the pieces face into the wall, send it again with facing set to the way they should look.`,
  };
}

export interface PerimeterInput {
  /** Table (or any centre) positions: one call seats as many as listed. */
  at: Array<[number, number]>;
  /** The seats around each centre. */
  of: string;
  params?: Record<string, Json> | undefined;
  /** The centre piece (the table) at each position; omitted = only the seats. */
  table?: { of: string; params?: Record<string, Json> | undefined; y?: number | undefined; yaw?: number | undefined } | undefined;
  shape: 'rect' | 'round';
  /** Footprint of the table (width along X, depth along Z); default from the table piece. */
  size?: [number, number] | undefined;
  /** Rect: seats along each long side and on each short end. Round: `count` seats around. */
  long: number;
  ends: number;
  count: number;
  /** Distance from the table edge to the seat's centre (m); small, so the seat tucks under. */
  gap: number;
  y: number;
  /** "in": seats look at the table; "out": away from it. */
  facing: 'in' | 'out';
  /** A cover (plate, glass, cutlery) on the table at every seat, in the same call. `y` is the table-top height above the floor. */
  settings?: { of: string; params?: Record<string, Json> | undefined; y?: number | undefined; inset: number } | undefined;
  /** One piece in the middle of every table (a candle, a vase, a menu stand). */
  centre?: { of: string; params?: Record<string, Json> | undefined; y?: number | undefined } | undefined;
  name?: string | undefined;
}

/**
 * `perimeter`: seats around a table, at every position given, as one instanced entity per facing direction plus one for the tables.
 * A restaurant floor of 14 tables of 4 is one call. Seats look at the table (or away from it for stools at a counter).
 */
export function perimeterPatches(world: WorldDoc, input: PerimeterInput, seed: number, known: (id: string) => boolean): LayoutResult {
  const gen = resolveGenerator(input.of, known);
  if (!gen) return { patches: [], refused: true, summary: `shape_land perimeter refused: "${input.of}" is not a generator. Seats are furn-chair, furn-cane-chair, furn-bar-stool, furn-armchair or a library model's generator; find_model lists them.` };
  const tableGen = input.table ? resolveGenerator(input.table.of, known) : undefined;
  if (input.table && !tableGen) return { patches: [], refused: true, summary: `shape_land perimeter refused: table "${input.table.of}" is not a generator (furn-table, furn-coffee-table, furn-desk, ...).` };
  const tsize = input.table && tableGen ? pieceSize(tableGen, input.table.params) : undefined;
  const [tw, td] = input.size ?? (tsize ? [tsize[0], tsize[2]] : [1.2, 0.8]);
  const seat = pieceSize(gen, input.params);
  const seatDepth = seat ? seat[2] : 0.5;
  const seatWidth = seat ? seat[0] : 0.46;
  // Seats (distance from the centre, yaw) around one table, in the table's frame.
  const local: Array<{ x: number; z: number; yaw: number; sx: number; sz: number }> = [];
  const inward = input.facing === 'in';
  if (input.shape === 'round') {
    const r = Math.min(tw, td) / 2 + input.gap;
    for (let k = 0; k < input.count; k++) {
      const a = (k / input.count) * Math.PI * 2;
      const x = Math.sin(a) * r;
      const z = Math.cos(a) * r;
      const k2 = Math.max(0.05, r - input.gap - (input.settings?.inset ?? 0.24)) / r;
      local.push({ x, z, yaw: yawOf(inward ? -x : x, inward ? -z : z), sx: x * k2, sz: z * k2 });
    }
  } else {
    const edge = (n: number, span: number): number[] => Array.from({ length: n }, (_, i) => -span / 2 + (span * (i + 0.5)) / n);
    const ins = input.settings?.inset ?? 0.24;
    for (const x of edge(input.long, tw)) {
      local.push({ x, z: td / 2 + input.gap, yaw: inward ? 180 : 0, sx: x, sz: td / 2 - ins });
      local.push({ x, z: -td / 2 - input.gap, yaw: inward ? 0 : 180, sx: x, sz: -td / 2 + ins });
    }
    for (let i = 0; i < input.ends; i++) {
      const z = input.ends === 1 ? 0 : edge(input.ends, td)[i] as number;
      local.push({ x: tw / 2 + input.gap, z, yaw: inward ? 270 : 90, sx: tw / 2 - ins, sz: z });
      local.push({ x: -tw / 2 - input.gap, z, yaw: inward ? 90 : 270, sx: -tw / 2 + ins, sz: z });
    }
  }
  const perTable = local.length;
  const total = perTable * input.at.length;
  if (total === 0) return { patches: [], refused: true, summary: 'shape_land perimeter refused: no seats (long, ends or count is 0).' };
  if (total > 1500) return { patches: [], refused: true, summary: `shape_land perimeter refused: ${total} seats (limit 1500); split it into calls.` };
  const quant = (y: number): number => ((Math.round(y / 5) * 5) % 360 + 360) % 360;
  const byYaw = new Map<number, Array<[number, number, number]>>();
  for (const [cx, cz] of input.at) {
    for (const s of local) {
      const tyaw = input.table?.yaw ?? 0;
      const c = Math.cos((tyaw * Math.PI) / 180);
      const sn = Math.sin((tyaw * Math.PI) / 180);
      // The table may itself be turned: rotate the seat ring with it.
      const wx = cx + s.x * c + s.z * sn;
      const wz = cz - s.x * sn + s.z * c;
      const yaw = quant(s.yaw + tyaw);
      const [lx, lz] = toLocal([0, 0], yaw, wx, wz);
      (byYaw.get(yaw) ?? byYaw.set(yaw, []).get(yaw) as Array<[number, number, number]>).push([r2(lx), input.y, r2(lz)]);
    }
  }
  const b = new Builder(seed, Object.keys(world.entities), CALM);
  const short = gen.replace(/^furn-/, '');
  const ids: string[] = [];
  for (const [yaw, pts] of [...byYaw.entries()].sort((a, c) => a[0] - c[0])) {
    ids.push(
      b.add({
        id: b.id(input.name ? input.name : `seats-${short}`),
        name: `${pts.length} x ${short} facing ${yaw} deg`,
        transform: { position: [0, 0, 0], rotation: [0, yaw, 0] },
        shape: { kind: 'scatter', of: { kind: 'procedural', generator: gen, params: input.params ?? {} }, count: pts.length, area: [1, 1], seed: seed % 100_000, scaleRange: [1, 1], randomYaw: false, points: pts },
        tags: ['seats'],
      }),
    );
  }
  let tables = '';
  if (input.table && tableGen) {
    const tyaw = input.table.yaw ?? 0;
    const pts = input.at.map(([x, z]) => {
      const [lx, lz] = toLocal([0, 0], tyaw, x, z);
      return [r2(lx), input.table?.y ?? input.y, r2(lz)] as [number, number, number];
    });
    const id = b.add({
      id: b.id(input.name ? `${input.name}-tables` : `tables-${tableGen.replace(/^furn-/, '')}`),
      name: `${pts.length} x ${tableGen.replace(/^furn-/, '')}`,
      transform: { position: [0, 0, 0], rotation: [0, tyaw, 0] },
      shape: { kind: 'scatter', of: { kind: 'procedural', generator: tableGen, params: input.table.params ?? {} }, count: pts.length, area: [1, 1], seed: seed % 100_000, scaleRange: [1, 1], randomYaw: false, points: pts },
      tags: ['tables'],
    });
    tables = ` and ${input.at.length} x ${tableGen} ("${id}")`;
  }
  let covers = '';
  if (input.settings) {
    const sg = resolveGenerator(input.settings.of, known);
    if (!sg) return { patches: [], refused: true, summary: `shape_land perimeter refused: settings piece "${input.settings.of}" is not a generator (furn-place-setting is one cover: plate, glasses, cutlery).` };
    const top = (input.table?.y ?? input.y) + (input.settings.y ?? (tsize ? tsize[1] : 0.75));
    const byY = new Map<number, Array<[number, number, number]>>();
    for (const [cx, cz] of input.at) {
      for (const sl of local) {
        const tyaw = input.table?.yaw ?? 0;
        const c = Math.cos((tyaw * Math.PI) / 180);
        const sn = Math.sin((tyaw * Math.PI) / 180);
        const wx = cx + sl.sx * c + sl.sz * sn;
        const wz = cz - sl.sx * sn + sl.sz * c;
        const yaw = quant((inward ? sl.yaw : sl.yaw + 180) + tyaw);
        const [lx, lz] = toLocal([0, 0], yaw, wx, wz);
        (byY.get(yaw) ?? byY.set(yaw, []).get(yaw) as Array<[number, number, number]>).push([r2(lx), r2(top), r2(lz)]);
      }
    }
    let n = 0;
    for (const [yaw, pts] of [...byY.entries()].sort((a, c) => a[0] - c[0])) {
      b.add({
        id: b.id(input.name ? `${input.name}-settings` : 'table-settings'),
        name: `${pts.length} x ${sg.replace(/^furn-/, '')}`,
        transform: { position: [0, 0, 0], rotation: [0, yaw, 0] },
        shape: { kind: 'scatter', of: { kind: 'procedural', generator: sg, params: input.settings.params ?? {} }, count: pts.length, area: [1, 1], seed: seed % 100_000, scaleRange: [1, 1], randomYaw: false, points: pts },
        tags: ['settings'],
      });
      n += pts.length;
    }
    covers += `, ${n} x ${sg} (one cover at every seat, on the table top at ${top.toFixed(2)} m)`;
  }
  if (input.centre) {
    const cg = resolveGenerator(input.centre.of, known);
    if (!cg) return { patches: [], refused: true, summary: `shape_land perimeter refused: centre piece "${input.centre.of}" is not a generator (furn-candle, furn-planter, furn-vitrine...).` };
    const top = (input.table?.y ?? input.y) + (input.centre.y ?? (tsize ? tsize[1] : 0.75));
    const tyaw = input.table?.yaw ?? 0;
    const pts = input.at.map(([x, z]) => {
      const [lx, lz] = toLocal([0, 0], tyaw, x, z);
      return [r2(lx), r2(top), r2(lz)] as [number, number, number];
    });
    b.add({
      id: b.id(input.name ? `${input.name}-centre` : 'table-centres'),
      name: `${pts.length} x ${cg.replace(/^furn-/, '')} on the tables`,
      transform: { position: [0, 0, 0], rotation: [0, tyaw, 0] },
      shape: { kind: 'scatter', of: { kind: 'procedural', generator: cg, params: input.centre.params ?? {} }, count: pts.length, area: [1, 1], seed: seed % 100_000, scaleRange: [1, 1], randomYaw: false, points: pts },
      tags: ['centres'],
    });
    covers += `, ${pts.length} x ${cg} in the middle of the tables`;
  }
  return {
    patches: b.build(),
    summary: `Seated ${total} x ${gen} (${perTable} at each of ${input.at.length} ${input.table ? 'tables' : 'centres'}${input.shape === 'round' ? `, round, ${input.count} each` : `, ${input.long} on each long side${input.ends > 0 ? ` and ${input.ends} on each end` : ''}`}, ${inward ? 'looking at the table' : 'looking away'}) in ${ids.length} instanced entit${ids.length === 1 ? 'y' : 'ies'}${tables}${covers}. Table footprint ${tw.toFixed(2)} x ${td.toFixed(2)} m, seat ${seatWidth.toFixed(2)} wide: keep tables at least ${(Math.max(tw, td) + 2 * (seatDepth + input.gap) + 0.5).toFixed(1)} m apart centre to centre so seats and walkways stay clear.`,
  };
}


export interface AroundInput {
  /** The room as [x0, z0, x1, z1] (the inner faces of its walls, or any rectangle). */
  rect: [number, number, number, number];
  /** `wall` hangs pieces on the walls; `along` stands them in a line inside each wall (columns, planters, stanchions). */
  mode: 'wall' | 'along';
  of: string;
  params?: Record<string, Json> | undefined;
  variants?: Array<Record<string, Json>> | undefined;
  /** Metres between pieces (centre to centre), or a count per side. */
  spacing?: number | undefined;
  count?: number | undefined;
  y: number;
  inset: number;
  /** Distance the pieces stand off the line, into the room (m). */
  offset: number;
  sides: Array<'north' | 'east' | 'south' | 'west'>;
  /** Stretches (metres from the start of that side, clockwise from the north-west corner) that stay empty: doors, windows. */
  gaps?: Partial<Record<'north' | 'east' | 'south' | 'west', Array<[number, number]>>> | undefined;
  light?: LightPlacement | undefined;
  labels?: LabelPlacement | undefined;
  name?: string | undefined;
}

/**
 * `around`: the same pieces on every wall of a rectangular room in ONE call, all facing into the room: columns or pilasters
 * round a hall, sconces or panels on all four walls, planters along a forecourt, stanchions round a gallery. Each side is one
 * instanced entity (or one per variant).
 */
export function aroundPatches(world: WorldDoc, input: AroundInput, seed: number, known: (id: string) => boolean): LayoutResult {
  const [x0, z0, x1, z1] = input.rect;
  if (!(x1 - x0 > 0.5 && z1 - z0 > 0.5)) return { patches: [], refused: true, summary: 'shape_land around refused: rect must be [x0, z0, x1, z1] with x1 > x0 and z1 > z0 (the inner faces of the room).' };
  const sides: Array<{ id: 'north' | 'east' | 'south' | 'west'; from: [number, number]; to: [number, number]; facing: Facing }> = [
    { id: 'north', from: [x0, z0], to: [x1, z0], facing: 'south' },
    { id: 'east', from: [x1, z0], to: [x1, z1], facing: 'west' },
    { id: 'south', from: [x1, z1], to: [x0, z1], facing: 'north' },
    { id: 'west', from: [x0, z1], to: [x0, z0], facing: 'east' },
  ];
  const patches: PatchInput[] = [];
  const summaries: string[] = [];
  const used = world;
  for (const side of sides) {
    if (!input.sides.includes(side.id)) continue;
    const r = alongPatches(
      used,
      {
        mode: input.mode,
        from: side.from,
        to: side.to,
        of: input.of,
        params: input.params,
        variants: input.variants,
        count: input.count,
        spacing: input.spacing,
        y: input.y,
        facing: side.facing,
        inset: input.inset,
        gaps: input.gaps?.[side.id],
        offset: input.offset,
        light: input.light,
        labels: input.labels,
        name: `${input.name ?? `around-${(resolveGenerator(input.of, known) ?? input.of).replace(/^furn-/, '')}`}-${side.id}`,
      },
      seed + patches.length,
      known,
    );
    if (r.refused) {
      summaries.push(`${side.id}: ${r.summary.replace(/^shape_land (wall|along) refused: /, '')}`);
      continue;
    }
    patches.push(...r.patches);
    summaries.push(`${side.id}: ${r.summary.split('. Entities:')[0]?.replace(/^Laid /, '')}`);
  }
  if (patches.length === 0) return { patches: [], refused: true, summary: `shape_land around refused: nothing fits on ${input.sides.join(', ')}. ${summaries.join('; ')}` };
  return { patches, summary: `Placed ${input.of} on ${summaries.length} side${summaries.length > 1 ? 's' : ''} of the room (${x0}, ${z0}) to (${x1}, ${z1}), all facing into the room. ${summaries.join('. ')}.` };
}
