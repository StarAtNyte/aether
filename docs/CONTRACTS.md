# Aether — package contracts

This file is the coordination contract between packages. Each package MUST export
exactly these public names from `src/index.ts` (more is fine, fewer is not).
The data model lives in `packages/core/src/schema.ts` and is authoritative.

Monorepo: npm workspaces, TypeScript (strict), ESM, source-level exports
(`"exports": {".": "./src/index.ts"}` — no build step for packages; Vite bundles
the studio and `tsx` runs the server). Tests: Vitest, `packages/<pkg>/test/*.test.ts`,
run from the repo root with `npx vitest run packages/<pkg>`.

Dependency graph (no cycles allowed):

```
core  <- procgen <- render <- studio
core  <- physics <-------------- studio
core  <- logic   <-------------- studio
core  <- agent   <- server
                 <-------------- studio
```

`physics`, `logic`, `procgen` and `agent` MUST NOT import `three` or the DOM
(except `procgen/sandbox` and `agent/providers/http` which may use Worker/fetch),
so they run headless in Node for tests and in Web Workers.
`physics` may import `procgen` (builtin generators) to derive default procedural colliders headlessly.

---

## @aether/core

```ts
export * from './schema';                       // zod schemas + types (WorldDoc, Entity, Patch, …)

// Creation / validation
export function createWorld(input?: WorldDocInput): WorldDoc;
export function validateWorld(doc: unknown): { ok: true; world: WorldDoc } | { ok: false; issues: Issue[] };
export interface Issue { path: string; message: string; }

// Patching (pure, immutable — returns new doc, structural sharing allowed)
export interface PatchResult { world: WorldDoc; applied: Patch[]; errors: PatchError[]; }
export interface PatchError { index: number; op: string; message: string; }
export function applyPatches(world: WorldDoc, patches: readonly unknown[], opts?: { atomic?: boolean }): PatchResult;
//   - each patch is zod-validated; invalid ones are reported in `errors` (never thrown)
//   - atomic: if any patch fails, return the original world and all errors
//   - referential checks: parent exists & no cycles, joint target exists, rule selectors syntactically valid,
//     duplicate ids rejected on add, `update` deep-merges objects and replaces arrays, re-validates the entity
//   - limits enforced: LIMITS below
//   - prototype-pollution safe: reject keys "__proto__", "constructor", "prototype" anywhere in patch input
export function invertPatches(before: WorldDoc, patches: readonly Patch[]): Patch[]; // for undo
export const LIMITS: { MAX_ENTITIES: number; MAX_RULES: number; MAX_SCATTER_TOTAL: number; MAX_GENERATORS: number; MAX_SCRIPTS: number; MAX_TESTS: number };

// Diffing (used by render/physics to sync incrementally)
export interface WorldDiff { added: EntityId[]; removed: EntityId[]; changed: EntityId[]; environmentChanged: boolean; playerChanged: boolean; rulesChanged: boolean; generatorsChanged: string[]; }
export function diffWorlds(a: WorldDoc, b: WorldDoc): WorldDiff;   // reference-equality fast path, then stable deep compare

// Selectors and queries
export function resolveSelector(world: WorldDoc, selector: string, ctx?: { playerId?: EntityId }): EntityId[];
export function childrenOf(world: WorldDoc, id: EntityId): EntityId[];
export function worldTransform(world: WorldDoc, id: EntityId): { position: Vec3; quaternion: [number, number, number, number]; scale: Vec3 };
export function readStateKey(world: WorldDoc, key: string): Json | undefined;   // "score" or "door-1.open"
export function compare(a: Json | undefined, op: CompareOp, b: Json): boolean;
export function stableStringify(v: unknown): string;   // sorted keys, used for cache keys

// History (undo/redo + named branches), pure data structure, serializable
export class History {
  constructor(initial: WorldDoc, opts?: { maxEntries?: number });
  get current(): WorldDoc;
  get size(): number;                                  // entries held in memory (all branches)
  get entryLimit(): number;
  setMaxEntries(max: number): number;                  // memory budget: prunes oldest entries now, never the current position
  commit(patches: readonly unknown[], message: string, source?: 'agent' | 'user' | 'system'): PatchResult;
  undo(): WorldDoc | null;  redo(): WorldDoc | null;
  canUndo(): boolean; canRedo(): boolean;
  entries(): ReadonlyArray<{ id: number; message: string; source: string; patchCount: number }>;
  checkout(entryId: number): WorldDoc;                 // time travel (non-destructive)
  branch(name: string): void; switchBranch(name: string): WorldDoc; branches(): string[]; currentBranch(): string;
  subscribe(fn: (world: WorldDoc) => void): () => void;
  toJSON(): unknown; static fromJSON(json: unknown): History;
}

// Deterministic utilities
export function rng(seed: number): () => number;      // sfc32/mulberry32, [0,1)
export function hashString(s: string): number;        // 32-bit FNV-1a
export function eulerDegToQuat(r: Vec3): [number, number, number, number];   // XYZ order, matches three.js Euler('XYZ')
export function quatToEulerDeg(q: [number, number, number, number]): Vec3;
export function slugify(name: string): EntityId;       // "Red Car!" -> "red-car"
export function uniqueId(world: WorldDoc, base: string): EntityId; // "tree" -> "tree-3"

// Compact text summary of a world for LLM context (token-efficient, deterministic ordering)
export function summarizeWorld(world: WorldDoc, opts?: { maxEntities?: number; focus?: EntityId[] }): string;

// Typed event bus
export class Emitter<E extends Record<string, unknown>> { on<K extends keyof E>(k: K, fn: (e: E[K]) => void): () => void; emit<K extends keyof E>(k: K, e: E[K]): void; clear(): void; }
```

## @aether/procgen

Deterministic geometry generation producing plain data (typed arrays) — no three.js.

```ts
export interface MeshPart {
  positions: Float32Array; normals: Float32Array; indices: Uint32Array; uvs?: Float32Array; colors?: Float32Array;
  material: MaterialSpec;              // per-part material (merged with entity material by renderer)
}
export type ColliderDesc =
  | { kind: 'box'; halfExtents: Vec3; offset: Vec3; rotation?: Vec3 }
  | { kind: 'sphere'; radius: number; offset: Vec3 }
  | { kind: 'capsule'; halfHeight: number; radius: number; offset: Vec3 }
  | { kind: 'cylinder'; halfHeight: number; radius: number; offset: Vec3 }
  | { kind: 'hull'; points: Float32Array; offset: Vec3 }
  | { kind: 'trimesh'; positions: Float32Array; indices: Uint32Array }
  | { kind: 'heightfield'; rows: number; cols: number; heights: Float32Array; size: Vec3 }; // heights row-major (rows+1)*(cols+1)? -> document exactly; size = full extent (x, maxHeight, z)
export interface GeneratorOutput { parts: MeshPart[]; colliders: ColliderDesc[]; bounds: { min: Vec3; max: Vec3 }; stats: { triangles: number; ms: number }; }

export interface BuiltinGenerator {
  id: string; description: string; category: 'nature' | 'architecture' | 'props' | 'vehicles' | 'terrain' | 'fx';
  params: Record<string, ParamSpec>;
  generate(params: Record<string, Json>, api: GeneratorApi): GeneratorOutput;
}
export const BUILTIN_GENERATORS: Record<string, BuiltinGenerator>;     // ≥ 20 high-quality generators
export function catalog(): Array<{ id: string; description: string; category: string; params: Record<string, ParamSpec> }>; // for agent prompt

// The API surface handed to BOTH built-in and LLM-written generators (keep it small, typed, LLM-friendly)
export interface GeneratorApi {
  rng: () => number; seed: number;
  noise2(x: number, y: number): number; noise3(x: number, y: number, z: number): number; fbm2(x: number, y: number, octaves?: number): number;
  box(w: number, h: number, d: number): MeshHandle; sphere(r: number, detail?: number): MeshHandle;
  cylinder(rTop: number, rBottom: number, h: number, segments?: number): MeshHandle; cone(r: number, h: number, segments?: number): MeshHandle;
  torus(r: number, tube: number): MeshHandle; capsule(r: number, h: number): MeshHandle; plane(w: number, d: number, segX?: number, segZ?: number): MeshHandle;
  lathe(profile: Array<[number, number]>, segments?: number): MeshHandle;
  extrude(shape: Array<[number, number]>, depth: number): MeshHandle;
  tube(path: Vec3[], radius: number, radialSegments?: number): MeshHandle;
  heightfield(cols: number, rows: number, width: number, depth: number, height: (x: number, z: number) => number): MeshHandle;
  icosphereRock(r: number, roughness: number): MeshHandle;
  add(mesh: MeshHandle, material: MaterialSpec): void;            // parts with equal materials are merged (fewer draw calls)
  collider(desc: ColliderDesc): void;                              // explicit physics collider
  autoColliders(mode?: 'box' | 'hull'): void;                      // derive colliders from added parts
  color(hex: string): [number, number, number]; mix(a: string, b: string, t: number): string;
  build(): GeneratorOutput;
}
export interface MeshHandle {
  translate(x: number, y: number, z: number): MeshHandle; rotate(xDeg: number, yDeg: number, zDeg: number): MeshHandle; scale(x: number, y?: number, z?: number): MeshHandle;
  displace(fn: (x: number, y: number, z: number) => number): MeshHandle;   // along normals
  vertexColor(fn: (x: number, y: number, z: number) => string): MeshHandle;
  merge(other: MeshHandle): MeshHandle; clone(): MeshHandle;
  bounds(): { min: Vec3; max: Vec3 };
}
export function createGeneratorApi(seed: number): GeneratorApi;

// Main entry used by render/physics: builtin OR custom (world.generators) — custom requires the sandbox
export function generate(shape: ProceduralShape, world: Pick<WorldDoc, 'generators'>, opts?: { sandbox?: SandboxRunner; cache?: GeneratorCache }): Promise<GeneratorOutput>;
export function generateBuiltinSync(generatorId: string, params: Record<string, Json>, seed: number): GeneratorOutput;
export function primitiveOutput(shape: PrimitiveShape, material?: MaterialSpec): GeneratorOutput;  // primitives through the same path
export function resolveParams(spec: Record<string, ParamSpec>, params: Record<string, Json>): Record<string, Json>; // defaults + clamping + type coercion
export function fallbackOutput(reason: string): GeneratorOutput;   // visible placeholder when a generator fails

// Cache (LRU, keyed by generator id + stableStringify(params) + seed + source hash)
// Bounded by entry count AND by the bytes of the outputs' typed arrays (default 64 MB); an output larger than the budget is not cached.
export class GeneratorCache { constructor(maxEntries?: number, maxBytes?: number); get(key: string): GeneratorOutput | undefined; set(key: string, v: GeneratorOutput): void; key(shape: ProceduralShape, sourceHash?: number): string; clear(): void; readonly bytes: number; readonly byteLimit: number; setByteLimit(maxBytes: number): void; }
export function outputBytes(out: GeneratorOutput): number;   // typed-array bytes of mesh parts + colliders
export const DEFAULT_CACHE_BYTES: number;

// Sandbox for LLM-written generator source (SECURITY CRITICAL)
export interface SandboxRunner { run(def: GeneratorDef, params: Record<string, Json>, seed: number, opts?: { timeoutMs?: number }): Promise<GeneratorOutput>; dispose(): void; }
export function createWorkerSandbox(opts?: { timeoutMs?: number; poolSize?: number }): SandboxRunner;   // browser: Worker pool, watchdog terminate, no network, output size caps
// Exported from the `@aether/procgen/node` SUBPATH only (not src/index.ts), so node:vm never enters the browser bundle.
export function createNodeSandbox(opts?: { timeoutMs?: number }): SandboxRunner;      // tests/server validation: node:vm with timeout, no require/process; NOT a security boundary (server runs it in a resource-limited worker thread, off by default)
export function staticCheckSource(source: string): { ok: boolean; problems: string[] }; // reject import/require/fetch/eval/Function/globalThis/postMessage/etc.
export function validateOutput(out: unknown): { ok: true; output: GeneratorOutput } | { ok: false; error: string }; // shape + NaN + size caps (≤ 2M verts)
export const GENERATOR_API_DTS: string;                  // .d.ts text of GeneratorApi for the LLM prompt
export const GENERATOR_EXAMPLES: Array<{ prompt: string; def: GeneratorDef }>; // few-shot examples (verified to run in tests)
```

## @aether/physics

Rapier (`@dimforge/rapier3d-compat` 0.21.0) wrapper. Headless-capable.

```ts
export async function initPhysics(): Promise<void>;     // idempotent RAPIER.init()
export interface BodyState { position: Vec3; quaternion: [number, number, number, number]; linvel: Vec3; angvel: Vec3; sleeping: boolean; }
export interface PhysicsEvent { type: 'collisionStart' | 'collisionEnd' | 'sensorEnter' | 'sensorExit'; a: EntityId; b: EntityId; impulse?: number; }
export type ColliderProvider = (entity: Entity) => ColliderDesc[] | undefined;   // procedural colliders from procgen output

export class PhysicsWorld {
  static async create(world: WorldDoc, opts?: { colliders?: ColliderProvider; fixedDt?: number }): Promise<PhysicsWorld>;
  sync(world: WorldDoc, diff?: WorldDiff): void;          // incremental: add/remove/update bodies, joints, gravity
  step(dt: number): PhysicsEvent[];                       // fixed-timestep accumulator, max substeps clamp (spiral-of-death guard)
  stepFixed(): PhysicsEvent[];
  readonly time: number;
  readonly alpha: number;                                 // interpolation factor for rendering
  getState(id: EntityId): BodyState | undefined;
  getAllStates(): Map<EntityId, BodyState>;
  dynamicIds(): EntityId[];
  writeTransforms(into: Float32Array, order: EntityId[]): void;   // packed [px,py,pz,qx,qy,qz,qw]* for zero-alloc render sync
  applyImpulse(id: EntityId, v: Vec3): void; setVelocity(id: EntityId, v: Vec3): void; setAngularVelocity(id: EntityId, v: Vec3): void;
  setKinematicTarget(id: EntityId, position: Vec3, quaternion: [number, number, number, number]): void;
  teleport(id: EntityId, position: Vec3, quaternion?: [number, number, number, number]): void;
  explode(center: Vec3, force: number, radius: number): void;
  setGravity(v: Vec3): void;
  addEntity(entity: Entity): void; removeEntity(id: EntityId): void;   // runtime spawn/destroy
  raycast(origin: Vec3, dir: Vec3, maxDist: number, excludeId?: EntityId): { id: EntityId | null; point: Vec3; normal: Vec3; distance: number } | null;
  overlapsSphere(center: Vec3, radius: number): EntityId[];
  snapshot(): Uint8Array;
  static async restore(snapshot: Uint8Array, world: WorldDoc, opts?: { colliders?: ColliderProvider }): Promise<PhysicsWorld>;
  fork(): Promise<PhysicsWorld>;
  stats(): { bodies: number; colliders: number; joints: number; stepMs: number };
  dispose(): void;
}

// Character controller (kinematic capsule) for the player
export class CharacterController { constructor(pw: PhysicsWorld, opts: { radius: number; height: number; spawn: Vec3 }); move(input: { forward: number; right: number; jump: boolean; yawDeg: number }, dt: number, speed: number, jumpSpeed: number): Vec3; readonly position: Vec3; readonly grounded: boolean; teleport(p: Vec3): void; dispose(): void; }

// Settling ("drop & freeze", PAT3D-style): simulate, then write rest poses back as patches
export interface SettleReport { patches: Patch[]; moved: Array<{ id: EntityId; distance: number }>; unstable: EntityId[]; fellOut: EntityId[]; seconds: number; ms: number; }
export async function settle(world: WorldDoc, opts?: { seconds?: number; colliders?: ColliderProvider; only?: EntityId[] }): Promise<SettleReport>;

// Static checks without stepping: interpenetrations, floating objects, out-of-bounds
export interface Diagnostic { severity: 'error' | 'warning' | 'info'; code: 'overlap' | 'floating' | 'outOfBounds' | 'jointInvalid' | 'tooManyBodies' | 'fellOut' | 'unstable'; entities: EntityId[]; message: string; suggestion?: string; }
export async function diagnose(world: WorldDoc, opts?: { colliders?: ColliderProvider }): Promise<Diagnostic[]>;

// Verification: run world.tests headless (fork, fast-forward), with logic hooked in via callback
export interface TestResult { id: string; kind: string; passed: boolean; message: string; atTime?: number; }
export interface VerifyReport { passed: boolean; results: TestResult[]; diagnostics: Diagnostic[]; simulatedSeconds: number; ms: number; }
export interface LogicHook { tick(dt: number, pw: PhysicsWorld, events: PhysicsEvent[]): void; readState(key: string): Json | undefined; }
export async function verify(world: WorldDoc, opts?: { colliders?: ColliderProvider; logic?: (pw: PhysicsWorld) => LogicHook; maxSeconds?: number; budgetMs?: number }): Promise<VerifyReport>;
export function summarizeReport(report: VerifyReport): string;   // compact text for the LLM repair loop

// Collider output caches (built-in generators / primitives): ≤ 64 entries and ≤ MAX_COLLIDER_CACHE_BYTES (32 MB) each
export function clearColliderCache(): void;
export function colliderCacheStats(): { entries: number; bytes: number };
```

## @aether/logic

Deterministic gameplay runtime: built-in behaviors + rules + sandboxed scripts.
Talks to the outside world only through the `LogicHost` interface (implemented by
the studio with physics + render, and by tests with fakes).

```ts
export interface LogicHost {
  getTransform(id: EntityId): { position: Vec3; quaternion: [number, number, number, number] } | undefined;
  setKinematic(id: EntityId, position: Vec3, quaternion: [number, number, number, number]): void; // for kinematic/no-physics entities
  applyImpulse(id: EntityId, v: Vec3): void; setVelocity(id: EntityId, v: Vec3): void; getVelocity(id: EntityId): Vec3 | undefined;
  teleport(id: EntityId, p: Vec3): void; explode(center: Vec3, force: number, radius: number): void; setGravity(v: Vec3): void;
  spawn(entity: Entity): void; destroy(id: EntityId): void;         // host applies to physics/render and to its world copy
  setProperty(id: EntityId, path: string, value: Json): void;        // e.g. "material.color", "visible", "light.intensity"
  message(text: string, duration: number): void; sound(name: string): void;
  gameOver(result: 'win' | 'lose', text: string): void; reset(): void;
  playerId(): EntityId | undefined;
}
export interface InputState { forward: number; right: number; jump: boolean; action: boolean; keys: ReadonlySet<string>; pointerYawDeg: number; }
export const EMPTY_INPUT: InputState;

export class LogicRuntime {
  constructor(world: WorldDoc, host: LogicHost, opts?: { scripts?: ScriptRunner; seed?: number });
  start(): void;                                   // fires 'start' rules, initializes behaviors
  tick(dt: number, input: InputState, events: readonly PhysicsEventLike[]): void;   // fixed dt from caller
  click(id: EntityId): void; emit(event: string): void;
  get state(): Readonly<Record<string, Json>>;     // world state (score, lives…)
  entityState(id: EntityId): Readonly<Record<string, Json>>;
  readState(key: string): Json | undefined;        // "score" or "door-1.open"
  get time(): number;
  get status(): 'playing' | 'won' | 'lost';
  readonly log: Array<{ t: number; rule?: string; text: string }>;   // trace for the "why did this happen" panel (bounded ring buffer)
  updateWorld(world: WorldDoc): void;              // hot-reload rules/behaviors while preserving state
  dispose(): void;
}
export type PhysicsEventLike = { type: 'collisionStart' | 'collisionEnd' | 'sensorEnter' | 'sensorExit'; a: EntityId; b: EntityId; impulse?: number };

export interface BehaviorCatalogEntry { type: BuiltinBehavior; description: string; params: Record<string, ParamSpec>; requires?: string; }
export const BEHAVIOR_CATALOG: BehaviorCatalogEntry[];      // every BuiltinBehavior documented (for agent prompt)
export const RULE_DOCS: string;                             // compact docs of triggers/actions for the agent prompt

export interface ScriptRunner { load(def: ScriptDef): void; update(scriptId: string, entityId: EntityId, snap: ScriptSnapshot): ScriptIntent[]; dispose(): void; }
export interface ScriptSnapshot { dt: number; time: number; self: { id: EntityId; position: Vec3; velocity: Vec3; state: Record<string, Json> }; player?: { position: Vec3 }; world: Record<string, Json>; nearby: Array<{ id: EntityId; tags: string[]; position: Vec3 }>; input: { forward: number; right: number; jump: boolean; action: boolean }; }
export type ScriptIntent = Action | { do: 'moveTo'; target: Vec3; speed: number } | { do: 'setSelfState'; key: string; value: Json };
export function createScriptRunner(opts?: ScriptRunnerOptions): ManagedScriptRunner;   // QuickJS sandbox; throws until initScripting() resolved
export function initScripting(): Promise<void>;     // LAZY: imports QuickJS (one variant: release-sync) on first call only
export function isScriptingReady(): boolean;
export function scriptHeapUsage(): { reservedBytes: number; abandonedRuntimes: number };
export const SCRIPT_API_DTS: string;
```

The package entry never imports QuickJS statically (a unit test walks the
static import graph): worlds without scripts never download or compile it.

## @aether/render

three.js r186. Prefers `WebGPURenderer` (`three/webgpu`) with automatic WebGL2 fallback (the same renderer forced onto its WebGL2 backend; every feature below works on both).

```ts
export type BackendPreference = 'auto' | 'webgpu' | 'webgl2';
export interface RendererOptions {
  backend?: BackendPreference;                            // default 'auto' (policy below)
  preferWebGPU?: boolean;                                 // deprecated: false = 'webgl2'
  antialias?: boolean; shadows?: boolean; pixelRatioCap?: number;   // pixelRatioCap: extra cap on top of the GPU budget
  sandbox?: SandboxRunner; onProgress?: (msg: string) => void;
  geometrySource?: GeometrySource; modelLoader?: ModelLoader; maxInstances?: number;   // default: the budget's instance cap
  lowMemory?: boolean;                                    // low-memory budget (see renderBudget); lowPower is a deprecated alias
  onContextLost?: (info: { backend: 'webgpu' | 'webgl2'; message: string }) => void;   // device/context lost: renderer stops drawing; host replaces it
  growIn?: boolean;                                       // default true: new entities grow in (false for reduced motion)
}
export class WorldRenderer {
  static async create(canvas: HTMLCanvasElement, opts?: RendererOptions): Promise<WorldRenderer>;
  readonly backend: 'webgpu' | 'webgl2';
  readonly gpu: Readonly<{ description: string; tier: GpuTier }>;
  readonly domElement: HTMLCanvasElement;
  get contextLost(): boolean; get frameCount(): number; get lowMemoryMode(): boolean;
  get camera(): THREE.PerspectiveCamera;
  get contentSphere(): Readonly<{ center: Vec3; radius: number }> | null;   // meaningful content (fog, shadows, framing)
  get cameraFlying(): boolean;                            // an automatic camera flight is in progress
  get fogState(): Readonly<{ color: string; density: number }> | null;      // fog after the content-size policy
  setWorld(world: WorldDoc): Promise<void>;               // incremental sync via diffWorlds; async because procedural generation may be sandboxed
  getGeneratorOutput(id: EntityId): GeneratorOutput | undefined;   // so physics can use procedural colliders
  applyTransforms(packed: Float32Array, order: EntityId[]): void;   // from PhysicsWorld.writeTransforms
  setEntityProperty(id: EntityId, path: string, value: Json): void;
  clearRuntimeOverrides(): void;
  addTransient(entity: Entity, opts?: { trusted?: boolean }): void; removeTransient(id: EntityId): void;   // runtime spawns not in doc
  setCameraMode(mode: 'orbit' | 'follow' | 'firstPerson', target?: EntityId): void;
  setPlayerAvatar(position: Vec3, yawDeg: number): void;
  frameContent(opts?: { focus?: EntityId[]; focusPoints?: Vec3[]; duration?: number; flyIn?: boolean }): boolean;   // auto-framing (see below)
  reveal(ids: EntityId[], duration?: number): boolean;    // re-frame only when edited entities are off screen / too small
  frameSphere(center: Vec3, radius: number, direction?: Vec3, duration?: number): void;
  viewFrom(direction: Vec3, duration?: number): void;     // camera preset (top/front/side/iso): no elevation clamp, frames contentSphere
  orbitTarget(out?: Vec3): Vec3;                          // editor orbit target (placement point)
  entityBounds(id: EntityId): { min: Vec3; max: Vec3 } | null;   // world bounds at full scale
  get animating(): boolean;                               // grow-in or camera flight in progress (captures wait for it)
  setGizmo(id: EntityId | null, mode: 'translate' | 'rotate' | 'scale' | null, onCommit?: (c: GizmoChange) => void): Promise<void>;   // TransformControls (lazy); one commit per drag
  get gizmoBusy(): boolean;                               // a handle is hovered or dragged: clicks must not change the selection
  focus(id: EntityId): void;                              // smooth camera fly-to
  pick(ndcX: number, ndcY: number): EntityId | null;
  highlight(ids: EntityId[]): void;                       // selection outline
  showGhost(world: WorldDoc | null): void;                // translucent preview of a proposed world
  showDebug(opts: { colliders?: boolean; bounds?: boolean; diagnostics?: Diagnostic[] }): void;
  screenshot(opts?: { width?: number; height?: number; mime?: string }): Promise<string>;   // data URL (VLM critique, thumbnails); never a mid-grow frame; no selection box or gizmo
  renderViews(views: Array<'top' | 'front' | 'side' | 'iso'>, size?: number): Promise<string[]>;
  render(dt: number, opts?: { onDemand?: boolean; animate?: boolean }): boolean;   // on-demand skips unchanged frames; animate:false freezes weather (idle editor)
  requestRender(): void;
  setLowMemory(on: boolean): void;                        // runtime switch: pixel ratio, shadows, post pass, generator cache (MSAA/instances need a new renderer); setLowPower = deprecated alias
  resize(width: number, height: number): void;            // pixel ratio = effectivePixelRatio(devicePixelRatio, w, h, budget)
  stats(): { fps: number; frameMs: number; drawCalls: number; triangles: number; geometries: number; textures: number; entities: number; instances: number };
  memoryStats(): RenderMemoryStats;                       // tier, pixel ratio, drawing buffer, shadow size, post, GPU/cached geometries, textures, materials, generator cache MB, estimated GPU MB
  dispose(): void;
}

// GPU memory budgets (pure, gpu/budget.ts)
export type GpuTier = 'discrete' | 'integrated' | 'software' | 'unknown';
export function classifyGpu(description: string | null | undefined): GpuTier;   // WebGL renderer string / WebGPU adapter info
export function renderBudget(tier: GpuTier, lowMemory: boolean): RenderBudget;   // { pixelRatioCap, maxPixels, shadowMapCap, post, antialias, maxInstances, generatorCacheBytes }
export function effectivePixelRatio(dpr: number, cssW: number, cssH: number, budget: Pick<RenderBudget, 'pixelRatioCap' | 'maxPixels'>): number;
// Backend policy (pure, gpu/backend.ts)
export function pickBackend(pref: BackendPreference, env: BackendEnvironment): 'webgpu' | 'webgl2' | 'probe';
export function adapterKnownGood(info: AdapterInfoLike | null | undefined): boolean;
```

**Memory budgets.** Drawing-buffer pixels dominate GPU memory (multisampled
half-float target + resolves + bloom chain + swap chain, measured at
roughly 100–140 bytes per pixel), so every GPU class has a pixel-ratio cap
and an absolute pixel cap:

| Tier | Pixel ratio cap | Max pixels | Sun shadow map | Post (bloom) | MSAA |
| --- | --- | --- | --- | --- | --- |
| discrete (incl. Apple silicon) | 1.5 | 3.7 MP | 2048² | yes | yes |
| integrated / unknown | 1.25 | 2.1 MP | 2048² | yes | yes |
| software (SwiftShader, llvmpipe) | 1 | 1.4 MP | 1024² | yes | yes |
| low-memory mode (any tier) | 1 | 1.05 MP | 1024² | no | no |

The post pipeline (the largest single allocation) exists only while a
world uses bloom: it is disposed when bloom is 0 or low-memory mode is on
and rebuilt on demand.

**Backend policy (`backend: 'auto'`).** Chromium and Safari use WebGPU when
`navigator.gpu` exists. Firefox and its forks use WebGL2 on Linux, and
elsewhere only when the WebGPU adapter is a real (non-fallback) NVIDIA, AMD
or Apple GPU. A WebGPU initialization (or adapter probe) that never finished
disables WebGPU for the origin. A lost device/context calls `onContextLost`
(three's default handler, which only logs, is replaced).

Rendering requirements: instanced rendering for `scatter` shapes (InstancedMesh /
BatchedMesh), geometry & material caches keyed by stable JSON, per-frame zero
allocation, frustum culling, PCF soft shadows with a camera-fitted directional
light, procedural sky per `environment.sky` and `timeOfDay`, fog, weather
particles (GPU points), bloom/tone mapping (ACES), dispose everything on removal.

**Look (art direction, all pure and unit-tested):**

- *Sky presets* (`computeSkyState`): the preset is authoritative and
  `timeOfDay` only moves the sun inside the preset's window
  (`PRESET_WINDOWS`). The sun's bearing is chosen relative to the default
  three-quarter camera (`sunBearing`, `VIEW_AZIMUTH`): morning light from the
  right, afternoon from the left, never straight into the lens; the moon
  rim-lights from behind-right. Dawn/sunset sample the sky a few degrees
  lower than the light (deeper color). `SkyState.nebula` paints a nebula
  (space) or a faint galactic band (clear nights) on the dome.
- *Fog* (`resolveFog`): content keeps < 6 % fog at its far edge from the
  framing distance (`maxContentFogDensity`); the preset haze fades backdrop
  scenery; world fog above `FOGGY_THRESHOLD` may thicken to twice the cap;
  the fog color is pulled toward the sky horizon and the dome's horizon band
  matches it.
- *Framing* (`collectFramingItems` → `contentFraming` → `framingPose`):
  ground, sky, `backdrop`/`terrain` tags, terrain generators (mountain,
  island, terrain) and huge entities are scenery (framed only when nothing
  else exists); `focus`-tagged entities pull the center; the camera is an
  elevated three-quarter view tilted up (`DEFAULT_SKY_TILT`) so sky shows,
  never below the ground.
- *Materials*: `lava` and `water` presets carry procedural, tileable detail
  maps (`SurfaceTextures`: glowing crack mask, ripple normal map) on
  box-projected metre UVs (`boxProjectedUvs`), scrolled slowly while frames
  are drawn. The post pipeline adds a subtle vignette after bloom.
- *Grow-in* (`GrowIn`): entities a `setWorld` adds are hidden while their
  geometry streams in, then grow (content group scale only) in a ripple
  from the content center; bounds/framing/captures always see full scale.

`@aether/procgen` mountain: `groundColor` param (foothill color, match the
world ground); the flat foothill plate is sunk to y = 0 and trimmed from the
render mesh (the heightfield collider keeps the full grid).

## @aether/agent

LLM orchestration — provider-agnostic, runs in browser (via server proxy) and Node.

```ts
export interface ChatMessage { role: 'user' | 'assistant'; content: string | ContentBlock[]; }
export type ContentBlock = { type: 'text'; text: string } | { type: 'image'; dataUrl: string } | { type: 'tool_use'; id: string; name: string; input: unknown } | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean };
export interface ToolDef { name: string; description: string; inputSchema: object; }
export interface CompletionRequest { role: 'planner' | 'coder' | 'critic'; model?: string; system: string; messages: ChatMessage[]; tools?: ToolDef[]; maxTokens?: number; temperature?: number; }
export interface CompletionResponse { content: ContentBlock[]; stopReason: 'end' | 'tool_use' | 'max_tokens' | 'error'; usage?: { inputTokens: number; outputTokens: number }; model?: string; }
export interface Provider { readonly name: string; complete(req: CompletionRequest, signal?: AbortSignal): Promise<CompletionResponse>; }

export function createAnthropicProvider(opts: { apiKey: string; models: { planner: string; coder: string; critic: string }; baseUrl?: string; fetch?: typeof fetch }): Provider;  // server-side only, raw fetch to Messages API, prompt caching on system/tools
export function createOpenAIProvider(opts: { apiKey: string; models: { planner: string; coder: string; critic: string }; baseUrl?: string; fetch?: typeof fetch }): Provider;     // server-side only, raw fetch to Responses API
export function createHttpProvider(opts: { endpoint: string; fetch?: typeof fetch }): Provider;                      // browser -> our server proxy
export function createMockProvider(opts?: { library?: MockLibraryItem[] }): Provider;   // deterministic offline planner: keyword → world templates (MUST produce good worlds for ~15 themes; used as fallback + in tests); `library` lets it place generator-library objects by name
export interface MockLibraryItem { id: string; keywords: readonly string[]; size: readonly [number, number, number] }

export type AgentEvent =
  | { type: 'status'; text: string }
  | { type: 'plan'; text: string }
  | { type: 'patches'; patches: Patch[]; message: string; result: { applied: number; errors: PatchError[] } }
  | { type: 'generator'; def: GeneratorDef; ok: boolean; error?: string }
  | { type: 'verify'; passed: boolean; summary: string; report: unknown }
  | { type: 'repair'; text: string; attempt: number }
  | { type: 'message'; text: string }
  | { type: 'error'; text: string }
  | { type: 'done'; usage: { inputTokens: number; outputTokens: number; calls: number } };

export interface AgentHost {
  getWorld(): WorldDoc;
  applyPatches(patches: unknown[], message: string): PatchResult;    // commits to history
  verify(world: WorldDoc): Promise<{ report: unknown; summary: string; passed: boolean }>;
  screenshot?(): Promise<string | null>;
  validateGenerator?(def: GeneratorDef): Promise<{ ok: boolean; error?: string }>;
  validateScript?(def: ScriptDef): Promise<{ ok: boolean; error?: string }>;
}
export interface AgentCatalogs { generators: unknown[]; behaviors: unknown[]; ruleDocs: string; generatorApiDts: string; generatorExamples: unknown[]; scriptApiDts: string;
  libraryGenerators?: unknown[];   // generator-library catalog (same entry shape); listed in its own prompt section, used like built-ins
}
export interface AgentOptions { provider: Provider; maxRepairs?: number; maxTurns?: number; catalogs: AgentCatalogs;
  resolveGenerator?: (id: string) => Promise<GeneratorDef | null>;   // library definitions on demand: before apply_patches, every referenced
                                                                      // procedural generator that is not built in / in the world / in the batch is
                                                                      // resolved and a defineGenerator patch is committed first (≤ 8 per call)
}
export class WorldAgent {
  constructor(opts: AgentOptions);
  run(prompt: string, host: AgentHost, opts?: { signal?: AbortSignal; images?: string[]; history?: ChatMessage[] }): AsyncGenerator<AgentEvent>;
}
export const AGENT_TOOLS: ToolDef[];        // apply_patches, write_generator, write_script, inspect, run_verification, finish
export function buildSystemPrompt(catalogs: AgentCatalogs): string;
```

### Zero-cost AI connections (also exported by `@aether/agent`)

Text-only backends (Codex / Claude Code headless, on-device models) are
adapted to the tool-calling `Provider` contract, so `WorldAgent`, verification
and repair run unchanged:

```ts
// Tool-use emulation. The model answers ONE JSON object:
//   { thoughts?, tool_calls: [{ name, input } | { name, input_json }], final_message? }
// (`input_json` = arguments as a JSON string, for strict structured-output engines).
// zod-validated (≤ 16 calls, ≤ 600 000 chars per input); one automatic re-ask on invalid JSON.
export interface TextBackend { name: string; strictSchema?: boolean; complete(req: TextCompletionRequest, signal?): Promise<TextCompletionResult>; }
// TextCompletionRequest = { role, system, prompt, schema, images, toolNames?, model?, effort?, maxOutputTokens? }
//   toolNames: the emulated tool names (never native tools). The Claude Code backend tolerates up to 3
//   direct calls to one of them after its init event proved only StructuredOutput is exposed;
//   any other tool name, or a call before that proof, is a `tool_violation`.
export function createEmulatedProvider(opts: { backend: TextBackend; name: string; model?: string; effort?: 'low' | 'medium' | 'high' }): Provider;
export function parseEmulatedReply(value: unknown, tools: ToolDef[], salt: string): { ok: true; response } | { ok: false; error };
export function replyJsonSchema(tools: ToolDef[], strict: boolean): object;

// Local bridge client (browser or Node). Protocol (bridge/protocol.ts, zod on both sides):
//   POST /v1/pair { code } → { token }          (pairing code printed by the bridge; 5 wrong codes lock and rotate it)
//   GET  /v1/status (Bearer) → { ok, name: 'aether-bridge', version, backends: BridgeBackendStatus[] }
//   POST /v1/complete (Bearer) { backend: 'codex' | 'claude-code', model?, effort?, request: CompletionRequest } → CompletionResponse
//   errors: { error: { code: BridgeErrorCode, message } }  (unauthorized, forbidden_origin, busy, not_logged_in, cli_missing, timeout, rate_limited, tool_violation, …)
export function createBridgeProvider(opts: { baseUrl: string; token: string; backend; model?; effort?; fetch? }): Provider;
export function fetchBridgeStatus(baseUrl, token, fetch?): Promise<BridgeStatus>;
export function pairBridge(baseUrl, code, fetch?): Promise<string>;   // → token
export function normalizeBridgeUrl(raw: string): string | null;        // loopback origins only

// Fallback: any primary failure (offline, not signed in, rate limited, timeout…) → offline planner, reported once.
export function createFallbackProvider(opts: { primary: Provider; fallback: Provider; onFallback?: (n: FallbackNotice) => void }): FallbackProvider;
// On-device (experimental; the engine is created lazily by the studio, WebGPU only):
export function createWebLlmProvider(opts: { engine: WebLlmEngineLike; model: string }): Provider;

// 3D quality loop: rubric (composition, materials, lighting, scale, detail, coherence, physical; weighted 0–100,
// threshold 72), deterministic heuristics (+ rendered view stats), optional vision critic, targeted improvements.
export function assessWorld(input: QualityInput): QualityReport;
export function improvementPatches(world, report, bounds?, only?): { patches; applied: QualityFix[] };
export function buildCriticRequest(prompt, heuristic, views: string[]): CompletionRequest;   // role 'critic', ≤ 4 views
export function blendCritique(heuristic: QualityReport, replyText: string): QualityReport;
export function needsRefinement(report, threshold?): boolean; export function refineInstruction(report): string;
```

## apps/bridge — Aether Bridge (local, `npm run bridge`)

A small Node service on the user's own computer that lets the browser studio
use the Codex or Claude Code CLI the user is already signed in to (no API
keys, no per-prompt cost to anyone else). `npx tsx apps/bridge/src/main.ts
[--port 8790] [--origin https://hosted.example] [--studio URL] [--timeout 240]`;
a published `npx aether-bridge` is planned (`bin/aether-bridge.mjs`).

- Binds `127.0.0.1` only (8790, or a free port); `Host` must be a loopback name.
- Pairing: prints a one-time code (and a deep link `?bridge=<url>#aether-bridge=<token>`);
  a 256-bit bearer token is required on every request except `/v1/pair`.
- Exact `Origin` allowlist (local studio origins + `--origin`, https only for
  non-loopback); CORS + Private Network Access preflight
  (`Access-Control-Allow-Private-Network: true`); body ≤ 16 MiB.
- One job per backend at a time, ≤ 4 queued (else `busy`); per-request timeout
  and client abort kill the run; identical requests are served from a
  content-hash LRU cache.
- Headless runs are locked down: Codex via `@openai/codex-sdk` (read-only
  sandbox, approval `never`, network + web search off, shell/exec/patch/MCP/
  plugin/browser features disabled, every configured MCP server disabled,
  strict `outputSchema`; any tool item aborts the run); Claude Code via the
  installed `claude` CLI (`-p`, stream-json in/out, `--tools ""` plus a
  deny list, empty `--strict-mcp-config`, `--safe-mode`, no setting sources
  or slash commands, `--permission-mode dontAsk`, no session persistence,
  `--json-schema`); both
  in a fresh empty temp directory (deleted afterwards), with an allowlisted
  environment (no keys/tokens), argument arrays only, no shell.
- `createHeadlessProvider('codex' | 'claude-code', opts)` exposes the same
  locked-down backends in Node (server `AETHER_PROVIDER=codex|claude-code`,
  `scripts/eval-agent.ts`, `scripts/build-generator-library.ts`).

## Generator library (`@aether/procgen`)

```ts
export interface LibraryEntry { id; description; category; keywords: readonly string[]; params: Record<string, ParamSpec>; size: [w, h, d] }
export const GENERATOR_LIBRARY: readonly LibraryEntry[];              // catalog only (src/library-index.ts, generated)
export function loadLibraryGenerator(id: string): Promise<GeneratorDef | null>;   // lazy JSON chunk; schema + static check on load; own keys only
export function matchLibrary(text: string, max?: number): LibraryEntry[];          // whole-word, plural-insensitive keyword match
export function isLibraryGenerator(id: string): boolean;
export function checkSilhouette(out: GeneratorOutput): { ok: true; front; top } | { ok: false; error };   // headless "render" check
```

Library generators are ordinary custom generators: placed with
`{"kind":"procedural","generator":"<id>"}`, defined into the world on first
use (`AgentOptions.resolveGenerator`) and always executed in the generator
sandbox. Files live in `packages/procgen/library/<id>.json`
(`LibraryFileSchema`: entry, def, provenance, checks); they are written by
`npm run library` (Codex, sequential, call budget) and accepted only when
`acceptLibraryGenerator` passes for seeds 1, 7 and 42 (static check, sandbox
run, output validation, plausible size, grounded + centred, visible silhouette
that is not a bare box, ≤ 60 000 triangles).

## apps/server (Hono on Node)

- `GET  /api/health` → `{ ok, providers: string[], mode: 'live' | 'mock' }`
- `POST /api/llm` body `CompletionRequest` (zod-validated, body ≤ 1 MB, ≤ 4 images) → `CompletionResponse`.
  The server maps `role` to an allowlisted model; clients cannot pick arbitrary models.
- `GET/PUT /api/generators/:hash` — content-addressed cache of validated generator defs.
- `GET/PUT /api/worlds/:id` — share links (validated `WorldDoc`, ≤ 2 MB, server-generated random ids).
- Security: keys from env only; CORS allowlist; per-IP token bucket; body limit; upstream timeout + abort; no secrets in responses/logs; security headers (CSP, nosniff, referrer-policy, frame-ancestors); serves `apps/studio/dist` in production.
- No key configured → `mode: 'mock'`; studio falls back to the offline planner. The hosted server never needs or uses an owner-paid key by default (`AETHER_PROVIDER` unset = mock).
- `AETHER_PROVIDER=codex|claude-code` (local full stack only): the server answers `/api/llm` through the locked-down headless CLI of the machine it runs on.
- `POST /api/llm/byok` (`AETHER_BYOK`, default on; set `false` to disable): the visitor's own Anthropic/OpenAI key in `X-Aether-Key` (sessionStorage in the browser), used for that one upstream call, never stored or logged.

## apps/studio (React 19 + Vite)

Two halves behind hash routes (`src/lib/router.ts`, untrusted input matched
against strict patterns): the projects home (`#/`, `#/templates`,
`#/projects`, `#/published`, `#/docs`) and the editor (`#/p/<id>`, loaded
lazily with the engine). `#/new` and `#/new/<template>` create a project and
replace themselves with its editor.

Editor + player: agent panel (streaming agent events, reference images),
objects outliner, assets palette, sectioned inspector (scene or object),
logic panel, checks panel, history timeline, play/edit, transform gizmos,
camera presets, labels, perf HUD (off by default), command palette,
export/import JSON, share link. A `Simulation` class wires PhysicsWorld +
LogicRuntime + WorldRenderer with a fixed-step loop.

Projects (`src/projects/`):

```ts
// IndexedDB 'aether-studio' v1: stores meta (keyPath id), data (keyPath id), thumbs (Blob by id)
interface ProjectMeta { v: 1; id: string /* [a-z0-9]{8,32} */; name: string; createdAt: number; updatedAt: number; openedAt: number;
  template: string | null; entityCount: number; hasThumbnail: boolean }            // zod-validated on every read
class ProjectRepo {                                      // over a ProjectBackend (IdbBackend | MemoryBackend fallback)
  list(): Promise<ProjectMeta[]>;                        // newest first; invalid records skipped
  create(p: { world: WorldDoc; chat?: ChatEntry[]; name?: string; template?: string | null }): Promise<RepoResult<ProjectMeta>>;
  open(id): Promise<RepoResult<{ meta; world; chat }>>;  // world via validateImportedValue, chat via reviveChat
  save(id, world, chat); rename(id, name); duplicate(id); remove(id) /* → DeletedProject for restore() */; restore(deleted);
  setThumbnail(id, blob /* image/webp|jpeg|png, ≤ 60 KB */); thumbnail(id); exportText(id); importText(text);
  subscribe(fn): () => void;                             // this tab + other tabs (BroadcastChannel, payload ignored)
}
// Caps: 200 projects, 6 MB serialized per project; quota errors become actionable messages.
migrateLegacyWorld(storage, repo)                        // the pre-projects localStorage world becomes the first project, once
```

`Studio` (constructed per opened project by the editor route):

```ts
new Studio({ storage?, safeMode?, project?: { world, chat }, onSave?: (world, chat) => Promise<string | null>, onSettings? });
studio.send(prompt, { offline?: boolean /* built-in planner (templates) */, images?: string[] /* ≤ 4 data URLs */ });
studio.flush(): Promise<void>;                 // write pending autosave (debounced, serialized; store.save = saved | unsaved | saving | error)
studio.captureThumbnail(): Promise<Blob | null>;   // WebP (JPEG fallback) ≤ 60 KB, waits for grow-in / camera flight
studio.addFromPalette(itemId): string | null;  // place an asset at the orbit target (one undoable edit, selected)
studio.viewPreset('top' | 'front' | 'side' | 'iso' | 'reset');
studio.applyGizmoTransform(id, change);        // one undoable edit per gizmo drag; no-op drags ignored
```

Settings gained `showLabels`, `showNavHint`, `repairs` (0–3, the agent's
automatic repair rounds); `showPerf` now defaults to false, and `darkTheme`
follows `prefers-color-scheme` until a theme is saved (`/theme-boot.js`
applies it before first paint).

Memory and GPU robustness (see `src/lib/memory.ts`):

- Settings `backend: 'auto' | 'webgpu' | 'webgl2'` (switching restarts the
  renderer) and `lowMemory: 'auto' | 'on' | 'off'` (older saves migrate:
  `preferWebGPU: false` → 'webgl2', `lowPower: true` → 'on').
- Automatic low-memory mode: `navigator.deviceMemory` ≤ 4 GB, JS heap
  pressure (≥ 70 % of the limit or ≥ 600 MB, sampled every 10 s, latched) or
  a lost GPU context. It is shown as a "Low memory" badge in the top bar and
  applies the renderer's low-memory budget plus a 40-entry undo history
  (150 otherwise).
- A lost context remounts the viewport canvas with a new renderer
  (`store.rendererEpoch`); after a lost WebGPU device the replacement uses
  WebGL2. At most 3 recoveries per 2 minutes, then a fatal message.
- The frame loop stops while the page is hidden, and after 30 s without
  input an edit-mode viewport stops redrawing animated weather.
- `studio.memoryReport()` (debug handle) and the perf HUD expose the memory
  picture; `npm run e2e:memory` asserts the budgets in Chromium and Firefox.
