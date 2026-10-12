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
export class GeneratorCache { constructor(maxEntries?: number); get(key: string): GeneratorOutput | undefined; set(key: string, v: GeneratorOutput): void; key(shape: ProceduralShape, sourceHash?: number): string; clear(): void; }

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
export function createScriptRunner(opts?: { budgetMs?: number }): ScriptRunner;   // interpreter-based (no eval of untrusted code on main thread) OR documented isolation; MUST enforce op budget and deny globals
export const SCRIPT_API_DTS: string;
```

## @aether/render

three.js r186. Prefers `WebGPURenderer` (`three/webgpu`) with automatic WebGL2 fallback.

```ts
export interface RendererOptions { preferWebGPU?: boolean; antialias?: boolean; shadows?: boolean; pixelRatioCap?: number; sandbox?: SandboxRunner; onProgress?: (msg: string) => void; }
export class WorldRenderer {
  static async create(canvas: HTMLCanvasElement, opts?: RendererOptions): Promise<WorldRenderer>;
  readonly backend: 'webgpu' | 'webgl2';
  setWorld(world: WorldDoc): Promise<void>;               // incremental sync via diffWorlds; async because procedural generation may be sandboxed
  getGeneratorOutput(id: EntityId): GeneratorOutput | undefined;   // so physics can use procedural colliders
  applyTransforms(packed: Float32Array, order: EntityId[]): void;   // from PhysicsWorld.writeTransforms
  setEntityProperty(id: EntityId, path: string, value: Json): void;
  addTransient(entity: Entity): void; removeTransient(id: EntityId): void;   // runtime spawns not in doc
  setCameraMode(mode: 'orbit' | 'follow' | 'firstPerson', target?: EntityId): void;
  setPlayerAvatar(position: Vec3, yawDeg: number): void;
  get camera(): THREE.PerspectiveCamera;
  readonly domElement: HTMLCanvasElement;
  focus(id: EntityId): void;                              // smooth camera fly-to
  pick(ndcX: number, ndcY: number): EntityId | null;
  highlight(ids: EntityId[]): void;                       // selection outline
  showGhost(world: WorldDoc | null): void;                // translucent preview of a proposed world
  showDebug(opts: { colliders?: boolean; bounds?: boolean; diagnostics?: Diagnostic[] }): void;
  screenshot(opts?: { width?: number; height?: number; mime?: string }): Promise<string>;   // data URL (for VLM critique)
  renderViews(views: Array<'top' | 'front' | 'side' | 'iso'>, size?: number): Promise<string[]>;
  render(dt: number): void;                               // call every frame
  resize(width: number, height: number): void;
  stats(): { fps: number; frameMs: number; drawCalls: number; triangles: number; geometries: number; textures: number; entities: number; instances: number };
  dispose(): void;
}
```

Rendering requirements: instanced rendering for `scatter` shapes (InstancedMesh /
BatchedMesh), geometry & material caches keyed by stable JSON, per-frame zero
allocation, frustum culling, PCF soft shadows with a camera-fitted directional
light, procedural sky per `environment.sky` and `timeOfDay`, fog, weather
particles (GPU points), bloom/tone mapping (ACES), dispose everything on removal.

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
export function createMockProvider(): Provider;   // deterministic offline planner: keyword → world templates (MUST produce good worlds for ~15 themes; used as fallback + in tests)

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
export interface AgentCatalogs { generators: unknown[]; behaviors: unknown[]; ruleDocs: string; generatorApiDts: string; generatorExamples: unknown[]; scriptApiDts: string; }
export interface AgentOptions { provider: Provider; maxRepairs?: number; maxTurns?: number; catalogs: AgentCatalogs; }
export class WorldAgent {
  constructor(opts: AgentOptions);
  run(prompt: string, host: AgentHost, opts?: { signal?: AbortSignal; images?: string[]; history?: ChatMessage[] }): AsyncGenerator<AgentEvent>;
}
export const AGENT_TOOLS: ToolDef[];        // apply_patches, write_generator, write_script, inspect, run_verification, finish
export function buildSystemPrompt(catalogs: AgentCatalogs): string;
```

## apps/server (Hono on Node)

- `GET  /api/health` → `{ ok, providers: string[], mode: 'live' | 'mock' }`
- `POST /api/llm` body `CompletionRequest` (zod-validated, body ≤ 1 MB, ≤ 4 images) → `CompletionResponse`.
  The server maps `role` to an allowlisted model; clients cannot pick arbitrary models.
- `GET/PUT /api/generators/:hash` — content-addressed cache of validated generator defs.
- `GET/PUT /api/worlds/:id` — share links (validated `WorldDoc`, ≤ 2 MB, server-generated random ids).
- Security: keys from env only; CORS allowlist; per-IP token bucket; body limit; upstream timeout + abort; no secrets in responses/logs; security headers (CSP, nosniff, referrer-policy, frame-ancestors); serves `apps/studio/dist` in production.
- No key configured → `mode: 'mock'`; studio falls back to `createMockProvider()`.

## apps/studio (React 19 + Vite)

Editor + player: chat panel (streaming agent events), viewport (WorldRenderer),
outliner, inspector, logic panel (rules as readable cards), verification panel
(tests + diagnostics + "physics check ✓"), history timeline (undo/redo/branches),
play/edit toggle, perf HUD, example prompt gallery, export/import JSON, share link.
A `Simulation` class wires PhysicsWorld + LogicRuntime + WorldRenderer with a fixed-step loop.
