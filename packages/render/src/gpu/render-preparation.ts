/** First-use graph/binding setup for Three r186, split into tasks in the context of the pass that requested it. */
import type { WebGPURenderer } from 'three/webgpu';
import { materialReferenceTextures, textureReadyForUpload, type UploadTexture } from './compile-textures';

type Material = { version: number; [key: string]: unknown };
interface Lights { getLights(): unknown[]; setLights(lights: unknown[]): void }
interface Group { bindings: Array<{ isSampledTexture?: boolean; texture?: UploadTexture | null }> }
interface Object3D { geometry: { drawRange: unknown } }
interface RenderObject {
  isRenderObject?: boolean;
  object: Object3D;
  material: Material;
  lightsNode: Lights;
  _bindings?: Group[] | null;
  drawRange: unknown;
  group: unknown;
  getNodeBuilderState(): unknown;
  getBindings(): Group[];
}
type Direct = (object: Object3D, material: Material, scene: unknown, camera: unknown, lights: Lights, group: unknown, clipping: unknown, passId?: string) => void;
type Get = (object: Object3D, material: Material, scene: unknown, camera: unknown, lights: Lights, context: unknown, clipping: unknown, passId?: string) => RenderObject;
interface Port {
  [key: string]: unknown;
  _objects: { get: Get };
  _nodes: { delete(object: RenderObject): unknown };
  _bindings: { getForRender(object: RenderObject): unknown };
  _geometries: { updateForRender(object: RenderObject): void };
  _pipelines?: { getForRender(object: RenderObject): unknown };
  _textures?: { get(texture: UploadTexture): { initialized?: boolean; version?: number } };
  initTexture?(texture: UploadTexture): void;
  _renderObjectDirect: Direct;
  _currentRenderContext: unknown;
  _currentRenderBundle: unknown;
  _currentSourceMaterial: Material | null;
  lighting: { enabled: boolean };
  shadowMap: { enabled: boolean; type: unknown };
  compileAsync(...args: unknown[]): Promise<unknown>;
  getRenderTarget(): unknown;
  getOutputRenderTarget(): unknown;
  getMRT(): unknown;
  getActiveCubeFace(): number;
  getActiveMipmapLevel(): number;
  setRenderTarget(target: unknown, face: number, mip: number): void;
  setOutputRenderTarget(target: unknown): void;
  setMRT(mrt: unknown): void;
}
const rendererFields = ['contextNode', 'toneMapping', 'outputColorSpace', 'lighting', 'opaque', 'transparent', '_currentSourceMaterial'] as const;
// Renderer.renderObject temporarily changes these, including both sides of transparent materials
// and the shared shadow/override material. Assignments must not change its persistent version.
const materialFields = ['side', 'colorNode', 'depthNode', 'positionNode', 'alphaTest', 'alphaMap', 'displacementMap', 'displacementScale', 'displacementBias', 'transparent'] as const;
type MaterialState = Array<{ present: boolean; value: unknown }>;
interface Snapshot {
  target: unknown; output: unknown; mrt: unknown; face: number; mip: number; values: unknown[];
  lighting: boolean; shadow: boolean; shadowType: unknown; targets: TargetStamp[];
}
interface TargetStamp { counter: { epoch: number }; epoch: number }
/** The target owns this listener; it captures no renderer, so tracking does not retain disposed renderers. */
function targetStamp(target: unknown, versions: WeakMap<object, { epoch: number }>): TargetStamp | null {
  if (!target || typeof target !== 'object') return null;
  const events = target as { addEventListener?: (type: string, listener: () => void) => void };
  if (typeof events.addEventListener !== 'function') return null;
  let counter = versions.get(target);
  if (!counter) {
    counter = { epoch: 0 };
    const record = counter;
    events.addEventListener('dispose', () => { record.epoch++; });
    versions.set(target, counter);
  }
  return { counter, epoch: counter.epoch };
}
const currentTargets = (state: Snapshot): boolean => state.targets.every(stamp => stamp.counter.epoch === stamp.epoch);
interface Job { ro: RenderObject; geometry: Object3D['geometry']; state: Snapshot; material: MaterialState; lights: unknown[]; source: Material; version: number; stage: number; bindings?: Group[]; bindingGroup: number; binding: number; builder?: unknown; materialTextures?: readonly UploadTexture[]; materialTexture: number; link?: boolean }
export interface RenderPreparation {
  readonly pending: number;
  /** Draws held back so far (running count) because their object was still preparing. */
  readonly deferred: number;
  idle(): Promise<void>;
  /** Start the program links of the objects prepared since the last call (at the start of an animation frame). */
  link(): void;
  /** Atomic capture work retains the normal renderer path. */
  synchronous<T>(draw: () => T): T;
  dispose(): void;
}
interface Options {
  ready(): void;
  error(error: unknown): void;
  /**
   * Do not enqueue resource uploads behind pending program links or native compileAsync. The node graphs (CPU only, most
   * of the work) are still built ahead while links are pending.
   */
  blocked(): boolean;
  /** Milliseconds one pump may spend before yielding (default 4; more while nothing on screen needs a smooth frame). */
  sliceMs?(): number;
  /** Milliseconds to wait before the next pump (a per-frame budget spent; default 0). */
  delayMs?(): number;
  /** Milliseconds one pump spent (accounted against a per-frame budget). */
  spent?(ms: number): void;
  /** One step of a sliced upload of the geometry's large buffers; true once none is left (see streaming/sliced-upload.ts). */
  upload?(geometry: unknown): boolean;
  /** One-shot texture generation must finish its GPU draws before publishing the texture. */
  atomic?<T>(draw: () => T): T;
  /** Null uses timers (also useful in deterministic lifecycle tests). */
  channel?: (() => MessageChannel) | null;
}

/** Longest a compile walk holds the preparation queue (ms). */
const COMPILE_HOLD_MAX_MS = 8000;

export function deferRenderPreparation(renderer: WebGPURenderer, options: Options): RenderPreparation {
  const slice = (): number => options.sliceMs?.() ?? 4;
  const r = renderer as unknown as Port;
  const jobs: Array<Job | undefined> = [], queued = new Set<RenderObject>(), dead = new WeakSet<object>(), failed = new WeakSet<object>();
  const waiters = new Set<() => void>();
  const targetVersions = new WeakMap<object, { epoch: number }>();
  let head = 0, deferred = 0;
  /** Prepared objects whose program links have not started yet (see `link`). */
  const linking: Job[] = [];
  /** First job whose node graph may still be built ahead of the queue while program links are pending (see buildAhead). */
  let ahead = 0;
  let disposed = false, bypass = false, active = false, compiling = 0, posted = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let channel: MessageChannel | null = null;
  let prefetched: RenderObject | null = null;
  const direct = r._renderObjectDirect, get = r._objects?.get, remove = r._nodes?.delete, compile = r.compileAsync;
  const supported = typeof direct === 'function' && typeof get === 'function' && typeof remove === 'function' && typeof compile === 'function'
    && typeof r._bindings?.getForRender === 'function' && typeof r._geometries?.updateForRender === 'function'
    && ['getRenderTarget', 'getOutputRenderTarget', 'getMRT', 'getActiveCubeFace', 'getActiveMipmapLevel', 'setRenderTarget', 'setOutputRenderTarget', 'setMRT'].every(key => typeof r[key] === 'function') && r.lighting && r.shadowMap;
  const notify = (): void => {
    if (head < jobs.length || active || (!disposed && compiling)) return;
    for (const resolve of waiters) resolve();
    waiters.clear();
    if (!disposed) options.ready();
  };
  const result: RenderPreparation = {
    get pending() { return Math.max(jobs.length - head, active ? 1 : 0); },
    link,
    get deferred() { return deferred; },
    idle() { return head < jobs.length || active || (!disposed && compiling) ? new Promise(resolve => { waiters.add(resolve); }) : Promise.resolve(); },
    synchronous(draw) { const previous = bypass; bypass = true; try { return draw(); } finally { bypass = previous; } },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimeout(timer); channel?.port1.close(); channel?.port2.close();
      jobs.length = 0; head = 0; ahead = 0; linking.length = 0; queued.clear(); prefetched = null;
      if (supported) {
        if (r._renderObjectDirect === draw) r._renderObjectDirect = direct;
        if (r._objects.get === getObject) r._objects.get = get;
        if (r._nodes.delete === deleteObject) r._nodes.delete = remove;
        if (r.compileAsync === compileAsync) r.compileAsync = compile;
      }
      notify();
    },
  };
  if (!supported) return result;

  function snapshot(): Snapshot {
    const target = r.getRenderTarget(), output = r.getOutputRenderTarget();
    const targets = [targetStamp(target, targetVersions)];
    if (output !== target) targets.push(targetStamp(output, targetVersions));
    return { target, output, targets: targets.filter((stamp): stamp is TargetStamp => stamp !== null), mrt: r.getMRT(), face: r.getActiveCubeFace(), mip: r.getActiveMipmapLevel(), values: rendererFields.map(key => r[key]), lighting: r.lighting.enabled, shadow: r.shadowMap.enabled, shadowType: r.shadowMap.type };
  }
  function restore(state: Snapshot): void {
    r.setOutputRenderTarget(state.output); r.setRenderTarget(state.target, state.face, state.mip); r.setMRT(state.mrt);
    rendererFields.forEach((key, i) => { (r as Record<string, unknown>)[key] = state.values[i]; });
    r.lighting.enabled = state.lighting; r.shadowMap.enabled = state.shadow; r.shadowMap.type = state.shadowType;
  }
  function materialState(material: Material): MaterialState { return materialFields.map(key => ({ present: key in material, value: material[key] })); }
  function applyMaterial(material: Material, state: MaterialState): void {
    const version = material.version;
    materialFields.forEach((key, i) => {
      const field = state[i]!;
      if (field.present) material[key] = field.value;
      else if (Object.hasOwn(material, key)) delete material[key];
    });
    material.version = version;
  }
  function schedule(delay = 0): void {
    if (disposed || posted || timer !== undefined || head === jobs.length) return;
    if (delay) { timer = setTimeout(pump, delay); return; }
    const factory = options.channel === undefined ? (typeof MessageChannel === 'function' ? () => new MessageChannel() : null) : options.channel;
    if (factory) {
      if (!channel) { channel = factory(); channel.port1.onmessage = pump; }
      posted = true; channel.port2.postMessage(null);
    } else timer = setTimeout(pump, 0);
  }
  /** Run `step` in the job's requesting pass (target, MRT, material fields, lights); never hold that state over a yield. */
  function within<T>(job: Job, step: () => T): T {
    active = true;
    const previous = snapshot(), previousMaterial = materialState(job.ro.material), previousLights = job.ro.lightsNode.getLights();
    try {
      restore(job.state); applyMaterial(job.ro.material, job.material);
      job.ro.lightsNode.setLights(job.lights);
      return step();
    } finally {
      job.ro.lightsNode.setLights(previousLights); applyMaterial(job.ro.material, previousMaterial); restore(previous);
      if (dead.has(job.ro)) remove.call(r._nodes, job.ro);
      active = false;
    }
  }
  function pump(): void {
    timer = undefined; posted = false;
    if (disposed || head === jobs.length) { notify(); return; }
    if (compiling) { schedule(8); return; }
    const wait = options.delayMs?.() ?? 0;
    if (wait > 0) { schedule(wait); return; }
    const start = performance.now();
    if (options.blocked()) {
      // Programs are linking: build the node graphs of the jobs behind meanwhile (CPU work, no GL commands), so the
      // GPU's links and the CPU's graph building overlap instead of taking turns.
      const more = buildAhead(start);
      options.spent?.(performance.now() - start);
      if (more) schedule(options.delayMs?.() ?? 0); else schedule(8);
      return;
    }
    do {
      const job = jobs[head]!;
      let finished = !valid(job);
      if (!finished) {
        try {
          finished = within(job, () => {
            let done: boolean;
            do {
              done = !valid(job) || advance(job);
            } while (!done && !disposed && !compiling && !options.blocked() && performance.now() - start < slice());
            return done;
          });
          if (finished && job.link) linking.push(job);
        } catch (error) { finished = true; failed.add(job.ro); options.error(error); }
      }
      if (finished) {
        // Clear consumed references immediately without shifting the world-sized queue.
        queued.delete(job.ro); jobs[head++] = undefined;
      }
    } while (!disposed && !compiling && !options.blocked() && head < jobs.length && performance.now() - start < slice());
    if (head === jobs.length) { jobs.length = 0; head = 0; ahead = 0; }
    options.spent?.(performance.now() - start);
    if (head < jobs.length) schedule(options.delayMs?.() ?? 0); else notify();
  }
  /**
   * Start the program links of the objects prepared since the last call, together, without waiting for a frame to draw
   * them. Program creation used to wait for the next drawn frame, and a frame is drawn only once the queue is idle, so
   * after a change of tier the GPU linked nothing while the CPU built graphs, and the reverse. Called by the host at the
   * start of an animation frame: GL work outside the frame's task disturbed what the browser kept on screen.
   */
  function link(): void {
    if (!linking.length) return;
    const batch = linking.splice(0);
    for (const job of batch) {
      if (disposed || !r._pipelines || !valid(job)) continue;
      try { within(job, () => r._pipelines!.getForRender(job.ro)); } catch (error) { options.error(error); }
    }
  }
  /** Build node graphs (stage 0) of queued jobs within the slice; true while more remain to build. */
  function buildAhead(start: number): boolean {
    if (ahead < head) ahead = head;
    while (ahead < jobs.length && !disposed && !compiling && performance.now() - start < slice()) {
      const job = jobs[ahead++]!;
      if (job.stage !== 0 || !valid(job)) continue;
      // A failure is reported by the ordinary pass, which builds the graph again.
      try { within(job, () => { job.builder = job.ro.getNodeBuilderState(); job.stage = 1; }); } catch { /* retried in order */ }
    }
    return ahead < jobs.length && !disposed && !compiling;
  }
  function valid(job: Job): boolean {
    return !disposed && !dead.has(job.ro) && job.ro.object.geometry === job.geometry && job.source.version === job.version && currentTargets(job.state);
  }
  /** One indivisible phase or ordinary texture upload; the caller checks its budget between steps. */
  function advance(job: Job): boolean {
    if (job.stage === 0) {
      job.builder = job.ro.getNodeBuilderState(); job.stage = 1;
    } else if (job.stage === 1) {
      // Large vertex and index buffers go up in slices first (one per step), so three's upload below has nothing large left.
      if (options.upload && !options.upload(job.geometry)) return false;
      job.bindings = job.ro.getBindings(); r._geometries.updateForRender(job.ro);
      job.materialTextures = materialReferenceTextures(job.builder, job.ro.material); job.stage = 2;
    } else if (job.stage === 2) {
      if (r.initTexture && r._textures) {
        while (job.materialTexture < job.materialTextures!.length) {
          const texture = job.materialTextures![job.materialTexture++]!;
          if (!textureReadyForUpload(texture)) continue;
          const data = r._textures.get(texture);
          if (data.initialized === true && data.version === texture.version) continue;
          r.initTexture(texture); return false;
        }
        const groups = job.bindings!;
        while (job.bindingGroup < groups.length) {
          const bindings = groups[job.bindingGroup]!.bindings;
          while (job.binding < bindings.length) {
            const binding = bindings[job.binding++]!, texture = binding.texture;
            if (!binding.isSampledTexture || !texture || !textureReadyForUpload(texture)) continue;
            const data = r._textures.get(texture);
            if (data.initialized === true && data.version === texture.version) continue;
            r.initTexture(texture);
            return false;
          }
          job.bindingGroup++; job.binding = 0;
        }
      }
      job.stage = 3;
    } else {
      // Dynamic display nodes supply their texture in updateBefore: retain their native binding path.
      const bindings = job.ro.getBindings();
      if (bindings.every(group => group.bindings.every(binding => !binding.isSampledTexture || binding.texture?.image))) {
        r._bindings.getForRender(job.ro);
        job.link = true;
      }
      return true;
    }
    return false;
  }
  // A hit does not allocate argument arrays or repeat RenderObjects.get's material/cache checks.
  function getObject(object: Object3D, material: Material, scene: unknown, camera: unknown, lights: Lights, context: unknown, clipping: unknown, passId?: string): RenderObject {
    if (prefetched) { const ro = prefetched; prefetched = null; return ro; }
    return get.call(r._objects, object, material, scene, camera, lights, context, clipping, passId);
  }
  function deleteObject(object: RenderObject): unknown { if (object.isRenderObject) dead.add(object); return remove.call(r._nodes, object); }
  function draw(object: Object3D, material: Material, scene: unknown, camera: unknown, lights: Lights, group: unknown, clipping: unknown, passId?: string): void {
    const target = r.getRenderTarget() as { isCubeRenderTarget?: boolean; texture?: { isPMREMTexture?: boolean } } | null;
    if (active || target?.isCubeRenderTarget || target?.texture?.isPMREMTexture) {
      const run = () => direct.call(r, object, material, scene, camera, lights, group, clipping, passId);
      return options.atomic ? options.atomic(run) : run();
    }
    if (disposed || bypass || r._currentRenderBundle !== null) return direct.call(r, object, material, scene, camera, lights, group, clipping, passId);
    const ro = get.call(r._objects, object, material, scene, camera, lights, r._currentRenderContext, clipping, passId);
    if (queued.size > 0 && queued.has(ro)) { deferred++; return; }
    if (!ro._bindings && !failed.has(ro)) {
      deferred++;
      ro.drawRange = object.geometry.drawRange; ro.group = group;
      if (!queued.has(ro)) {
        const source = r._currentSourceMaterial ?? material;
        const job: Job = { ro, geometry: object.geometry, state: snapshot(), material: materialState(material), lights: lights.getLights().slice(), source, version: source.version, stage: 0, bindingGroup: 0, binding: 0, materialTexture: 0 };
        queued.add(ro);
        // A full-screen pass (the post chain's quads, the one that presents the frame among them) goes first: queued behind
        // a world's thousands of objects, it held the picture frozen until all of them were ready (seconds after a tier change).
        if ((object as { isQuadMesh?: boolean }).isQuadMesh === true) {
          jobs.splice(head, 0, job);
          if (ahead > head) ahead++;
        } else jobs.push(job);
        schedule();
      }
      return;
    }
    prefetched = ro;
    try { direct.call(r, object, material, scene, camera, lights, group, clipping, passId); } finally { prefetched = null; }
  }
  function compileAsync(...args: unknown[]): Promise<unknown> {
    compiling++;
    // A compile walk holds the queue (its binding phase is atomic), but not for ever: on WebGPU some of its pipeline
    // promises never settled, and the queue then stood still through a whole load (3,000 objects, the load screen gave
    // up). Past COMPILE_HOLD_MAX_MS the queue moves on; the compile itself carries on.
    let held = true;
    const release = (): void => {
      if (!held) return;
      held = false;
      clearTimeout(timer);
      compiling--;
      notify();
      if (!disposed && head < jobs.length) schedule();
    };
    const timer = setTimeout(release, COMPILE_HOLD_MAX_MS);
    try { return Promise.resolve(compile.apply(r, args)).finally(release); }
    catch (error) { release(); throw error; }
  }
  r._objects.get = getObject; r._nodes.delete = deleteObject; r._renderObjectDirect = draw; r.compileAsync = compileAsync;
  return result;
}
