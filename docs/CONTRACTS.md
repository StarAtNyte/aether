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
export interface Diagnostic { severity: 'error' | 'warning' | 'info'; code: 'overlap' | 'floating' | 'outOfBounds' | 'jointInvalid' | 'tooManyBodies' | 'fellOut' | 'unstable' | 'noCharacter'; entities: EntityId[]; message: string; suggestion?: string; }
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
  matches it. `environment.fog.visibility` (metres, additive, optional) is
  aerial perspective by distance: density `1 / visibility` (63 % haze at that
  range) is honoured whatever the content-size policy does, so a valley with a
  mountain 400 m away turns the mountain blue-grey while the foreground stays
  clear.
- *Stand-in lint* (`findStandIns` in `@aether/core`): people, animals and
  vehicles shown as a bare capsule / box primitive (collider proxies), as the
  library's block mini-figures (`VOXEL_PERSON_ASSET_IDS`) or cube pets
  (`CUBE_PET_ASSET_IDS`) are reported with a reason; entities with a
  `character`, modelled creatures and vehicles, parts of a being and block
  worlds (`world.voxel`) are exempt. The quality review turns findings into a
  major `coherence` issue; the bundled worlds and the planner archetypes are
  held to zero findings by tests.
- *Vehicle rig* (`VehicleRig`, `isVehicleModel`): a library model with nodes
  `chassis`, `wheel_{fl,fr,rl,rr}` (hub height = wheel radius), `steer_{fl,fr}`
  and optionally `steer_wheel` rolls, steers and sways purely from how its
  entity moved (wheels by distance over radius, steering from heading rate,
  body pitch and roll on a damped spring). A material named `paint` is tinted
  by the entity's `material.color` (one clone per entity).
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
//   errors: { error: { code: BridgeErrorCode, message } }  (unauthorized, forbidden_origin, busy, not_logged_in, cli_missing, timeout, rate_limited, tool_violation, model_unavailable, context_too_large, network_error, …; a code from a newer bridge reads as backend_error)
export function createBridgeProvider(opts: { baseUrl: string; token: string; backend; model?; effort?; fetch? }): Provider;
export function fetchBridgeStatus(baseUrl, token, fetch?): Promise<BridgeStatus>;
export function pairBridge(baseUrl, code, fetch?): Promise<string>;   // → token
export function normalizeBridgeUrl(raw: string): string | null;        // loopback origins only

// Fallback: any primary failure (offline, not signed in, rate limited, timeout…) → offline planner, reported once.
// The studio wraps a run in `createProviderChain(links, offline, onSwitch)` (apps/studio/src/ai/chain.ts) instead: chosen assistant →
// the user's other signed-in assistant (AiConnection.alternates) → offline planner; shared-door failures (bridge_offline, unauthorized,
// forbidden_origin…) skip straight to offline; every switch carries the FallbackNotice of the link that failed.
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
ChunkMesher.mesh(volume) → ChunkMesh     // greedy, per-vertex AO + smooth light; passes opaque / cutout / liquid; heights: Uint8Array(512) column tops (256 solid, 256 foliage) for sun shadows (additive; checkMesh requires it)
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
VoxelLayer.setAtlas(pixels, size, faceTiles); setBlockMaterials(sheets | null, tileTable | null); setQuality(tier); setSkyZenith(color); setWaterLevel(y); setCharacters(system | null); setChunk(key, cx, cz, mesh | null) // mesh.heights optional; removeChunk(key); setLighting(daylight, tint)
@aether/voxel: pbrBinding(tileSpec), buildTileTable(tiles, sheetMaterials) → Float32Array(256 × 4 rows × 4) (slot, class, roughness scale, metallic / tint, wet / tint2, slot2 / accent, emissive)
@aether/render: loadBlockSheets(url, anisotropy) → BlockSheets | null; parseSheetIndex; SunShadowField (512² RG8, toroidal); SHADOW_MARCH per tier
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
// (see "Intelligent characters" below for WorldTest.npcs)
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
analyzeRoomPlacements(world, scope='*') → PlacementIssue[] { code: wall_item_on_opening | wall_item_overlap | curtain_off_window, message, hint,
  entities, wall, compass ('north wall'), room?, t, fix: { entity, position? | remove? } }   // wall pieces vs doors / windows / each other
wallViews(world, scope) / describeWallPlacements(world, building) / wallMountIndex(world)     // per wall face: openings {kind,t,width,sill,height}, pieces {id,kind,t,width,y0,y1}
RoomLayout.onWall / onAnyWall / hangCurtain(windowIndex, color)                                // opening-aware placement (wall-space.ts); null when no clear stretch
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
- `Environment` gains `grade?: { temperature?, tint?: -1..1, saturation?: 0.4..1.8, contrast?: 0.6..1.6, exposureEv?: -3..3 }`
  (additive, optional): fields replace those of the sky's colour-grade preset in the renderer (`exposureEv` adds to it). The
  room-from-photo flow sets it from the photograph's measured white balance, saturation and contrast.
- Room description (`@aether/arch/photo`): beds gain `headboardStyle` (slab, panel, tufted, slats), `pattern` (plain, floral,
  stripe, damask), `canopy` and `canopyHeight`; nightstands gain `style` (cabinet, round, wire), `height`, `diameter`; plants
  gain the `palm` species. `applyReality` repairs implausible numbers of a description (and reports them as fixes).
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

## Photoreal renderer (additions to core, arch, render, studio; all additive)

### `@aether/core`

- `LightSpec.type` gains `'area'`: a rectangular panel that shines along the
  entity's local -Y axis. New optional `size: [width, depth]` (metres, 0.01 to
  100 each, default 1 x 1) and `profile?: LightProfile` (`soft`, `downlight`,
  `narrow`, `wash`, `batwing`: the photometric falloff of a `spot`, like an IES
  file). Older worlds parse unchanged.
- `MaterialFinish` gains `bark`, `rock`, `soil`, `snow`, `sand`, `asphalt`
  (photographed CC0 sets; `grass`, `gravel` and `leather` already existed and now
  carry photographed maps too). `@aether/arch` `FINISHES` has matching entries.

### `@aether/render`

```
RenderTier = 'low' | 'medium' | 'high' | 'ultra'
PostEffects = { composite, ao, gi, taa, ssr, shafts, halation, aberration, grain, dof }   // booleans
EffectOverrides = Partial<Record<keyof PostEffects, boolean>>
RenderQuality = 'realtime' | 'studio' | 'final'      // `final` adds depth of field and the heaviest still plan
GradePresetId = 'archviz-daylight' | 'golden-hour' | 'dusk-interior' | 'overcast' | 'night' | 'neutral'

WorldRenderer.setRenderTier(tier | 'auto') → tier in effect; .renderTier; .autoRenderTier
WorldRenderer.setEffects(overrides)          // replaces the whole override set; {} follows the tier again
WorldRenderer.activeEffects / .intendedEffects / .failedEffectNames   // what runs / is asked for / failed on this device
WorldRenderer.setGradePreset(id | null) / .gradePreset                // null follows the sky
WorldRenderer.setRenderQuality('realtime' | 'studio' | 'final')
WorldRenderer.planStill(w, h, 'studio' | 'final') → StillPlan { supersample: 1|2, tileSize, single, frames }
WorldRenderer.preparePost(timeoutMs?)        // waits for the post pipeline to exist (stills call it themselves)
WorldRenderer.renderStill({ width, height, pose, frames?, tileSize?, supersample?, signal?, onProgress? })
  // up to 8192 px on the long side; supersampled stills are filtered down in linear light;
  // a still that comes out as one flat colour is rendered once more
WorldRenderer.pathTraceStill({ width, height, samples, pose, denoise?, bounces?, fStop?, focusDistance?, signal?, onProgress? })
  // lazy module (view/pathtrace.ts) on a private WebGL2 context; rejects on cancel (AbortError), when a render
  // is running, or when the scene exceeds MAX_PATH_TRACE_TRIANGLES (2 000 000); samples 1..4096, size <= 4096
WorldRenderer.pathTracing                     // true while a path-traced still runs (the viewport pauses)
qualityPlan(quality, budget, software, tier) → { tier, effects, shadowMapCap, shadowRadius, accumulateFrames, adaptiveResolution }
```

Tiers: `low` draws directly (a bloom-only composite stays for worlds with bloom), `medium`
adds the composite and grain, `high` adds ambient occlusion and temporal AA, `ultra` adds
reflections, sun shafts, halation and chromatic aberration. `auto` is chosen from the GPU
class and memory budget; an effect that fails to build on a device is dropped (and listed in
`failedEffectNames`) instead of failing the viewport. The high and ultra tiers, and stills,
light and reflect with a photographed sky chosen from the sky preset when the world names no
HDRI.

Pure modules, unit-tested: `gpu/finishing.ts` (tiers, effect sets, degradation order, grade
presets), `gpu/render-quality.ts`, `environment/clouds.ts`, `materials/anti-tile.ts`,
`geometry/soften.ts`, `view/still.ts`, `view/pathtrace.ts` helpers.

### `apps/studio`

- Settings, Graphics: render tier (`auto`, `low`, `medium`, `high`, `ultra`) and one
  switch per effect; stored in `lib/storage.ts` as `renderTier` and `effects`
  (validated with zod on load; unknown names are dropped).
- Publish, Render still: `quality` gains Final render (`final`) and a Path traced (beta)
  option with a samples selector (64, 256, 1024); defaults `pathTraced: false`,
  `samples: 256`.

## Replay proofs: `@aether/verifier` (+ additions to studio, procgen; format in `docs/PROOFS.md`)

### `@aether/verifier` (new; deps: core, logic, physics, playtest (evidence schema only), procgen, zod; bin `aether-verify`)
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


## Intelligent characters: `entity.npc` (+ additions to core, logic, physics, agent, studio)

A character is an ordinary entity plus one optional field. Everything is plain
JSON, validated by zod with size caps, produced by the agent from language and
edited with minimal `update` patches (objects merge, arrays replace).

### World IR (additive, backward compatible)

```ts
Entity.npc?: NpcSpec          // absent for everything else; worlds without it are unchanged
NpcSpec = {
  role ('' ≤ 40; how the user names it: "guard"), faction (slug, 'neutral'), archetype: NpcArchetype ('villager'),
  enemies, allies: slug[] ≤ 8      // factions, or "player"
  fears: string[] ≤ 8 (tags, e.g. "fire"), fearRange (7 m)
  speed (1.5 m/s), runSpeed (4.2), turnRate (420°/s), radius (0.4), height (1.8), health (100)
  perception: { sight 14, fov 110°, hearing 7, memory 6 s, alert 0 }      // alert = radius in which allies learn of a foe
  attack?: { range 1.7, damage 12, cooldown 1.1 }, fleeAt? (0..1), leash (40 m)
  waypoints: Vec3[] ≤ 32, patrol: { mode: loop|pingpong|random, wait 1.5 }, wander (0 m)
  activeHours?: [from, to] (hours; rests outside, may wrap midnight), follow (false), carries: slug[] ≤ 8
  talkRange (2.8 m), dialogue?: Dialogue, chat?: NpcChat, barks?: { spot, lose, flee, hurt, alert, idle: string[] ≤ 6 }
  transitions: NpcTransition[] ≤ 24                                         // extra graph edges, win ties
}
NpcArchetype = villager | guard | merchant | predator | prey | follower | sentinel
NpcMode      = idle | patrol | investigate | chase | flee | attack | trade | talk | follow
NpcTransition = { from: NpcMode | '*' ('*'), to: NpcMode, when: NpcCond, priority -100..100 (50), say? ≤ 120 }
NpcCond = seesFoe | hearsFoe | remembersFoe | fearNear | arrived | talkRequested | following | always
        | { foeWithin | foeBeyond | playerWithin | playerBeyond, r } | { healthBelow, frac } | { timer, t }
        | { time, from, to } | { flag, key, op, value } | { farFromHome, r } | { not, c } | { all | any, cs ≤ 8 }
Dialogue = { start ('start'), nodes: Record<slug, DialogueNode> ≤ 48 }       // links are validated (no dangling next / start)
DialogueNode = { text ≤ 320, speaker?, variants ≤ 6 [{ if: Cond[], text }], choices ≤ 6, effects ≤ 8, next: slug | null, mode: talk | trade }
DialogueChoice = { text ≤ 140, if: Cond[] ≤ 6 (shown only while true), effects ≤ 8, next: slug | null, once }
DialogueEffect = give | take {item, count} | set {key, value} | add {key, amount} | openDoor {target} | emit {event}
               | message {text} | provoke | calm | follow {on} | win {text}
NpcChat = { persona ≤ 500, facts ≤ 8 × 160, maxTurns 1..50 (12) }            // free conversation through a connected model
WorldTest += { kind: 'npcs', target: Selector ('*'), seconds (20), stuckAfter (6) }
```

Conventions: items and currencies are numeric world-state counters named after
the item (`give` adds, `take` subtracts down to 0); `openDoor` sets the world
flag `<target>-unlocked`, which a door with `trigger: "state"` and that
`stateKey` opens; the player's health is the world state `health` (an NPC hit
creates it at 100 when absent; 0 ends the game); each NPC's own health is its
entity state `health` (rules can `add guard.health -10`; at 0 it dies, emits
`npc-died` and `<id>-died`). Archetypes that hunt (guard, predator, sentinel)
are hostile to `"player"` unless `allies` lists it; timid kinds (prey, villager,
merchant, follower) treat anything that hunts their faction as a threat.

### `@aether/logic` (`src/npc/`)

```ts
LogicRuntime.npcs: NpcSystem        // always present, inert without NPCs
NpcSystem.dialogue: DialogueView | null          // { npc, speaker, text, choices, mode, node, version, chat, free }
NpcSystem.prompt: TalkPrompt | null              // nearest character in reach: { npc, name, distance }
NpcSystem.bubbleCount / bubbleAt(i) / activeBubbles()   // barks above characters (world position included)
NpcSystem.startDialogue(id) / choose(i) / advance() / endDialogue()      // pointer and touch route; keys: E talk / continue, 1–6 choose
NpcSystem.damage(id, n) / info(id) / infos() / count / chatContext() / freeReply(text) / reset() / invalidate()
analyzeNpcs(world, { target?, bounds? }) → { errors, warnings, npcs }    // static checks used by the `npcs` test
NavGrid.build(obstacles, opts) / findPath / lineClear / lineOfSight      // A* over the walkable floor, preallocated, bounded
buildNavFor(world, { refY, radius, height, points }, bounds?), collectObstacles(...)
LogicHost (optional, additive): getBounds(id), getColliderBounds(id), groundHeight(x, z, fromY, exclude?)
```

- **Determinism.** Same world + seed + inputs ⇒ identical positions, modes and
  log (each brain has its own seeded stream; perception is staggered by index,
  not by wall time). Nothing in `@aether/logic` touches a network or a clock.
- **Per-tick published state** on each NPC entity: `npcState`, `npcAnim`
  (idle walk run attack talk hurt dead), `npcSpeed`, `npcStuck` (seconds
  without progress while trying to move), `npcLegs` (waypoints reached),
  `health`, `talking`. The renderer's asset animator already picks idle / walk /
  run from the entity's speed.
- **Perception.** Sight = range × cone (`fov`) × line of sight over the grid's
  sight mask (tall solids block; a crate under 1 m does not), reduced to 70 % in
  the dark unless the NPC carries a light (predators are unaffected). Hearing =
  `hearing` × the player's noise (full pace loud, sneak quiet, standing silent;
  relative to `player.moveSpeed`; a jump is audible). Foes seen are remembered
  for `memory` seconds at their last known position; allies within `alert` are
  told. Fear: any entity tagged with a `fears` tag within `fearRange` (a flame
  child of a torch carrier burns where its carrier stands).
- **Navigation.** One grid per (floor level, body radius, body height), cell
  0.5 m (larger for huge areas, ≤ 320 cells per axis), built lazily from the
  document: primitives exactly, generated shapes from per-collider bounds when the
  host provides them (trunk and canopy are different heights), open ground as
  floor. A* is 8-connected with corner-cutting rules, a 9000-expansion budget and
  string-pulled output; steering adds separation from neighbours and a stuck
  detector (re-plan, then nudge back onto walkable floor, then skip the goal).
- **Allocation.** No arrays, strings, closures or objects are created per tick
  in steady state (typed-array paths, pooled buckets); what remains is boxed
  numbers passed between non-inlined calls. Measured on the test machine: 50
  NPCs 0.05 ms per tick, 100 → 0.11 ms, 400 → 1.0 ms (`npc-perf.test.ts` asserts
  the budget and an allocation probe).

### `@aether/physics`

- `verify`: the `npcs` test. Decided at t = 0 from `analyzeNpcs` (standing on
  walkable floor, every waypoint reachable from the spawn, dialogue links, items
  and flags the dialogue reads exist somewhere) and then over `seconds` of
  simulation: nobody falls through the floor, nobody is stuck for `stuckAfter`
  seconds, and every patrolling NPC reaches a waypoint. Without a logic hook only
  the static part runs.
- `entityWorldBounds(world, id, margin?)`, `entityColliderBounds(world, id)`
  (also at `@aether/physics/bounds`, which does not pull Rapier). `@aether/physics`
  now depends on `@aether/logic`.

### `@aether/agent`

- Offline planner (`providers/mock/npc.ts`, `npc-kinds.ts`): guards, bandits,
  shopkeepers, villagers, wolves/predators, prey, companions, dogs, monsters and
  sentinels from sentences ("a guard who patrols the gate and chases me when he
  sees me", "a shopkeeper who greets me and sells a key", "a wolf pack that hunts
  at night"). It builds the characters (primitive bodies, or library models when
  the catalog is loaded), a gate / stall / campfire / coins when the sentence
  needs them, the `health` / `coins` / item counters with HUD entries, and an
  `npcs` test. Counts, names, patrol places, prices, fears, followers,
  torches and props, night hours and free conversation are read from the text.
  Scene prompts that name characters ("a bandit camp with two bandits") place them
  with the scene's own builder.
- Edits by role, name, id, faction or archetype, with pronouns carrying the
  subject inside one request: "make the guard faster" →
  `{ op: 'update', id, set: { npc: { speed, runSpeed } } }`; "give him a torch" adds
  a flame child with a light and `carries`; "make the wolves afraid of fire" sets
  `fears` (and lights a campfire when none exists); also slower / stronger /
  tougher, sees farther / hears better, friendly / hostile, patrol / stand still
  / wander / follow me, night only, sells X for N, renames, lines, free
  conversation on and off. Ambiguous requests ask which character; locked
  characters are left alone. `resolveTargets` (generic edits, removal) also
  matches NPC role and faction.
- The world summary lists each NPC on its entity line:
  `npc "guard" arch=guard fac=watch spd=1.5 run=4.2 hp=100 sight=14 fov=110 hear=7 dmg=10 wp=2 dlg=3 foes=player fears=fire carries=torch chat`.
- The LLM system prompt has a "Characters" section (schema, archetypes, graph
  conditions, dialogue effects, minimal edits, the `npcs` test) and a verified
  worked example.

### `apps/studio`

- Play mode shows bubbles above characters, a "Talk to …" hint and a dialogue card
  with numbered choices (keys 1–6, E, buttons for pointer and touch). The overlay
  (`NpcSpeechView`) is shared by the studio and the standalone player.
  `Simulation` samples the NPC system into an `NpcFrame` on change and about
  12 times a second; bubbles are projected with the camera matrices (no three.js
  allocation). Holding Shift sneaks (half pace, quiet).
- Free conversation (`NpcChatController`): available only when the user's model
  connection resolves to something other than the offline planner and is ready.
  It uses `AiConnection.createProvider`, so the existing metered per-session call
  cap of bring-your-own keys applies; on top: ≤ 40 free replies per play session,
  `chat.maxTurns` per character, one request at a time, a 25 s timeout, 200
  output tokens, no tools. The player's line is quoted as data
  (`<player>…</player>`), replies are reduced to plain capped text, and any
  failure leaves the authored dialogue running. Off offline: the input explains
  that a connected model is needed.
- Flagship world **The Hollow Gate** (`hollow-gate`): a walled hamlet with a
  locked gate, a torch-carrying guard, a shopkeeper selling the key, a night wolf
  pack that fears fire and two villagers; playtested by a bot
  (`apps/studio/test/hollowGate.test.ts`) and verified (`npcs` test).


## Verified playable: `@aether/playtest` (+ additions to physics, logic, arch, render, agent, studio)

The autonomous playtest agent: it derives what a player has to do in a World
IR, plays the game (or walks the building) headless on the real character
controller and logic runtime, and reports whether it can be won and what is
broken. A new workspace package; no new third-party dependency.

### `@aether/playtest` (headless: no three.js, no DOM)

- `playtest(world, opts?) → PlaytestReport` — plays a game. Never throws except
  `AbortError` (`opts.signal`). Options: `maxSimSeconds` (default 240, max 900),
  `budgetMs` (default 20 000, max 120 000), `trace` (replay recording, default
  true), `traceHz`, `onProgress`, `scripts`.
- `walkthrough(world, opts?) → PlaytestReport` — walks a building: every room
  of every `arch` building must be reached through its doors and stairs.
- `selfRepair(world, opts?) → SelfRepairResult` — play → propose the smallest
  patch → apply → play again, at most `maxRounds` (default 4, max 8). `opts.run`
  and `opts.apply` let a host run the bot in a worker and commit repairs through
  its history. `proposeRepairs(world, report)` is the pure part.
- `deriveGoals(world)` / `deriveWalkGoals(world)` — objectives (pickups that
  count, goals, winning zones, rooms), doors with their openers, hazards,
  movers. A pickup is *required* when its state key is (transitively) read by a
  winning rule or a door.
- `NavGraph` — navigation graph sampled from the physics world (grid of
  downward rays, capsule fit test, walk / jump / drop edges, jumps validated by
  simulating the real controller, Dijkstra on typed arrays).
- `toProof(report)`, `parseProof(raw)`, `proofTrace(proof)`, `hashWorld(world)`,
  `proofFreshness`, `proofIsGreen`, `playtestKindOf(world)` — the bot's own
  compact proof (subpath `@aether/playtest/proof`, dependency-light).
- `toEvidence(proof)`, `EvidenceWire`, `evidenceTrace`, `evidenceSentence`,
  `thinTrace`, `EVIDENCE_LIMITS` — the winning run in the form that is sealed
  *inside* an `@aether/verifier` proof (see below). Only `passed` runs become
  evidence; the trace is thinned to ≤ 400 frames and ≤ 20 events.
- `talk` objectives (`ObjectiveKind`), the `talk_failed` finding and
  `planDialogue(tree, wantedKeys)`: characters whose dialogue writes a state
  key the game needs are talked to (E, then the numbered options).
- `parseReport`, `ReportWire`, `ProgressWire` — validation of a report that
  crossed a boundary (subpath `@aether/playtest/wire`).

`PlaytestReport` (`v: 1`): `kind` (`game` | `walkthrough`), `status`
(`passed` | `failed` | `inconclusive` | `unsupported`), `won`, `outcome`,
`seconds` (simulated), `steps`, `wallMs`, `objectives[]` (`done` | `unreachable` |
`blocked` | `untouched` | `pending`, with `reason`), `findings[]` (`code`,
`severity`, a plain-sentence `message`, `entities`, `position`, `hint`, `data`),
`falls`, `stuckPoints`, `path`, optional `trace` (`Float32Array` of x, y, z, yaw
per frame + events), `summary` (one sentence), `worldHash`, `stats`. A report is
`passed` only when the game's win (or every room) was actually reached in the
run and no error-severity finding exists. Finding codes: `unreachable_objective`,
`door_locked`, `door_stuck`, `door_blocked`, `unwinnable`, `lost`,
`spawn_blocked`, `stuck`, `soft_lock`, `fell`, `no_win_condition`, `budget`,
`unsupported`, `room_unreachable`, `clipping`, `no_entrance`.

What the bot does not drive (reported `unsupported`, never green): block worlds,
orbit-camera worlds, vehicles and avatar-entity players. Lifts and other
moving platforms are planned on their starting pose only; a gap they may bridge
is reported as a caution ("could not check"), never a verdict.

**Proof wire format** (`Proof`, zod `ProofWire`): `v: 1`, `bot` (bot version),
`kind`, `status`, `worldHash` (16 hex digits over the gameplay content: entities'
pose, shape, physics and behaviours, rules, state, player, gravity, ground,
generators, scripts — not colours, names or lighting), `seconds`, `steps`,
`summary`, `objectives[]`, `issues[]`, `falls`, optional `trace` (box-quantised
16-bit frames in base64, ≤ 6001 frames, ≤ 400 events), `ms`. A viewer recomputes
`hashWorld`; a mismatch means the proof is *stale* and is never shown green.

### `@aether/physics` (additive)

`entityBounds(world, id, provider?)` (world-space AABB of an entity's collision
geometry), `yieldToHost()` exported, `PhysicsWorld.capsuleFree(feet, radius,
height, lift?)` (an upright capsule overlaps no solid collider).

### `@aether/logic`, `@aether/arch` (additive)

`zoneShapeOf`, `insideZone`, `ZoneShape` exported from logic (the touch
volumes the runtime itself uses); `placedPolygon` exported from arch.

### `@aether/render` (additive)

`GhostRun`, `ghostPoseAt`, `validGhostTrace`, `GhostTrace`;
`WorldRenderer.startGhost / stopGhost / seekGhost / playGhost / pauseGhost /
setGhostSpeed / ghostState / ghostPosition` — a translucent player figure that
walks a recorded path over the rendered world with the route drawn and a
marker per event. Decorations are excluded from captures and exports like the
proof replay.

### `@aether/agent` (offline planner)

New activity theme `vault` ("a locked vault with a key and a door"): a walled
room with a state-locked door (`keys`), a golden key and a treasure goal.

### Studio

- `engine/playtest/` — `protocol.ts` (zod request / reply), `handler.ts` (pure,
  testable), `playtest.worker.ts`, `client.ts` (one module worker, timeout,
  cancel, progress, main-thread fallback), `controller.ts`
  (`PlaytestController`: `run({repair, auto})`, `cancel`, replay control, `proof()`).
- Store: `playtest: PlaytestState` and `replay: ReplayState | null`;
  `ProofSeal` gained `kind`, `title`, `detail`.
- `Studio.playtest`, `Studio.playtestProof()`; the app runs the bot (quiet when
  there is nothing to play) after every agent turn that changed the world.
- UI: `PlaytestPill` (the badge), `ReplayBar` (play, pause, scrub, speed),
  `VerifiedSection` at the top of the Checks tab, the seal over the viewport.
  `lib/playtestView.ts` decides when the badge may be green: only for a
  `passed` run that was `proven` for the history entry on screen.
- Share links and published builds carry **one** proof: the `@aether/verifier`
  replay seal (`SharePayload.proof?`, `game.json` key `proof`, `proof.json`),
  which contains the bot's run as its optional `playtest` member (see
  "Replay proofs" above: `aether-proof` v1, `playtest` is an additive,
  hashed and signed field). `PublishHost.playtestProof()` hands the bot's passed
  run for exactly the world on screen to `sealCurrent`; a failed, stale or
  missing run is simply not sealed in. The player title screen shows one badge
  (`player/ProofBadge.tsx`): *Sealed playable* until a viewer checks it, with a
  sentence about the bot's win and "Watch the bot's run" (ghost replay); "Check
  it yourself" re-simulates the world and has the bot play again on the viewer's
  device (`recheckProof` wires `checkProof({ playtest })` to the playtest worker).
- `@aether/verifier` additions for this: `ProofBody.playtest?` (the evidence),
  `createProof({ playtest })`, `CheckOptions.playtest` (a re-player; without it
  the evidence is checked for freshness only), `CheckStep` name `bot`,
  `ProofCheck.playtest` / `botReproduced`, `replaySettingsFor(world)` (the seal
  horizon grows to the longest test, so a 16 s NPC test is decided), subpath
  `@aether/verifier/bot` (`botEvidenceFor`, `rerunBot`, Node-side glue), and
  `aether-verify seal` (runs the bot, `--no-bot` skips) / `aether-verify`
  (re-plays the bot, `--no-bot` skips).
- Commit label of a repair: `Playtest fix: <sentence>`, source `agent`; every repair
  is one undo step.
## Fine edits: small, precise changes by prompt (+ additions to core, arch, agent, studio)

After a world exists, every message in the same chat REFINES it. A small
request ("make the sofa dark green velvet", "move the lamp a bit left",
"collect 15 coins to win") becomes the smallest possible patch on exactly the
named things: nothing else is regenerated or moved. Big requests ("make it a
winter scene") are scene-wide patches on the current world, never a rebuild.
A new world is built only when the user clearly asks for one ("start over",
"a new world") or the host says so (`intent: 'new'`: templates, example
chips, the first prompt on the untouched default glade).

### World IR (additive, backward compatible)

- `ArchMeta.overrides?: Record<string, Json>` — property edits made to a
  generated piece (dotted entity paths: `"shape.params.color"`,
  `"transform.position"`), at most 64. `applyArchOps` re-applies them when a
  building is re-compiled (invalid results keep the compiled piece; `id`,
  `parent`, `arch` and prototype keys are never applied).
- `ArchMeta.removed?: EntityId[]` (building entity, at most 400) — compiled
  pieces the user removed; they stay removed after a re-compile.

### `@aether/agent`

- `RunOptions` gains `selection?: EntityId[]` ("make this red"), `memory?:
  RefineMemory`, `heading?: number` (viewer heading in degrees; 0 looks
  toward −Z, 90 toward +X: "left" and "back" are the viewer's) and
  `intent?: 'auto' | 'new' | 'refine'`. Selection, memory and heading come
  from the host and are sanitised (`sanitizeSelection`, `sanitizeMemory`).
- `AgentOptions` gains `fineEdit?: boolean` (default true: local edits +
  the over-edit guard) and `localEdits?: boolean` (default = `fineEdit`).
- `AgentEvent` gains `edit` (`{ summary, diff: DiffLine[], targets, cosmetic,
  notes, ms, local }`), `clarify` (`{ text, candidates: {id, label}[] }`),
  `history` (`{ action: 'undo' | 'redo' }`, the host steps its history) and
  `memory` (`{ memory }`, hand it back on the next run). A local edit emits
  `patches`, `edit`, `memory`, `message` (and `verify` for geometric edits).
- `planFineEdit(input): FineEditResult` (`packages/agent/src/refine/`, loaded
  lazily by the agent; tests import it from source): `{ kind: 'edit' | 'question' | 'undo' | 'redo' | 'none',
  reason?, detail?, patches, world, summary, changes, diff, targets, scope,
  added, cosmetic, notes, question?, memory, ms }`. Pipeline: `parseEdit`
  (clauses → `Command`s) → `resolveRef` (name, type, room, ordinal, relation,
  selection, conversation) → an op edits a copy-on-write `Draft` → the patch
  list is `patchesBetween(before, draft)`, validated atomically and checked
  against the named scope. Anything not fully understood is `none` and goes
  to the model; a final capability answer ("the sofa legs only come in oak,
  walnut…", "already walnut") is `none` with `reason: 'refused'` and the text
  is the reply (no model call).
- Resolution rules: locked objects never resolve; a group tag ("the train")
  or a field family ("the pine forest") is one thing; a singular reference
  with several equally likely matches is a `question` with the candidates;
  walls resolve by geometry (room polygon edges ↔ wall entities, the face
  that looks into the room, `back/front/left/right/north…/feature` relative to
  the heading).
- The model path is guarded: `classifyScope(world, text, ctx)` decides what a
  request may touch (`small` with the named entities, or `broad`);
  `apply_patches` calls that change unrelated existing entities are refused
  with a message the model can act on (`auditPatches`). Large worlds
  (`SLICE_THRESHOLD` = 80 entities) send a focused summary plus the in-scope
  entities in full; every turn carries `<edit_mode>` (refine or new world).
  The offline planner honours the mode: a described scene re-dresses the
  world (atmosphere) or adds in a free spot, it never wipes it.

### Studio

- `Studio.send(prompt, { intent?, resumePlay?, echo? })`; the first prompt on
  the pristine default glade is `new`. The conversation memory lives on the
  `Studio`; `answerClarify(id)` selects the chosen object and re-runs the
  question's prompt; clicking one of the numbered candidates in the viewport
  answers too (`store.clarify`, `Simulation.setCandidates`).
- Chat: the `edit` card (compact diff with colour swatches, "N ms · no model
  call", one-click Undo / Redo), the `clarify` card (numbered chips), a
  refine hint after the first build, selection-aware placeholder and chips.
- `PlayTweak`: a prompt over the running game; the edit is applied and play
  restarts with it.
- `Simulation.cameraHeading()`, `Simulation.setCandidates(ids)`.

### Coverage

Every editable property class is reachable by prompt (proved by
`packages/agent/test/refine-coverage.test.ts`): transform (move, rotate,
scale), parametric size and variants (generator parameters), per-slot
materials (upholstery, legs, wall faces, floors, ground), opacity / glow /
metal, physics feel, lights (intensity, warmth, on/off), sky / time /
weather / fog / gravity / ground / bloom, player speed / jump / camera,
behaviour speeds (spin, bob, patrol, wander, vehicle), NPC names and
dialogue, doors, show / hide, rename, add / duplicate / remove (in buildings
through the plan), scatter density and instance size, game goal / time limit
/ difficulty, block-world structures, blocks and game settings. Sounds are
rule actions (no entity or environment field), so there is nothing to edit
beyond the rules.


## People: `entity.character`, `player.character` (stage `characters`)

Additive and optional. `CharacterSpec` (`packages/core/src/character-schema.ts`):
`body` (cast id slug), `gender`, `age` (`young|adult|old`), `wardrobe`, `top`/`bottom`/`hair`
(`#rrggbb` tints), `scale` (0.85 to 1.15, default 1), `mood`, `hold`, `words` (<= 6 of <= 24 chars).
Visual only: the entity's shape stays the collider, animation is a pure function of published
simulation state, so physics, NPC navigation, the playtest bot and proofs are unchanged
(`hashWorld` is not affected by animation). Variant resolution is deterministic per entity id
(`resolveLook` in `@aether/assets`). The cast and motion sets are listed in `assets/characters.json`.


## The AI is the brain: design tools, review loop, replay (additive, backward compatible)

### `@aether/arch` (scene tools; `packages/arch/src/scene`)

- `readScene(world, building) → Scene`: rooms (outline, walls with compass, length, openings with `t0/t1/centre`,
  sill, top, what they lead to), pieces (kind, mount, footprint, y range, wall `t` span or the walls it stands
  against, asset, `placed`), obstacles. Reads the document, never the plan, so hand edits are measured.
  Wall `t` runs along the wall face from the left end as seen from inside (north: west to east).
- Measuring tools: `queryWall`, `measure`, `listEntities`, `reviewScene` / `reviewBuildings`
  (`Finding {code, severity, message, entities, room?, fix, moveTo?}`; `scoreFindings`, `findingKey`, `findingsText`),
  `checkConformance(scene, design)` (planned pieces missing or off their relations: `plan_missing`,
  `plan_mismatch`), `reviewFindings(world, building)` (both).
- Placement tools (each `(world, buildingRef, …) → EditResult {ok, patches, message, text, ids, warnings} | {ok:false, error}`):
  `placeItem`, `moveItem`, `rotateItem`, `resizeItem`, `removeItem`, `snapToWall`, `anchorToOpening`, `centerOver`.
  A change is applied to a copy, audited, and refused when it overlaps, crosses a wall, covers an opening,
  blocks a doorway or swing, or walls a room in. Parts library: `listParts`, `partInfo`, `describeParts`.
- Design plan: `DesignPlan` (zod), `validateDesign`, `designToBuildingPlan(plan, aliases?)`, `describeShell`.
  `BuildingPlan.design?: DesignRecord` (brief, programme, circulation, `furniture` with `relations`, `openingAliases`),
  `PlanDoor.along?`, `PlanWindow.centres?` (exact positions). A re-compile keeps entities tagged `placed` while
  their room exists.
- Tool dispatcher: `runDesignTool(world, name, input) → {ok, text, patches, message, ids, accepted, refused, world}`
  for `design_plan`, `place_items`, `edit_items`, `query_scene` (`DESIGN_TOOL_NAMES`, `DesignToolInputs`,
  `PlaceItemInput`, `EditItemInput`, `QueryInput`, `DESIGN_LIMITS`: 40 items / 40 edits / 12 queries per call).
- Eyes: `reviewPoses(world, building, {rooms?, maxViews?, aspect?}) → ReviewPose[]` (world-space camera:
  position, target, up, vertical fov, `hideTops`), `markIndex`, `projectMarks(world, building, pose, aspect) →
  ImageMark[]` (normalised centre and half size), `legendText`.

### Tool reference (what the model sends)

| tool | input | result |
| --- | --- | --- |
| `design_plan` | `{plan: DesignPlan}` | the shell described (rooms, walls, openings with built ids), or the refusals |
| `place_items` | `{items: [{kind, room, id?, wall+t \| wall+align \| at \| on+offset, y?, yaw?, faces?, params?, opening?}], building?, message?}` | per item: facts (position, wall span, clearance, nearest pieces) or the refusal with a fix |
| `edit_items` | `{edits: [{op: move \| rotate \| resize \| remove \| snap_to_wall \| anchor_to_opening \| center_over, ref, …}], building?, message?}` | as above |
| `query_scene` | `{queries: [{q: wall \| measure \| list \| parts \| shell \| review, …}], building?}` | facts |

All inputs are zod-validated (finite bounded numbers, slug ids, no unknown keys, ≤ 600 000 serialised
characters); unknown ids, `NaN`/huge values and prototype keys are refused with a message, never thrown.

### `@aether/agent`

- Tools `design_plan`, `place_items`, `edit_items`, `query_scene` join `AGENT_TOOLS` (the compact profile is unchanged).
- `AgentOptions.review?: {maxRounds?, stallRounds?, vision?, maxViews?}`; absent: no review. `maxRounds` unset or
  `Infinity` means no cap (subscription backends). `vision` may be a function asked every round.
- `AgentEvent` gains `{type:'review', round, phase: 'checking'|'found'|'fixing'|'approved'|'stalled'|'limit', text, score?, findings?}`.
- `AgentHost.captureReview?(views: ReviewViewRequest[], {signal?, size?}) → [{name, dataUrl}]` renders the views
  (pose, `hideTops`, `aspect`, numbered `marks`) with the marks drawn; without it the review is checker-only.
- Exports: `StallTracker`, `snapshotForReview`, `reviewTurnText`, `drawMarksRgba`, `createRecordingProvider`,
  `createReplayProvider` (`onExhausted: 'throw' | 'finish'`), `TranscriptSchema` (`{version:1, prompt, source, responses}`).
- Bridge: a Codex failure now carries the stream's own reason (usage limit, sign-in) instead of "exited with code 1".

### Studio / CLI

- `WorldRenderer.capturePoses(poses, {width, height, mime})` (perspective captures from explicit poses),
  `Simulation.capturePoses` (plan views are taken with the building view lowered to a plan, then restored),
  `AgentBridge.captureReview` (waits for the viewport, draws marks with canvas 2D: `ai/marks.ts`).
- `apps/cli/src/mcp/review.ts`: `captureReviewHeadless` (software renderer, marks with `drawMarksRgba`).
- `ChatEventView` gains `review`. Review rounds: no cap on `bridge` / `local` connections, 10 on paid keys.
- Scripts: `npm run eval:design` (replay; `-- --mode=live` records with the logged-in Codex), `npm run e2e:design`.

## Realistic, playable games: level tools, layered terrain, foliage cards, game feel (additive, backward compatible)

### `@aether/core`

- `MaterialSpec.splat?: boolean`: terrain layering. The generator part carries four per-vertex weights (grass, rock,
  dry ground, snow) and the renderer blends the photographed grass, rock, soil and snow surfaces by them, per pixel,
  with the vertex colours as the base tint. Without the flag, or without weights, the part is drawn with its vertex
  colours (CLI renders, glTF and path-traced exports do exactly that).
- `MaterialSpec.foliage?: 'broadleaf' | 'shrub' | 'needles' | 'grass' | 'fern'`: alpha-tested foliage cards. The part is
  a set of quads with authored 0..1 UVs, both faces in the geometry (the material is single-sided), and a soft normal;
  the renderer cuts a leaf cluster, needle spray, blade tuft or frond out of each quad and the vertex colours tint it.

### `@aether/procgen`

- `MeshPart.splat?: Float32Array` (4 per vertex, in [0, 1], summing to 1), present when `material.splat` is true.
  Validated by `validateOutput` (length, finite, range), transferred with the other buffers, counted in cache bytes.
- Generators: `tree-broadleaf`, `tree-birch`, `tree-spruce`, `shrub`, `fern`, `meadow-grass`, `boulder`
  (`generators/flora.ts`; each has `variant`; trees and shrubs `detail` 0.3..2). Trees are 1 to 3 k triangles, grass tufts 12.
  `terrain`, `island` and `mountain` now paint the layer weights and a meadow colour variation.
- `foliagePixels(kind, size) → {size, rgba}`: the deterministic cut-out cards (`FOLIAGE_ALPHA_CUT`).

### `@aether/render`

- `FoliageTextures` (shared per `MaterialCache`: `cache.foliage`), `applySplat` (`materials/terrain-splat.ts`),
  `terrainUvs` (metre top-down UVs; the rock layer is triplanar). `ResolvedMaterial` gains `splat` and `foliage`;
  `ResolveOptions.hasSplat`. `createMaterial(resolved, variant, surfaces?, finishes?, antiTile?, foliage?, layered?)`;
  `MaterialCache.layeredTerrain` is false on software rasterisers and in low-memory mode (terrain keeps its vertex colours).
- `FOLIAGE_GENERATORS` (wind sway) includes the new vegetation generators.
- Block terrain: `VoxelLayer.setLighting(daylight, tint, hour?)` puts the sun in the sky for an hour (warm and low at dusk,
  white and high at noon, dim cool moonlight at night; `TerrainUniforms.sunDirection` / `sunColor`). The block shader
  lights faces by it where the vertex sees the sky, adds a distance-faded texture relief and a per-block brightness
  variation, and draws water with animated ripples, a fresnel sky reflection and a sun glint.

### `@aether/physics`

- `CharacterOptions.feel?: CharacterFeel` and `CHARACTER_FEEL`: acceleration 48 and deceleration 60 m/s², air control
  0.55, coyote time 0.11 s, jump buffer 0.12 s, jump cut 0.55. The studio's player uses it; without `feel` the
  controller takes the input velocity instantly (the playtest bot and the replays use that, unchanged).

### `@aether/playtest`

- New objective kind `press` (also in the proof and report wire schemas): a rule chain "press key K while the
  conditions hold (standing on a plate) and an event it emits wins" is derived from the rules; `GoalObjective.pressKey`.
- Goals a rule switches on (`enableBehavior goal`) count as the way to win (`GoalObjective.gated`).
- Vertical lifts (a kinematic platform on a straight up and down `patrol`) become one-way `Ride` edges
  (`EdgeKind.Ride`, `NavGraph.addRide`, `RideInfo`); the bot waits for the platform, boards, rides and steps off.
- Low gravity: jumps ease off their forward thrust over the last stretch (`airThrust`) and are simulated longer.
- Larger levels: the walking map reaches 330 m from the spawn (was 160); a game plan tries up to 160 searches
  (a walkthrough keeps 14).
- `probeLevel(world) → LevelProbe {ok, problem, objectives(), reachFrom(point), dispose()}`: the walking map for
  reach questions without playing. Subpath `@aether/playtest/level`: `runLevelTool(world, name, input) →
  {ok, text, patches, message, accepted, refused}` for `query_level` and `place_level_items` (`LEVEL_TOOL_NAMES`,
  `QueryLevelInput`, `PlaceLevelInput`, `LEVEL_LIMITS`: 24 points, 40 items, 5000 m coordinates, 4000 rays).
  The walking map is cached for one world's gameplay content for 30 s (`withProbe`, `clearProbeCache`,
  `probeCacheStats`; calls are serialised), so a run of reach questions about one world builds it once.

| tool | input | result |
| --- | --- | --- |
| `query_level` | `{op: summary \| ground \| clearance \| sightline \| reach \| objectives \| review, …}` | facts: top surface height, what it is and the slope; free radius and headroom; what blocks a line; whether the player can walk, jump or ride there and the gap if not; every objective's reach; `review`: the level checked as a designer would (`LevelReview {applicable, findings, poses, score}`: no win, spawn, unreachable required or optional objectives, first reward too far) with the cameras of the review renders |
| `place_level_items` | `{items: [{id, role: pickup \| goal \| checkpoint \| hazard \| enemy \| prop \| decor, x, z, above?, below?, yaw?, key?, reach?, entity?}], message?}` | each item snapped to the ground, refused when nothing is under it, buried, on a cliff, or out of reach (with the gap and the nearest standable spot); accepted items are one undo step; `{id, x, z}` without `entity` moves an existing item |

### `@aether/agent`

- `AgentOptions.levelTools?: LevelToolRunner` (`(world, name, input) → Promise<{ok, text, patches, message}>`):
  when set, `query_level` and `place_level_items` (`LEVEL_TOOLS`) are appended to the tool list after `AGENT_TOOLS`
  and the system prompt gains the level-design section; absent, nothing changes. `ExecutorContext.levelTools`.
- The review loop covers levels: with `levelTools` and no building in the world, each round calls `query_level` op
  `review` (`LevelToolOutput.data`, validated by `LevelReviewData`), renders the overview and the player's first view
  through `AgentHost.captureReview` (no marks), shows the findings with their fixes, and ends on approval or the same
  stall detector; a world with no gameplay (scenery) is not reviewed. `levelSnapshot`, `levelTurnText`.
- The offline planner exchanges stylised nature for the realistic generators when the request says realistic,
  photoreal or lifelike (`providers/mock/realistic.ts`).
- New flagship `highland-trail` (`providers/mock/showcase/highland-trail.ts`); the agent package now depends on
  `@aether/procgen` (it samples the generated heightfield to place the route).

### Studio

- `engine/levelTools.ts` (`lazyLevelTools`: the measuring code loads on first use); the end screen shows the run's
  numbers and "Try again" after a loss; the player's controller uses `CHARACTER_FEEL`.
- Scripts and tests: `tests/e2e/gameplay.e2e.ts` plays Highland Trail, Neon Rain City and Kyoto Temple to their win
  screens in Chromium through the on-screen controls, driven by the verified bot's recorded route;
  `apps/studio/test/gamesVerified.test.ts` plays every shipped game with the verified bot and seals the run;
  `tests/e2e/photoreal.e2e.ts --lab=flora` shoots the vegetation lab.

## Room from a photograph (additive, backward compatible)

A photograph of a room plus a prompt about it rebuilds THAT room: no preset room, no template with decor laid
over it. Everything the model decides goes through the design tools; the photo flow only reads the picture into
a structured description and derives tool calls from it.

### `@aether/arch` (`packages/arch/src/photo`)

- `RoomDescription` (zod) and `parseRoomDescription(raw, partKinds) → {ok, value, fixes} | {ok:false, error}`: footprint
  (interior width, depth, ceiling), `camera` {x, z, height, heading, pitch, horizontal `fov`}, per-wall colour and
  material, floor, `ceiling.cornice`, `openings` (window / door / opening with wall, `along`, width, height, sill,
  `visible`), `items` (a part `kind`, wall-relative `wall` + `along` + `gap`, or `at`, or `on` a host + `offset`,
  curtains with `opening`, wall pieces with `bottom` or `above` + `aboveGap`, part `params`, `visible`, `confidence`),
  `light`, `palette` and `assumptions` ({text, confidence, adjust}). Frame: metres on the INSIDE faces, x east, z
  south; `along` is measured from the LEFT corner of a wall as seen from inside (the scene tools' `t` minus the
  half wall thickness). Free text is clipped, numbers written as strings are accepted, kind synonyms map to parts
  (`picture` → `art`, `television` → `tv-set`), a piece with no matching part is left out and reported in `fixes`.
- `deriveBuild(description) → PhotoBuild {plan: DesignPlan, steps: PlaceStep[], environment, notes, assumedDoor?}`:
  the plan builds only the shell (a rectangle of exactly the described size, openings at their exact positions, an
  assumed door behind the camera when none is visible, said so in `notes`); `steps` are ordered rug and floor
  pieces (large to small), surface pieces, wall pieces, curtains (anchored to a window), ceiling pieces, cornice
  runs per wall. `PHOTO_WALL_INSET` (0.14 m) converts description `along` values to wall `t`.
- `runBuild(world, build, call: ToolCaller) → {world, shellOk, shellText, outcomes, openings}` runs the plan and the
  steps through `design_plan` / `place_items` (`memoryCaller` applies patches in memory); wall pieces hung `above`
  another get their height from the host piece once it is placed; refusals are in `outcomes[].text`.
- `buildChecklist(description) → ChecklistItem[]` (`{id, category, text, structural, target?}`; shell, wall colour,
  floor, cornice, every visible opening, every visible piece, light), `ItemVerdict` (zod), `scoreVerdicts(list,
  verdicts) → {total, passed, rate, failing, structuralFailed}` (unjudged items fail), `scoreLine`.
- `customPose(world, building, spec) → ReviewPose | null` (a camera at a plan position, heading and pitch, in world
  coordinates), `photoCameraSpec(description, aspect)`, `verticalFov(horizontal, aspect)`.
- Parts library additions: `cornice` (wall mount, runs the top of a wall, ignored by wall-space checks), `tv-set`
  (surface mount), `art` parameters `subject` (`abstract` | `round` | `blank`), `matColor`, `ink`; `bed` parameters
  `accents` (0..4) and `accent`; `floor-lamp` style `pole`; `nightstand` and `sideboard` `color`. `place_items` for
  curtains honours `params.width` (gathered width of one panel).

### `@aether/agent` (`packages/agent/src/photo`)

- `AgentOptions.photo?: {vision?, maxRounds?, stallRounds?, maxViews?}`; `RunOptions.photo?: 'auto' | 'recreate' | 'off'`.
  With `photo` options a picture plus a prompt about a room ('auto'), or the composer's "Recreate this image"
  ('recreate'), runs the photo flow instead of the planner. Without a vision model (`vision` false, the offline
  planner, or the chain falling back to it mid-run) NOTHING is built: the event says why, gives the palette and
  brightness read from the picture, and offers to build from words.
- Flow: `describe_room` (one tool, zod-validated, refused descriptions are sent back up to three times) → build →
  compare rounds. A round renders the room from the photo's camera at the photo's aspect (numbered marks) plus a
  clean render to measure; the model answers with `report_verdicts` (a verdict for every checklist id) and fixes
  failures in the same reply with the design tools; edits before verdicts are refused. `compareImages` (colour
  histogram overlap, SSIM on standardised luminance, Sobel edge correlation) gives an objective similarity; a
  round whose quality (0.7 × pass rate + 0.3 × similarity) falls more than 0.03 below the best is rolled back
  (`restorePatches`) before anything else changes. The loop ends when every item passes, the model stops with
  nothing to change, progress stalls (`StallTracker`) or `maxRounds` (default 6) is reached; edits made after the
  last judged render get one judge-only final check and are kept only if not worse.
- `AgentEvent` gains `{type:'photo', phase: 'analysing'|'described'|'building'|'built'|'comparing'|'round'|'done'|
  'offline'|'unavailable', text, round?, assumptions?: [{id, text, confidence, adjust}], score?: {passed, total,
  rate, objective?, structuralFailed, failing}, palette?}`.
- `AgentHost.decodeImage?(dataUrl, maxSide) → {width, height, data} | null` (the studio decodes with a canvas, the
  eval script with ffmpeg); without it the objective score is skipped and the aspect comes from the image header
  (`imageSize`, PNG / JPEG / WebP).
- Exports: `reconstructRoom`, `isRoomPhotoRequest`, `compareImages`, `extractPalette`, `restorePatches`, `imageSize`.

### Studio

- `SendOptions.photo`, the composer's "Recreate this image" button (shown with an attached picture), the
  `ChatEventView` `photo` card: assumptions as chips (one tap sends the `adjust` sentence through the minimal-patch
  edit path), item score, what still differs, palette swatches. `AgentBridge.decodeImage`.
- `scripts/eval-photo.ts` (`npm run eval:photo`): live or replayed runs with software renders; montages and
  scoreboards go to `~/.local/share/aether/imageroom/`.

### Framing and calibration (same stage)

- `RoomDescription` items and openings may carry `box: [x0, y0, x1, y1]` (0..1 of the photo, origin top-left; unusable boxes
  are dropped). `framingTargets(description, builtOpenings)`, `framingOf(geometry, targets, pose, aspect) → {score, rows}`,
  `calibrateCamera(world, description, aspect, targets) → {camera, before, after, improved} | null` (needs 4 targets;
  deterministic), `framingText(report)`; `entityGeometry` / `projectGeometry` in the scene views project every piece and
  opening through any pose. `PlanRoom.wallColors` / `DesignRoom.wallColors` (per compass side) are additive.
- `deriveBuild` fits openings first (`fitOpening`: under the ceiling, inside the wall, 0.3 m clear of corners).
- The agent measures framing and pixel similarity each round; the round quality is 0.5 pass rate + 0.5 measured agreement
  (0.6 framing, 0.4 similarity, whichever exist). `RunOptions.intent === 'refine'` builds the room beside the existing world,
  any other intent replaces it (one undo step).


## Architecture realism and interactive rooms (`archreal`)

All additive: older worlds, plans and ops keep working unchanged.

### World IR

```ts
MaterialFinish += wallpaper wallpaper-stripe wallpaper-floral wallpaper-damask wallpaper-geometric   // tintable papers (tile 0.64 m)
                  panelling (shaker wainscot, tintable)  wood-slats (timber on dark felt)  foliage (overlapping leaves, tintable)
Entity.interact?: InteractSpec = { kind: door | drawer | cabinet | window | appliance | switch | tap | pickup | seat, label? (≤ 40), reach? 0.4..6 = 2.4 }
ArchRole += part                      // a drawer, cabinet door, appliance door, tap or window casement: its own entity, child of its piece
BuiltinBehavior += operable, toggle
```

- `operable` is the `door` mechanics under another name (the playtest bot treats `door` behaviors as obstacles to open,
  furniture parts are not): `trigger` `use` (default) | `state` | `proximity`; `motion` `slide` (`slide: [x,y,z]` world
  offset) | `swing` (`swingAngle`, `hinge` left/right) | `joint`. Writes `<id>.open`.
- `toggle`: on/off by use, writes `<id>.on`; `show: ids[]` are visible only while on (a tap's water), `light: ids[]` follow it.
- `door` gains `trigger: 'use'`, `motion: 'joint'` and `jointOpen` (degrees or metres): the entity is a dynamic body with its
  own revolute / prismatic `joint`; the behavior servos the joint to `jointOpen` / 0 through `LogicHost.driveJoint`.
  A `door` with trigger `key` also opens when it is the aimed `used` entity.
- `LogicHost.driveJoint?(id, target)`, `BehaviorEnv.used: ReadonlySet<EntityId>`, `LogicRuntime.use(id)` (queued like `click`).
- `PhysicsWorld.driveJoint(id, target, stiffness = 60, damping = 12)`: motor servo of a revolute (degrees) or prismatic
  (metres) joint, false for entities without one. `PhysicsWorld.raycastAll(origin, dir, maxDist, limit = 8, excludeId?)`:
  every solid hit nearest first (overlapping colliders all report). `CharacterController.setEnabled(on)`.
- `WorldRenderer.setLookPitch(rad)`, `setEyeHeight(m)`; `InputController.pitchDeg` (mouse look up and down in first person).
- Studio: `Simulation.placePlayer(feet, yawDeg, pitchDeg)`, `sitOn(id)`, `standUp()`, `isSitting`,
  `SimulationListener.onInteract(prompt | null)`, `useUI().interact`.

### `@aether/arch`

```ts
WallDado = { height 0.2..2.4 = 1, material = panelling, rail = true }          // lower covering with a chair rail
WallParams += dadoA?: WallDado, dadoB?: WallDado                                 // splits the face of a wall side at the dado height
PlanRoom  += finish?: MaterialSpec                                               // every interior wall face of the room (wallpaper, panelling, brick, tile…)
             walls?: { north|south|east|west: MaterialSpec }                     // per wall, by the compass side it is on seen from INSIDE the room
             dado?: WallDado
// precedence per wall face: walls[compass] > finish (tinted by wallColor when it has no colour) > the type default (bathroom tile…)
// rooms with finish / walls / dado keep their walls as pieces of their own (no merging with collinear neighbours), so a papered
// back wall never spills onto the next room; the other side of a shared wall belongs to the room on that side.
ArchOp += set_wall { building, room, wall: north|south|east|west|all = all, material?, dado?: WallDado | null, clear = false }
          // refused with `empty_wall_op` (and a hint) when it carries nothing; `set_material walls` with a non-paint finish sets `finish`
DesignRoom += finish, walls, dado       // the AI-first design_plan carries wall coverings into the plan
PlanDoor += physical?: boolean; BuildingPlan += physicalDoors = true
ArchStyle += mediterranean
CeilingParams += downlights: [x,z][] (≤ 24), lit = true     // recessed cans: trim ring + emissive lens (no light source of their own)
downlightGrid(poly, type, style) → P2[]                      // ~1.9 m grid, 0.7 m off the walls, ≤ 12, none for terraces / industrial / tiny rooms
WindowParams += sash = false;  SashParams = { width, height, frame, glass }   // generators arch-window / arch-sash
sashHeight(windowHeight)
```

- Swing doors are physical by default: the leaf is a `dynamic` body (18 kg) on a `revolute` joint to the world (axis up at
  the hinge edge, limits `[min(0, angle), max(0, angle)]`, spring motor to 0), a `door` behavior with `motion: 'joint'`,
  `jointOpen = swingAngle`. The playtest bot's `openDoorPose` treats joint doors like swing doors. `physicalDoors: false`
  (or `physical: false` on a door) keeps the kinematic leaf.
- Casement windows (width 0.6..1.8 m, plain casement style, not frosted) compile with `sash: true` and a child entity
  `<window id>-sash` (`arch-sash`, kinematic, `operable` swing about the left edge, 78° inward, `interact: window`).
- Interactive furniture: `FurnitureDef.build(p, seed, sink?: MovableSink)`, `FurnitureDef.interactive`,
  `emitFront(sink, statics, spec)`, `drawerBox(...)`, `MovableSpec { id, name, kind: drawer | door | tap, center, size, motion: slide | swing | toggle, parts }`,
  `furnitureMovables(def, params, seed)`, `buildFurniturePart(def, params, seed, partId)` (geometry re-centred on the part, one box
  collider around everything it draws, so the inside of an open drawer can be aimed at), `placedParts(...)`.
  Pieces with an `interactive` param (kitchen, island, fridge, wardrobe, sideboard, nightstand) compile with `interactive: true`:
  the carcass has no fronts and every drawer / door / the kitchen tap is a child entity of the piece with generator
  `furn-part` (`params: { of, part, p (the piece params), size }`, validated by `parsePartParams`), a kinematic body,
  an `operable` (`toggle` for taps, with a `<id>-water` stream that shows while on) and an `interact`.
  Door leaves of buildings carry `interact: door`.
- Portable props (`FurnitureDef.portable = { mass }`): `mug`, `book` compile as dynamic bodies with `interact: pickup`; they are
  placed on coffee tables, desks, nightstands and the kitchen island. Seats (`sofa armchair chair office-chair bar-stool`) get `interact: seat`.
- Material slots: `FURNITURE_SLOTS[kind][slot] = { finish?: param, color?: param, aliases }`, `slotNames(kind)`, `findSlot(kind, word)`,
  `slotPatch(kind, slot, { finish?, color? }) → { params, dropped }` (the minimal param override for "dark green velvet upholstery";
  a finish or colour the slot cannot take is reported in `dropped`). Slots: sofa/armchair `upholstery cushions legs`, chair `frame seat`,
  table `top legs`, kitchen `worktop fronts splashback`, bed `frame headboard linen throw`, rug `field border`, plant `pot`, mug `glaze`, tree `foliage`…
- `furn-tree` (`species` olive | cypress | umbrella-pine, `height`, `leaf`): barked trunk and limbs with a crown of noise-displaced foliage
  masses (olive, pine) or a fluted spindle (cypress), `foliage` finish; `foliageMass`, ≤ 60 000 triangles.
- Roof plates stop at courtyards: loops of the outline that lie inside another loop become holes of the roof slab (with a parapet round
  them); wide sliding leaves up to 4 m are valid (`DoorParams.width` ≤ 4).

### Agent

`build_architecture` ops include `set_wall`; `design_plan` rooms accept `finish`, `walls`, `dado`; the style list includes `mediterranean`
(the offline planner understands "courtyard", "mediterranean", "sintra"…). Flagship `casa-patio` ("Casa del Patio: a courtyard house in the
hills above Sintra"): `casaPlan()` in `providers/mock/showcase/casa.ts`.

### Studio

```ts
engine/interaction.ts   PlayInteraction(session, aim, events): frame() (prompt "E · Open drawer"), use(), throwCarried(), drop();
                        usableEntity / describeInteraction / promptFor / holdPoint / carryVelocity / throwVelocity / seatPose (pure)
                        aim = ray from the eye along the camera through every collider (HIT_TOLERANCE 0.14 m: a drawer front inside its
                        cabinet's collider still counts); E acts on the aimed entity and keeps the key from reaching other doors;
                        pick up (dynamic props follow the hold point, click throws), sit (sofa, chair, stool: capsule off, eye 0.72 m above the seat),
                        taps, drawers, cabinets, fridge, windows, doors; touch / gamepad "action" uses the same path
components/viewport/PlayHud.tsx  InteractPromptView (crosshair dot + prompt; the standalone player has the same markup)
lib/reveal.ts           revealPhase(t), sectionHeightFor, inkPlan(floorPlan2d) → strokes with lengths and labels, cameraArc / cameraAt (pure)
engine/arch.ts          ArchController.startReveal(seconds = 7.5) / scrubReveal(t) / cancelReveal() / isRevealing
state/archUi.ts         ArchUiState.reveal: number | null
components/viewport/RevealOverlay.tsx   the plan in ink on paper over the viewport; click, any key or Stop skips
```

The reveal draws the ground-floor plan in ink (walls first, openings, furniture, room names), dissolves the paper into the 3D view while the walls
rise out of it (an animated section cut, 24 steps) and the camera comes down from overhead to where the editor camera was, then restores the
previous view. Frame time is clamped (slow devices play it slower instead of skipping the ink); `prefers-reduced-motion` skips it.

### Scripts

`npm run e2e:interact` (Chromium WebGPU + WebGL2, Firefox: drawer, cabinet door, window, front door on its joint, tap, mug pick-up and throw, sofa),
`npm run e2e:reveal`, `tests/e2e/archshots.e2e.ts` (eye-level stills of any building: `--slug` / `--prompt`, `--cams=<json>`, `--gpu`, `--hide`, `--set`).

## Interior and architecture look (additive, backward compatible)

### `@aether/core`

- `PlayerSpec.yaw?: number` (degrees, -720..720, 0 faces -Z, counter-clockwise from above): the heading a first-person start looks along. Absent: toward the
  building entrance (`entranceYawDeg`), else where the editor camera looked. Old documents are unchanged.

### `@aether/arch`

- `compileBuilding(...).spawn` is now just inside the main entrance (1.4 to 2.2 m, inside the entrance room) and `.spawnYaw` is the heading that shows the most of
  the house (`entranceView`, `sightLine`, exported with `WallRec`; plan frame, rotation applied). Without a main door, or when no inside spot exists, the old
  doorstep spawn applies. `applyArchOps` writes both into `player` for walkthrough buildings.
- The `paint` finish has `bump: 0` (no normal map). Ceramic and glass keep only fine grain.

### `@aether/render`

```
PostEffects.gi: boolean                     // SSGI bounce; off in every tier, opt-in (Settings, "Bounced light")
PostPipeline.setAo({ radius?, scale?, thickness?, resolutionScale?, samples? })   // live AO retune (clamped); STUDIO_AO defaults
EnvironmentRig.setInteriorBounce(on) / .setInteriorFill(level 0..1) / .setEnvScale(scale)  // building worlds only; bounce.ts: interiorBounce(sky)
view/eye-adapt.ts: interiorFactor(x, y, z, ceilings) -> 0..1, adaptStep(current, target, dt), adaptedLook(f) -> { exposure, envScale }
view/framing.ts: frontAzimuthDeg(dx, dz, swing?) -> degrees | null, pickClearAzimuth(candidates, eye, target, obstacles), segmentHitsBox(a, b, min, max)
```

`WorldRenderer.frameContent` frames buildings at 21 degrees elevation from the garden side with a clear sight line (was 38 degrees from +Z). Exposure and image
light follow the camera: under a ceiling the exposure rises 0.45 stop and the image light is scaled to 60 %.

### Scripts

`tests/e2e/archshots.e2e.ts` gained per-camera `hour` and `js` (a snippet run with `renderer`), cameras without a pose (`frameContent` hooks), `--world=<file>` (a world
document served in place of the `apartment` template of the build output) and `--fx` / `--sunshadow` switches for look development.

## People, imports and scatter budgets (`qafix`, additive, backward compatible)

- `@aether/core`: `isBodylessPerson(entity)`, `characterFor(entity)`, `bodilessPeople(world, scope?)`, `characterPatches(world, scope?)`. A bodiless person is a capsule, cylinder or box of a person's size (0.8 to 2.6 m tall, at most 1.4 m wide) with no `character`, no `arch` role and no sensor body, whose id, name, tags or NPC role names a person ("guard", "villager", "shopkeeper"); statues, guard towers, zones and animals are excluded. `characterPatches` returns `update` patches that set `character` (wardrobe, gender and age from the words).
- `@aether/physics` `Diagnostic.code` gains `'noCharacter'` (severity `warning`; never fails a verification). The studio's verify protocol accepts it.
- `@aether/agent`: after `apply_patches`, `build_architecture`, the design tools and the level tools the executor applies `characterPatches` as one more undo step ("Give N people a character") and appends a note to the tool result. The review snapshot adds a `person-without-character` warning finding.
- Studio import: a JSON object with none of the world fields (`name`, `id`, `entities`, `environment`, `player`, `rules`, ...) is refused with "Not an Aether world".
- Renderer: with more than one field-sized scatter layer asking for more than the field budget, each field is capped at `MAX_FIELD_SHARE` (0.45) of `maxInstances`. A single layer is unchanged.
- `BlueprintMarks` expire by wall-clock time as well as by animation time.

## Outdoor look, part A: physical sky, vegetation variety, clustered cover (stage `outdoora`, additive, backward compatible)

### `@aether/core`

- `MaterialSpec.foliage` gains `'blossom'` (round five-petal blossoms on a twig card) and `'flower'` (slim stems topped with open flowers).
  Both cards are neutral: the part's vertex colours tint them (pink crown, or green stems rising to the flower colour).

### `@aether/procgen`

- `FoliageKind` and `foliagePixels(kind, size)` gain `'blossom'` and `'flower'`; the sandbox material sanitiser accepts them.
- `tree-broadleaf` gains `blossom` (0..1): above 0.5 the crown carries blossom cards in rose-shaded tones instead of leaves
  (cherry, plum; `color` is the blossom colour). Default 0, so existing worlds are unchanged.
- New generator `wildflowers` (`size`, `color`, `cards`, `variant` 0 one colour / 1 mixed meadow): crossed flower cards, at most 24 triangles, collider.

### `@aether/render`

- `environment/atmosphere.ts` (pure): `skyRadiance` / `skyDisplay` (single-scattering Rayleigh + Mie + ozone through a spherical atmosphere, per direction,
  `turbidity` scales the aerosols), `sunTransmittance(elevation)`, `skyKeys(elevation)` (zenith and horizon for the gradient consumers).
- `SkyState.physical?: { sunDirection, elevation, weight, turbidity }`: set for the `day`, `dawn`, `sunset` and `night` presets once the sun is above about -9 degrees.
  The dome is painted per direction from it (blended over the keyed gradient by `weight`, which is 0 at night, so night keeps its keyed colours and stars).
  `SkyState.zenith`, `horizon` and the sun colour come from the same model; `fogColor` is the horizon haze (pale at noon, tinted by the sunlight as the sun gets low).
- `SkyDome`: a 96x48 dome; sun sprite and moon disc (`sky-bodies.ts`: `sunSpritePixels`, `moonPixels(phase)`, `sunRaysPixels`); a high `cirrus` cloud layer over the
  cumulus deck; `raysStrength(elevation, preset)` for the sun's crepuscular rays; `setDetail(boolean)` (the low tier turns off the cirrus layer and the rays).
- `CloudLayer(radius, kind)` (`'cumulus'` default, `'cirrus'`); `cloudPixels(size, cover, fbm, sun?)` bakes self-shadowing from the cloud's own density along the
  way to the sun; `cirrusPixels`.
- `buildLodChain` thins foliage card sets (`isCardPart`, `thinCards`, `cardKeepRatio`): far levels keep a share of the cards, grown to keep coverage, instead of a
  QEM collapse of disconnected quads.
- `MACRO_VARIATION` (`materials/terrain-splat.ts`): world-space patch (90 m), mottle (11 m) and hue drift multiplied into the layered terrain colour.

### `@aether/agent` (offline planner)

- `Builder.realisticNature` (on for every flagship except those built with `flagshipBuilder(seed, mood, { stylised: true })`, today Painterly Meadow):
  `gen` and `scatter` exchange the stylised nature generators for the realistic ones (`realisticStandIn`, which now also maps `flowers` to `wildflowers` and
  `hero-cherry-tree` to a blossoming `tree-broadleaf`); `Builder.nature(generator, params)` does the same for hand-built shapes.
- With it, scatters of `meadow-grass`, `grass-tuft`, `shrub`, `bush`, `fern`, `flowers`, `boulder` and `rock` of 12 or more instances are laid out by
  `clusterPoints` (a Thomas cluster process plus 22 % lone plants, deterministic, as hand-placed scatter `points`), so ground cover grows in tussocks and drifts.

## Water, creatures, ambient life and wind (`outdoorb`, additive, backward compatible)

### `@aether/core`

- `MaterialSpec.waterKind?: 'puddle' | 'pond' | 'stream' | 'river' | 'lake' | 'sea'`: the scale of a water surface (preset `water`). It sets wave length and steepness, clarity,
  colour, foam and whether the waves follow a current. Without it the renderer infers the class from the entity's size and its id, name and tags (`inferWaterKind`).
- `MaterialSpec.waterFlow?: [x, z]` (each -12..12 m/s): the current of a river or stream (default: along +X for the classes that flow).
- `Environment.wind?: { speed: 0..30 m/s, direction: degrees (0 toward -Z, counter-clockwise from above, default 0) }`: bends grass and trees, roughens lakes and seas and sets their
  wave heading. Absent: a light breeze (2.5 m/s).
- `findWaterBodies(world)` / `waterAt(bodies, x, z, y)` / `edgeDistance(body, x, z)` / `isWaterEntity(entity)` (`water-bodies.ts`): the horizontal surfaces of water entities (planes, boxes,
  cylinders; round bodies are ellipses), largest first.
- `planLife(request, probe)` / `LIFE_SPECIES` / `isLifeSpecies` / `MAX_LIFE_COUNT` (`life.ts`): measured placement of animal groups (below). `CUBE_PET_ASSET_IDS` no longer lists
  `cat`, `deer`, `fish`, `parrot` (modelled replacements exist); `findStandIns` also flags a ball, cone or box of at most 1.6 m called bird, duck, crow, gull, hawk, parrot, fish, koi,
  trout, butterfly or bee (not a bird house, a fish tank or a statue).

### `@aether/playtest`

- `place_level_items` gains `role: 'life'`: `{id, role:"life", species, count (1-24), radius (1-150 m), x, z, below?, perch?}` places a group of animals the code measures:
  ground animals (deer, doe, cat, sheep, cow, horse, pig, dog, fox) stand on ground under 25 to 40 degrees that is not under water and not inside something solid, as kinematic NPCs
  (prey / predator / follower, wandering); flyers (bird, crow, seagull, hawk, parrot, butterfly) circle in air that is clear, at the species' altitude above the terrain or water
  (hawk 25-65 m, bird 3-12 m, butterfly 0.5-1.7 m) with `orbit` + `bob`, or sit on the solid surface at x,z with `perch`; fish and koi need water at least 0.3 / 0.4 m deep under them
  and a roaming circle that stays over water, swim at 45 % of the depth; ducks float on the surface. Members that do not fit are refused with the measured reason; the others are
  placed (one undo step). Up to 60 animals per call. Result text names each group's measurements ("deer-1: 6 of 6 deer placed (slopes 2.1 to 14.6 deg, none in water)").

### `@aether/render`

- Water shader (`materials/water.ts`, TSL, WebGPU and WebGL2): four summed directional waves from the class and the wind, a scrolling detail normal map, ripple rings, per-channel
  depth absorption from the scene depth, refraction through the wave normal, shoreline and crest foam, caustics on a shallow bed, Fresnel sky reflection and (tier `high`) a planar
  reflection. Tiers (`waterTierFor`): `simple` (software rasterisers, low-memory: waves, ripples, sky), `standard` (adds depth, refraction, foam, caustics), `high` (discrete GPUs: adds the
  planar mirror). `MaterialCache.waterTier` (null keeps the classic translucent water), `MaterialCache.retuneWater()`, `MaterialCache.mirror` (`PlanarReflection`), `MaterialCache.waterMaterials()`.
  `ResolvedMaterial.water: { kind, flow } | null`. Debug: `globalThis.__WATER_TIER = 'simple' | 'standard' | 'high'` before the renderer starts.
- `water-state.ts`: module-level uniforms (`waterClock`, `windSpeed`, `windHeading`, sky colours, reflection height/on), `RippleField.emit(x, z, strength)` (12 rings, 3.2 s), `advanceWater(dt)`, `setWind`, `resetWater`.
  `WaterSystem` (`sync/water-system.ts`) watches moving bodies and the avatar and emits rings on entering, wading and leaving; `underwater(camera)` returns the fog look under a surface;
  `EnvironmentRig.setUnderwater(look | null)` swaps fog and sky.
- `PlanarMirror` (`materials/planar-mirror.ts`): the scene drawn from the camera mirrored about the dominant water height with an oblique near plane, once per frame before the main frame.
- `materials/tsl-lite.ts`: a typed view of three's TSL used by the shaders. `materials/wind.ts` reads the wind uniforms (`windGain(speed)`).

### Assets and scripts

- Twelve library models are now code-authored, skinned and animated (pack `aether-creatures`, MIT): `deer` (stag, antlers), `doe`, `cat`, `bird` (robin), `crow`, `seagull`, `hawk`, `duck`,
  `parrot`, `fish` (trout), `koi`, `butterfly`. Clips: quadrupeds `idle walk run graze`; birds `perch flap fly glide` (roles idle perch, walk flap, run fly; the duck walks in `perch`);
  fish `idle swim dash`; butterfly `idle walk run`. They face -Z, stand on y = 0 and carry vertex colours. `scripts/assets/living.ts` (+ `sdf.ts`, `living-kit.ts`, `living-quad.ts`,
  `living-bird.ts`, `living-fish.ts`, `living-parts.ts`) builds them; `assets/living.json` is merged by `build.ts`.
- `tests/e2e/lookshots.e2e.ts`: `SHOT_WATER=simple|standard|high` forces a water tier.

### Ground, walls and skyline (stage `groundcity`)

- `MaterialFinish` gains `facade` (a 4 x 4 window grid per 12 m tile; the ORM blue channel marks panes that may glow), `cobble`, `limestone`, `dry-earth` and `cladding` (ambientCG photographs, see `docs/THIRD_PARTY.md`). Old documents are unaffected.
- `Environment.ground` gains the optional `skirt` (false leaves out the decorative horizon skirt, for a rooftop that must end at its edge).
- `@aether/procgen` gains the built-in generator `skyline-tower` (params `width`, `depth`, `height`, `setbacks`, `variant` 0 glass / 1 concrete / 2 brick, `color`): setback volumes with `facade` walls whose metre UVs are authored so the 3 m window grid lines up with floors, concrete roof decks with plant rooms and, above 45 m, a mast; one box collider. Under 250 triangles.
- Renderer: windows of `facade` materials glow by a shared uniform driven by the sun's elevation (`MaterialCache.setSkyElevation`, on from +4 to -5 degrees); a share of 42 % of the 3 m window cells lights, chosen by a hash of the cell so no tile-sized pattern repeats. Ground finishes (`concrete`, `asphalt`, `soil`, `dry-earth`, `grass`, `gravel`, `sand`, `snow`, `rock` and the paving `stone`, `cobble`, `limestone`) get macro tone and roughness variation, a close-up micro lookup (fades out between 1.5 and 7 m) and a distance macro lookup (fades in between 10 and 60 m); `MaterialCache.groundDetail` (off on software rasterisers and in low-memory mode) switches the two extra lookups. `MaterialCache.setWetness(0..1)` (rain = 1, from `environment.weather`) darkens and glosses all ground and fills puddles on asphalt, concrete, paving, gravel and soil (flat and mirror-like, so screen-space reflections show the sky).
- `WorldRenderer.screenshot` renders through a temporarily resized drawing buffer when the requested aspect differs from the viewport's (the post chain draws at the buffer's size, which stretched such captures); it also waits for the first three frames so a capture right after load is never black.
- Chase camera: the boom is probed with a ring of rays (`BOOM_RADIUS` 0.3 m) and is pulled in instantly in front of walls, never eased through them; first-person eye height eases small steps over about 55 ms.
