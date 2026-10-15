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
// Worker lockdown (procgen/sandbox/lockdown.ts): BLOCKED_GLOBALS are shadowed, then stripHostGlobals(scope)
// removes every property that is not in ALLOWED_GLOBALS (ECMAScript intrinsics + console) from the
// scope AND its prototype chain (WorkerGlobalScope.prototype, EventTarget.prototype …), so web APIs
// cannot be recovered through interface objects / property descriptors. Exploit tests: procgen
// sandbox.test.ts (child-process probe) and `npm run e2e:security` (real Chromium + Firefox workers).
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
  readPose(id: EntityId, position: Vec3, quaternion: Quat): boolean;   // copy into caller buffers (no result objects); false without a body
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
export interface VerifyReport { passed: boolean; results: TestResult[]; diagnostics: Diagnostic[]; simulatedSeconds: number; ms: number;
  testIndices?: number[];          // shard runs only: the world.tests indices `results` belong to
  trace?: VerifyTrace;             // only with `opts.trace` and when something moved; replay data, never for prompts
}
// Poses of the bodies that moved most: frame-major, 7 floats per body per frame (position xyz, quaternion xyzw)
export interface VerifyTrace { ids: EntityId[]; dt: number; frames: number; poses: Float32Array; }
export interface TraceOptions { hz?: number /* 12, ≤30 */; maxBodies?: number /* 16, ≤64 */; maxTracked?: number /* 128, ≤512 */; minPath?: number /* 0.2 m */; maxSeconds?: number /* 10, ≤20 */; minSeconds?: number /* 3 */; }
export class TraceRecorder { constructor(pw: PhysicsWorld, opts?: TraceOptions); sample(pw, time): void; wantsMore(time): boolean; finish(): VerifyTrace | undefined; }
export interface LogicHook { tick(dt: number, pw: PhysicsWorld, events: PhysicsEvent[]): void; readState(key: string): Json | undefined; }
export interface VerifyOptions {
  colliders?: ColliderProvider; logic?: (pw: PhysicsWorld) => LogicHook; maxSeconds?: number; budgetMs?: number;
  sliceMs?: number;                // yield to the host after this much stepping (default 8; 0 = never)
  tests?: readonly number[];       // run only these world.tests indices (a parallel shard); report sets testIndices
  diagnostics?: boolean;           // default true; shards other than one skip the static diagnostics
  signal?: AbortSignal;            // abort → rejects with VerifyAbortedError (name 'AbortError') at the next step
  onResult?: (index: number, result: TestResult) => void;   // each test as soon as it is decided (listener errors are ignored)
  trace?: boolean | TraceOptions;  // record report.trace; the run continues to ≥ minSeconds of simulated time after the
                                   // tests are decided (bounded by maxSeconds and the budget). Verdicts are unchanged.
}
export async function verify(world: WorldDoc, opts?: VerifyOptions): Promise<VerifyReport>;
export class VerifyAbortedError extends Error {}           // name 'AbortError'
export function shardIndices(count: number, only: readonly number[] | undefined): number[];   // sorted, unique, in range
export function summarizeReport(report: VerifyReport): string;   // compact text for the LLM repair loop
// Also importable without Rapier: `import { summarizeReport } from '@aether/physics/report'` (main thread, no WASM chunk).

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
  // May return a record reused per entity id (overwritten by the next query for that id): copy what you keep past the tick.
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

export interface ScriptRunner { load(def: ScriptDef): void; update(scriptId: string, entityId: EntityId, snap: ScriptSnapshot, prepared?: ScriptPrepared): ScriptIntent[]; dispose(): void; }
// `prepared.worldJson` === JSON.stringify(snap.world), serialized once per tick by the runtime (invalidated by state
// writes); the QuickJS runner splices it instead of serializing the world state for every call (additive).
export interface ScriptPrepared { worldJson?: string; }
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
  blueprint?: boolean;                                    // default true (with growIn): later builds show corner-bracket plan marks first
  adaptiveResolution?: boolean;                           // default true: scale the drawing buffer down while continuous frames stay < 40 fps
  staticBatching?: boolean;                               // default true: ≥ 6 identical static primitives draw as one InstancedMesh
  fields?: boolean; virtualGeometry?: boolean; workerGeneration?: boolean;   // default true (see "Scale geometry" below)
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
  setAdaptiveResolution(on: boolean): void;              // stats().resolutionScale reports the current scale (1 = full budget)
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
  setGizmo(ids: readonly EntityId[] | null, mode: GizmoMode | null, onCommit?: (c: GizmoCommit) => void, opts?: GizmoOptions, onLive?: (ids: readonly EntityId[]) => void): Promise<void>;   // multi-selection gizmo (see "Editing" below); one commit per drag
  get gizmoBusy(): boolean;                               // a handle is hovered or dragged: clicks must not change the selection
  focus(id: EntityId): void;                              // smooth camera fly-to
  pick(ndcX: number, ndcY: number): EntityId | null;
  highlight(ids: EntityId[]): void;                       // selection outline
  showGhost(world: WorldDoc | null): void;                // translucent preview of a proposed world
  playProof(trace: ProofTrace, opts?: { reducedMotion?: boolean; speed?: number }): Promise<boolean>;
                                                          // ghost replay of a verification run (own 'proof' ghost sync, trails;
                                                          // frames the motion first; originals hidden while their ghosts play)
  stopProof(): void; readonly proofActive: boolean;
  clearBlueprint(): void;                                 // drop the plan marks (corner brackets) of the last build
  exportGlb(): Promise<ArrayBuffer>;                      // binary glTF of what is drawn: the exportGltf pipeline below (≤ 6 M triangles)
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
export interface CompletionRequest { role: 'planner' | 'coder' | 'critic'; model?: string; system: string; messages: ChatMessage[]; tools?: ToolDef[]; maxTokens?: number; temperature?: number;
  session?: string;   // conversation key (/^[a-z0-9][a-z0-9-]{7,79}$/, the studio sends `p-<projectId>`): thread-keeping backends resume it }
export interface CompletionResponse { content: ContentBlock[]; stopReason: 'end' | 'tool_use' | 'max_tokens' | 'error'; usage?: { inputTokens: number; outputTokens: number }; model?: string; }
export interface Provider { readonly name: string; complete(req: CompletionRequest, signal?: AbortSignal): Promise<CompletionResponse>; }

export function createAnthropicProvider(opts: { apiKey: string; models: { planner: string; coder: string; critic: string }; baseUrl?: string; fetch?: typeof fetch; browser?: boolean }): Provider;  // raw fetch to Messages API, prompt caching on system/tools; `browser: true` (only with the user's own key) adds `anthropic-dangerous-direct-browser-access: true`
export function createOpenAIProvider(opts: { apiKey: string; models: { planner: string; coder: string; critic: string }; baseUrl?: string; fetch?: typeof fetch }): Provider;     // raw fetch to Responses API (server, or browser with the user's own key)
export function createChatCompletionsProvider(opts: { name: string; apiKey: string; baseUrl: string /* https, or loopback http */; models: { planner: string; coder: string; critic: string }; fetch?: typeof fetch; headers?: Record<string, string> }): Provider;  // OpenAI-compatible `POST {baseUrl}/chat/completions` with function tools (OpenRouter, Gemini's OpenAI endpoint); tool calls without ids are numbered `call_<index>`
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
  | { type: 'done'; usage: { inputTokens: number; outputTokens: number; calls: number; models?: string[] /* models that answered, first use order */ } };

export interface AgentHost {
  getWorld(): WorldDoc;
  applyPatches(patches: unknown[], message: string): PatchResult;    // commits to history
  verify(world: WorldDoc, opts?: { signal?: AbortSignal /* the run's abort signal (additive) */ }): Promise<{ report: unknown; summary: string; passed: boolean }>;
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
  promptProfile?: 'full' | 'compact';   // default 'full'. 'compact' (small on-device models, ~4k-token context): condensed system prompt
                                        // (buildCompactSystemPrompt), COMPACT_TOOLS only, ≤ 15 summary entities, last user/assistant
                                        // exchange of history (≤ 400 chars each), output cap 1 200 tokens (COMPACT_LIMITS)
}
export class WorldAgent {
  constructor(opts: AgentOptions);
  run(prompt: string, host: AgentHost, opts?: { signal?: AbortSignal; images?: string[]; history?: ChatMessage[]; session?: string }): AsyncGenerator<AgentEvent>;
}
export const AGENT_TOOLS: ToolDef[];        // apply_patches, write_generator, write_script, inspect, run_verification, finish
export const COMPACT_TOOLS: ToolDef[];      // apply_patches, finish (short descriptions, minimal schemas; same validators)
export function buildSystemPrompt(catalogs: AgentCatalogs): string;
export function buildCompactSystemPrompt(catalogs: AgentCatalogs): string;   // ≈ 1.2k tokens; catalog ids only, one example
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
export function createEmulatedProvider(opts: { backend: TextBackend; name: string; model?: string; effort?: 'low' | 'medium' | 'high';
  compact?: boolean;   // small-context backend: tool results cut to 1 200 chars in the transcript
}): Provider;
export function parseEmulatedReply(value: unknown, tools: ToolDef[], salt: string): { ok: true; response } | { ok: false; error };
export function replyJsonSchema(tools: ToolDef[], strict: boolean): object;

// Local bridge client (browser or Node). Protocol (bridge/protocol.ts, zod on both sides):
//   POST /v1/pair { code } → { token }          (pairing code printed by the bridge; 5 wrong codes lock and rotate it)
//   GET  /v1/status (Bearer) → { ok, name: 'aether-bridge', version, backends: BridgeBackendStatus[] }
//   POST /v1/complete (Bearer) { backend: 'codex' | 'claude-code', model?, effort?, request: CompletionRequest } → CompletionResponse
//     `model` must match MODEL_ID_RE; the inner `request.model` is ignored (it is free-form and would otherwise reach the CLI)
//   errors: { error: { code: BridgeErrorCode, message } }  (unauthorized, forbidden_origin, busy, not_logged_in, cli_missing, timeout, rate_limited, tool_violation, …)
export function createBridgeProvider(opts: { baseUrl: string; token: string; backend; model?; effort?; fetch? }): Provider;
export function fetchBridgeStatus(baseUrl, token, fetch?): Promise<BridgeStatus>;
export function pairBridge(baseUrl, code, fetch?): Promise<string>;   // → token
export function normalizeBridgeUrl(raw: string): string | null;        // loopback origins only

// Fallback: any primary failure (offline, not signed in, rate limited, timeout…) → offline planner, reported once.
export function createFallbackProvider(opts: { primary: Provider; fallback: Provider; onFallback?: (n: FallbackNotice) => void }): FallbackProvider;
// On-device (experimental; the engine is created lazily by the studio, WebGPU only):
export function createWebLlmProvider(opts: { engine: WebLlmEngineLike; model: string; maxTokens?: number /* 1200 */; contextTokens?: number /* 4096 */ }): Provider;
//   compact transcript; a request whose estimated input (chars / 3) leaves < 256 output tokens is refused before generating
//   (ProviderError 'too_large', reason 'webllm_context'); max_tokens never exceeds what the context has left.
//   Hosts should run WorldAgent with promptProfile 'compact' for it.

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

### Studio side of the bridge (`apps/studio/src/ai/`)

```ts
// What a bridge send actually uses: the chosen backend when signed in (else the first signed-in one),
// the saved model only while that backend's catalog lists it (else its defaultModel), and the saved
// effort only when that model supports it. With no catalog yet, the saved choice is sent unchanged.
export function effectiveBridgeChoice(prefs: AiPrefs, backends: readonly BridgeBackendStatus[]): { backend; model: string | undefined; effort };
// Browser limits for a hosted (https) studio reaching http://127.0.0.1: WebKit (Safari, every iOS
// browser) blocks it as mixed content ('warn'); Chromium may ask for local-network access ('info').
export function hostedBridgeNote(origin: string, userAgent: string): { tone: 'warn' | 'info'; text: string } | null;
```

### Bring your own key (`apps/studio/src/ai/byokCatalog.ts`, `byok.ts`, `session.ts`, `connection.ts`)

The studio calls the provider's API **straight from the browser** with the
user's own key. The key is never sent to Aether's server, never logged,
never placed in observable state, exports or share links. CSP `connect-src`
lists exactly the four provider origins (`BYOK_ORIGINS` must equal the
server's `BYOK_API_HOSTS`, which a test checks).

```ts
export const BYOK_PROVIDERS = ['anthropic', 'openai', 'openrouter', 'gemini'] as const;  // byokCatalog.ts (no heavy imports)
export const BYOK_CATALOG: Record<ByokProvider, { label; origin; keyPage; keyHint; models: ByokModel[]; defaultModel }>;
export const BYOK_KEY_RE = /^[A-Za-z0-9_.-]{20,300}$/;      // no whitespace: no header injection
export const BYOK_MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
export const BYOK_SESSION_CALL_CAP = 150;                   // model calls per browser session, then 'rate_limit' (reason 'session_cap') until reset
export function maskKey(key: string): string;               // "sk-ant-••••WXYZ"
// Anthropic: Messages API + `anthropic-dangerous-direct-browser-access: true`; OpenAI: Responses API;
// OpenRouter (https://openrouter.ai/api/v1) and Gemini (…/v1beta/openai): Chat Completions.
export function createDirectProvider(provider: ByokProvider, key: string, model: string, fetch: typeof fetch): Provider;
export function meteredProvider(inner: Provider, meter: { read(): ByokUsage; write(u: ByokUsage): void }, cap?: number): Provider;
export function listProviderModels(provider: ByokProvider, key: string, fetch: typeof fetch, signal?: AbortSignal): Promise<ByokModel[]>;  // zod-validated, ≤ 8 MiB, tool-capable only, ≤ 200

// Storage: sessionStorage 'aether.byok.v2' ({keys}), plus localStorage 'aether.byok.device.v1' only with
// "remember on this device"; usage in sessionStorage 'aether.byok.usage.v1'. Every read re-validates.
class AiConnection {
  setByok(provider: ByokProvider, key: string, opts?: { remember?: boolean }): string | null;  // error message, or null
  clearByok(provider?: ByokProvider): void;   // no argument: every key, from this device too
  setByokRemember(remember: boolean): void;
  resetByokUsage(): void;
  listByokModels(provider: ByokProvider, signal?: AbortSignal): Promise<ByokModel[]>;
}
interface ByokState { provider: ByokProvider | null; providers: ByokProvider[]; remembered: boolean; usage: { calls; inputTokens; outputTokens } }
// AiPrefs: byokProvider: ByokProvider; byokModels: Partial<Record<ByokProvider, string>> (backward compatible: absent → defaults).
// 'auto' resolution: local AI → bridge → server model → a key that is set → loaded on-device model → offline planner.
```

## Full editor (selection, transforms, meshes, sculpt, paint, logic)

### `@aether/core` additions (backward compatible)

```ts
// Schema
type MeshId = string;                                   // slug, like entity ids
interface MeshShape { kind: 'mesh'; mesh: MeshId }       // in the ShapeSpec union
interface Entity { locked?: boolean; /* … */ }           // user lock: editor tools and the agent leave it alone
interface ScatterShape { points?: Vec3[] /* ≤ MAX_SCATTER_POINTS, painted placements (local, y included) */; /* … */ }
interface MeshAsset {
  id: MeshId; vertexCount: number; triangleCount: number;
  positions: Base64Chunks;            // f32 xyz           Base64Chunks = string[] (≤ 64 Ki chars each, 4-byte aligned)
  indices: Base64Chunks;              // u16 when vertexCount ≤ 65 536 (always, given MAX_MESH_VERTICES)
  colors?: Base64Chunks;              // u8 sRGB rgb per vertex
  uvs?: Base64Chunks;                 // f32 uv per vertex
  faceMaterials?: Base64Chunks;       // u8 slot per triangle
  materials: MaterialSpec[];          // ≤ 16 slots
  source?: { generator: string; params: Record<string, Json>; seed: number };   // "Bake to mesh" keeps the link
}
interface WorldDoc { meshes?: Record<MeshId, MeshAsset>; /* … */ }
type Patch = /* … */ | { op: 'setMesh'; mesh: MeshAsset } | { op: 'removeMesh'; id: MeshId };
// LIMITS += MAX_MESHES 128, MAX_MESH_VERTICES 65 536, MAX_MESH_TRIANGLES 131 072, MAX_MESH_BYTES 24 MB (all meshes), MAX_SCATTER_POINTS 20 000
// applyPatches: a mesh shape must reference an existing asset; removing the last user GCs the asset; `clear` drops meshes.
interface PatchResult { world; applied; errors; notes?: string[] }   // notes: informational (e.g. "kept locked entity x")

// Mesh codec (pure; typed arrays ↔ base64 chunks; strict decoding: lengths, ranges, finite values)
interface MeshData { positions: Float32Array; indices: Uint32Array; colors: Float32Array | null /* linear */; uvs: Float32Array | null; faceMaterials: Uint8Array | null }
function encodeMesh(id, data: MeshData, opts: { materials; source? }): MeshAsset;
function encodeMeshUpdate(prev: MeshAsset, prevData: MeshData, next: MeshData): MeshAsset;   // unchanged streams share their chunk arrays
function decodeMesh(asset: MeshAsset): MeshData;  function decodeMeshCached(asset): MeshData;  // WeakMap per asset object
function checkMeshData(data): string | null;  function meshBounds(data): { min; max };  function meshByteSize(asset): number;

// Hand-edit tracking (agent ↔ manual round trip)
function userEditMarks(commits: CommitLike[], opts: { maxCommits?: number; exists?: (id) => boolean }): UserEditMarks;   // newest user edits per entity
History.recentCommits(limit): CommitLike[];
summarizeWorld(world, { userEdits?: ReadonlyMap<EntityId, { paths: string[]; age: number }> /* … */ });
//   entity lines gain "locked(by user: do not change)" and "user-edited(<paths>, just now)";
//   a trailing "user recently edited by hand (newest first): …" line resolves "the tower I just moved".
```

### `@aether/procgen` additions

```ts
// Mesh editing (pure functions over MeshData; every result passes checkMeshData and the caps)
extrudeFaces(mesh, faces, distance); insetFaces(mesh, faces, amount); subdivide(mesh, faces | null, { smooth? });
smoothMesh(mesh, { iterations?, factor?, weights?, pinBoundary? }); mergeByDistance(mesh, distance) → { mesh, removed };
flipFaces(mesh, faces | null); orientOutward(mesh) → { mesh, flipped }; deleteFaces(mesh, faces); unwrapUVs(mesh, 'box' | 'planar', scale?);
softWeights(mesh, selected, radius) → Float32Array; transformVertices(positions, weights, matrix4) (+ allocation-free transformVerticesInto);
nearestComponent(mesh, triangle, localPoint) → { vertex, edge } | null; coplanarFaces(mesh, seed, maxAngleDeg?, limit?);
buildTopology(mesh) / meshHealth(mesh) (manifold, boundary and non-manifold edges, …) / signedVolume(mesh);
class SculptSession { constructor(mesh, { seed? }); sculpt(mode: SculptMode, dab: BrushDab): number; paint(rgb, dab, erase?): number;
  takeDirty(): { start, count } | null /* changed vertex range for a partial GPU upload */; }   // modes: raise/lower/smooth/flatten/noise
bakeOutput(output: GeneratorOutput): BakedMesh;   meshColliders(mesh, dynamic): Collider[];   // trimesh (static) or hull (dynamic, ≤ MAX_HULL_POINTS)
const MeshOp: ZodType;  runMeshOp(input: MeshOpInput): MeshOpResult;   // the worker protocol (zod-validated, transferables)

// Heavy work off the main thread (module worker; inline fallback where workers are unavailable)
class ComputeClient {
  constructor(opts?: { timeoutMs?: number; idleTimeoutMs?: number; createWorker?: (() => WorkerLike) | null });
  meshOp(op: MeshOpInput, mesh: MeshData): Promise<MeshOpResult>;   // input mesh copied; a timed-out worker is replaced
  generate(generator: string, params, seed): Promise<GeneratorOutput>;   // built-in generators; debounced parameter regeneration
  dispose(): void;
}
```

### `@aether/render` editing API

```ts
type GizmoMode = 'translate' | 'rotate' | 'scale';
interface GizmoOptions { space?: 'world' | 'local'; pivot?: 'center' | 'origin' | 'individual'; translationSnap?: number | null;
  rotationSnapDeg?: number | null; scaleSnap?: number | null; surfaceSnap?: boolean; vertexSnap?: boolean }
interface GizmoCommit { mode: GizmoMode; changes: Array<{ id: EntityId; position: Vec3; rotation: Vec3 /* deg XYZ */; scale: Vec3 }> }   // local transforms
interface EntityHit { id; point; normal; localPoint; localNormal; triangle: number | null; distance }
setGizmoOptions(opts); get gizmoDragging(): boolean;   // live drag: proxy pivot moves the objects, no document writes until release
raycastEntity(ndcX, ndcY, { only?, exclude? }): EntityHit | null;   raycastWorld(origin, dir, max?, exclude?, only?);
entitiesInRect(x0, y0, x1, y1, skip?): EntityId[];   pick(ndcX, ndcY, skip?): EntityId | null;   // marquee + click selection
meshBundle(id); previewMesh(id, positions | null, colors | null): boolean;   // live sculpt/paint preview without a document write
rebuildEntity(id); showMeshComponents(view | null); showBrush(brush | null); showJoint(id | null);
setComponentGizmo(id, localCenter, mode, opts, onLive?, onCommit?);   // vertex/edge/face transforms (matrix in mesh space)
setLeftDragNavigation(on); primeGeneratorOutput(shape, output);       // worker results reuse the renderer's cache
```

Mesh shapes render as one shared set of position/normal/colour/uv attributes
with one index geometry per material slot; GPU resources are disposed when an
asset is replaced or removed. Physics builds a trimesh (static) or convex hull
(dynamic) and rebuilds bodies whose mesh changed (`diffWorlds().meshesChanged`).

### Studio editor (`apps/studio/src/engine/editor/`)

`Editor` owns selection (click, shift/ctrl toggle, marquee), the gizmo
(W/E/R, local/world, pivot, grid/angle/surface/vertex snapping, numeric
input in the inspector), align/distribute, duplicate (Ctrl+D), copy/cut/paste
(clipboard JSON `aether/entities`, works across projects; generator and mesh
assets travel along), delete, group/ungroup (Ctrl+G / Ctrl+Shift+G), outliner
drag-to-reparent (world transform preserved), hide (H) / lock, focus (F) and
frame all (0). Mesh edit mode (Tab) offers vertex/edge/face components,
move/rotate/scale with soft selection, extrude, inset, subdivide, smooth,
merge by distance, flip / recompute normals and box/planar UV unwrap, all in
the compute worker. Sculpt (raise/lower/smooth/flatten/noise), vertex paint
and scatter paint (density, erase) brushes record one history entry per
stroke. Every edit is one undoable commit.

The agent sees which entities the user edited by hand (`AgentHost.userEdits`)
and never changes a locked entity: such patches are dropped with a note in
the tool result, and when an agent patch overwrites a property the user set
by hand the chat says so ("Changed things you set by hand: … Undo to restore").

## Local AI and the coding-agent worker

### Bridge additions (`apps/bridge`, all behind the pairing token)

```
POST   /v1/auth/login        { backend } → LoginState        runs `codex login --device-auth` / `claude auth login --claudeai`
GET    /v1/auth/login        → { login: LoginState | null }   poll; the CLI's verification URL and one-time code only
POST   /v1/auth/login/cancel → { login }
POST   /v1/auth/logout       { backend } → { ok, message }    `codex logout` / `claude auth logout`
DELETE /v1/sessions/:project → { cleared }                    forget a project's resumable conversations
```

`/v1/complete` accepts `request.session`: the bridge remembers per project
(LRU 64, 6 h idle, in memory only) the Codex thread id or Claude Code session
id and resumes it with only the new part of the conversation. Runs stay
read-only and tool-less.

### Server: `/api/local/*` (only when `config.localAi`)

`AETHER_LOCAL_AI=auto|on|off` (default `auto`: on for a non-production server
without hosting-platform markers such as `VERCEL`, `FLY_APP_NAME`, `RENDER`,
`K_SERVICE`, `AETHER_HOSTED`; the Docker image sets `AETHER_HOSTED=1` and
`AETHER_LOCAL_AI=off`; `on` with a marker is a startup error). Every request
must arrive on a loopback socket with a loopback `Host` and without proxy
headers (`X-Forwarded-For`, `X-Real-IP`, `Forwarded`, …); errors use the
bridge format `{ error: { code, message } }`.

```
GET    /api/local/status                  → LocalStatus { backends: BridgeBackendStatus[] (account, models, busy), account, jobs, login }
POST   /api/local/complete                BridgeCompleteRequest → CompletionResponse   (one worker process per call; 1 running, ≤ 4 waiting)
DELETE /api/local/sessions/:project       → { cleared }
GET|POST /api/local/login, POST /api/local/login/cancel, POST /api/local/logout { backend, accountId? }
GET    /api/local/accounts                → { items: LocalAccount[], activeId, jobs }
POST   /api/local/accounts                { label } → LoginState     new Codex account (own CODEX_HOME) + device sign-in
POST   /api/local/accounts/:id/activate   → AccountsList             refused while jobs run; never automatic
DELETE /api/local/accounts/:id            → AccountsList             not the default or the active account
POST   /api/local/jobs                    AssetJobRequest { kind: 'asset', backend, model?, effort?, spec: { id, description, paramsHint? }, budget: { turns 1–6, minutes 1–20 } } → LocalJob
GET    /api/local/jobs/:id                → LocalJob
GET    /api/local/jobs/:id/events?after=N → text/event-stream: `progress` events { seq, at, phase, message } after N, then `end` with the LocalJob
POST   /api/local/jobs/:id/cancel         → LocalJob
```

Schemas: `@aether/agent` `bridge/local-protocol.ts`; clients:
`createLocalAiApi()` (status, sign-in, accounts, jobs, `followJob` with
reconnect from the last `seq`), `createLocalProvider()`,
`createBridgeAccountApi()`.

### Worker processes (`apps/bridge/src/worker/`)

```ts
type WorkerJob =
  | { kind: 'complete'; backend; request: TextCompletionRequest; session?: { id; systemHash; body; dir? }; codexHome?: string | null; timeoutMs? }
  | { kind: 'agentic'; backend; model?; effort?; workspace: string; task: string; artifact: `out/${string}.json`; maxTurns: 1–8; codexHome?: string | null };
type WorkerResult = { ok: true; kind: 'complete'; text; structured?; usage?; model?; resumed?; session? }
                  | { ok: true; kind: 'agentic'; turns; passed; usage?; model?; message? }
                  | { ok: false; code: BridgeErrorCode; message };
// stdin: the job (JSON); stdout: the result (JSON, ≤ 16 MB); stderr: `AETHER_PROGRESS {"phase","message"}` lines (validated) + noise
function runWorker(job, { timeoutMs, signal?, onProgress?, env?, command? }): Promise<WorkerResult>;
//   detached process group (Windows: taskkill /T /F), allowlisted environment, SIGTERM then SIGKILL after 3 s on timeout/cancel, stopAllWorkers() on shutdown
class JobManager {   // durable build queue: one job at a time, ≤ 4 waiting; records + JSONL events (0600) under <data>/local-ai/ai-jobs
  enqueueAsset(req): Promise<LocalJob>;  get(id); eventsAfter(id, after); subscribe(id, fn); cancel(id); activeCount(); init(); dispose();
}
// cancel(id): a queued job ends 'cancelled' at once; a running one is aborted, and the abort wins at every
// stage (workspace setup, worker run, validation): it never ends 'done' after a cancel.
class LocalAi { status(); provider(backend, model?, effort?); jobs; accounts; login; sessions; clearProject(project); refresh(); dispose() }
```

An agentic asset job: a private temp workspace (0700) with
`GENERATOR_API.d.ts`, worked examples, `task.md` and `check.mjs` (bundled
once with esbuild: schema + static screen + sandbox run for three seeds +
size/grounding/silhouette heuristics + a four-view `out/preview.png`, prints
`RESULT: PASS|FAIL` and `- issue:` lines). Codex runs in its
`workspace-write` sandbox (network off, approval `never`, `inherit: core`
environment, web search/MCP off, one thread across rounds); Claude Code runs
`claude -p --restricted --tools Read,Write,Edit,Bash` with only `Read`,
`Write(./out/**)`, `Edit(./out/**)` and `Bash(node check.mjs:*)` allowed and
every tool call screened (reads inside the workspace, writes inside `out/`,
no other command). The checker executes generator code only under the Node
permission model (`confinedNodeArgs`: read the workspace, write `out/`, no
processes/workers/addons); it re-spawns itself confined when the agent runs
it, and the host runs its own pristine bundle confined (`runConfinedCheck`,
which also reports `VALID: yes|no` independent of the quality heuristics).
After each round the host runs the checker and feeds failures back, up to
the budget. Only the final artifact is read (no links followed, ≤ 120 KB),
parsed, statically screened and validated by the confined checker
(`validateInWorkspace`); the studio validates it again in its generator
sandbox. The workspace is always deleted.

The generator sandbox worker script (`/assets/sandbox.worker-*.js`) is
served with its own policy, `default-src 'none'; script-src 'self'
'unsafe-eval' 'wasm-unsafe-eval'` (server `SANDBOX_WORKER_CSP` and
`vercel.json`), because it compiles generator source with `new Function`;
the page keeps the strict policy.

### Studio (`apps/studio/src/ai/`)

- `AiPrefs.mode` adds `'local'`; `deep: boolean` (default true) and
  `deepTurns` (1–6, default 3). Automatic order: Codex on this computer,
  Claude Code on this computer, the paired bridge, the server model, a loaded
  on-device model, the offline planner; a personal key only when chosen.
- `ResolvedConnection.kind` adds `'local'` (`worker: true`): new assets
  (`request_asset`) go through a deep build with streamed progress when
  "Deep build" is on; everything else stays a quick completion.
- `projectSessionKey(projectId)` = `p-<id>` is sent as `RunOptions.session`
  for local and bridge connections; deleting a project calls
  `aiConnection().forgetProject(id)` (local AI and bridge).
- The chat's `done` line shows the connection, the models that answered and
  the token usage of the turn.


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

## Local app: `aether` CLI (`apps/cli`) and the first-run screen

One command runs the studio on the user's computer with their own AI login.
`npx aether` (workspace bin `@aether/cli`, root `bin` + `npm run aether`):

```
aether [start]  [--port N] [--open] [--no-build|--rebuild] [--origin https://studio]… [--bridge-port N]
                [--host H --allow-lan] [--foreground] [--state-dir DIR]
aether stop [--force] · status [--json] · logs [-f] [-n N] · login [--device-auth] [--claude]
aether logout [--claude] · pair · doctor [--json] · help · version
```

Exit codes: 0 ok, 1 failure, 2 usage error, 3 `status`: not running.

- **State folder** (`resolveStateDir`): `--state-dir` > `AETHER_STATE_DIR` >
  Windows `%LOCALAPPDATA%\Aether` > `$XDG_STATE_HOME/aether` (absolute
  only) > `~/.local/state/aether`; created 0700. Files (0600): `server.json`
  (`ServerRecord { version: 1, pid, port, host, url, instance, startedAt,
  lan, bridge: { port, origins } | null }`, zod-validated, ≤ 16 KiB),
  `secret` (per-install, 43-char base64url, created once), `access-token`
  (LAN only, fresh per start), `server.log` (+ `.1`–`.3`), `server.out`
  (crash output of the last start), `data/` (server `DATA_DIR`).
- **start**: an existing record is `running` (health answers with its
  `instance`): print the link and exit; `unresponsive` (pid alive, no
  matching health): refuse; `stale` (pid gone): remove the record. Build when
  `apps/studio/dist/index.html` is missing or older than any file under the
  studio sources and `packages/*` (tests and node_modules ignored). Port:
  the explicit `--port` or fail; otherwise 4280, the next 19, then an
  ephemeral one. Spawns `node --import tsx apps/server/src/main.ts` with
  `detached: true` (own process group), `windowsHide`, stdin ignored,
  output to `server.out`, then waits ≤ 60 s for `/api/health` with the new
  random `instance`. Server env: `HOST`, `PORT`, `NODE_ENV=production`,
  `SERVE_STATIC=true`, `AETHER_LOCAL_AI=on`, `AETHER_PROVIDER=mock` unless
  set, `ALLOWED_ORIGINS` = `AETHER_ALLOWED_HOSTS` (as origins) =
  `127.0.0.1:<port>`, `localhost:<port>` (+ LAN addresses),
  `AETHER_SECRET_FILE`, `AETHER_INSTANCE_ID`, `AETHER_LOG_FILE`, `DATA_DIR`,
  and with `--origin` `AETHER_BRIDGE_ORIGINS` / `AETHER_BRIDGE_PORT`.
  Hosting-platform markers are removed from the child env.
- **stop**: `POST /api/admin/shutdown` with `X-Aether-Admin: <secret>`
  (graceful), then SIGTERM / SIGKILL of the process group (Windows:
  `taskkill /PID <pid> /T /F`, so AI workers and the CLIs they started end
  too). A pid that does not answer health and is not recognisably the
  server (`/proc/<pid>/cmdline` on Linux) is never signalled without `--force`.
- **login / logout**: run `codex login` (`--device-auth`: `codex login
  --device-auth`) / `codex logout`, or `claude auth login --claudeai` /
  `claude auth logout` with `--claude`, interactively (inherit stdio,
  allowlisted env + desktop variables, argument arrays; Windows `.cmd` shims
  via `cmd.exe /d /s /c` with fixed quoted arguments). An existing login is
  detected with `codex login status` / `claude auth status --json` and
  reported instead of signing in again.
- **Cross-platform process helpers** (exported by `@aether/bridge`, used by
  the CLI, the server's sign-in manager, CLI probes and AI workers):
  `commandPlan(command, args, platform, comSpec?)` → `{ command, args,
  verbatim }` (Windows `.cmd` / `.bat` → `cmd.exe /d /s /c` with quoted fixed
  arguments; any of `"%^&|<>` or a newline throws), `spawnCli(...)` (spawn
  with that plan, `shell: false`, `windowsHide`), `sdkExecutable(path)`
  (undefined for a Windows batch shim, so the Codex SDK uses its bundled
  binary with the same `CODEX_HOME`), `killTree(pid, signal)` /
  `killTreePlan` (POSIX: signal `-pid`, falling back to `pid`; Windows:
  `taskkill /T /F`; invalid pids ignored). `which(name, env, platform)` on
  Windows tries only `PATHEXT` extensions for a bare name (npm's
  extensionless sh shim is not runnable there).
- **pair**: `POST /api/local/bridge/pair` (admin header) → `{ url, code,
  links[] }`; each link is `<origin>/?bridge=<url>#aether-bridge=<token>`.

### Server additions (all off unless configured; the CLI configures them)

```
AETHER_ALLOWED_HOSTS=h:p,…    any other Host → 421 { error: 'host-not-allowed' } on every route
AETHER_SECRET_FILE=path       HTML responses set `aether_session=<secret>; HttpOnly; SameSite=Strict; Path=/`;
                              /api/local/* requires that cookie or `X-Aether-Admin` (else 401 { error: { code: 'unauthorized' } })
AETHER_ACCESS_TOKEN_FILE=path LAN gate: `GET …?access=<token>` → 303 to the same URL without it + `aether_access` cookie;
                              anything else without the cookie → 403 (except /api/health)
AETHER_INSTANCE_ID=id         echoed as `instance` by /api/health
AETHER_LOG_FILE=path          JSON log lines appended (0600), rotated at 5 MiB keeping 3
AETHER_BRIDGE_ORIGINS=https://…  also start the token-paired bridge on 127.0.0.1:AETHER_BRIDGE_PORT (default 8790)
POST /api/admin/shutdown      X-Aether-Admin only (the cookie is not enough) → 202 { ok, stopping }
POST /api/local/bridge/pair   X-Aether-Admin only → { url, code, links }
```

`AETHER_BRIDGE_ORIGINS` without local AI is a startup error. Secrets are
compared in constant time and scrubbed from logs.

### Studio: first-run screen (`apps/studio/src/onboarding/`)

- `probeFirstRun(fetch, storage, hostedBuild)` → `{ marker, local, signedIn,
  hostedBuild }` from `/api/health` (`local === true`) and, only for a local
  server without a remembered choice, `/api/local/status` (any backend
  installed and signed in). `decideFirstRun(facts)` → `{ show, variant:
  'local' | 'hosted' }`: never shows with a remembered choice, nor locally
  when a CLI is already signed in. `VITE_AETHER_HOSTED=1` forces `hosted`.
- Remembered choice: localStorage `aether.onboarding.v1` = `{ choice:
  'offline' | 'codex' | 'claude-code' | 'byok' | 'bridge', at }` (validated;
  closing the screen = `offline`).
- Local variant test ids: `first-run` (with `data-variant`), `first-run-codex`,
  `first-run-login-start`, `first-run-device-code`, `first-run-signed-in`,
  `first-run-done`, `first-run-claude` (only when signed in),
  `first-run-offline`. Hosted, in this order: `first-run-local` ("Use your
  own Codex / ChatGPT login": install command with `--origin <this
  origin>`, pairing `first-run-pair-code` + `first-run-pair`, optional
  `first-run-bridge-url` under "Bridge address"; once paired,
  `first-run-bridge-paired` reuses the Codex rows above through the
  bridge's `/v1/auth/login` (`first-run-login-start`,
  `first-run-device-code`, `first-run-signed-in`, `first-run-done` → prefs
  `{ mode: 'bridge', backend: 'codex', codexModel }`) and
  `first-run-bridge-claude` when Claude Code is signed in there → `{ mode:
  'bridge', backend: 'claude-code' }`; choice `bridge`), `first-run-byok`
  (toggles the form: `first-run-provider`, `first-run-key`,
  `first-run-remember`, `first-run-key-submit`), `first-run-offline`. The
  hosted screen never runs a CLI itself and never uses anyone else's
  account or key. Chip while offline: `signin-chip`.
- A choice saves the global AI prefs and dispatches `aether:ai-prefs`
  (`CustomEvent<Partial<AiPrefs>>`; receivers keep only known keys and
  re-validate) so an open editor applies it at once.
- e2e suites that test something else seed the marker with
  `SKIP_FIRST_RUN` (`tests/e2e/support/env.ts`).

## apps/server (Hono on Node)

- `GET  /api/health` → `{ ok, providers: string[], mode: 'live' | 'mock', byok: false, local: boolean, instance?: string }` (`local`: `/api/local/*` is served, see "Local AI"; `instance`: only with `AETHER_INSTANCE_ID`, see "Local app")
- `HOST` defaults to `127.0.0.1` (the Docker image sets `0.0.0.0`).
- `POST /api/llm` body `CompletionRequest` (zod-validated, body ≤ 1 MB, ≤ 4 images) → `CompletionResponse`.
  The server maps `role` to an allowlisted model; clients cannot pick arbitrary models.
- `GET/PUT /api/generators/:hash` — content-addressed cache of validated generator defs.
- `GET/PUT /api/worlds/:id` — share links (validated `WorldDoc`, ≤ 2 MB, server-generated random ids).
- Security: keys from env only; CORS allowlist; per-IP token bucket; body limit; upstream timeout + abort; no secrets in responses/logs; security headers (CSP, nosniff, referrer-policy, frame-ancestors); serves `apps/studio/dist` in production.
- No key configured → `mode: 'mock'`; studio falls back to the offline planner. The hosted server never needs or uses an owner-paid key by default (`AETHER_PROVIDER` unset = mock).
- `AETHER_PROVIDER=codex|claude-code` (local full stack only): the server answers `/api/llm` through the locked-down headless CLI of the machine it runs on.
- Bring-your-own keys never reach the server: the studio calls the provider's API straight from the browser (see "Bring your own key" below). `/api/health` keeps `byok: false` for compatibility.
- Static hosting (`static.ts`, production): `/assets/*` and `/fonts/*` → `Cache-Control: public, max-age=31536000, immutable`, every other file `no-cache`. Precompressed `.br` / `.gz` siblings (from `precompressDir`, `precompress.ts`) are sent with `Content-Encoding` + `Vary: Accept-Encoding` when accepted, never for `Range` requests and never under their own names. `/` and `/index.html` are the studio, `/play` the player; **any other browser navigation outside `/api/` answers 404 with `404.html`** (changed from the earlier SPA fallback to `index.html`: the studio routes only with the URL hash). `vercel.json` matches (no catch-all rewrite; Vercel serves `404.html`).
- Error pages (`error-pages.ts`): `errorPageHtml(404 | 500 | 503)`; `wantsHtmlPage(c)` (GET/HEAD, `Accept: text/html`, outside `/api/`) selects the page in `notFound` / `onError`, otherwise the JSON error body. Pages are script-free, `noindex`, `Cache-Control: no-store`; `apps/studio/public/404.html` equals `errorPageHtml(404)` (a test checks).
- Process (`main.ts`): `applyHttpTimeouts(server)` (keep-alive 65 s < headers 66 s ≤ request 120 s, `server-timeouts.ts`); `uncaughtException` / `unhandledRejection` are logged scrubbed and drain like `SIGTERM` with exit code 1.
- Deployment manifests (root): `Dockerfile` (+ `.dockerignore`), `docker-compose.yml`, `fly.toml`, `render.yaml`, `vercel.json`, `.github/workflows/ci.yml`; `apps/server/test/deploy.test.ts` checks their invariants. e2e suites accept `BASE_URL` / `AETHER_E2E_URL` (`externalBaseUrl()` in `tests/e2e/support/env.ts`) to test a running deployment.
- Studio build: `siteMeta()` Vite plugin (`scripts/vite/site-meta.ts`) makes `og:image` / `og:url` / `twitter:image` absolute from `VITE_AETHER_SITE_URL` or `VERCEL_PROJECT_PRODUCTION_URL` (validated https origin only).

## apps/studio (React 19 + Vite)

Two halves behind hash routes (`src/lib/router.ts`, untrusted input matched
against strict patterns): the projects home (`#/`, `#/templates`,
`#/projects`, `#/published`, `#/docs`) and the editor (`#/p/<id>`, loaded
lazily with the engine). `#/new` and `#/new/<template>` create a project and
replace themselves with its editor. `#/view/<token>` is the read-only viewer
of a shared world (`src/editor/ViewerRoute.tsx`, same lazy chunk): Play,
Export, Remix (copy into a new project); nothing is persisted.

Share links (`src/lib/shareLink.ts`): the world travels in the URL fragment,
`z1.<base64url(deflate-raw(JSON))>` (or `j1.<base64url(JSON)>` without
`CompressionStream`), ≤ 60,000 characters; decoding caps the inflated size
at `MAX_IMPORT_BYTES` and validates like a file import. `Studio.share()`
copies such a link, falling back to `POST /api/worlds` (`?world=<id>`) only
for worlds too large for a link.

UX additions (see `docs/DESIGN.md`): `Studio.presentProof()` /
`dismissProof()` (seal + ghost replay of the last verification run; the
trace is recorded in the verification worker and kept out of the report
sent to the model), `Studio.exportGltf()`, plan annotations
(`store.planMarks`, `src/lib/planMarks.ts`), the proof seal
(`store.proofSeal`), the editor tour (`src/onboarding/tour.ts`, marker
`aether.tour.v1`), the shortcuts overlay (`?`), the home hero, and the
settings `uiSounds` (default off) and `immersivePlay` (default on). The
verification worker protocol adds `options.trace?: boolean` (requests) and
`report.trace?` (replies, exact-length finite `Float32Array` checked by zod).

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
studio.editor.commitGizmo(commit);             // one undoable edit per gizmo drag (all selected targets); no-op drags ignored
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

Verification off the main thread (`src/engine/verify/`):

```ts
// Worker protocol (zod on both ends, request ids, one terminal reply per request)
type VerifyRequest =                                   // main → worker
  | { type: 'verify'; id; world: unknown /* validateWorld in the worker */; colliders: Array<[entityId, ColliderDesc[]]>;
      options: { maxSeconds; budgetMs; diagnostics: boolean; tests?: number[] /* shard */ } }
  | { type: 'diagnose' | 'settle'; id; world; colliders; … } | { type: 'warm'; id; scripting: boolean } | { type: 'cancel'; id };
type VerifyReply =                                     // worker → main
  | { type: 'ready' } | { type: 'progress'; id; index; result: TestResult }
  | { type: 'verified'; id; report } | { type: 'diagnosed'; id; diagnostics } | { type: 'settled'; id; report }
  | { type: 'warmed'; id } | { type: 'failed'; id; error; cancelled: boolean };
// Caps: ≤ 5000 collider entities, ≤ 2048 colliders each, ≤ 16 M numbers in total; reply strings ≤ 2000 chars, lists ≤ 512.
createVerifyHandler({ physics, scripting?, post, sliceMs? })   // pure handler (worker entry + Node tests)
new VerifyPool({ lanes /* 1..2 */, createWorker?, slackMs?, idleMs? })
  .verify(world, { colliders, maxSeconds, budgetMs, signal?, onResult?, onPlan? }) → { report, lanes }
  // throws WorkerUnavailableError (caller falls back to the main thread), VerifyTimeoutError (worker restarted), AbortError
  .warm(scripting?)                                     // idle / intent prefetch of Rapier (+ QuickJS) inside the worker
planShards(tests, lanes, maxSeconds) / mergeShardReports(tests, shards)   // fork verification across lanes
verifyLanes({ hardwareConcurrency, deviceMemory, lowMemory }) → 1 | 2
new VerificationService(pool | null, verifyOnMainThread).run(world, opts) → VerifyOutcome   // never throws
```

`AgentBridge.verify(world, { signal })` and `Studio.runVerify()` stream each
test into `store.verify.live` (`{ tests, results (index-aligned, null until
decided), lanes, worker }`, coalesced to ≤ 1 store write per 60 ms); the
final state adds `lanes`, `worker` and `simulatedSeconds`. The verification
worker is served with `default-src 'none'; script-src 'self'
'wasm-unsafe-eval'; connect-src 'self'` (server and `vercel.json`).

Render performance helpers (`@aether/render`, additive):

```ts
accelerateRaycast(mesh, idle?): boolean      // BVH raycast for meshes with ≥ BVH_MIN_TRIANGLES (512); tree built at idle, refitted on vertex edits
triangleBvh(geometry): TriangleBvh | null    // cached per geometry (rebuilt when the index or the position array changes)
class AdaptiveResolution { scale; enabled; record(dt, continuous): boolean; reset(): void }   // ADAPTIVE_DEFAULTS: < 40 fps → ×0.8 steps to 0.5
class StaticBatches { rebuild(nodes): boolean; update(): boolean; drawCallsSaved; count; clear() }   // used by SceneSync
SceneSync.updateBatches(): boolean; SceneSync.batchStats(): { batches; drawCallsSaved }; BATCHED_LAYER = 7   // raycasters must enable it
RenderStats.resolutionScale?: number; RenderStats.batchedDrawsSaved?: number
```

`WorldRenderer.screenshot()` and `renderViews()` read pixels back
asynchronously (output render target + `readRenderTargetPixelsAsync`) and
fall back to the synchronous canvas readback once if that fails.


## Scale geometry: scatter fields and virtual geometry (`@aether/render`, additive)

Both are on by default, work identically on the WebGPU and WebGL2 backends
(plain instanced / indexed draws; all planning on the CPU) and degrade by
budget, never by failure.

```ts
// Renderer options (default true): huge scatter layers as culled LOD fields; high-poly parts as virtual geometry;
// built-in generators run in the compute worker (inline fallback).
RendererOptions.fields?: boolean; RendererOptions.virtualGeometry?: boolean; RendererOptions.workerGeneration?: boolean;
WorldRenderer.scaleGeometryActive: boolean                 // a field or a virtual mesh is mounted
RenderStats.sceneTriangles?: number                        // full-detail triangles the scene holds (instances × mesh, every part)
RenderStats.fieldInstances?: number; RenderStats.fieldDrawn?: number
RenderStats.virtualInstances?: number; RenderStats.virtualSourceTriangles?: number; RenderStats.virtualDrawnTriangles?: number
RenderBudget.fieldInstances / fieldTriangles / virtualTriangles   // per GPU class (discrete 2M / 4M / 3M … low memory 300k / 600k / 400k)

// SceneSync (GPU-free)
SceneSyncOptions.fields?: { maxInstances; triangles } | false      // layers ≥ FIELD_MIN_INSTANCES (2000) become fields
SceneSyncOptions.virtual?: { triangles; dag?: DagClientOptions } | false   // parts ≥ VIRTUAL_MIN_TRIANGLES (20 000)
SceneSync.updateView(camera, heightPx, nowMs = 0): boolean   // re-plan fields + cuts; throttled to VIEW_INTERVAL_MS (120) when nowMs > 0
SceneSync.viewNeedsUpdate: boolean; SceneSync.scaleGeometryActive: boolean
SceneSync.fieldStats(); SceneSync.virtualStats(); SceneSync.sceneTriangles()

// Algorithms (pure, typed arrays, unit-tested)
simplifyMesh(positions, indices, { targetIndexCount, maxError?, locked?, lockBorder?, welded? }) → { indices, error }   // QEM half-edge collapse: never creates vertices
buildClusters(positions, indices, maxTriangles = 128, weld?) / splitClusters(...) / clusterBounds(...) → spheres + normal cones
buildClusterDag(positions, indices) → ClusterDag            // levels of 128-triangle clusters, groups of 4 simplified with locked borders
selectCut(dag, view, out, scratch) → count; assembleCut(dag, selected, n, target, offset?) // watertight view-dependent cut (≤ threshold px)
buildLodChain(parts, ratios?) → LodLevel[]                   // discrete LODs for scatter meshes (faceted parts re-flattened)
buildChunks(packed, count, radius) + new FieldCuller(chunks, { lodTriangles, radius, budgetTriangles }).update(view) → dirty level mask
composeScatterPacked(placements, lift, sampler?) → Float32Array   // x, y, z, s·cos, s·sin (20 B per instance)
gradeFor(skyState) → Grade                                  // post-pass colour grade (split tone, saturation, contrast)
WorldRenderer.startTour(seconds = 26): boolean; stopTour(); touring   // fly-through around the content; canvas input stops it
tourKeys(from, center, radius, focus?, floorY?) → TourKey[]; new CameraTour(keys, seconds).update(dt, camera, target)
```

DAG builds run in `dag.worker.ts` (module worker; inline fallback),
one at a time, 60 s timeout, cached per geometry key (96 MB LRU); requests
and replies are structurally validated (`parseDagRequest`, `validateDag`:
types, lengths, index ranges). Physics caches outputs above the trimesh
limit as a collider view (colliders + bounds + a 16k point sample).

World IR (backward compatible): `ScatterShape.count` max 1 000 000 (was
200 000), `LIMITS.MAX_SCATTER_TOTAL` 2 000 000 (was 500 000). New built-in
generator `colossus` (variants head / standing stone / boulder; `detail`
1–4 ≈ 49k–786k smooth triangles) and terrain variant 3 (canyon, floor at y = 0).
Studio URL flag `?engine=classic` turns fields and virtual geometry off.

## Block worlds: `@aether/voxel` (+ additions to core, render, physics, studio)

### World IR (additive, backward compatible)

```ts
WorldDoc.voxel?: VoxelTerrain            // absent for ordinary worlds
VoxelTerrain = { preset: 'survival'|'plains'|'forest'|'desert'|'snow'|'mountains'|'islands'|'flat'|'void' = 'survival',
  seed?: int (default world.seed), viewDistance: 2..16 = 6 (chunks), border: 0..30000 = 0 (finite half-size, 0 endless),
  blocks: VoxelBlockDef[] (≤ 64 custom / recoloured blocks), edits: VoxelEdit[] (≤ 2000), game: VoxelGame }
VoxelEdit = box | sphere | cylinder | line | stairs | structure (house castle tower bridge well pyramid tree lamppost wall arch)
          | pixels (character grid + palette) | text (5×7 font) | replace | clear;  anchor 'world' | 'surface' (y above generated ground)
VoxelGame = { mode: 'survival'|'creative'|'explore', dayLength, startHour, cycle, mobs, passive[], hostile[], maxMobs,
  hunger, fallDamage, keepInventory, startItems: VoxelStack[], recipes: VoxelRecipe[] }
Patch += { op: 'setVoxel', set: Record<string, Json> | null }    // deep merge (arrays replace); null removes the terrain
       | { op: 'voxelEdit', edits: VoxelEdit[] (1..256) }       // append edits; needs terrain
LIMITS.MAX_VOXEL_PATCH_BLOCKS 2 000 000 · MAX_VOXEL_TOTAL_BLOCKS 32 000 000 · MAX_VOXEL_EDITS 2000 (upper-bound volumes, voxelEditVolume)
```

Block and item ids are checked against `VOXEL_BLOCK_IDS` / `VOXEL_ITEM_IDS`
plus the world's custom blocks (with "did you mean" hints); `diffWorlds`
reports `voxelChanged`; `patchesBetween` emits `setVoxel`; `summarizeWorld`
prints `voxel …`, `voxel-game …` and the newest 24 `voxel-edit …` lines.

### `@aether/voxel` (pure TypeScript, no three.js)

```ts
BlockRegistry(custom?: VoxelBlockDef[])  // numeric ids (0 air, built-ins, custom), flag tables solid/opaque/render/emissive/lightCost, faceTiles
ChunkData                                // palette-compressed 16×16×128 chunk: 0/1/2/4/8/16-bit indices; get/set/pack/fromPacked(validated)/toDense
TerrainGenerator(seed, preset, reg)      // height/biome/groundLevel + generate(cx, cz, out): biomes, caves, ores, trees, plants (deterministic)
compileEdits(edits, reg, gen, seed) / applyEdits(compiled, cx, cz, dense)   // document edits, bounded per chunk
  CompiledEdit = { min/max X Y Z (inclusive), content?: { minY, maxY }, sample(x, y, z, cur) → id | −1 }
  // structures: columns that carve are also cleared up to the sky; foundation columns reach down to the
  // natural ground (≤ MAX_FOUNDATION_REACH = 48 below the model); `content` = the model's own extent
LightVolume.compute(reg)                 // sky + block light flood over the 3×3 chunk region
ChunkMesher.mesh(volume) → ChunkMesh     // greedy, per-vertex AO + smooth light; passes opaque / cutout / liquid
  MeshBuffers = { positions f32×3, uvs f32×2 (block units), data u8×4 = [tile, AO×85, sky×17, block×17], indices, quads }
VoxelJobContext(identity).generate(cx, cz) / .mesh(chunks[9], tops?)        // the two worker jobs
VoxelJobPool({ createWorker?, workers? (1–2 by deviceMemory/cores), timeoutMs? })
  .configure(identity, maxBlockId) → key; .generate(cx, cz, urgent?) / .mesh(cx, cz, chunks, tops, urgent?) → Promise<… | null (outdated)>
  // module workers (voxel.worker.ts) with inline fallback; zod-validated messages; checkMesh / fromPacked on every reply; timeouts;
  // mesh jobs keep chunk references and pack them when posted (ChunkData.view(): structured clone copies, no transfer)
VoxelWorld(reg)                          // loaded chunk slots (version, modified), get/set/isSolid/isLiquid/surfaceY, dirty set for remeshing
ChunkStreamer(world, pool, sink, { viewDistance, border?, saved? })
  .setCenter(x, z); .update(); .regenerate(keys); .reset(); .settled; .meshedCount; .shownVersion(key)
  // spiral order, dirty chunks first (urgent), generate within view+1, mesh within view, hide beyond view, unload beyond view+2
raycastVoxels(get, ox, oy, oz, dx, dy, dz, max, hits, out: VoxelHit) → boolean   // Amanatides–Woo DDA, allocation-free
moveBody(query, body, dt, autoStep?) / sweepAxis / resolvePenetration / sampleLiquid   // swept AABB, no tunnelling, 1-block step
buildAtlas(reg) → { pixels RGBA 256², 16 px tiles }                           // procedural block textures
encodeSave / decodeSave / encodeChunk / decodeChunk (deflate-raw via CompressionStream; caps, zod meta, SaveFormatError)
```

`@aether/voxel/game`: `VoxelGame({ world, reg, settings, seed, spawn })`
with `tick(dt, GameInput)`, `drainEvents(fn)` (`sound`, `block`, `pickup`,
`damage`, `death`, `respawn`, `message`), `breakTime`, `harvests`, `craft`,
`spawnMob`, `spawnDrop`, `respawn`, `snapshotPlayer` / `loadPlayer`;
`ItemRegistry`, `Inventory` (36 slots, hotbar 0–8), `RecipeBook` (built-in
shapeless recipes + `game.recipes`), `DayClock` / `daylightAt` /
`skyForHour` / `skyTintAt`, `MOB_SPECS` + `tickMob` / `hurtMob`.

### `@aether/render`, `@aether/physics`, studio

```ts
WorldRenderer.voxel(): Promise<VoxelLayer>   // lazy chunk; .voxelIfLoaded; .releaseVoxel()
VoxelLayer.setAtlas(pixels, size, faceTiles); setChunk(key, cx, cz, mesh | null); removeChunk(key); setLighting(daylight, tint)
          setFog(color, near, far, density); setFogOrigin(x, z)   // terrain's own fog: linear over the horizontal distance
          // to the streaming centre (near = ½ view distance, far = view distance) + the document's exp² fog density
EnvironmentRig.terrainFog: { color, near, far, density }   // set by setFogDistance; the renderer copies it to the layer each frame
          setTarget(x, y, z, visible); setCrack(progress); setDrop(...); setMob(...); stats()
WorldRenderer.setCameraPose(x, y, z, yaw, pitch)   // camera mode 'manual'
WorldRenderer.setFogDistance(metres | null); setEnvironmentOverride(env); restoreEnvironment(); setAvatarVisible(on)
PhysicsWorld.setVoxelTerrain(source: VoxelSolidSource | null)   // merged 8³ brick colliders around dynamic bodies
Simulation.voxel: VoxelSession | null        // lazy; status(), measureEdit(), blockAt(), counts, game (VoxelPlay)
VoxelSession.editFocus(from?) → { center, radius } | null          // sphere around the document edits from index `from`
VoxelSession.viewOffset(center, radius, distance, preferred)        // framing side with the clearest view (generator heightfield)
Simulation.revealVoxelEdits(from)            // frame the block edits a turn added
isNewWorld(prev, next)                       // also true when block terrain appears or changes seed / preset
addedVoxelEdits(prev, next) → index | null   // first block edit a turn added (camera reveal)
```

Saves live in IndexedDB database `aether-voxel` (stores `chunks`,
`players`), keyed `<project id>::<preset>:<seed>:<border>`.

## Real-life architecture: `@aether/arch` (+ additions to core, procgen, render, agent, studio)

### World IR (additive, backward compatible)

```ts
Entity.arch?: ArchMeta     // role in a parametric building; absent for everything else
ArchMeta = { role: ArchRole, name?, level? (storey index), height? (storey height), room? (room entity),
  wall? (host wall of a door / window / opening), kind? (furniture kind or room type),
  variants?: Array<Record<string, Json>> (≤ 6; generator param overrides for the walkthrough's finish swap),
  plan?: Json (buildings: the BuildingPlan they were compiled from; validated by @aether/arch) }
ArchRole = building level wall room ceiling door window opening stair roof railing column furniture fixture light switch site pool
MaterialSpec.finish?: MaterialFinish   // oak walnut ash herringbone marble terrazzo concrete plaster paint tile subway-tile stone brick
                                       // fabric velvet leather carpet brushed-metal chrome brass black-metal glass frosted-glass ceramic
                                       // mirror roof-tile metal-roof decking grass gravel water (procedural PBR texture sets)
WorldTest += { kind: 'navigable', target: building id | '*', clearance: 0.4..2 = 0.8 }
```

### `@aether/arch` (pure TypeScript, typed-array geometry, no three.js)

```ts
BuildingPlan (zod) = { id, name, style: modern|scandinavian|industrial|japandi|classic, origin [x,z], rotation°, plinth,
  exteriorWall { thickness, finish }, interiorWall { thickness }, levels: PlanLevel[1..6], roof: PlanRoof, site?: PlanSite }
PlanLevel = { name?, height 2.4..8, rooms: PlanRoom[1..40], doors ≤ 80, windows ≤ 80, autoWindows, stairs ≤ 4, railings ≤ 16 }
PlanRoom = { id (slug), name?, type: RoomType, rect [x0,z0,x1,z1] | polygon, floor?, wallColor?, furnish, items ≤ 60, omit ≤ 20 }
PlanDoor = { between: [room, room|'outside'], at 0..1, width 0.6..4, height, kind swing|sliding|opening, style?, side?, main }
compileBuilding(plan, { seed? }) → CompiledBuilding { id, entities, patches, stats, spawn, spawnYaw, bounds, rooms[{ id, level, name, type, area }], notes }
  // mitred wall network (T-junctions butt), CSG-free openings, slabs / ceilings / stairwells, swing / sliding doors
  // (door behaviour, E), windows, stairs (straight / L / U), roofs (flat / gable / hip / shed), railings, site works,
  // furniture layouts per room type and style, ≤ MAX_BUILDING_LIGHTS (14) real light sources, switches; ≤ 1800 entities
  // door swing side and window interior side are sampled geometrically (merged collinear walls pass several rooms)
PlanError { code, message, hint }        // every refusal carries a machine-readable code and a concrete fix
applyArchOps(world, ops ≤ MAX_ARCH_OPS 40) → { patches, lines, errors[{ index, op, code, message, hint }], compiled, reports, target }
  ArchOp = create_building {plan, walkthrough=true} | remove_building | add_level | add_room {level, room, doors?} | remove_room
         | add_door | add_window | add_stairs | set_roof | set_style | furnish_room {items?, omit?} | place_item | remove_item
         | set_material {target: exterior|roof|floor|walls, room?, material}
  // ops apply in order to the stored plans; touched buildings are re-compiled, locked entities kept, a `navigable`
  // test added, the player set to first person in front of the main entrance; minimal patches via patchesBetween
checkBuilding(world, id, clearance=0.8) / checkBuildings(world, '*') → BuildingReport { passed, rooms, reachable, doors, doorsClear, issues }
  // 5 cm nav grid per storey from the document (walls, door linings, floor furniture; walkway inflation); flood fill
  // from the entrance through doorways and up stairs; door swing discs free of furniture; furniture grounded, no overlaps
navigableVerdict(world, target, clearance)  // the physics verifier's `navigable` test
floorPlan2d(world, building, level) → FloorPlan2d { rooms (polygon, area m², label point), walls (solid pieces), doors (hinge,
  open leaf, arc), windows, items (footprints), stairs (outline, treads, arrow), dimensions, bounds }   // plan frame, ≤ 4000 elements
listBuildings(world) / listLevels(world, building) / planToWorld / worldToPlan
// Plan editing for interactive tools (plan frame; all return ordinary ArchOps):
snapPlanPoint(p, level, grid=0.1)        // room corner within 0.3 m, else onto a room edge at grid steps, else the grid
roomShape(points) → { rect } | { polygon } // PlanError for < 3 corners, self-crossing, < 1.5 m²
drawRoomOp(plan, level, points, type, name?)  // refuses overlaps; adds a door to the neighbour sharing the longest wall
                                              // (≥ 1.1 m), or an entrance for a free-standing room
drawRoomCandidates(plan, level, points, type) // ≤ 8 alternatives (door near either end, other neighbours, an entrance);
                                              // the studio commits the first whose result passes the usability checks
pickWall(level, p) → WallPick | null     // shared wall [roomA, roomB] or exterior wall [room, 'outside'] + side, within 0.45 m
doorAtOp(plan, level, p, { width?, kind? }) / windowAtOp(plan, level, p, { width? }) / doorAtFraction(span, t, width)
nextRoomId(plan, type) / levelPolygons(level)
variantsFor({ kind }) → param overrides of sofas, armchairs, rugs, beds (walkthrough finish swap)
buildWall(WallParams) … buildStructure(id, params) / buildFurniture(def, params, seed)   // the arch-* / furn-* generators
WallParams.cut?: 0.05..30   // VIEW-ONLY section: the wall is drawn up to `cut` with a dark cap (SECTION_CAP); window holes
                            // below fill in, doorways stay open. Set by the renderer's view modes; never compiled into documents.
```

`@aether/procgen` wraps every structural element (`arch-wall`, `arch-slab`,
`arch-ceiling`, `arch-roof`, `arch-stair`, `arch-door`, `arch-frame`,
`arch-window`, `arch-railing`, `arch-column`, `arch-basin`) and every
furniture piece (`furn-*`, light fittings with a `lit` switch) as built-in
generators; their params are zod-validated by `@aether/arch`. Finish
textures (albedo / roughness / normal per `MaterialFinish`) are synthesised
in the compute worker (`compute.finish(finish, size)`).

### `@aether/render`

```ts
WorldRenderer.setArchView(patch: Partial<ArchViewState>); .archViewState; .hasBuildings
  ArchViewState = { walls: 'up'|'cutaway'|'down', levels: 'stacked'|'exploded'|'solo', level, xray, section: metres | null }
  // cutaway: exterior walls facing the camera sectioned at CUTAWAY_WALL_HEIGHT (1.05 m); down: every wall at 0.3 m;
  // exploded: storeys + roof lift apart (EXPLODE_GAP 3.4 m, animated 0.9 s); solo: one storey; x-ray: structure as glass;
  // section: GPU clipping plane (ClippingGroup, loaded lazily) + walls rebuilt to the plane with their cap.
  // Ceilings, roofs and ceiling fittings hide while looking in; wall-mounted pieces hide with their sectioned wall.
  // All view state: sectioned walls are runtime overrides of `shape.params.cut`, restored per node.
archDecision(state, ctx) / explodeLift(level, isRoof, t) / distanceToWall(...) / looksInside(state)   // pure, unit-tested
WorldRenderer.setRenderQuality('realtime' | 'studio') → quality in effect; .renderQuality; .studioQualityAvailable; .refineProgress
WorldRenderer.onQualityChange: ((q) => void) | null   // fired when the effective quality changes (e.g. studio fell back)
  qualityPlan(quality, budget, software?) → { post: 'standard'|'studio'|null, shadowMapCap, shadowRadius, accumulateFrames, adaptiveResolution }
  // studio = pre-pass (packed view normals + velocity, single-sampled) → GTAO (half resolution, temporal) applied to
  // indirect light only (builtinAOContext) → scene pass → bloom + grade → TRAA; sun shadow map ×2 (≤ 4096), PCF radius 6;
  // keeps drawing 48 refinement frames (16 on software rasterizers) after the view rests, then idles; adaptive
  // resolution suspended. Unavailable without the post budget (low-memory mode) or when the pipeline fails (→ realtime).
createPostPipeline(renderer, scene, camera, bloom, quality = 'standard')   // PostPipeline.quality
SceneSync.restoreNode(id)            // drop one node's runtime overrides (view modes undo their own)
SceneSync.setArchLampScale(scale)    // architectural lamps (arch.role 'light') dimmed in daylight; off below LAMP_CUTOFF (0.2)
daylightLampFactor(sunElevationDeg)  // 1 at night → DAYLIGHT_LAMP_FACTOR (0.14) in full daylight (smoothstep, −3°..22°)
StaticMerges                         // building parts (static `arch` entities without behaviours) merged per storey and
                                     // material (≥ MIN_MERGE 3 meshes, ≤ 400 k vertices per buffer) under the storey object;
                                     // members stay on BATCHED_LAYER (pickable) and are evicted when they move, change
                                     // material, rebuild or hide; merged buffers are owned and disposed on regroup / clear
SceneSync.setMergesSuspended(on)     // the renderer pauses merging while content grows in
SceneSync.batchStats() → { batches, drawCallsSaved (instancing + merges), merges }
mergeGeometries(members)             // pure: positions / normals / uvs / colours into the parent frame
```

Frame fitting: worlds with buildings frame from 38° elevation, without sky
tilt, tighter than other content (`ARCH_FRAMING`).

### Agent

`build_architecture { ops: ArchOp[], message }` (see the tool description
and the "Architecture" section of the system prompt: plan format, room
types, finishes, realistic proportions, floor-plan images and room photos).
The offline planner (`providers/mock/arch.ts`) plans apartments (1–4
bedrooms), lofts, single rooms, cafés, office floors and two-storey villas
(with terrace and pool), gives buildings without site works a paved
forecourt with planters, and turns edits of an existing building ("make it
scandinavian", "marble floors in the kitchen", "a gable roof", "remove the
tv") into ops.

### Studio

```ts
state/archUi.ts   ArchUiState { building, levels, walls, levelMode, level, xray, section, plan, planTool, roomType,
                  quality, studioAvailable, sunHour, photo }; mergeArchUi (validates every field); skyForHour; TIME_PRESETS
store.arch / store.setArch(patch)
engine/arch.ts    ArchController(host): tracks buildings + storeys; a new single-storey building opens as a cutaway;
                  applies views / quality / daylight study (environment override, document untouched); suspends view
                  modes while playing; edit(ops, message) → one undoable user commit (refusals and usability issues as toasts);
                  drawRoom(points) / addDoor(p) / addWindow(p) / removeRoom(id) / restyle(op, message); .walkthrough
engine/walkthrough.ts  Walkthrough (play mode, worlds with a building): 1–4 time of day, E switch / lamp (consumed only at a
                  switch facing the player or a lamp; elsewhere E opens doors), L all lights, R finish swap, V first/third
                  person, P photo mode; walkIndex / nearestTarget / roomToggle / nextVariant (pure)
Simulation        walkthroughs start facing the entrance (entranceYawDeg); worlds with a building frame themselves
components/viewport/ArchBar.tsx   3D | Plan · walls · storeys · x-ray · section · daylight · Studio · Walk
components/viewport/PlanView.tsx  SVG floor plan: poche walls, doors with swing arcs, windows, stairs, furniture,
                  room chips (dot · name · m²), dimensions; tools select / rectangle / polygon / door / window; snapping
lib/planView.ts   fitPlan / zoomAt / panBy / viewBox / roomColors / areaLabel / dragRect / closesPolygon (pure)
lib/labels.ts     roomLabels(world, level?) → name · m² chips over each room (cutaway / walls down / section / one storey)
state/archUi.ts   sectionLevel(levels, height) → the storey a section cuts through (its rooms are labelled)
```

E2E: `npm run e2e:arch` (Chromium WebGPU, Chromium WebGL2, Firefox WebGL2):
prompt → cutaway → walls down, x-ray, section, golden hour, studio render →
floor plan (draw a room, add a door, undo) → walk in through the front door
(E) → night, all lights, photo mode → Stop restores the views.

## Asset pipeline: `@aether/assets` (+ additions to core, render, physics, logic, arch, agent, server, studio)

### World IR (additive, backward compatible)

- `ShapeSpec` gains `AssetShape`:
  `{ kind: 'asset', id: AssetRef, variant?: AssetRef, fitSize?: number (0..500 m), animation?: string, fallback?: PrimitiveShape | ProceduralShape }`.
  `id` is a library catalog id (`sofa`, `tree-oak`) or a user import
  (`user-` + 12 hex of the content SHA-256). Models are real-world sized
  (metres), base on y = 0, centred in x/z. `variant` must be one of the
  catalog entry's `variants`, else the base id is shown. `animation`:
  absent / `"auto"` = idle / walk / run from the entity's movement,
  `"none"` = rest pose, any other value loops that clip.
- **Fallback chain** (render and physics agree): catalog / import → a
  generator asset's procedural shape → the shape's `fallback` → a
  translucent box of the asset's size (or 1 m), with a warning. Never empty.
- `Environment` gains `hdri?: AssetRef`, `hdriIntensity?: number (0..8, default 1)`,
  `hdriBackground?: boolean (default true)`.
- Library models face +Z (props, like `furn-*` furniture); characters,
  animals and vehicles face −Z (the engine's forward axis) — catalog field
  `facing`.

### `@aether/assets` (pure TypeScript; `sideEffects: false`; subpath `@aether/assets/import`)

| Export | Contract |
| --- | --- |
| `Catalog`, `CatalogEntry`, `CatalogPack`, `CatalogCollider`, `CatalogAnims`, `AssetCategory`, `AssetLicence` | zod schemas of `assets/catalog.json` (version 1). Paths are content-hashed (`m/<id>[.lod1|.lod2].<sha8>.glb`, `h/…hdr`, `t/…webp`) relative to `base` (`/assets/lib/`). Licences: `CC0-1.0`, `CC-BY-4.0` (third party), `MIT` (first-party forge originals). Kinds: `model`, `hdri`, `generator` (a library procedural generator + params) and `material` (category `materials`: `material: { finish, tile, maps: { albedo, orm, normal } }`, photographed maps of a `MaterialFinish`; `x/<finish>.<map>.<sha8>.jpg`). Older catalogs without the new kind / category stay valid. |
| `loadCatalog()` / `getCatalog()` / `setCatalog(c)` / `catalogEntry(id)` / `libraryUrl(path)` | Lazy registry. `loadCatalog` imports the JSON once (own bundle chunk), validates it and never rejects (empty catalog when missing). |
| `searchAssets(catalog, query)` / `bestAsset(catalog, text, filter)` | Tokenised, plural-folded, synonym-expanded (`SYNONYM_GROUPS`), typo-tolerant (one edit or swap) AND search with category / kind / style / placement / animated filters; ties prefer lighter models; ≤ 200 results. |
| `selectLod(entry, distance, fovY, scale?, bias?)`, `lodDistances(…)`, `screenFraction(…)` | LOD choice by projected height (`LOD_SCREEN_FRACTIONS` = 0.25 / 0.08 of the viewport). |
| `assetInfo(id)`, `assetShapeSize(shape)`, `effectiveAssetId(shape)`, `fitScale(size, fitSize)`, `pickRoles(clips)` | Uniform facts for library entries and registered imports (URL, LOD URLs, size, collider, clips). |
| `registerUserAsset({ meta, url, size? })`, `unregisterUserAsset(id)`, `userAsset(id)`, `userAssets()`, `onUserAssetsChanged(fn)` | Host registry of imports (the studio registers `blob:` URLs). Images become posters (`POSTER_WIDTH` 1.2 m). |
| `creditsFor(world, catalog?)`, `creditsText(name, credits)`, `worldAssetIds(world)` | Attribution grouped by pack + author (imports last). |
| `catalogSummary(catalog)` | ≤ 1800 characters: per category count + example ids (prompt). |
| `validateGltf(bytes, limits?)` → `{ ok, glb, report } \| { ok:false, error }` | Never throws. GLB or self-contained `.gltf` (data URIs only). Exact header / chunk checks, `inspectUntrusted` JSON guard, zod structure, no external URIs, supported extensions only (no Draco / Basis), budgets (`DEFAULT_GLTF_LIMITS`: 32 MB, 500 k triangles, 4096 nodes, 64 textures, 64 clips …), names sanitised, `extras` dropped, pivot normalised by a new root node (idempotent). |
| `validateImage(bytes)` / `validateHdr(bytes)` | PNG / JPEG / WebP / Radiance RGBE by magic bytes; byte and pixel caps. |
| `importUserAsset(bytes, fileName)` (`@aether/assets/import`) | Sniffs the kind by content, validates, returns sanitised bytes + `UserAssetMeta` with a content-derived id. |
| `createTrellisProvider({ endpoint, token?, timeoutMs?, maxOutputBytes?, fetch? })`, `isAllowedEndpoint(url)` | Optional image → GLB through a user-run TRELLIS.2 wrapper (see docs/IMAGE_TO_3D.md). Loopback over http or https only; results pass `validateGltf`. |

### `@aether/render`

- `SceneSync` mounts `asset` shapes (placeholder sized from the catalog while
  loading; refcounted per URL; LOD chains as three.js `LOD` whose lower
  levels reuse LOD 0's materials; posters for image imports;
  `refreshAssets(ids?)`; `gaitOf(id)`; `animatedCount`; `updateAnimations(dt)`).
  New option `textures?: TextureCache`.
- `AssetAnimator` (lazy chunk): idle / walk / run cross-fades from tracked
  world-space speed (`GAIT`: walk ≥ 0.25 m/s, run ≥ 3.2 m/s), gait scaled
  to speed, zero allocations per frame.
- `createGltfModelLoader()` now decodes `EXT_meshopt_compression`
  (three's `MeshoptDecoder`, lazy) and keeps clips on `scene.animations`;
  `cloneModel` / `instantiateAsset` clone skinned models with
  `SkeletonUtils`.
- `HdriController` (`environment.hdri`): lazy `HDRLoader`, binds
  `scene.environment` (× 0.6 of the sky's IBL scale) and the background,
  dims the hemisphere ambient; the analytic sky stays the fallback.
- `FinishTextures.usePhotos(resolver, loader?)` switches `material.finish`
  maps to photographed ones (`photoFinishResolver()` over the installed
  catalog's `material` entries): albedo is a pattern ratio around 1 that
  is multiplied by the finish colour (tints keep working), ORM roughness is
  rescaled to the finish's calibrated value. Unknown finishes, a missing
  catalog or a failed fetch keep the procedural maps. `WorldRenderer`
  calls it when the catalog is installed (`refreshAssets()`).
- `WorldRenderer`: options `textureSource`, `hdriSource`; methods
  `cursorRay(ndcX, ndcY)`, `refreshAssets(ids?)`, `gaitOf(id)`, `animatedCount`.
  Animated assets update only while `render(dt, { animate: true })`.

### `@aether/physics`

- `autoColliders` handles `asset`: provider colliders → catalog
  (`assetColliderDescs`: box / upright capsule / hull support points) →
  fallback chain. `PhysicsWorld.create` / `restore` await the catalog when
  the world uses assets. Subpath `@aether/physics/asset-colliders` (no Rapier).

### `@aether/logic`, `@aether/arch`

- Trigger zones of asset entities use the asset's size.
- `furnitureAsset(kind, style)` / `FURNITURE_ASSETS`: when the catalog is
  loaded, layouts place photographed models for kinds that suit the
  building style (classic: sofa, armchair, nightstand; all: round coffee
  table; modern styles: pendant), sized by the model, with the `furn-*`
  generator as `fallback`. `furnitureOfEntity(e)` gives the definition and
  size of procedural or asset furniture (floor plan, nav and support checks).
  Ceiling models hang from their top.

### `@aether/agent`

- Tool `search_assets({ query ≤ 120, category?, limit 1..20 })` (between
  `request_asset` and `inspect`). `AgentCatalogs.assetSummary?` adds an
  "Asset library" prompt section.
- `forgeGenerator(deps, req)` — the asset forge: OBSERVE → SPEC → BUILD →
  PARAMETRISE (`FORGE_METHOD`), sandbox check, four-view contact sheet,
  critic scores (`FORGE_CRITERIA` silhouette .35, proportions .25, parts .25,
  colours .15; gate `FORGE_GATE` 0.8), coder patches from text critique;
  `maxIterations` ≤ 6, `maxCalls` ≤ 16; best iteration wins; reasons
  `passed | iterations | calls | no-vision | failed | aborted`.
- The offline planner places library models for everyday nouns
  (`PROCEDURAL_NOUNS` stay procedural), brings characters / animals to life
  (npc / wander / follow), and dresses the city street with library models and
  an HDR sky when the catalog is loaded.

### `apps/server`

- `GET /api/health` adds `imageTo3d: boolean`.
- `POST /api/image-to-3d` (only with `AETHER_IMAGE_TO_3D_URL`; optional
  `AETHER_IMAGE_TO_3D_TOKEN`, scrubbed from logs): raw PNG / JPEG / WebP
  ≤ 12 MB → validated GLB (`model/gltf-binary`); one job at a time (429);
  upstream failures → 502 without details.
- `/assets/lib/*` is served from the build output with the immutable cache
  rule of `/assets/*` (`scripts/vite/asset-library.ts` serves it in dev and
  preview and copies it into `dist`).

### Studio (`apps/studio/src/engine/assets.ts`, `forge.ts`, `src/assets/*`, `src/editor/library/*`)

- `studio.assets` (`AssetController`): `ready()`, `place(id, ndc?)`,
  `placement(id, ndc)`, `previewDrop` / `clearPreview` (ghost),
  `importFiles(files, ndc?)`, `removeImport`, `saveCreation` /
  `placeCreation` / `removeCreation`, `credits()`, `buildPackage()` /
  `exportPackage()` / `importPackage(file)`, `toggleFavorite`,
  `setCreditsOpen`; its own zustand store (`LibraryState`).
- Imports live in IndexedDB `aether-assets` (v2: `meta`, `blobs`,
  `generators`), ≤ 200 files / 400 MB, ≤ 100 creations; memory fallback.
- Packages (`.aether.zip`): `world.aether.json`, `package.json`
  (`format: "aether-package"`), `CREDITS.txt`, `assets/lib/<library path>`,
  `assets/user-<id>.<ext>`. Import re-validates every file and keeps only
  files whose content id matches the name.
- `studio.forge` (`ForgeController`): `availability()`, `open(base?)`,
  `run(description, reference)`, `cancel()`, `accept()`; renders with a
  private off-screen WebGL2 `WorldRenderer` (disposed on close).

## Publishing: games, videos, renders, models, floor plans, share links

Everything here is additive; the World IR is unchanged.

### `@aether/render`

- `WorldRenderer.beginCapture(width, height, { vignette? })` → `CaptureSession`
  (`view/capture-session.ts`): exclusive; the viewport stops drawing and
  `resize()` is deferred until `end()`. The drawing buffer is set to the
  capture size once (pixel ratio 1). `frame(pose, { dt?, frames?, view? })`
  poses the camera (`{ pos, target, fov? }`), advances animations and the
  environment by `dt`, renders `frames` times (temporal accumulation) and
  resolves to the session's one reused RGBA8 buffer (tight, top-down,
  opaque). `view` renders a sub-rectangle of a larger virtual image through
  the camera view offset (temporal AA jitter is composed with it). Frames
  must be awaited one at a time. Editor decorations, the path overlay,
  debug and ghost objects are hidden; grow-in is finished first.
- `renderStill({ width, height, pose, frames?, tileSize?, signal?, onProgress? })`
  → `{ width, height, data }`: up to 8192 px on the long side; one draw
  when it fits `tileSize` (default 2048), else overlapping tiles (48 px
  margin on split axes) assembled on the CPU with the vignette applied to
  the whole image (`applyVignette`, the CPU twin of the shader).
- `preparePost(timeoutMs?)` resolves once the post pipeline of the current
  quality exists; `setPixelRatioCap(cap)`; `capturing`.
- `exportGltf({ binary?, maxTriangles? })` → `{ data: Uint8Array | string,
  meshes, triangles, skipped }`: what the camera draws, flattened (static
  batches and merged buildings instead of their hidden members; scatter
  fields and virtual geometry at their current detail), node materials
  copied to `MeshStandardMaterial`, RGBA8 / image textures only, ≤ 6 M
  triangles. `verifyGltf(data)` (exported) parses a file back with
  `GLTFLoader` and counts meshes, materials, triangles and textures.
  The module-level `exportGltf(content, camera | null, opts)` (no camera:
  every visible mesh) rejects with "nothing to export" or "over the export
  limit" before the exporter loads; `exportGlb(root, maxTriangles?)`,
  `buildExportScene(content, camera | null, max?)`, `countTriangles(root)`,
  `textureExportMode(tex)` ('keep' | 'canvas' | 'drop') and `rgbaPixels`
  are exported. One pipeline serves the quick export and the Publish hub.
- `lookAt(pos, target, fov?)`, `cameraPose()`, `cameraFloorY`,
  `showCameraPath(points | null, keys | null, markerSize?)` (editor-only
  line + key markers; `view/path-overlay.ts`).
- `PostPipeline.setVignette(strength)`; `vignetteFactor`, `VIGNETTE_STRENGTH`
  exported. Pure helpers: `tileLayout`, `normalizePixels` (drops WebGPU's
  256-byte row padding, flips WebGL2 rows — screenshots now use it too),
  `blitTile`, `stillSize`, `MAX_STILL_SIZE`, `MAX_TILE_SIZE`, `TILE_MARGIN`.

### `@aether/assets`

- `@aether/assets/zip` (moved from the studio; `apps/studio/src/assets/zip.ts`
  re-exports it): `writeZip` (deflate via `CompressionStream` unless the
  entry is already compressed: png/jpg/webp/woff/mp4/webm/zip/glb),
  `readZip(bytes, limits)` (caps, safe names, CRC), `safeEntryName`, `crc32`.
  `safeEntryName` also refuses Windows device names (`con`, `nul`, `com1` …,
  any extension) and parts ending in a dot or a space.
- `@aether/assets/offline-sw`: `serviceWorkerSource(buildId, files)` (the
  `sw.js` of published builds; the studio's `player/offline.ts` re-exports
  it) and `isGeneratedServiceWorker(text)` (exactly a generated worker).
- `GltfLimits` gained `maxAccessorBytes` (256 MB decoded vertex data,
  accessors without a buffer view included), `maxTextureSide` (8192) and
  `maxTexturePixels` (80 M): every embedded image's header (buffer view or
  data URI) is read and must be PNG / JPEG / WebP within those caps before
  any decoder sees it. `accessorBytes(json)` is exported.
- `Catalog.base` accepts any absolute path of safe segments
  (`/html/12345/assets/lib/`), never `.` / `..` segments or another origin:
  published games set it to their own sub-path.

### Studio (`apps/studio/src/publish/`, `src/engine/publish.ts`, `src/editor/publish/`)

- `studio.publish` (`PublishController`, own zustand store `PublishState`):
  `open(target?)`, `close()`, `setTarget`, `setMeta`, `setMusic`, `setVideo`,
  `setTitles`, `setStill`, `setModel`, `setPlan`, `setGame`; camera path:
  `applyPreset(id)`, `addKeyFromView()`, `updateKeyFromView(i)`,
  `deleteKey(i)`, `selectKey(i)`, `setKeyEase`, `setKeyFov`, `retime`,
  `setDuration`, `scrub(t)`, `startPreview` / `stopPreview` /
  `togglePreview`, `restoreCamera`, `direct(text)`; jobs (one at a time,
  `cancel()`): `exportVideo`, `exportStill`, `exportModel`, `exportPlan`,
  `downloadGame`, `deploy(target, { name?, itch? })`, `setLan(on)`;
  share: `makeShareLink`, `shareLink`, `embedSnippet`, `copyShareLink`,
  `setPlayerBase(url)`; history: `refreshHistory`, `downloadItem`,
  `removeItem`, `snapshot(label)`, `restoreVersion(id)`, `removeVersion(id)`.
  `Studio` adds `publish`, a public `projectId`, `directorProvider()` and
  `bundledImports()`; `AssetController.importsFor(world)`.
- Share links (`publish/share.ts`): `#w=` + format letter (`D` deflate-raw,
  `J` JSON) + base64url of `{ v: 1, world, meta: { title?, description?,
  author?, controls?, music? } }`. Limits: fragment ≤ 1.5 M characters,
  inflated ≤ 8 MB (enforced while inflating), envelope strict, world through
  `validateImportedValue`. `encodeShare`, `decodeShare`, `shareUrl`,
  `shareValueFromHash`.
- QR codes (`publish/qr.ts`): `encodeQr(text, { ecc, boostEcc, minVersion,
  maxVersion })` → `{ version, ecc, mask, size, modules }` (byte mode,
  versions 1–40); `qrPath`, `qrSvg`, `byteCapacity`.
- Camera paths (`publish/cameraPath.ts`): `CameraPath` (zod) =
  `{ v: 1, name, duration ≤ 300, keys (1–64): { t, pos, target, fov 12–100,
  ease: linear|ease|easeIn|easeOut|cut }, easeInOut }`; `CompiledPath.sample(t,
  out)` (Catmull–Rom, allocation-free); presets `orbit, turntable,
  flythrough, dolly, crane, topdown, reveal`.
- Director (`publish/director.ts`): `ShotPlan` = `{ shots (1–12): { move,
  subject?, speed?, seconds?, direction?, height?, turns? } }` with moves
  `dolly, orbit, rise, descend, flythrough, push, pull, topdown, pan,
  establish, turntable, hold`; `parseShotScript(text)` (offline),
  `directorPrompt(subjects)` + `parseModelPlan(text)` (language model),
  `resolvePlan(plan, scene)` (the only place words become coordinates).
- Video (`publish/video/`): `exportVideo(source, opts)` → `{ blob, mime, ext,
  codec, width, height, fps, seconds, frames, audio, method }`;
  `chooseVideoCodec(w, h, fps, 'auto'|'mp4'|'webm')` (auto prefers MP4 only
  when this browser can play it back); `Mp4Muxer` (H.264 + Opus, fast
  start), `WebmMuxer` (VP8/VP9/AV1 + Opus, cues, seek head); music
  `scheduleMusic` / `renderMusic` / `playMusic` (moods `calm, cinematic,
  playful, mystery`); titles `drawOverlay`, `overlayAt`, `letterboxBar`.
- Floor plans: `planDrawing(plan2d, { title })` → primitives, `planSvg(d,
  scale)`, `planPdf(d, scale)` (one page, Helvetica, WinAnsi).
- Game builds (`publish/gameBuild.ts`): `buildGame(input)` → `{ zip,
  fileName, files, bytes, id }` from `play-manifest.json` (written by
  `scripts/vite/player-manifest.ts`; the build fails if editor code reaches
  the player). `game.json` (`publish/manifest.ts`): `{ format:
  "aether-game", v: 1, title, description, author, controls, publishedAt?,
  music, save?: "saves/<name>.aethersave", imports?: [{ meta, file:
  "assets/user/user-<id>.<ext>" }], world }` (strict). Index CSP: `BUILD_CSP`.
  Title-screen defaults: `defaultTitle(world)` / `defaultDescription(world)`
  / `defaultControls(world)` read the world's title card (`intro`) when it
  has one (capped to 80 / 600 / 300 characters), else the world name, an
  empty description and controls derived from the player mode.
- Publish library (`publish/library.ts`, IndexedDB `aether-publish` v1:
  `items`, `blobs`, `paths`, `snapshots`; memory fallback): ≤ 300 items,
  files ≤ 120 MB each and 400 MB total (oldest files dropped first),
  ≤ 30 snapshots per project (worlds ≤ 6 M characters, validated on read).
- Hosting client (`publish/hosting.ts`): `localPublishing()`,
  `hostTargets(fresh?)`, `uploadBuild(zip)`, `startDeploy`, `followDeploy`,
  `cancelDeploy`, `lanStatus`, `setLan`, `isPublicHostUrl`, `siteSlug`.
- `Simulation`: `setPaused(on)`, `isPaused`, `setVolume(v)`,
  `setLookSensitivity(m)`; listener `onPauseRequest()`; controllers through
  `engine/gamepad.ts` (`GamepadPoller`, standard mapping, dead zone 0.18).
  `SoundBoard.setVolume`. `VoxelHudView` / `TouchControlsView` render from
  props (used by the player).

### Player (`apps/studio/play.html`, `src/player/`)

- `/play#w=…` plays a share link; next to a build it reads `./game.json`.
  Title screen over a fly-through, pause menu (Esc / Start), settings
  (`aether.player.settings.v1`: volume, music, sensitivity, quality
  low/medium/high), credits from `creditsFor`, HUD, touch, gamepad; bundled
  imports are re-validated (`importUserAsset`, id must match) before use; a
  bundled block-world save is imported once per browser. `window.__aetherPlayer`
  exposes `phase`, `title`, `entities`, `backend`, `world`, `start()`.
- Builds register `./sw.js` (offline precache, per-scope cache names) only
  when the page links a web-app manifest.

### `apps/server` (local app only; behind the `/api/local/*` guard)

- `GET /api/local/publish/targets` → `{ targets: [{ id: netlify|vercel|github|itch,
  label, bin, installed, signedIn, account?, hint? }] }`.
- `GET|POST /api/local/publish/builds` (POST: `application/zip` ≤ 256 MB →
  `201 { build: { v, id, title, createdAt, bytes, files }, url: "/published/<id>/" }`),
  `DELETE /api/local/publish/builds/:id`.
- `POST /api/local/publish/deploy` `{ build, target, name?, itch?, channel? }`
  → `202 { job }`; `GET /api/local/publish/jobs/:id`,
  `GET …/jobs/:id/events?after=<seq>` (SSE `progress`, `ping`, `end`),
  `DELETE …/jobs/:id` (cancel). One deploy at a time (409).
- `GET|POST /api/local/publish/lan` `{ on, build? }` → `{ on, build, urls, until }`.
- `GET /published/:id/…` serves a library build with `PLAY_CSP`.
- Library builds carry no foreign code: every `.js` / `.mjs` must be
  byte-identical (SHA-256) to a player file of this computer's studio build
  (`playerDir/play-manifest.json`), and `sw.js` must satisfy
  `isGeneratedServiceWorker`; otherwise `400 publish-rejected`. Without a
  player build no build with scripts is accepted.
  `new PublishStore(dir, limits?, now?, playerDir?)`;
  `PublishServiceOptions.playerDir` (default `config.staticDir`).
- `GET /play` serves `play.html`. `/play`, `/play.html` and published builds
  get `PLAY_CSP` (no third-party hosts, `frame-ancestors *`), no
  `X-Frame-Options`, `Cross-Origin-Resource-Policy: cross-origin`,
  `Referrer-Policy: no-referrer`; `vercel.json` mirrors it.
- `createApp` deps: `publish?: Partial<PublishServiceOptions>` (`dir, env, spawn,
  lanHost, lanAddresses, tmpRoot, now`), `publishServices?` (created by `main.ts`
  and shared with the bridge), `onPublish?(services)`.
- `createPublishServices(options)` → `{ store, jobs, lan, dispose() }`;
  `bridgePublish(services)` adapts them to the bridge.

### Bridge (`apps/bridge`, hosted studios paired with the local app)

- `BridgeDeps.publish?: BridgePublish` / `startBridge(config, { publish })`:
  `GET /v1/publish/targets[?fresh=1]`, `GET|POST /v1/publish/builds`
  (`application/zip` ≤ `maxBuildBytes` → `201 { build, url: null }`),
  `POST /v1/publish/deploy`, `GET|DELETE /v1/publish/jobs/:id`,
  `GET|POST /v1/publish/lan` — all behind the pairing token and the origin
  allowlist; publishing errors map to bridge codes (`invalid_request`,
  `not_found`, `busy`, `too_large`, `backend_error`); without `publish` the
  endpoints answer `not_found`. The studio's `publish/hosting.ts` uses them
  through `PublishTransport` `{ kind: 'bridge', url, token }`
  (`AiConnection.bridgeEndpoint()`).

## Default projects and flagship worlds (+ additions to core, procgen, render, physics, agent, studio)

### World IR (additive, backward compatible)

- `WorldDoc.intro?: WorldIntro` — the title card shown when play starts:
  `{ title (1–80), tagline (≤ 200, default ''), objective? (≤ 240),
  controls (≤ 6 strings of ≤ 60, default []), accent? (#rrggbb) }`. Plain
  text, rendered as text only.
- Patch `setMeta` takes `intro?: WorldIntro | null` (`null` removes it);
  `patchesBetween` / `invertPatches` diff it; `diffWorlds().metaChanged`
  includes it; `clear` removes the title card (it describes the cleared game).
- `Environment.weather` adds `'petals'` (drifting blossom) and `'leaves'`
  (tumbling autumn leaves).
- `riverMeander(z, size)`, `riverHalfWidth(size)`, `canyonMeander(z, size)`,
  `canyonHalfWidth(size)` (exported by `@aether/core`): the curves the
  terrain generator carves, so worlds can lay water, boats and race tracks on
  them.

### `@aether/procgen`

- `terrain` variant 4 — river valley: a meandering flat riverbed at y = 0
  along Z (`riverMeander`, half-width `riverHalfWidth`) between soft grassy
  banks rising to rolling hills. Variant 3 (canyon) now reads its floor curve
  from `canyonMeander` (identical geometry).

### `@aether/render`

- Weather `petals` / `leaves`: flat double-sided flakes whose instance
  rotation tumbles (`writeTumble`, allocation-free).
- Material resolution: a part that asks for vertex colours
  (`vertexColors: true`) without an explicit `color` gets a white base — its
  albedo is in the vertex colours and the preset supplies only the surface
  feel. An explicit `color` still tints; surfaces that merely allow vertex
  colours (the ground plane) keep their preset colour.

### `@aether/physics`

- Heightfield colliders are built with `FIX_INTERNAL_EDGES`: fast bodies no
  longer catch triangle seams on flat terrain.

### `@aether/agent` (offline planner)

- `showcase/index.ts`: `FLAGSHIPS` (id, title, name matcher, deterministic
  `plan()`), `findFlagship(request, summary)`, `planShowcase(request,
  summary)`. `planMock` routes a request that names a flagship ("Lantern
  Isles", "build the kart canyon") before every other planner; in a world
  with content the request must also ask to build it. Flagship plans start
  with `clear` and end with `setMeta { intro }`; architecture flagships send
  `build_architecture` ops; Blockfall is `planBlockfall()` in the voxel
  planner. The `Builder` gains `asset(…, { animation })` and
  `scatter(…, { onSurface })`.

### Studio

- `src/showcase/manifest.ts` — `SHOWCASE: ShowcaseEntry[]`, the single place
  to curate default projects: `{ slug, title, description, prompt, kind,
  curation: 'featured' | 'candidate' | 'hidden', origin: 'flagship' |
  'gallery', shot? }`; array order is display order. `src/lib/examples.ts`
  derives `FEATURED_TEMPLATES`, `MORE_TEMPLATES`, `TEMPLATES` (shown ones),
  `templateBySlug` (hidden included), `templateThumbnail(slug)`
  (`/templates/<slug>.webp`) and `templateWorldUrl(slug)`
  (`/templates/worlds/<slug>.json`). `TemplateKind` adds `'architecture'`.
- `src/showcase/load.ts` — `loadTemplateWorld(slug, fetch?, timeoutMs?)`
  (slug pattern ≤ 64 chars, 20 s deadline over request and body, streamed
  body cap = the import limit, then `parseWorldImport`) and
  `loadTemplateThumbnail(slug, …)` (WebP magic + thumbnail budget); both
  never throw.
- `createFromTemplate(repo, slug, fetch?)` creates the project from the
  saved world with the template's title, its thumbnail and a chat that starts
  with the original prompt; if the saved world cannot be loaded it falls back
  to an empty project rebuilt by the offline planner.
- Play: `Studio.togglePlay()` holds a world with an `intro` before its first
  tick (`Simulation.setHeld`), `GameState.intro` shows the title card
  (`TitleCard`, every kind of world), `Studio.startGame()` releases it;
  restart never shows it again and stopping always releases the hold.

## Replay proofs: `@aether/verifier` (+ additions to studio, procgen; format in `docs/PROOFS.md`)

### `@aether/verifier` (new; deps: core, logic, physics, procgen, zod; bin `aether-verify`)
```ts
PROOF_FORMAT = 'aether-proof'; PROOF_VERSION = 1; REPLAY_ENGINE = 'aether-replay/1'; PHYSICS_ENGINE = 'rapier3d-compat@0.21.0'
PROOF_LIMITS   // MAX_BYTES 24 MB, MAX_TESTS 512, MAX_MESSAGE 600, MAX_SECONDS 60, collider caps
parseProof(value): { ok: true; proof: Proof } | { ok: false; error }       // zod .strict(); never throws
createProof(world, { settings?, colliders?, key?: SigningKey, now?, signal?, budgetMs? }): Promise<Proof>
                                   // replays once, throws if the wall-clock budget cut it short or the proof would not parse
checkProof(proof, world, { replay?, trustedKeys?, signal?, budgetMs? }): Promise<ProofCheck>
                                   // status: verified | intact | tampered | bad-signature | engine-mismatch |
                                   //         world-mismatch | replay-diverged | unverifiable | inconclusive | invalid
                                   // + steps[], signature, differences[], playable (verified AND claim.passed), summary
resimulate(world, opts)            // the one place a claim is computed (sealing and checking share it)
signProof / verifySignature / generateSigningKey / generateNonExtractableKey / keyId   // Ed25519, Web Crypto
worldHash(world) / hashJson / canonicalJson / sha256 / digest / hashQuantized          // dependency-free SHA-256
splitBundle(json) / stringifyBundle(proof, world?)   // proof.json (`worldDoc` member), game.json (`proof`), share payload
BADGES / badgeFor(status, playable) / PROOF_DISCLAIMER    // "@aether/verifier/format": the shared wording, no engine
createVerifyLogic / HeadlessLogicHost                    // moved here from apps/studio (re-exported there)
```
`aether-verify <proof.json|game.json|build-dir> [--world f] [--trust key] [--no-replay] [--json]`,
`aether-verify seal <world|game.json> [--out] [--key] [--seconds]`, `aether-verify keygen <file>`;
exit 0 verified, 1 not verified, 2 usage. Any change that can alter a replay's
outcome bumps `REPLAY_ENGINE` (pinned by `packages/verifier/test/golden.json`).

### `@aether/procgen`
- `parseCollider` is exported (the verifier validates embedded colliders with it).

### Studio
- `game.json` gains an optional `proof` member (untrusted until re-checked);
  `GameManifest.proof?: unknown`. Builds add `proof.json`, `<meta name="aether:proof">`
  and a "Replay-sealed" caption on `cover.png` / `screenshot.png` (`ImageKit.crop(image, w, h, stamp?)`).
- Share payload gains an optional `proof` (≤ 16 KB); `encodeShare(world, meta, proof?)`
  returns `sealed`; `decodeShare` passes it through as untrusted `payload.proof`.
- `PublishState.seal` (`on`, `sign`, `status`, `note`, `hash`, `keyId`),
  `PublishController.setSeal`, `sealCurrent(signal?)` (cached per world version;
  a world with failing checks is not sealed). `publish/seal.ts`: `sealWorld`,
  `browserSigningKey` (non-extractable Ed25519 key in IndexedDB `aether-signing`).
- Player: `ProofBadge` on the title screen (`data-testid` `proof-badge` / `proof-check` /
  `proof-detail`, `data-state` sealed|checking|verified|failed|mismatch|unverifiable|none;
  `window.__aetherProof`). The verifier loads only on click.
- `npm run e2e:proof` (Chromium + Firefox).


## Aether as an MCP server: `aether mcp` (`apps/cli/src/mcp`, additive)

`aether mcp [--project-dir DIR] [--provider auto|offline|local] [--player-dir DIR] [--state-dir DIR]`
serves MCP (protocol 2025 revision, SDK 1.32.1) on stdio; stdout carries only
protocol messages. Full guide, client configs and safety model:
[docs/MCP.md](MCP.md). No change to `@aether/core`, the agent or the server.

- `startMcpServer(opts: SessionOptions, transport, version?) → { server, session, close() }`
  and `createAetherMcpServer(session)` (`mcp/server.ts`) build the server on any
  SDK `Transport` (tests use the in-memory pair; `runStdioServer` the stdio one).
  `SessionOptions = { projectDir, provider: 'auto'|'offline'|'local', stateDir, playerDir?, providerOverride?, log? }`.
- `AetherSession` (`mcp/session.ts`) owns a core `History`, the headless `Engine`
  (Rapier, logic runtime, script and generator sandboxes) and the project
  folder. Operations: `createWorld`, `edit` (a `WorldAgent` run through an
  `AgentHost` over the history, `source: 'agent'`), `applyPatch` (`atomic`
  default), `undo`/`redo` (one step per tool action, via history checkouts),
  `listEntities`, `getEntity`, `verify`, `playtest`, `replay`, `renderStill`,
  `export`. Mutations are serialized.
- Tools (all strict zod inputs): `create_world {prompt}`, `edit {prompt}`,
  `apply_patch {patches[≤200], message?, atomic?}`, `list_entities`,
  `get_entity {id}`, `get_world_summary`, `verify`, `playtest {seconds?≤120, goal?}`,
  `replay`, `render_still {width?, height?, yawDeg?, pitchDeg?, fovDeg?, from?, lookAt?, at?, name?}`,
  `export {format: 'gltf'|'build'|'plan'|'project', name?}`, `undo`, `redo`.
  Failures: `isError: true`, text `"<code>: <message>"`, `structuredContent.error = { code, message }`
  with `code` one of `invalid_input | invalid_patch | not_found | too_large | timeout | cancelled | busy | unavailable | path_denied | nothing_to_undo | internal`.
- Resources: `aether://world/current`, `aether://world/summary`, `aether://schema/world`,
  `aether://schema/patch`, `aether://entity/{id}`, `aether://guide`.
- Project folder layout (the only paths ever touched): `.aether/world.json`
  (the studio's `aether-world` envelope; loaded on start, validated),
  `exports/<name>.glb | <name>-web.zip | <name>-<building>-level-<n>.svg | <name>.aether.json`,
  `renders/<name>.png`, `replays/replay.json`. `ProjectDir` (`mcp/fsguard.ts`) is
  the single gate: names through `safeFileName`, real-path containment, no
  symbolic links, atomic 0600 writes, size caps (`MCP_LIMITS`, `mcp/limits.ts`).
- Provider (`mcp/provider.ts`): `offline` = the mock planner; `local` = `createLocalProvider`
  against the running local server over `loopbackFetch` (only
  `http://127.0.0.1:<port>/api/local/*`, the admin secret header, redirects refused).
- Stills (`mcp/scene.ts`, `mcp/raster.ts`, `mcp/png.ts`): `buildScene(world, opts) → Scene`
  (world-space meshes from procgen; model/asset/mesh shapes are listed in `skipped`),
  `renderStill(scene, environment, opts) → Still` (deterministic software renderer),
  `encodePng`. glTF: `sceneToGlb(scene, name)` (`mcp/gltf.ts`).
- Playtest (`mcp/playtest.ts`): `findObjectives(world, goal?)`, `playtest(world, opts) → PlaytestResult`
  (`outcome: 'win'|'lose'|'incomplete'`, `reason?`, `objectives[{id, kind, reached, collected}]`, `state`, `messages`, `path`).
- CLI: new command `mcp` and options `--project-dir`, `--player-dir`, `--provider`
  (`CliOptions.projectDir | playerDir | provider`); `AETHER_PROJECT_DIR` sets the default folder.
