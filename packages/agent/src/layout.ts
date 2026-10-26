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
import { furnitureById, furnitureSize, tierHeights, TIER_BASE } from '@aether/arch';
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
  if (!known(input.of)) return { patches: [], refused: true, summary: `shape_land grid refused: "${input.of}" is not a generator (built-in, crafted furn-*, library or defined). find_model names the crafted parts, e.g. furn-cinema-seat, furn-pew, furn-school-desk, furn-dining-table.` };
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
  if (!known(input.of)) return { patches: [], refused: true, summary: `shape_land tier refused: "${input.of}" is not a generator. Seats are furn-cinema-seat (default), furn-pew, furn-school-desk or any library / defined generator; find_model lists them.` };
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
  if (input.stepLights && aisleX.length > 0) {
    const pts: Array<[number, number, number]> = [];
    for (let k = 1; k < input.rows; k++) {
      const zRiser = depthTotal / 2 - d / 2 - k * d + d / 2;
      for (const ax of aisleX) pts.push([r2(ax), r2((heights[k - 1] as number) + 0.07), r2(zRiser + 0.002)]);
    }
    if (pts.length > 0) {
      b.add({
        id: b.id('step-lights'),
        name: `${pts.length} aisle step lights`,
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
