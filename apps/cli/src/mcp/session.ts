/**
 * The state behind one MCP connection: the world and its history inside the
 * project folder, the engine, the model provider, and every operation the
 * tools expose. All world changes go through the patch system (zod-validated,
 * limit-checked, undoable); all files go through {@link ProjectDir}.
 *
 * Mutating operations are serialized (one at a time per session), so two
 * clients that call at once cannot interleave half-finished edits.
 */
import { WorldAgent, summarizeWorldForModel, type AgentEvent, type AgentHost } from '@aether/agent';
import { analyzeRoomPlacements, wallMountIndex } from '@aether/arch';
import { createWorld, History, inspectUntrusted, resolveSelector, type Entity, type Vec3, type WorldDoc } from '@aether/core';
import type { VerifyTrace } from '@aether/physics';
import { loadLibraryGenerator, worldColliderProvider } from '@aether/procgen';
import { Engine } from './engine';
import { ToolError } from './errors';
import { ProjectDir, safeFileName } from './fsguard';
import { MCP_LIMITS } from './limits';
import { playtest, type PlaytestResult } from './playtest';
import { resolveProvider, type ProviderMode, type ResolvedProvider } from './provider';
import { buildScene, type Scene } from './scene';
import { renderStill } from './raster';
import { encodePng } from './png';
import { sceneToGlb } from './gltf';
import { exportWorld, validateImportedValue } from '../../../studio/src/lib/worldIO';

/** Where the session keeps its files, relative to the project folder. */
const STATE_FOLDER = '.aether';
const WORLD_FILE = 'world.json';

/** Options of {@link AetherSession.open}. */
export interface SessionOptions {
  /** The project folder (created when absent). */
  projectDir: string;
  /** Which model answers `create_world` and `edit`. */
  provider: ProviderMode;
  /** The `aether` state folder (to find a running local server). */
  stateDir: string;
  /** Folder of the studio's production build (`apps/studio/dist`), for `export build`. */
  playerDir?: string;
  /** Test seam: replaces provider resolution. */
  providerOverride?: () => Promise<ResolvedProvider>;
  /** Diagnostics sink (stderr in the real server). */
  log?: (line: string) => void;
}

/** Compact result of an agent run. */
export interface AgentSummary {
  provider: string;
  message: string;
  plan: string;
  patchesApplied: number;
  patchesRejected: number;
  rejected: string[];
  repairs: number;
  verify: { passed: boolean; summary: string } | null;
  errors: string[];
  notes: string[];
  usage: { calls: number; inputTokens: number; outputTokens: number };
}

/** One row of {@link AetherSession.listEntities}. */
export interface EntityRow {
  id: string;
  name: string;
  parent: string | null;
  tags: string[];
  shape: string;
  position: Vec3;
  behaviors: string[];
  body: string | null;
  /** Wall pieces (pictures, curtains, mirrors …): the wall face they hang on and where. */
  wall?: { wall: string; compass: string; room?: string; offset: number; width: number; y0: number; y1: number };
}

/** Filters of {@link AetherSession.listEntities}. */
export interface EntityFilter {
  selector?: string;
  tag?: string;
  behavior?: string;
  text?: string;
  parent?: string;
  offset: number;
  limit: number;
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}...`;
}

function shapeLabel(e: Entity): string {
  const s = e.shape;
  switch (s.kind) {
    case 'primitive':
      return `primitive:${s.primitive}`;
    case 'procedural':
      return `procedural:${s.generator}`;
    case 'scatter':
      return `scatter:${s.of.kind === 'primitive' ? s.of.primitive : s.of.generator}x${s.count}`;
    case 'asset':
      return `asset:${s.id}`;
    default:
      return s.kind;
  }
}

/** A running session. */
export class AetherSession {
  readonly project: ProjectDir;
  private history: History;
  private readonly undoStack: number[] = [];
  private redoStack: number[] = [];
  private chain: Promise<unknown> = Promise.resolve();
  private lastTrace: VerifyTrace | null = null;
  private resolved: { at: number; value: ResolvedProvider } | null = null;

  private constructor(
    readonly opts: SessionOptions,
    readonly engine: Engine,
    world: WorldDoc,
  ) {
    this.project = new ProjectDir(opts.projectDir);
    this.history = new History(world);
  }

  /** Open the project folder, start the engine and load the saved world (if any). */
  static async open(opts: SessionOptions): Promise<AetherSession> {
    const engine = await Engine.start();
    const project = new ProjectDir(opts.projectDir);
    let world = createWorld();
    try {
      const text = project.readText(STATE_FOLDER, WORLD_FILE, MCP_LIMITS.MAX_WORLD_BYTES);
      if (text) {
        const parsed = validateImportedValue(JSON.parse(text) as unknown);
        if (parsed.ok) world = parsed.world;
        else opts.log?.('The saved world is not valid and was ignored.');
      }
    } catch {
      opts.log?.('The saved world could not be read and was ignored.');
    }
    return new AetherSession(opts, engine, world);
  }

  /** The current world. */
  get world(): WorldDoc {
    return this.history.current;
  }

  /** Free the engine's sandbox (end of process). */
  dispose(): void {
    this.engine.dispose();
  }

  /** Run `fn` after every earlier mutation finished. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.catch(() => undefined);
    return next;
  }

  private headId(): number {
    return this.history.recentCommits(1)[0]?.id ?? (this.history.entries()[0]?.id as number);
  }

  /** Remember the head before a mutation; if the head moved afterwards it becomes an undo step. */
  private async mutate<T>(fn: () => Promise<T>): Promise<T> {
    return this.serial(async () => {
      const before = this.headId();
      try {
        return await fn();
      } finally {
        if (this.headId() !== before) {
          this.undoStack.push(before);
          if (this.undoStack.length > MCP_LIMITS.MAX_UNDO) this.undoStack.shift();
          this.redoStack = [];
          this.save();
        }
      }
    });
  }

  private save(): void {
    try {
      this.project.write(STATE_FOLDER, WORLD_FILE, exportWorld(this.world), MCP_LIMITS.MAX_WORLD_BYTES);
    } catch (e) {
      this.opts.log?.(`Could not save the world: ${e instanceof Error ? e.name : 'error'}`);
    }
  }

  /** One-paragraph description of the world (counts, state, tests). */
  describe(): Record<string, unknown> {
    const w = this.world;
    return {
      name: w.name,
      entities: Object.keys(w.entities).length,
      rules: w.rules.length,
      tests: w.tests.length,
      generators: Object.keys(w.generators).length,
      scripts: Object.keys(w.scripts).length,
      state: w.state,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
    };
  }

  /** Text summary for LLM context (same as the agent sees). */
  summary(maxEntities = 80): string {
    return clip(summarizeWorldForModel(this.world, { maxEntities }), MCP_LIMITS.MAX_TEXT_CHARS);
  }

  private async provider(): Promise<ResolvedProvider> {
    if (this.opts.providerOverride) return this.opts.providerOverride();
    if (this.resolved && Date.now() - this.resolved.at < 20_000) return this.resolved.value;
    const value = await resolveProvider(this.opts.provider, { stateDir: this.opts.stateDir });
    this.resolved = { at: Date.now(), value };
    return value;
  }

  private host(): AgentHost {
    return {
      getWorld: () => this.history.current,
      applyPatches: (patches, message) => this.history.commit(patches, message, 'agent'),
      verify: async (world, o) => {
        const r = await this.engine.verify(world, o?.signal ? { signal: o.signal } : {});
        return { report: r.report, summary: r.summary, passed: r.passed };
      },
      validateGenerator: (def) => this.engine.validateGenerator(def),
      validateScript: (def) => this.engine.validateScript(def),
    };
  }

  private async runAgent(prompt: string, signal: AbortSignal | undefined): Promise<AgentSummary> {
    const text = prompt.trim();
    if (text === '' || text.length > MCP_LIMITS.MAX_PROMPT_CHARS) throw new ToolError('invalid_input', `The prompt must be 1-${MCP_LIMITS.MAX_PROMPT_CHARS} characters.`);
    const chosen = await this.provider();
    const agent = new WorldAgent({ provider: chosen.provider, catalogs: this.engine.catalogs, resolveGenerator: loadLibraryGenerator, maxRepairs: 2, maxTurns: 40, maxToolCalls: 300, review: { maxRounds: 6 }, levelTools: async (world, name, input) => {
      const { runLevelTool } = await import('@aether/playtest/level');
      const r = await runLevelTool(world, name, input, { colliders: await worldColliderProvider(world, this.engine.sandbox) });
      return { ok: r.ok, text: r.text, patches: r.patches, message: r.message, ...(r.data ? { data: r.data } : {}) };
    } });
    const timeout = AbortSignal.timeout(MCP_LIMITS.AGENT_TIMEOUT_MS);
    const sig = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const out: AgentSummary = { provider: chosen.label, message: '', plan: '', patchesApplied: 0, patchesRejected: 0, rejected: [], repairs: 0, verify: null, errors: [], notes: [], usage: { calls: 0, inputTokens: 0, outputTokens: 0 } };
    for await (const ev of agent.run(text, this.host(), { signal: sig })) this.collect(out, ev);
    if (sig.aborted && out.errors.length === 0) out.errors.push(timeout.aborted ? 'The request ran out of time.' : 'The request was cancelled.');
    out.message = clip(out.message, 4000);
    out.plan = clip(out.plan, 2000);
    return out;
  }

  private collect(out: AgentSummary, ev: AgentEvent): void {
    switch (ev.type) {
      case 'plan':
        out.plan = ev.text;
        break;
      case 'message':
        out.message = out.message ? `${out.message}\n${ev.text}` : ev.text;
        break;
      case 'patches':
        out.patchesApplied += ev.result.applied;
        out.patchesRejected += ev.result.errors.length;
        for (const e of ev.result.errors.slice(0, 3)) if (out.rejected.length < 8) out.rejected.push(clip(`${e.op}: ${e.message}`, 240));
        break;
      case 'verify':
        out.verify = { passed: ev.passed, summary: clip(ev.summary, 3000) };
        break;
      case 'repair':
        out.repairs = ev.attempt;
        break;
      case 'error':
        if (out.errors.length < 6) out.errors.push(clip(ev.text, 300));
        break;
      case 'status':
        if (out.notes.length < 8) out.notes.push(clip(ev.text, 200));
        break;
      case 'done':
        out.usage = { calls: ev.usage.calls, inputTokens: ev.usage.inputTokens, outputTokens: ev.usage.outputTokens };
        break;
      default:
        break;
    }
  }

  /** Start a new world from a prompt (the old one stays one `undo` away). */
  createWorld(prompt: string, signal?: AbortSignal): Promise<AgentSummary> {
    return this.mutate(async () => {
      this.history.commit([{ op: 'clear', keepEnvironment: false }], 'New world', 'agent');
      const summary = await this.runAgent(prompt, signal);
      this.lastTrace = null;
      return summary;
    });
  }

  /** Change the current world from a prompt. */
  edit(prompt: string, signal?: AbortSignal): Promise<AgentSummary> {
    return this.mutate(async () => {
      const summary = await this.runAgent(prompt, signal);
      this.lastTrace = null;
      return summary;
    });
  }

  /** Apply patches directly (validated, atomic by default). */
  applyPatch(patches: readonly unknown[], message: string, atomic: boolean): Promise<{ applied: number; errors: Array<{ index: number; op: string; message: string }>; entities: number }> {
    if (patches.length === 0 || patches.length > MCP_LIMITS.MAX_PATCHES) throw new ToolError('invalid_input', `Send between 1 and ${MCP_LIMITS.MAX_PATCHES} patches.`);
    let bytes = 0;
    try {
      bytes = JSON.stringify(patches).length;
    } catch {
      throw new ToolError('invalid_input', 'The patches are not plain JSON.');
    }
    if (bytes > MCP_LIMITS.MAX_PATCH_BYTES) throw new ToolError('too_large', `The patches are ${Math.round(bytes / 1024)} KB; the limit is ${Math.round(MCP_LIMITS.MAX_PATCH_BYTES / 1024)} KB.`);
    const guard = inspectUntrusted(patches);
    if (!guard.ok) throw new ToolError('invalid_patch', `${guard.path ? `${guard.path}: ` : ''}${guard.message}`);
    return this.mutate(async () => {
      const r = this.history.commit(patches, clip(message.trim() || 'Patch from MCP client', 200), 'user', { atomic });
      this.lastTrace = null;
      if (r.errors.length > 0 && r.applied.length === 0 && atomic) {
        throw new ToolError('invalid_patch', `Nothing was applied. ${r.errors.slice(0, 5).map((e) => `[${e.index}] ${e.op}: ${e.message}`).join(' | ')}`);
      }
      return { applied: r.applied.length, errors: r.errors.slice(0, 20).map((e) => ({ index: e.index, op: e.op, message: clip(e.message, 300) })), entities: Object.keys(r.world.entities).length };
    });
  }

  /** Step back one tool action (an agent run counts as one). */
  undo(): Promise<Record<string, unknown>> {
    return this.serial(async () => {
      const prev = this.undoStack.pop();
      if (prev === undefined) throw new ToolError('nothing_to_undo', 'There is nothing to undo.');
      this.redoStack.push(this.headId());
      this.history.checkout(prev);
      this.lastTrace = null;
      this.save();
      return this.describe();
    });
  }

  /** Step forward again after an undo. */
  redo(): Promise<Record<string, unknown>> {
    return this.serial(async () => {
      const next = this.redoStack.pop();
      if (next === undefined) throw new ToolError('nothing_to_undo', 'There is nothing to redo.');
      this.undoStack.push(this.headId());
      this.history.checkout(next);
      this.lastTrace = null;
      this.save();
      return this.describe();
    });
  }

  /** Entities, filtered and paged. */
  listEntities(f: EntityFilter): { total: number; offset: number; rows: EntityRow[] } {
    const w = this.world;
    let ids: string[];
    if (f.selector) {
      try {
        ids = resolveSelector(w, f.selector);
      } catch {
        throw new ToolError('invalid_input', 'That selector is not valid. Use an entity id, "#tag", "player" or "*".');
      }
    } else ids = Object.keys(w.entities);
    const text = f.text?.toLowerCase();
    const rows: EntityRow[] = [];
    let mounts: ReturnType<typeof wallMountIndex> | undefined;
    for (const id of ids) {
      const e = w.entities[id];
      if (!e) continue;
      if (f.tag && !e.tags.includes(f.tag)) continue;
      if (f.behavior && !e.behaviors.some((b) => b.type === f.behavior)) continue;
      if (f.parent !== undefined && e.parent !== f.parent) continue;
      if (text && !(e.id.includes(text) || e.name.toLowerCase().includes(text) || e.tags.some((t) => t.toLowerCase().includes(text)))) continue;
      rows.push({
        id: e.id,
        name: e.name,
        parent: e.parent,
        tags: e.tags.slice(0, 12),
        shape: shapeLabel(e),
        position: [e.transform.position[0], e.transform.position[1], e.transform.position[2]],
        behaviors: e.behaviors.map((b) => b.type),
        body: e.physics ? e.physics.body : null,
      });
      if (e.arch?.role === 'fixture' || e.arch?.role === 'switch' || e.arch?.role === 'light') {
        mounts ??= wallMountIndex(w);
        const m = mounts.get(e.id);
        if (m) (rows[rows.length - 1] as EntityRow).wall = { wall: m.wall, compass: m.compass, ...(m.room ? { room: m.room } : {}), offset: m.t, width: m.width, y0: m.y0, y1: m.y1 };
      }
    }
    return { total: rows.length, offset: f.offset, rows: rows.slice(f.offset, f.offset + f.limit) };
  }

  /** One entity, in full. */
  getEntity(id: string): Entity {
    const e = Object.hasOwn(this.world.entities, id) ? this.world.entities[id] : undefined;
    if (!e) throw new ToolError('not_found', `There is no entity "${clip(id, 64)}". Use list_entities to see the ids.`);
    return e;
  }

  /** Where a wall piece hangs and what, if anything, it overlaps (null for other entities). */
  wallPlacement(id: string): { mount: NonNullable<ReturnType<ReturnType<typeof wallMountIndex>['get']>>; problems: ReturnType<typeof analyzeRoomPlacements> } | null {
    const mount = wallMountIndex(this.world).get(id);
    if (!mount) return null;
    return { mount, problems: analyzeRoomPlacements(this.world).filter((p) => p.entities.includes(id)) };
  }

  /** Run the world's tests (physics as unit tests). */
  async verify(signal?: AbortSignal): Promise<{ passed: boolean; summary: string; tests: Array<{ id: string; kind: string; passed: boolean; message: string }>; diagnostics: number; simulatedSeconds: number; ms: number }> {
    const sig = this.deadline(signal, MCP_LIMITS.VERIFY_TIMEOUT_MS);
    const r = await this.engine.verify(this.world, { signal: sig });
    return {
      passed: r.passed,
      summary: clip(r.summary, 6000),
      tests: r.report.results.slice(0, 100).map((t) => ({ id: t.id, kind: t.kind, passed: t.passed, message: clip(t.message, 300) })),
      diagnostics: r.report.diagnostics.length,
      simulatedSeconds: Math.round(r.report.simulatedSeconds * 10) / 10,
      ms: Math.round(r.report.ms),
    };
  }

  private deadline(signal: AbortSignal | undefined, ms: number): AbortSignal {
    const t = AbortSignal.timeout(ms);
    return signal ? AbortSignal.any([signal, t]) : t;
  }

  /** Let a bot play the world. */
  async playtest(opts: { seconds: number; goal?: string }, signal?: AbortSignal): Promise<PlaytestResult> {
    if (opts.goal) {
      try {
        if (resolveSelector(this.world, opts.goal).length === 0) throw new ToolError('not_found', `The goal "${clip(opts.goal, 64)}" matches no entity.`);
      } catch (e) {
        if (e instanceof ToolError) throw e;
        throw new ToolError('invalid_input', 'That goal selector is not valid.');
      }
    }
    const sig = this.deadline(signal, MCP_LIMITS.PLAYTEST_TIMEOUT_MS);
    return playtest(this.world, {
      seconds: Math.min(opts.seconds, MCP_LIMITS.MAX_PLAYTEST_SECONDS),
      ...(opts.goal ? { goal: opts.goal } : {}),
      deadline: Date.now() + MCP_LIMITS.PLAYTEST_TIMEOUT_MS,
      signal: sig,
    });
  }

  /** Fast-forward the physics and report how the moving things behaved. */
  async replay(signal?: AbortSignal): Promise<{
    passed: boolean;
    simulatedSeconds: number;
    bodies: Array<{ id: string; start: Vec3; end: Vec3; pathMeters: number; peakHeight: number; keyframes: Array<{ t: number; position: Vec3 }> }>;
    file: string | null;
    note?: string;
  }> {
    const sig = this.deadline(signal, MCP_LIMITS.VERIFY_TIMEOUT_MS);
    const r = await this.engine.verify(this.world, { trace: true, signal: sig });
    const tr = r.report.trace ?? null;
    this.lastTrace = tr;
    if (!tr) return { passed: r.passed, simulatedSeconds: Math.round(r.report.simulatedSeconds * 10) / 10, bodies: [], file: null, note: 'Nothing moved under physics, so there is nothing to replay. Give a body physics {"body":"dynamic"} (or kinematic motion) to see it.' };
    const bodies = tr.ids.map((id, b) => {
      const at = (f: number): Vec3 => {
        const o = (f * tr.ids.length + b) * 7;
        return [round(tr.poses[o] as number), round(tr.poses[o + 1] as number), round(tr.poses[o + 2] as number)];
      };
      let path = 0;
      let peak = -Infinity;
      for (let f = 0; f < tr.frames; f++) {
        const p = at(f);
        peak = Math.max(peak, p[1]);
        if (f > 0) {
          const q = at(f - 1);
          path += Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
        }
      }
      const keys = Math.min(8, tr.frames);
      const keyframes = Array.from({ length: keys }, (_, k) => {
        const f = keys === 1 ? 0 : Math.round((k * (tr.frames - 1)) / (keys - 1));
        return { t: round(f * tr.dt), position: at(f) };
      });
      return { id, start: at(0), end: at(tr.frames - 1), pathMeters: round(path), peakHeight: round(peak), keyframes };
    });
    const dump = { dt: tr.dt, frames: tr.frames, ids: tr.ids, poses: Array.from(tr.poses, round) };
    const file = this.project.write('replays', 'replay.json', JSON.stringify(dump), MCP_LIMITS.MAX_WORLD_BYTES);
    return { passed: r.passed, simulatedSeconds: Math.round(r.report.simulatedSeconds * 10) / 10, bodies, file };
  }

  /** Poses of the last replay at `t` seconds (null without a replay). */
  private replayPoses(t: number): Map<string, { position: Vec3; quaternion: [number, number, number, number] }> {
    const tr = this.lastTrace;
    if (!tr) throw new ToolError('invalid_input', 'Run replay first: "at" shows a moment of the last replay.');
    const f = Math.max(0, Math.min(tr.frames - 1, Math.round(t / tr.dt)));
    const m = new Map<string, { position: Vec3; quaternion: [number, number, number, number] }>();
    tr.ids.forEach((id, b) => {
      const o = (f * tr.ids.length + b) * 7;
      m.set(id, { position: [tr.poses[o] as number, tr.poses[o + 1] as number, tr.poses[o + 2] as number], quaternion: [tr.poses[o + 3] as number, tr.poses[o + 4] as number, tr.poses[o + 5] as number, tr.poses[o + 6] as number] });
    });
    return m;
  }

  private async scene(signal: AbortSignal | undefined, poses?: ReturnType<AetherSession['replayPoses']>): Promise<Scene> {
    return buildScene(this.world, { sandbox: this.engine.sandbox, maxTriangles: MCP_LIMITS.MAX_TRIANGLES, ...(poses ? { poses } : {}), ...(signal ? { signal } : {}) });
  }

  /** Render a still (software renderer, no GPU) and save it as a PNG. */
  async renderStill(o: { width: number; height: number; yawDeg?: number; pitchDeg?: number; fovDeg?: number; from?: Vec3; lookAt?: Vec3; at?: number; name?: string }, signal?: AbortSignal): Promise<{ png: Buffer; file: string; width: number; height: number; triangles: number; skipped: Array<{ id: string; reason: string }>; camera: { from: Vec3; lookAt: Vec3; fovDeg: number } }> {
    const sig = this.deadline(signal, MCP_LIMITS.RENDER_TIMEOUT_MS);
    const scene = await this.scene(sig, o.at !== undefined ? this.replayPoses(o.at) : undefined);
    const still = renderStill(scene, this.world.environment, {
      width: o.width,
      height: o.height,
      deadline: Date.now() + MCP_LIMITS.RENDER_TIMEOUT_MS,
      ...(o.yawDeg !== undefined ? { yawDeg: o.yawDeg } : {}),
      ...(o.pitchDeg !== undefined ? { pitchDeg: o.pitchDeg } : {}),
      ...(o.fovDeg !== undefined ? { fovDeg: o.fovDeg } : {}),
      ...(o.from ? { from: o.from } : {}),
      ...(o.lookAt ? { lookAt: o.lookAt } : {}),
    });
    const png = encodePng(still.rgba, still.width, still.height);
    const base = safeFileName(o.name ?? '', safeFileName(this.world.name, 'world'));
    const file = this.project.write('renders', `${base.replace(/\.png$/, '')}.png`, png, MCP_LIMITS.MAX_EXPORT_BYTES);
    return { png, file, width: still.width, height: still.height, triangles: still.triangles, skipped: scene.skipped.slice(0, 12), camera: still.camera };
  }

  /** Export the world as glTF (GLB), a standalone web game build, a floor-plan SVG set, or the project file. */
  async export(format: 'gltf' | 'build' | 'plan' | 'project' | 'ifc', name: string | undefined, signal?: AbortSignal): Promise<{ format: string; files: Array<{ path: string; bytes: number }>; notes: string[] }> {
    const sig = this.deadline(signal, MCP_LIMITS.RENDER_TIMEOUT_MS);
    const world = this.world;
    const base = safeFileName(name ?? '', safeFileName(world.name, 'world')).replace(/\.(glb|zip|svg|json|ifc)$/, '');
    const files: Array<{ path: string; bytes: number }> = [];
    const notes: string[] = [];
    const put = (file: string, data: Uint8Array | string): void => {
      const bytes = typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength;
      files.push({ path: this.project.write('exports', file, data, MCP_LIMITS.MAX_EXPORT_BYTES), bytes });
    };
    switch (format) {
      case 'project':
        put(`${base}.aether.json`, exportWorld(world));
        break;
      case 'gltf': {
        const scene = await this.scene(sig);
        if (scene.meshes.length === 0) throw new ToolError('invalid_input', 'The world has nothing to export yet.');
        const out = await sceneToGlb(scene, world.name);
        put(`${base}.glb`, out.glb);
        notes.push(`${out.nodes} nodes, ${out.triangles} triangles, ${out.materials} materials.`);
        for (const s of scene.skipped.slice(0, 8)) notes.push(`Skipped ${s.id}: ${s.reason}.`);
        break;
      }
      case 'plan': {
        const { floorPlan2d, listBuildings, listLevels } = await import('@aether/arch');
        const { planDrawing, planSvg } = await import('../../../studio/src/publish/floorplan');
        const buildings = listBuildings(world);
        if (buildings.length === 0) throw new ToolError('not_found', 'The world has no building to draw a plan of. Ask for a house, an office or another building first.');
        for (const b of buildings.slice(0, 8)) {
          for (const lvl of listLevels(world, b.id).slice(0, 12)) {
            const plan = floorPlan2d(world, b.id, lvl.index);
            if (!plan) continue;
            const svg = planSvg(planDrawing(plan, { title: `${b.name} - ${plan.levelName}`, subtitle: plan.levelName }), 50);
            put(`${base}-${safeFileName(b.id, 'building')}-level-${lvl.index}.svg`, svg);
          }
        }
        if (files.length === 0) throw new ToolError('not_found', 'The buildings have no floors to draw.');
        break;
      }
      case 'ifc': {
        const { exportWorldToIfc, listBuildings } = await import('@aether/arch');
        if (listBuildings(world).length === 0) throw new ToolError('not_found', 'The world has no building to export as IFC. Ask for a house, an office or another building first.');
        const out = exportWorldToIfc(world, { projectName: world.name });
        put(`${base}.ifc`, out.ifc);
        notes.push(`IFC4: ${Object.entries(out.elements).map(([k, n]) => `${n} ${k.slice(3).toLowerCase()}`).join(', ')}.`);
        for (const sk of out.skipped.slice(0, 8)) notes.push(`Skipped ${sk.id}: ${sk.reason}.`);
        break;
      }
      case 'build': {
        const { build, note } = await this.buildGame(sig);
        put(`${base}-web.zip`, build);
        if (note) notes.push(note);
        break;
      }
    }
    return { format, files, notes };
  }

  private async buildGame(signal: AbortSignal): Promise<{ build: Uint8Array; note?: string }> {
    const dir = this.opts.playerDir;
    if (!dir) throw new ToolError('unavailable', 'The web player is not built. Run "aether start" once (it builds the studio), then export again.');
    const { readFileSync, existsSync } = await import('node:fs');
    const { join, resolve, sep } = await import('node:path');
    const root = resolve(dir);
    if (!existsSync(join(root, 'play-manifest.json'))) throw new ToolError('unavailable', 'The web player is not built. Run "aether start" once (it builds the studio), then export again.');
    const { buildGame } = await import('../../../studio/src/publish/gameBuild');
    const { safeEntryName } = await import('@aether/assets/zip');
    const world = this.world;
    const scene = await this.scene(signal);
    const cover = new Blob([new Uint8Array(encodePng(renderStill(scene, world.environment, { width: 640, height: 400 }).rgba, 640, 400))], { type: 'image/png' });
    const images = {
      // Covers and icons are drawn straight from the scene at the size asked for.
      async crop(_image: Blob, w: number, h: number): Promise<Uint8Array> {
        const s = renderStill(scene, world.environment, { width: w, height: h });
        return encodePng(s.rgba, w, h);
      },
    };
    const result = await buildGame({
      world,
      title: world.name,
      description: world.description || `${world.name}, a playable 3D world made with Aether.`,
      author: '',
      controls: 'WASD to move, Space to jump, mouse to look.',
      music: null,
      cover,
      images,
      signal,
      fetchFile: async (path: string): Promise<Uint8Array> => {
        const clean = path.replace(/^\/+/, '');
        if (!safeEntryName(clean)) throw new Error('unsafe path');
        const abs = resolve(root, clean);
        if (!abs.startsWith(root + sep)) throw new Error('unsafe path');
        return new Uint8Array(readFileSync(abs));
      },
    });
    return { build: result.zip, note: `${result.files.length} files, ${Math.round(result.bytes / 1024)} KB. Serve the unzipped folder over HTTP to play it.` };
  }

  /** Raw world JSON for the resource (size-capped). */
  worldJson(): string {
    const text = JSON.stringify(this.world, null, 2);
    return text.length > MCP_LIMITS.MAX_WORLD_BYTES ? JSON.stringify({ error: 'The world is too large to inline.' }) : text;
  }

  /** The provider that would answer right now (for status). */
  async providerLabel(): Promise<string> {
    try {
      return (await this.provider()).label;
    } catch (e) {
      return e instanceof ToolError ? `unavailable (${e.message.slice(0, 80)})` : 'unavailable';
    }
  }
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
