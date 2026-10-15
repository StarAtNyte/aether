/**
 * Public data types of @aether/procgen. Everything here is plain data (typed
 * arrays, tuples, JSON) so outputs can cross Worker boundaries with zero-copy
 * transfers and be consumed by any renderer or physics engine.
 */
import type { GeneratorDef, Json, MaterialSpec, ParamSpec, Vec3 } from '@aether/core';

/** Axis-aligned bounding box as plain tuples. */
export interface Bounds {
  min: Vec3;
  max: Vec3;
}

/**
 * One drawable piece of a generated object (one draw call).
 *
 * - `positions`, `normals`: xyz per vertex (object space, meters, Y up).
 * - `indices`: counter-clockwise triangles (front faces), 3 per triangle.
 * - `uvs`: uv per vertex (optional).
 * - `colors`: LINEAR-space rgb per vertex (optional; present when
 *   `material.vertexColors` is true). Renderers multiply them with the
 *   material color, exactly like three.js vertex colors.
 */
export interface MeshPart {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  uvs?: Float32Array;
  colors?: Float32Array;
  /**
   * Terrain layer weights, 4 per vertex in [0, 1] (grass, rock, dry ground, snow; they sum to 1).
   * Present when `material.splat` is true; renderers that do not layer terrain ignore it and draw
   * the vertex colours.
   */
  splat?: Float32Array;
  /** Per-part material (merged with the entity material by the renderer). */
  material: MaterialSpec;
}

/**
 * Physics collider description in the object's local space.
 *
 * - `box.rotation` is Euler degrees in XYZ order (same as the World IR).
 * - `capsule` / `cylinder` are aligned with the local Y axis.
 * - `hull.points` is packed xyz; the convex hull of the points is used.
 * - `heightfield` is centered on the local origin in x/z, its base at y = 0.
 *   `rows` = number of cells along Z, `cols` = number of cells along X.
 *   `heights` has `(rows + 1) * (cols + 1)` NORMALIZED samples in [0, 1],
 *   stored X-major: `heights[ix * (rows + 1) + iz]` (this is Rapier's
 *   column-major layout, so it can be passed to
 *   `ColliderDesc.heightfield(rows, cols, heights, size)` unchanged).
 *   Sample `ix` lies at `x = -size[0] / 2 + ix * size[0] / cols`, sample `iz`
 *   at `z = -size[2] / 2 + iz * size[2] / rows`; its height in meters is
 *   `heights[...] * size[1]`. `size` = full extent (width x, max height, depth z).
 */
export type ColliderDesc =
  | { kind: 'box'; halfExtents: Vec3; offset: Vec3; rotation?: Vec3 }
  | { kind: 'sphere'; radius: number; offset: Vec3 }
  | { kind: 'capsule'; halfHeight: number; radius: number; offset: Vec3 }
  | { kind: 'cylinder'; halfHeight: number; radius: number; offset: Vec3 }
  | { kind: 'hull'; points: Float32Array; offset: Vec3 }
  | { kind: 'trimesh'; positions: Float32Array; indices: Uint32Array }
  | { kind: 'heightfield'; rows: number; cols: number; heights: Float32Array; size: Vec3 };

/** Result of running a generator. Treat as immutable (it may be cached and shared). */
export interface GeneratorOutput {
  parts: MeshPart[];
  colliders: ColliderDesc[];
  bounds: Bounds;
  stats: { triangles: number; ms: number };
  /** Non-fatal notes, e.g. why a fallback placeholder was produced. */
  warnings?: string[];
}

/** Built-in generator categories. */
export type GeneratorCategory = 'nature' | 'architecture' | 'props' | 'vehicles' | 'terrain' | 'fx' | 'interior';

/** A built-in procedural generator. `generate` resolves (defaults/clamps) params itself. */
export interface BuiltinGenerator {
  id: string;
  description: string;
  category: GeneratorCategory;
  params: Record<string, ParamSpec>;
  /**
   * Custom param resolution for generators whose params are nested JSON
   * (architecture: polylines, openings, finishes). Must validate untrusted
   * input and may throw; defaults to `resolveParams(params, …)`.
   */
  resolve?: (params: Record<string, Json>) => Record<string, Json>;
  generate(params: Record<string, Json>, api: GeneratorApi): GeneratorOutput;
}

/** Catalog entry handed to the agent prompt. */
export interface CatalogEntry {
  id: string;
  description: string;
  category: string;
  params: Record<string, ParamSpec>;
}

/**
 * A mutable mesh being built by a generator. All transforms mutate in place
 * and return the same handle for chaining.
 */
export interface MeshHandle {
  translate(x: number, y: number, z: number): MeshHandle;
  /** Rotate by Euler angles in degrees, XYZ order (matches three.js). */
  rotate(xDeg: number, yDeg: number, zDeg: number): MeshHandle;
  /** Scale (uniform when y/z are omitted). Normals stay correct under non-uniform scale. */
  scale(x: number, y?: number, z?: number): MeshHandle;
  /** Move every vertex along its normal by fn(x, y, z) meters, then recompute normals. */
  displace(fn: (x: number, y: number, z: number) => number): MeshHandle;
  /** Assign a per-vertex color ("#rrggbb") computed from the vertex position. */
  vertexColor(fn: (x: number, y: number, z: number) => string): MeshHandle;
  /** Append another mesh's geometry into this one (the other mesh is unchanged). */
  merge(other: MeshHandle): MeshHandle;
  clone(): MeshHandle;
  bounds(): Bounds;
}

/**
 * The API surface handed to BOTH built-in and LLM-written generators.
 * Primitives are centered on the origin unless documented otherwise.
 */
export interface GeneratorApi {
  /** Seeded PRNG in [0, 1). */
  rng: () => number;
  seed: number;
  noise2(x: number, y: number): number;
  noise3(x: number, y: number, z: number): number;
  fbm2(x: number, y: number, octaves?: number): number;
  box(w: number, h: number, d: number): MeshHandle;
  sphere(r: number, detail?: number): MeshHandle;
  cylinder(rTop: number, rBottom: number, h: number, segments?: number): MeshHandle;
  cone(r: number, h: number, segments?: number): MeshHandle;
  torus(r: number, tube: number): MeshHandle;
  capsule(r: number, h: number): MeshHandle;
  plane(w: number, d: number, segX?: number, segZ?: number): MeshHandle;
  lathe(profile: Array<[number, number]>, segments?: number): MeshHandle;
  extrude(shape: Array<[number, number]>, depth: number): MeshHandle;
  tube(path: Vec3[], radius: number, radialSegments?: number): MeshHandle;
  heightfield(cols: number, rows: number, width: number, depth: number, height: (x: number, z: number) => number): MeshHandle;
  icosphereRock(r: number, roughness: number): MeshHandle;
  /** Add a mesh with a material. Parts with equal materials are merged (fewer draw calls). */
  add(mesh: MeshHandle, material: MaterialSpec): void;
  /** Add an explicit physics collider. */
  collider(desc: ColliderDesc): void;
  /** Derive compound colliders from the added parts at build time. */
  autoColliders(mode?: 'box' | 'hull'): void;
  /** "#rrggbb" → [r, g, b] in 0..1 (sRGB). */
  color(hex: string): [number, number, number];
  /** Mix two colors (sRGB), t in 0..1 → "#rrggbb". */
  mix(a: string, b: string, t: number): string;
  build(): GeneratorOutput;
}

/** Runs LLM-written generator source in isolation. */
export interface SandboxRunner {
  run(def: GeneratorDef, params: Record<string, Json>, seed: number, opts?: { timeoutMs?: number }): Promise<GeneratorOutput>;
  dispose(): void;
}
