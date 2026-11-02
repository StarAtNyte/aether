/**
 * TypeScript declaration text of the generator API, embedded in the coding
 * model's prompt. Keep in sync with types.ts / api.ts (a test checks that
 * every API method is documented here).
 */
import { MaterialPreset } from '@aether/core';
import { PROCGEN_LIMITS } from '../limits';

/** `.d.ts`-style description of GeneratorApi, MeshHandle, MaterialSpec and ColliderDesc for the LLM. */
export const GENERATOR_API_DTS = `// Aether procedural generator API.
// You write the BODY of: function generate(params, api) { ... }  and must end with: return api.build();
// Units: meters. Y is up. Angles in DEGREES. Colors are "#rrggbb" strings.
// All primitives are created CENTERED on the origin (plane lies in XZ at y = 0, facing +Y).
// api.build() moves the finished object so its lowest point is y = 0 and it is centered in x/z.
// Deterministic: use api.rng() (never Math.random) and api.noise2/noise3/fbm2 for variation.
// Sandbox rules: plain synchronous JavaScript only. No import/require/fetch/eval/Function/globalThis/
// window/self/document/timers/async/Promise/Proxy/Reflect/Symbol/prototype/constructor/escape sequences.
// Limits: ${PROCGEN_LIMITS.MAX_OUTPUT_VERTICES} vertices, ${PROCGEN_LIMITS.MAX_PARTS} distinct materials, ${PROCGEN_LIMITS.MAX_COLLIDERS} colliders, ${PROCGEN_LIMITS.DEFAULT_TIMEOUT_MS} ms.
// Keep props under ~3000 triangles. Reuse identical material objects: equal materials merge into one draw call.

type Vec3 = [number, number, number];

type MaterialPreset = ${MaterialPreset.options.map((o) => `'${o}'`).join(' | ')};

interface MaterialSpec {
  preset?: MaterialPreset;
  finish?: string;             // photographed surface at real scale, tinted by color: 'marble' 'stone' 'rock' 'plaster' 'brick' 'roof-tile' 'concrete' 'oak' 'bark' 'soil' 'sand' 'gravel' 'brass' 'black-metal' 'ceramic' 'fabric' 'tile' (use it: plain colours look flat)
  color?: string;              // "#rrggbb"
  roughness?: number;          // 0..1
  metalness?: number;          // 0..1
  emissive?: string;           // glow color "#rrggbb"
  emissiveIntensity?: number;  // 0..50 (1-4 looks good with bloom)
  opacity?: number;            // 0..1
  flatShading?: boolean;       // faceted low-poly look
  doubleSided?: boolean;       // both faces: shells people walk into
  vertexColors?: boolean;      // set automatically when the mesh has vertexColor()
  waterKind?: 'pond' | 'stream' | 'river' | 'lake' | 'sea' | 'fall'; // preset 'water': scale class; 'fall' = falling sheet (api.ribbon, v = metres from lip)
  waterFlow?: [number, number]; // current [x, z] m/s for streams and rivers
  surface?: { layers: SurfaceLayer[]; scale?: number }; // ≤8 weathering layers (moss, grime, edgeWear, cracks ...): see "Surface layers and shaders"
  shader?: { color?: string; roughness?: string; metalness?: string; emissive?: string; bump?: string; opacity?: string; displace?: string }; // expressions, same section
}

type ColliderDesc =
  | { kind: 'box'; halfExtents: Vec3; offset: Vec3; rotation?: Vec3 }   // rotation: Euler degrees XYZ
  | { kind: 'sphere'; radius: number; offset: Vec3 }
  | { kind: 'capsule'; halfHeight: number; radius: number; offset: Vec3 } // Y-aligned
  | { kind: 'cylinder'; halfHeight: number; radius: number; offset: Vec3 } // Y-aligned
  | { kind: 'hull'; points: number[]; offset: Vec3 };                       // convex hull of xyz triples
// Collider coordinates use the same space as your meshes (before api.build() recentering; they move with it).

// api.sdf tree: plain JSON, at most 400 nodes, depth 16. Any node may add at: Vec3, rot: Vec3 (degrees XYZ), scale: number.
type SdfNode =
  | { shape: 'sphere'; r: number } | { shape: 'ellipsoid'; r: Vec3 } | { shape: 'box'; size: Vec3; round?: number }
  | { shape: 'capsule'; a: Vec3; b: Vec3; r: number } | { shape: 'cone'; a: Vec3; b: Vec3; ra: number; rb: number } // round cone a→b
  | { shape: 'cylinder'; r: number; h: number } | { shape: 'torus'; R: number; r: number }                       // along Y / flat in XZ
  | { op: 'union' | 'intersect'; items: SdfNode[]; k?: number }  // k > 0: smooth blend radius in m (organic joins)
  | { op: 'subtract'; a: SdfNode; b: SdfNode; k?: number }       // carve b out of a
  | FigureNode;
// Posed, draped classical human 2 m tall (sole y=0, faces +Z, its right side -X); size with scale. Angles in degrees.
interface FigureNode {
  shape: 'figure'; sex?: 'f' | 'm'; seed?: number; garment?: 'peplos' | 'chiton' | 'himation' | 'chlamys' | 'nude' | 'lap';
  weight?: 'R' | 'L';  // standing leg
  hip?: { roll?: number; yaw?: number; pitch?: number }; chest?: { roll?: number; yaw?: number; pitch?: number }; head?: { yaw?: number; pitch?: number; roll?: number };
  armR?: Arm; armL?: Arm; freeAnkle?: Vec3; weightAnkle?: Vec3;  // IK targets in figure metres (stride: freeAnkle [-0.14, 0.08, 0.36])
  kneel?: number; seat?: number;  // kneel 0..1; seat = seat height in m (seated on a block, lap drape)
  hair?: 'wavy' | 'curly' | 'none'; beard?: boolean; strong?: boolean;
}
interface Arm { wrist?: Vec3; pole?: Vec3; fingers?: Vec3; curl?: Vec3 }  // pole: elbow direction; curl: finger joints in degrees. Raised: wrist [-0.27, 2.0, 0.16]

interface MeshHandle {
  translate(x: number, y: number, z: number): MeshHandle;
  rotate(xDeg: number, yDeg: number, zDeg: number): MeshHandle;  // Euler XYZ, about the origin
  scale(x: number, y?: number, z?: number): MeshHandle;           // uniform when y/z omitted
  displace(fn: (x: number, y: number, z: number) => number): MeshHandle;    // push vertices along normals
  warp(fn: (x: number, y: number, z: number) => number[]): MeshHandle;       // move vertices to [x,y,z]: bend along a curve
  vertexColor(fn: (x: number, y: number, z: number) => string): MeshHandle; // per-vertex "#rrggbb"
  merge(other: MeshHandle): MeshHandle;  // append other's geometry into this mesh
  clone(): MeshHandle;
  bounds(): { min: Vec3; max: Vec3 };
}

interface GeneratorApi {
  rng(): number;                 // seeded random in [0, 1)
  seed: number;
  noise2(x: number, y: number): number;              // simplex noise in [-1, 1]
  noise3(x: number, y: number, z: number): number;   // simplex noise in [-1, 1]
  fbm2(x: number, y: number, octaves?: number): number; // fractal noise in ~[-1, 1]

  box(w: number, h: number, d: number): MeshHandle;
  roundedBox(w: number, h: number, d: number, r: number, segments?: number): MeshHandle; // box with bevelled edges (radius r)
  sphere(r: number, detail?: number): MeshHandle;                          // detail 0..6 (default 2)
  cylinder(rTop: number, rBottom: number, h: number, segments?: number): MeshHandle; // along Y, capped
  cone(r: number, h: number, segments?: number): MeshHandle;               // apex up
  torus(r: number, tube: number): MeshHandle;                              // ring in the XY plane (rotate(90,0,0) to lay flat)
  capsule(r: number, h: number): MeshHandle;                               // h = total height, along Y
  plane(w: number, d: number, segX?: number, segZ?: number): MeshHandle;   // XZ plane, facing +Y
  lathe(profile: Array<[number, number]>, segments?: number): MeshHandle;  // [radius, y] points revolved around Y; repeat a point for a sharp edge
  extrude(shape: Array<[number, number]>, depth: number): MeshHandle;      // polygon in XY (concave ok), extruded along Z, centered
  tube(path: Vec3[], radius: number, radialSegments?: number): MeshHandle; // pipe along a polyline, capped
  ribbon(path: Vec3[], width: number, widthAt?: (t: number) => number): MeshHandle; // flat strip along a path: u 0..1 across, v metres along (waterfall sheets, roads)
  sdf(tree: SdfNode, opts?: { resolution?: number; cell?: number; smooth?: number; detail?: (x: number, y: number, z: number) => number }): MeshHandle;
  // sculpt statues, figures, animals, drapery, rocks: smooth mesh of the tree (resolution = cells on the longest side, default 128,
  // ≤120k triangles; a figure takes ~1 s). detail(x,y,z) is added to the distance at every sample: carving noise, but slow.
  library(id: string, params?: Record<string, unknown>): Array<{ mesh: MeshHandle; material: MaterialSpec }>;
  // a built-in generator's parts (base on y 0) to sculpt on: warp/displace/merge each mesh, then api.add(mesh, material).
  // Built-ins only (no arch-/furn-), ≤ 32 per object. e.g. weather a column: for (const p of api.library('column', { variant: 0 })) api.add(p.mesh.displace((x, y, z) => 0.01 * api.noise3(x * 9, y * 9, z * 9)), p.material);
  heightfield(cols: number, rows: number, width: number, depth: number, height: (x: number, z: number) => number): MeshHandle; // grid in XZ
  icosphereRock(r: number, roughness: number): MeshHandle;                 // faceted noisy rock, roughness 0..1

  add(mesh: MeshHandle, material: MaterialSpec): void;   // add a finished mesh to the object
  collider(desc: ColliderDesc): void;                     // explicit physics collider (prefer boxes/cylinders/hulls)
  autoColliders(mode?: 'box' | 'hull' | 'trimesh'): void; // derive colliders from added meshes (used if you add none); 'trimesh' = the exact surface: use it for terrain, streets and anything walked on (a box would be a solid slab up to its top)
  color(hex: string): [number, number, number];           // "#rrggbb" -> [r, g, b] in 0..1
  mix(a: string, b: string, t: number): string;           // blend two colors, t in 0..1
  build(): GeneratorOutput;                                // ALWAYS return api.build()
}
`;
