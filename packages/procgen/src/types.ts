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
  /**
   * Render-ready streams of this part, computed off the main thread by the renderer's generation workers (never by
   * generators, never validated as generator output). Absent: the renderer computes them itself.
   */
  prepared?: PreparedPart;
}

/**
 * Vertex streams of a {@link MeshPart} as the renderer draws them (texture coordinates in metres, corners split where
 * the projection turns, indices narrowed to 16 bits when they fit) plus its bounds. Arrays may be the part's own.
 */
export interface PreparedPart {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint16Array | Uint32Array;
  uvs: Float32Array;
  colors: Float32Array | null;
  splat: Float32Array | null;
  /**
   * 32-bit indices matching `positions` when the corners were split and `indices` are those same 32-bit indices; null
   * otherwise (16-bit indices are widened on demand from the geometry's index, see `split`).
   */
  splitIndices: Uint32Array | null;
  /** True when the corners were split for the UVs: `positions` are not the part's own (null `splitIndices`: widen `indices`). */
  split?: boolean;
  /** Bounding box (min xyz, max xyz) and sphere (centre xyz, radius); null: computed when the geometry is built. */
  bounds: Float64Array | null;
  /** For parts big enough for virtual geometry: true when the part is a kit of small separate pieces. */
  kit?: boolean;
  /**
   * Soft-shaded variant for the crease angle the part's own material asks for (organic presets on flat-shaded parts):
   * the new normals and their own prepared streams (null: softening changes nothing for that crease).
   */
  soft?: { crease: number; normals: Float32Array | null; prepared: PreparedPart | null };
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
  /** Move every vertex to fn(x, y, z) → [x, y, z] (a smooth bend, no mirroring), then recompute normals. */
  warp(fn: (x: number, y: number, z: number) => readonly number[]): MeshHandle;
  /** Assign a per-vertex color ("#rrggbb") computed from the vertex position. */
  vertexColor(fn: (x: number, y: number, z: number) => string): MeshHandle;
  /** Append another mesh's geometry into this one (the other mesh is unchanged). */
  merge(other: MeshHandle): MeshHandle;
  clone(): MeshHandle;
  bounds(): Bounds;
}

/** A node of an `api.sdf` tree (plain JSON; validated by the kernel, see `GENERATOR_API_DTS`). */
export type SdfNode = Record<string, unknown>;

/** Options of `api.sdf`. */
export interface SdfOptions {
  /** Cell size in metres (default: longest side of the bounds / resolution). */
  cell?: number;
  /** Cells along the longest side of the bounds (default 128, max 512). */
  resolution?: number;
  /** Laplacian smoothing passes 0..4 (default 1). */
  smooth?: number;
  /** Newton projection passes onto the surface 0..3 (default 1). */
  project?: number;
  /** Meshing bounds (default: conservative bounds of the tree). */
  min?: Vec3;
  max?: Vec3;
  /** Added to the distance at every sample (carving, fold noise). Called for every sample: costly. */
  detail?: (x: number, y: number, z: number) => number;
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
  /** Box with rounded (bevelled) edges of radius r (segments per edge, default 2): use it for walls, plinths, trim, steps, furniture. */
  roundedBox(w: number, h: number, d: number, r: number, segments?: number): MeshHandle;
  sphere(r: number, detail?: number): MeshHandle;
  cylinder(rTop: number, rBottom: number, h: number, segments?: number): MeshHandle;
  cone(r: number, h: number, segments?: number): MeshHandle;
  torus(r: number, tube: number): MeshHandle;
  capsule(r: number, h: number): MeshHandle;
  plane(w: number, d: number, segX?: number, segZ?: number): MeshHandle;
  lathe(profile: Array<[number, number]>, segments?: number): MeshHandle;
  extrude(shape: Array<[number, number]>, depth: number): MeshHandle;
  tube(path: Vec3[], radius: number, radialSegments?: number): MeshHandle;
  ribbon(path: Vec3[], width: number, widthAt?: (t: number) => number): MeshHandle;
  /**
   * Sculpt with signed distance fields: a plain-JSON tree of shapes (sphere, ellipsoid, box, capsule, cone,
   * cylinder, torus, posed draped `figure`), smooth booleans (union, subtract, intersect) and transforms, meshed
   * with surface nets (smooth gradient normals, metre UVs). See `SdfNode` in the sandbox API text.
   */
  sdf(tree: SdfNode, opts?: SdfOptions): MeshHandle;
  /**
   * A built-in generator's geometry to sculpt on (warp, displace, merge, then `add`): one entry per material part,
   * already grounded (base on y = 0, centred in x/z). Built-ins only (not the arch-/furn- building parts); at most 32
   * per object; the seed derives from this generator's seed; the vertices count against this generator's budget.
   */
  library(id: string, params?: Record<string, Json>): Array<{ mesh: MeshHandle; material: MaterialSpec }>;
  heightfield(cols: number, rows: number, width: number, depth: number, height: (x: number, z: number) => number): MeshHandle;
  icosphereRock(r: number, roughness: number): MeshHandle;
  /** Add a mesh with a material. Parts with equal materials are merged (fewer draw calls). */
  add(mesh: MeshHandle, material: MaterialSpec): void;
  /** Add an explicit physics collider. */
  collider(desc: ColliderDesc): void;
  /** Derive compound colliders from the added parts at build time. */
  autoColliders(mode?: 'box' | 'hull' | 'trimesh'): void;
  /** "#rrggbb" → [r, g, b] in 0..1 (sRGB). */
  color(hex: string): [number, number, number];
  /** Mix two colors (sRGB), t in 0..1 → "#rrggbb". */
  mix(a: string, b: string, t: number): string;
  build(): GeneratorOutput;
}

/** Options of one sandbox run. */
export interface SandboxRunOptions {
  /** Wall-clock budget of the run in ms. */
  timeoutMs?: number;
  /** Queue order: lower runs first (e.g. the distance to the view); default 0. Runs of one priority keep their order. */
  priority?: number;
}

/** Runs LLM-written generator source in isolation. */
export interface SandboxRunner {
  run(def: GeneratorDef, params: Record<string, Json>, seed: number, opts?: SandboxRunOptions): Promise<GeneratorOutput>;
  /**
   * Like {@link run}, but resolves with the worker's reply as it arrived, NOT validated: the caller must validate it
   * (`validateOutput`) before use, typically in a trusted worker, so the page never scans the buffers. Optional.
   */
  runRaw?(def: GeneratorDef, params: Record<string, Json>, seed: number, opts?: SandboxRunOptions): Promise<unknown>;
  dispose(): void;
}
