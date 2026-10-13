/**
 * Sculpt and paint brushes. A {@link SculptSession} owns a working copy of a
 * mesh for one stroke: each dab mutates it in place (no allocations per dab,
 * so a stroke can run every pointer move at 60 fps), and the session reports
 * the dirty vertex range for partial GPU uploads. The caller commits the
 * finished stroke as one undoable edit.
 */
import { rng, type MeshData } from '@aether/core';
import { Noise } from '../noise';
import { buildTopology, type Topology } from './topology';

/** Sculpt brush modes. */
export type SculptMode = 'raise' | 'lower' | 'smooth' | 'flatten' | 'noise';
/** Brush falloff curves. */
export type BrushFalloff = 'smooth' | 'linear' | 'constant' | 'sharp';

/** One brush dab in the mesh's local space. */
export interface BrushDab {
  /** Brush centre (local coordinates). */
  center: readonly [number, number, number];
  /** Unit direction raise/lower/noise move along, and the flatten plane normal (usually the surface normal or up). */
  normal: readonly [number, number, number];
  /** Radius in local units. */
  radius: number;
  /** 0..1 */
  strength: number;
  falloff?: BrushFalloff;
  /** Pen pressure 0..1 (1 for mouse). */
  pressure?: number;
}

/** Brush falloff weight for normalised distance `x` (0 at the centre, 1 at the rim). */
export function falloffWeight(kind: BrushFalloff, x: number): number {
  if (x >= 1) return 0;
  if (x <= 0) return 1;
  switch (kind) {
    case 'constant':
      return 1;
    case 'linear':
      return 1 - x;
    case 'sharp':
      return (1 - x) * (1 - x);
    default: {
      const t = 1 - x;
      return t * t * (3 - 2 * t);
    }
  }
}

/** Working copy of a mesh for one sculpt / paint stroke. */
export class SculptSession {
  readonly data: MeshData;
  private topo: Topology | null = null;
  private noise: Noise | null = null;
  private plane: { px: number; py: number; pz: number; nx: number; ny: number; nz: number } | null = null;
  /** Smooth needs a stable snapshot within one dab. */
  private scratch: Float32Array | null = null;
  /** Lowest / highest vertex index changed since the last {@link takeDirty}. */
  private dirtyMin = Number.POSITIVE_INFINITY;
  private dirtyMax = -1;
  /** Vertices changed at all during the stroke. */
  private touched = 0;

  constructor(mesh: MeshData, opts: { seed?: number } = {}) {
    this.data = {
      positions: mesh.positions.slice(),
      indices: mesh.indices,
      colors: mesh.colors ? mesh.colors.slice() : null,
      uvs: mesh.uvs,
      faceMaterials: mesh.faceMaterials,
    };
    this.seed = opts.seed ?? 1;
  }

  private readonly seed: number;

  private topology(): Topology {
    this.topo ??= buildTopology(this.data);
    return this.topo;
  }

  /** Vertex range changed since the last call (null when nothing changed), then reset. */
  takeDirty(): { start: number; count: number } | null {
    if (this.dirtyMax < 0) return null;
    const r = { start: this.dirtyMin, count: this.dirtyMax - this.dirtyMin + 1 };
    this.dirtyMin = Number.POSITIVE_INFINITY;
    this.dirtyMax = -1;
    return r;
  }

  /** True once any dab changed the mesh. */
  get changed(): boolean {
    return this.touched > 0;
  }

  private mark(v: number): void {
    if (v < this.dirtyMin) this.dirtyMin = v;
    if (v > this.dirtyMax) this.dirtyMax = v;
    this.touched++;
  }

  /**
   * Apply one sculpt dab. Raise/lower move along `normal` by up to 15 % of
   * the radius per dab at full strength; smooth relaxes toward neighbours;
   * flatten pulls toward the plane captured at the stroke's first dab;
   * noise displaces with seeded simplex noise. Returns vertices affected.
   */
  sculpt(mode: SculptMode, dab: BrushDab): number {
    const r = dab.radius;
    if (!(r > 0) || !Number.isFinite(r)) return 0;
    const strength = Math.min(1, Math.max(0, dab.strength)) * Math.min(1, Math.max(0.05, dab.pressure ?? 1));
    if (strength <= 0) return 0;
    const falloff = dab.falloff ?? 'smooth';
    const [cx, cy, cz] = dab.center;
    let [nx, ny, nz] = dab.normal;
    const nl = Math.hypot(nx, ny, nz);
    if (!(nl > 1e-9)) {
      nx = 0;
      ny = 1;
      nz = 0;
    } else {
      nx /= nl;
      ny /= nl;
      nz /= nl;
    }
    const topo = this.topology();
    const p = this.data.positions;
    const r2 = r * r;
    const step = r * 0.15 * strength;
    if (mode === 'flatten' && !this.plane) this.plane = { px: cx, py: cy, pz: cz, nx, ny, nz };
    if (mode === 'noise') this.noise ??= new Noise(rng(this.seed));
    if (mode === 'smooth') {
      if (!this.scratch || this.scratch.length !== p.length) this.scratch = new Float32Array(p.length);
      this.scratch.set(p);
    }
    const src = this.scratch;
    let affected = 0;
    const reps = topo.reps;
    for (let i = 0; i < reps.length; i++) {
      const w = reps[i] as number;
      const x = p[w * 3] as number;
      const y = p[w * 3 + 1] as number;
      const z = p[w * 3 + 2] as number;
      const dx = x - cx;
      const dy = y - cy;
      const dz = z - cz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= r2) continue;
      const f = falloffWeight(falloff, Math.sqrt(d2) / r);
      if (f <= 0) continue;
      let ox = x;
      let oy = y;
      let oz = z;
      switch (mode) {
        case 'raise':
        case 'lower': {
          const s = (mode === 'raise' ? 1 : -1) * step * f;
          ox += nx * s;
          oy += ny * s;
          oz += nz * s;
          break;
        }
        case 'noise': {
          const n = (this.noise as Noise).noise3(x * 0.6, y * 0.6, z * 0.6);
          const s = n * step * f;
          ox += nx * s;
          oy += ny * s;
          oz += nz * s;
          break;
        }
        case 'flatten': {
          const pl = this.plane as NonNullable<SculptSession['plane']>;
          const dist = (x - pl.px) * pl.nx + (y - pl.py) * pl.ny + (z - pl.pz) * pl.nz;
          const s = dist * Math.min(1, strength * 0.5) * f;
          ox -= pl.nx * s;
          oy -= pl.ny * s;
          oz -= pl.nz * s;
          break;
        }
        case 'smooth': {
          const start = topo.nStart[w] as number;
          const end = topo.nStart[w + 1] as number;
          if (end === start || !src) break;
          let ax = 0;
          let ay = 0;
          let az = 0;
          for (let k = start; k < end; k++) {
            const u = topo.neighbors[k] as number;
            ax += src[u * 3] as number;
            ay += src[u * 3 + 1] as number;
            az += src[u * 3 + 2] as number;
          }
          const inv = 1 / (end - start);
          const s = Math.min(1, strength) * f;
          ox += (ax * inv - x) * s;
          oy += (ay * inv - y) * s;
          oz += (az * inv - z) * s;
          break;
        }
      }
      if (ox === x && oy === y && oz === z) continue;
      // Write the representative and all its split copies.
      for (let k = topo.copyStart[w] as number; k < (topo.copyStart[w + 1] as number); k++) {
        const v = topo.copies[k] as number;
        p[v * 3] = ox;
        p[v * 3 + 1] = oy;
        p[v * 3 + 2] = oz;
        this.mark(v);
      }
      affected++;
    }
    return affected;
  }

  /**
   * Paint vertex colours (LINEAR rgb 0..1) blended by brush weight. Creates
   * a white colour channel on first use (white × material colour = unchanged
   * look). With `erase`, blends back to white. Returns vertices affected.
   */
  paint(color: readonly [number, number, number], dab: BrushDab, erase = false): number {
    const r = dab.radius;
    if (!(r > 0) || !Number.isFinite(r)) return 0;
    const strength = Math.min(1, Math.max(0, dab.strength)) * Math.min(1, Math.max(0.05, dab.pressure ?? 1));
    if (strength <= 0) return 0;
    if (!this.data.colors) this.data.colors = new Float32Array(this.data.positions.length).fill(1);
    const colors = this.data.colors;
    const p = this.data.positions;
    const falloff = dab.falloff ?? 'smooth';
    const [cx, cy, cz] = dab.center;
    const r2 = r * r;
    const tr = erase ? 1 : color[0];
    const tg = erase ? 1 : color[1];
    const tb = erase ? 1 : color[2];
    let affected = 0;
    const n = p.length / 3;
    for (let v = 0; v < n; v++) {
      const dx = (p[v * 3] as number) - cx;
      const dy = (p[v * 3 + 1] as number) - cy;
      const dz = (p[v * 3 + 2] as number) - cz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= r2) continue;
      const f = falloffWeight(falloff, Math.sqrt(d2) / r) * strength;
      if (f <= 0) continue;
      colors[v * 3] = (colors[v * 3] as number) + (tr - (colors[v * 3] as number)) * f;
      colors[v * 3 + 1] = (colors[v * 3 + 1] as number) + (tg - (colors[v * 3 + 1] as number)) * f;
      colors[v * 3 + 2] = (colors[v * 3 + 2] as number) + (tb - (colors[v * 3 + 2] as number)) * f;
      this.mark(v);
      affected++;
    }
    return affected;
  }
}
