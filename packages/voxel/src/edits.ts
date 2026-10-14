/**
 * Rasterization of document edits (`voxel.edits`) into chunks.
 *
 * Edits are compiled once per terrain configuration: anchors are resolved
 * against the natural ground (`anchor: "surface"`), block names become
 * numeric ids, structures and lettering become voxel models, and every edit
 * gets a world-space bounding box. A chunk then replays, in document order,
 * only the edits whose box intersects it — so generation cost scales with
 * the edits that touch the chunk, not with the whole document.
 */
import type { VoxelEdit } from '@aether/core';
import { hashString } from '@aether/core';
import type { BlockRegistry } from './blocks';
import { AIR, CHUNK, HEIGHT, LAYER } from './constants';
import { textRows } from './font';
import { buildStructure, CARVE, FOUNDATION, KEEP, type VoxelModel } from './structures';
import type { TerrainGenerator } from './terrain';

/** Sentinel: leave the cell unchanged. */
const SKIP = -1;

/** A compiled edit with its world-space bounds (inclusive). */
export interface CompiledEdit {
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly maxZ: number;
  /**
   * New block for world cell (x, y, z) currently holding `cur`, or −1 to
   * keep it. Only called inside the bounds.
   */
  sample(x: number, y: number, z: number, cur: number): number;
}

interface Box {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

function boxOf(ax: number, ay: number, az: number, bx: number, by: number, bz: number): Box {
  return {
    minX: Math.min(ax, bx), minY: Math.max(0, Math.min(ay, by)), minZ: Math.min(az, bz),
    maxX: Math.max(ax, bx), maxY: Math.min(HEIGHT - 1, Math.max(ay, by)), maxZ: Math.max(az, bz),
  };
}

function nameId(reg: BlockRegistry, name: string): number {
  return name === 'air' ? AIR : reg.idOr(name);
}

function distToSegment(px: number, py: number, pz: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const len2 = dx * dx + dy * dy + dz * dz;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + dx * t - px;
  const qy = ay + dy * t - py;
  const qz = az + dz * t - pz;
  return Math.sqrt(qx * qx + qy * qy + qz * qz);
}

/** Compiles one edit; `lift(x, z)` is the y offset of `anchor: "surface"` edits at their anchor column. */
function compileOne(e: VoxelEdit, reg: BlockRegistry, gen: TerrainGenerator, worldSeed: number, index: number): CompiledEdit | null {
  const lift = (x: number, z: number): number => (e.anchor === 'surface' ? gen.groundLevel(x, z) : 0);
  const isSolid = (id: number): boolean => reg.solid[id] === 1 && reg.render[id] !== 3;
  switch (e.shape) {
    case 'box':
    case 'clear':
    case 'replace': {
      const dy = lift(e.from[0], e.from[2]);
      const b = boxOf(e.from[0], e.from[1] + dy, e.from[2], e.to[0], e.to[1] + dy, e.to[2]);
      if (e.shape === 'clear') return { ...b, sample: () => AIR };
      if (e.shape === 'replace') {
        const from = nameId(reg, e.block);
        const to = nameId(reg, e.with);
        return { ...b, sample: (_x, _y, _z, cur) => (cur === from ? to : SKIP) };
      }
      const id = nameId(reg, e.block);
      const ey0 = Math.min(e.from[1], e.to[1]) + dy;
      const ey1 = Math.max(e.from[1], e.to[1]) + dy;
      if (!e.hollow) return { ...b, sample: () => id };
      return {
        ...b,
        sample: (x, y, z) => (x === b.minX || x === b.maxX || z === b.minZ || z === b.maxZ || y === ey0 || y === ey1 ? id : SKIP),
      };
    }
    case 'sphere': {
      const [cx, cyRaw, cz] = e.center;
      const cy = cyRaw + lift(cx, cz);
      const r = e.radius;
      const ri = Math.ceil(r);
      const id = nameId(reg, e.block);
      const outer = (r + 0.5) * (r + 0.5);
      const inner = Math.max(0, r - 0.5) * Math.max(0, r - 0.5);
      return {
        ...boxOf(cx - ri, cy - ri, cz - ri, cx + ri, cy + ri, cz + ri),
        sample: (x, y, z) => {
          const d = (x - cx) * (x - cx) + (y - cy) * (y - cy) + (z - cz) * (z - cz);
          if (d > outer) return SKIP;
          return e.hollow && d < inner ? SKIP : id;
        },
      };
    }
    case 'cylinder': {
      const [bx, byRaw, bz] = e.base;
      const by = byRaw + lift(bx, bz);
      const ri = Math.ceil(e.radius);
      const r2o = (e.radius + 0.5) ** 2;
      const r2i = Math.max(0, e.radius - 0.5) ** 2;
      const id = nameId(reg, e.block);
      const h = e.height - 1;
      const b =
        e.axis === 'y' ? boxOf(bx - ri, by, bz - ri, bx + ri, by + h, bz + ri)
        : e.axis === 'x' ? boxOf(bx, by - ri, bz - ri, bx + h, by + ri, bz + ri)
        : boxOf(bx - ri, by - ri, bz, bx + ri, by + ri, bz + h);
      return {
        ...b,
        sample: (x, y, z) => {
          const u = e.axis === 'x' ? y - by : x - bx;
          const v = e.axis === 'z' ? y - by : z - bz;
          const along = e.axis === 'y' ? y - by : e.axis === 'x' ? x - bx : z - bz;
          const d = u * u + v * v;
          if (d > r2o) return SKIP;
          if (e.hollow && d < r2i && along > 0 && along < h) return SKIP;
          return id;
        },
      };
    }
    case 'line': {
      const dy = lift(e.from[0], e.from[2]);
      const [ax, ayRaw, az] = e.from;
      const [bx, byRaw, bz] = e.to;
      const ay = ayRaw + dy;
      const by = byRaw + dy;
      const reach = e.radius > 0 ? e.radius + 0.5 : 0.62;
      const ri = Math.ceil(reach);
      const id = nameId(reg, e.block);
      return {
        ...boxOf(Math.min(ax, bx) - ri, Math.min(ay, by) - ri, Math.min(az, bz) - ri, Math.max(ax, bx) + ri, Math.max(ay, by) + ri, Math.max(az, bz) + ri),
        sample: (x, y, z) => (distToSegment(x, y, z, ax, ay, az, bx, by, bz) <= reach ? id : SKIP),
      };
    }
    case 'stairs': {
      const [fx, fyRaw, fz] = e.from;
      const fy = fyRaw + lift(fx, fz);
      const [dx, dz] = e.direction === 'north' ? [0, -1] : e.direction === 'south' ? [0, 1] : e.direction === 'east' ? [1, 0] : [-1, 0];
      const lo = -Math.floor((e.width - 1) / 2);
      const hi = lo + e.width - 1;
      const n = e.steps - 1;
      const id = nameId(reg, e.block);
      const ex = fx + dx * n;
      const ez = fz + dz * n;
      const px = dz !== 0 ? 1 : 0;
      const pz = dx !== 0 ? 1 : 0;
      return {
        ...boxOf(Math.min(fx, ex) + Math.min(lo * px, hi * px), fy, Math.min(fz, ez) + Math.min(lo * pz, hi * pz), Math.max(fx, ex) + Math.max(lo * px, hi * px), fy + n, Math.max(fz, ez) + Math.max(lo * pz, hi * pz)),
        sample: (x, y, z) => {
          const along = dx !== 0 ? (x - fx) * dx : (z - fz) * dz;
          const side = dx !== 0 ? z - fz : x - fx;
          if (along < 0 || along > n || side < lo || side > hi) return SKIP;
          return y - fy <= along ? id : SKIP;
        },
      };
    }
    case 'structure': {
      const model = buildStructure(reg, {
        structure: e.structure, size: e.size, facing: e.facing, palette: e.palette, seed: worldSeed ^ hashString(`${index}`),
        ...(e.length !== undefined ? { length: e.length } : {}),
      });
      const [ax, ayRaw, az] = e.at;
      const ay = ayRaw + lift(ax, az);
      return modelEdit(model, ax - model.ax, ay - model.ay, az - model.az, isSolid);
    }
    case 'pixels':
    case 'text': {
      const rows = e.shape === 'text' ? textRows(e.text) : e.rows;
      const lookup = new Map<string, number>();
      if (e.shape === 'text') lookup.set('#', nameId(reg, e.block));
      else for (const [ch, name] of Object.entries(e.palette)) lookup.set(ch, nameId(reg, name));
      const [ax, ayRaw, az] = e.at;
      const ay = ayRaw + lift(ax, az);
      const s = e.scale;
      const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
      const height = rows.length;
      const plane = e.plane;
      // Grid of ids (−1 keep), row 0 at the top.
      const grid = new Int32Array(width * height).fill(SKIP);
      rows.forEach((row, r) => {
        for (let c = 0; c < row.length; c++) {
          const id = lookup.get(row[c] as string);
          if (id !== undefined) grid[c + r * width] = id;
        }
      });
      const b =
        plane === 'xy' ? boxOf(ax, ay, az, ax + width * s - 1, ay + height * s - 1, az + s - 1)
        : plane === 'zy' ? boxOf(ax, ay, az, ax + s - 1, ay + height * s - 1, az + width * s - 1)
        : boxOf(ax, ay, az, ax + width * s - 1, ay + s - 1, az + height * s - 1);
      return {
        ...b,
        sample: (x, y, z) => {
          let col: number;
          let row: number;
          if (plane === 'xy') {
            col = Math.floor((x - ax) / s);
            row = height - 1 - Math.floor((y - ay) / s);
          } else if (plane === 'zy') {
            col = Math.floor((z - az) / s);
            row = height - 1 - Math.floor((y - ay) / s);
          } else {
            col = Math.floor((x - ax) / s);
            row = Math.floor((z - az) / s);
          }
          if (col < 0 || col >= width || row < 0 || row >= height) return SKIP;
          return grid[col + row * width] as number;
        },
      };
    }
  }
}

function modelEdit(m: VoxelModel, ox: number, oy: number, oz: number, isSolid: (id: number) => boolean): CompiledEdit {
  const b = boxOf(ox, oy, oz, ox + m.sx - 1, oy + m.sy - 1, oz + m.sz - 1);
  const area = m.sx * m.sz;
  return {
    ...b,
    sample: (x, y, z, cur) => {
      const v = m.data[x - ox + (z - oz) * m.sx + (y - oy) * area] as number;
      if (v === KEEP) return SKIP;
      if (v === CARVE) return AIR;
      if (v === FOUNDATION) return isSolid(cur) ? SKIP : m.foundation;
      return v;
    },
  };
}

/** Compile document edits (invalid or empty ones are skipped). */
export function compileEdits(edits: readonly VoxelEdit[], reg: BlockRegistry, gen: TerrainGenerator, worldSeed: number): CompiledEdit[] {
  const out: CompiledEdit[] = [];
  edits.forEach((e, i) => {
    const c = compileOne(e, reg, gen, worldSeed, i);
    if (c && c.minX <= c.maxX && c.minY <= c.maxY && c.minZ <= c.maxZ) out.push(c);
  });
  return out;
}

/** Replay the compiled edits that touch chunk (cx, cz) onto its dense blocks, in order. */
export function applyEdits(edits: readonly CompiledEdit[], cx: number, cz: number, dense: Uint16Array): number {
  const x0 = cx * CHUNK;
  const z0 = cz * CHUNK;
  const x1 = x0 + CHUNK - 1;
  const z1 = z0 + CHUNK - 1;
  let touched = 0;
  for (const e of edits) {
    if (e.maxX < x0 || e.minX > x1 || e.maxZ < z0 || e.minZ > z1) continue;
    touched++;
    const lx0 = Math.max(e.minX, x0);
    const lx1 = Math.min(e.maxX, x1);
    const lz0 = Math.max(e.minZ, z0);
    const lz1 = Math.min(e.maxZ, z1);
    for (let y = e.minY; y <= e.maxY; y++) {
      for (let z = lz0; z <= lz1; z++) {
        let idx = lx0 - x0 + (z - z0) * CHUNK + y * LAYER;
        for (let x = lx0; x <= lx1; x++, idx++) {
          const v = e.sample(x, y, z, dense[idx] as number);
          if (v >= 0) dense[idx] = v;
        }
      }
    }
  }
  return touched;
}
