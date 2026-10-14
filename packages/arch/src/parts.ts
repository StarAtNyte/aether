/**
 * Collects geometry per material into {@link ArchPart}s (one draw call per
 * distinct material) and colliders, producing an {@link ArchOutput}.
 */
import { stableStringify, type MaterialSpec, type Vec3 } from '@aether/core';
import type { Geom } from './mesh';
import type { ArchCollider, ArchOutput, ArchPart } from './types';

/** Upper bound of parts one element may produce (procgen allows 64). */
export const MAX_ELEMENT_PARTS = 24;
/** Upper bound of colliders one element may produce (procgen allows 256). */
export const MAX_ELEMENT_COLLIDERS = 200;

/** Accumulates parts by material and colliders. */
export class PartSet {
  private readonly byKey = new Map<string, { material: MaterialSpec; geoms: Geom[] }>();
  readonly colliders: ArchCollider[] = [];

  /** Add geometry with a material (merged with earlier geometry of an equal material). */
  add(geom: Geom, material: MaterialSpec): this {
    if (geom.i.length === 0) return this;
    const key = stableStringify(material);
    let slot = this.byKey.get(key);
    if (!slot) {
      if (this.byKey.size >= MAX_ELEMENT_PARTS) {
        // Over budget: fold into the first part rather than exceed the draw-call cap.
        slot = this.byKey.values().next().value as { material: MaterialSpec; geoms: Geom[] };
      } else {
        slot = { material, geoms: [] };
        this.byKey.set(key, slot);
      }
    }
    slot.geoms.push(geom);
    return this;
  }

  /** Oriented box collider (centre, half extents, optional Euler rotation in degrees). */
  box(center: Vec3, half: Vec3, rotation?: Vec3): this {
    if (this.colliders.length >= MAX_ELEMENT_COLLIDERS) return this;
    const h: Vec3 = [Math.max(0.005, half[0]), Math.max(0.005, half[1]), Math.max(0.005, half[2])];
    if (rotation && (rotation[0] !== 0 || rotation[1] !== 0 || rotation[2] !== 0)) this.colliders.push({ kind: 'box', halfExtents: h, offset: center, rotation });
    else this.colliders.push({ kind: 'box', halfExtents: h, offset: center });
    return this;
  }

  /** Axis-aligned box collider from min/max corners. */
  boxMinMax(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): this {
    return this.box([(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], [Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2, Math.abs(z1 - z0) / 2]);
  }

  /** Convex hull collider of the given points (packed xyz). */
  hull(points: number[]): this {
    if (this.colliders.length >= MAX_ELEMENT_COLLIDERS || points.length < 12) return this;
    this.colliders.push({ kind: 'hull', points: new Float32Array(points), offset: [0, 0, 0] });
    return this;
  }

  /** Static triangle-mesh collider from a geometry. */
  trimesh(geom: Geom): this {
    if (this.colliders.length >= MAX_ELEMENT_COLLIDERS || geom.i.length === 0) return this;
    this.colliders.push({ kind: 'trimesh', positions: new Float32Array(geom.p), indices: new Uint32Array(geom.i) });
    return this;
  }

  /** Finish: one part per material, in insertion order. */
  build(): ArchOutput {
    const parts: ArchPart[] = [];
    for (const { material, geoms } of this.byKey.values()) {
      const merged = geoms.length === 1 ? (geoms[0] as Geom) : mergeAll(geoms);
      const data = merged.toData();
      parts.push({ ...data, material });
    }
    return { parts, colliders: this.colliders };
  }
}

function mergeAll(geoms: readonly Geom[]): Geom {
  const first = geoms[0] as Geom;
  const out = first.clone();
  for (let k = 1; k < geoms.length; k++) out.merge(geoms[k] as Geom);
  return out;
}
