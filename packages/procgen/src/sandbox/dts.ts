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
  color?: string;              // "#rrggbb"
  roughness?: number;          // 0..1
  metalness?: number;          // 0..1
  emissive?: string;           // glow color "#rrggbb"
  emissiveIntensity?: number;  // 0..50 (1-4 looks good with bloom)
  opacity?: number;            // 0..1
  flatShading?: boolean;       // faceted low-poly look
  doubleSided?: boolean;       // both faces: shells people walk into
  vertexColors?: boolean;      // set automatically when the mesh has vertexColor()
}

type ColliderDesc =
  | { kind: 'box'; halfExtents: Vec3; offset: Vec3; rotation?: Vec3 }   // rotation: Euler degrees XYZ
  | { kind: 'sphere'; radius: number; offset: Vec3 }
  | { kind: 'capsule'; halfHeight: number; radius: number; offset: Vec3 } // Y-aligned
  | { kind: 'cylinder'; halfHeight: number; radius: number; offset: Vec3 } // Y-aligned
  | { kind: 'hull'; points: number[]; offset: Vec3 };                       // convex hull of xyz triples
// Collider coordinates use the same space as your meshes (before api.build() recentering; they move with it).

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
