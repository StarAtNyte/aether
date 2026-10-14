/**
 * Studio — the application controller. Owns History, the UI store, the
 * agent bridge, provider selection and persistence; attaches a Simulation
 * once the viewport canvas exists. React components call into this object
 * and subscribe to History / the store; they never own engine state.
 */
import { History, diffWorlds, getEntity, patchesBetween, type EntityId, type Patch, type WorldDoc } from '@aether/core';
import { WorldAgent, createFallbackProvider, improvementPatches, isAbortError, needsRefinement, refineInstruction, type AgentEvent, type FallbackNotice, type PromptProfile, type Provider, type QualityFix } from '@aether/agent';
import { createWorkerSandbox, type SandboxRunner } from '@aether/procgen';
import type { StoreApi } from 'zustand/vanilla';
import { API, MAX_PROMPT_CHARS, PERSIST_DEBOUNCE_MS } from '../config';
import { buildAgentHistory, toEventView, type ChatEntry, type ChatEventView } from '../lib/chat';
import { formatStateValue } from '../lib/format';
import { createLogger, errorMessage } from '../lib/log';
import { createStarterWorld } from '../lib/starterWorld';
import {
  browserStorage,
  clearBooting,
  loadChat,
  loadSettings,
  loadWorld,
  markBooting,
  previousBootFailed,
  saveChat,
  saveRecoveryWorld,
  MAX_REPAIRS_SETTING,
  saveSettings,
  saveWorld,
  systemPrefersDark,
  type StorageLike,
  type StudioSettings,
} from '../lib/storage';
import { paletteEntity, paletteItem } from '../lib/palette';
import { dataUrlToBlob, fitThumbnail } from '../lib/thumbnail';
import { downloadText } from '../lib/download';
import { exportFileName, exportWorld, parseWorldImport, validateImportedValue } from '../lib/worldIO';
import { initialPanels } from '../lib/layout';
import { decideLowMemory, HISTORY_ENTRIES, heapUnderPressure, MEMORY_SAMPLE_MS, readMemorySignals, RecoveryLimiter } from '../lib/memory';
import type { ContextLossInfo, RenderMemoryStats } from '@aether/render';
import { Editor } from './editor/Editor';
import { createStudioStore, type MemoryState, type StudioState } from '../state/store';
import { AgentBridge, agentCatalogs, createOfflinePlanner, resolveLibraryGenerator, verifyOnMainThread } from './AgentBridge';
import { LiveVerifyFeed } from './verify/live';
import { VerifyPool } from './verify/pool';
import { VerificationService } from './verify/service';
import { verifyLanes } from './verify/shards';
import { aiConnection, effectiveBridgeChoice, projectSessionKey, type AiConnection, type ResolvedConnection } from '../ai/connection';
import { loadAiPrefs, saveAiPrefs } from '../ai/prefs';
import { runQualityPass, toQualityView } from '../ai/quality';
import { fallbackText } from '../ai/messages';
import { Simulation } from './Simulation';

/** Token usage of one turn (all agent runs of a prompt). */
interface RunUsage {
  inputTokens: number;
  outputTokens: number;
  calls: number;
  /** Models that answered, in order of first use. */
  models: string[];
}
import { addedVoxelEdits, isNewWorld } from './worldQueries';

const log = createLogger('studio');

/** Share-link world ids (server-generated, 12 base62 chars). */
const SHARE_ID = /^[0-9A-Za-z]{12}$/;
const MAX_REPAIRS = 2;
/** Offline refinement only applies physical and lighting fixes (the offline planner's art direction stays intact). */
const OFFLINE_FIXES: ReadonlySet<QualityFix> = new Set(['ground', 'separate', 'light-night']);

/** A project opened in the studio (see `projects/`). */
export interface StudioProject {
  world: WorldDoc;
  chat: readonly ChatEntry[];
}

/** Construction options. */
export interface StudioOptions {
  /** Settings/legacy storage (default: localStorage). */
  storage?: StorageLike | null;
  /** Force or skip crash-loop safe mode (default: detected). */
  safeMode?: boolean;
  /**
   * Open this project instead of the legacy single saved world. World and
   * chat are then persisted through `onSave` (debounced) instead of
   * localStorage.
   */
  project?: StudioProject;
  /** Persist the project; resolves to an error message, or null on success. */
  onSave?: (world: WorldDoc, chat: readonly ChatEntry[]) => Promise<string | null>;
  /** Called whenever settings change (lets the app shell follow the theme). */
  onSettings?: (settings: StudioSettings) => void;
  /** Project id (AI preferences are remembered per project). */
  projectId?: string;
  /** AI connection manager (default: the page-wide one). */
  ai?: AiConnection;
}

/** Options of {@link Studio.send}. */
export interface SendOptions {
  /** Use the built-in offline planner even when an AI backend is live (templates). */
  offline?: boolean;
  /** Reference images (data URLs) sent with the prompt; at most 4. */
  images?: readonly string[];
}

/** Memory picture of the whole studio (debug handle, memory e2e). */
export interface StudioMemoryReport {
  renderer: RenderMemoryStats | null;
  historyEntries: number;
  historyLimit: number;
  chatEntries: number;
  /** JS heap in use (MB), null where the browser does not report it. */
  heapMB: number | null;
  memory: MemoryState;
  rendererEpoch: number;
  contextLosses: number;
}

/** Application controller. See module docs. */
export class Studio {
  readonly history: History;
  readonly store: StoreApi<StudioState>;
  readonly bridge: AgentBridge;
  /** Hand editing: selection ops, mesh editing, brushes, materials, parameters. */
  readonly editor: Editor;
  private readonly storage: StorageLike | null;
  private readonly sandbox: SandboxRunner | null;
  /** Physics verification in workers (main-thread fallback). */
  private readonly verifier: VerificationService;
  /** Streams verification progress into the store. */
  private readonly liveVerify: LiveVerifyFeed;
  /** Cancels the running panel verification (dispose). */
  private verifyAbort: AbortController | null = null;
  private warmTimer: ReturnType<typeof setTimeout> | null = null;
  private sim: Simulation | null = null;
  /** Bumped per attach so a superseded (StrictMode / remount) attach discards its renderer. */
  private attachGen = 0;
  readonly ai: AiConnection;
  private readonly projectId: string | null;
  private abort: AbortController | null = null;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly cleanups: Array<() => void> = [];
  private readonly simListeners = new Set<(sim: Simulation | null) => void>();

  /** World skipped at boot because the previous session crashed while starting (or `?safe=1`). */
  private readonly skippedWorld: WorldDoc | null;
  /** GPU contexts lost this session (feeds automatic low-memory mode). */
  private contextLosses = 0;
  /** Heap pressure seen this session (latched). */
  private pressure = false;
  /** After a lost WebGPU device the replacement renderer uses WebGL2. */
  private forceWebGL2 = false;
  private readonly recoveries = new RecoveryLimiter();
  private attachCount = 0;
  private memoryTimer: ReturnType<typeof setInterval> | null = null;
  /** Project persistence (null: legacy localStorage world). */
  private readonly onSave: StudioOptions['onSave'] | null;
  /** The save in flight (project mode), so saves never overlap. */
  private saving: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor(opts: StudioOptions = {}) {
    this.storage = opts.storage === undefined ? browserStorage() : opts.storage;
    this.onSave = opts.project && opts.onSave ? opts.onSave : null;
    const saved = opts.project ? opts.project.world : loadWorld(this.storage);
    // Crash-loop guard: never auto-load a world that may have killed the last session.
    const safe = opts.safeMode ?? (previousBootFailed(this.storage) || safeModeRequested());
    this.skippedWorld = safe && saved ? saved : null;
    if (this.skippedWorld) saveRecoveryWorld(this.storage, this.skippedWorld);
    // In safe mode the saved world stays one Undo away (first history entry).
    const initial = saved ?? createStarterWorld();
    const settings = loadSettings(this.storage, systemPrefersDark());
    const memory = decideLowMemory(settings.lowMemory, readMemorySignals());
    this.history = new History(initial, { maxEntries: memory.on ? HISTORY_ENTRIES.low : HISTORY_ENTRIES.normal });
    this.projectId = opts.projectId ?? null;
    this.ai = opts.ai ?? aiConnection();
    this.store = createStudioStore({ chat: opts.project ? [...opts.project.chat] : loadChat(this.storage), settings, panels: initialPanels(), aiPrefs: loadAiPrefs(this.storage, this.projectId) });
    this.store.getState().setMemory({ lowMemory: memory.on, reason: memory.reason, automatic: memory.automatic });
    this.sandbox = createSandbox();
    this.verifier = new VerificationService(createVerifyPool(memory.on), verifyOnMainThread);
    this.liveVerify = new LiveVerifyFeed({
      get: () => this.store.getState().verify,
      set: (patch) => this.store.getState().setVerify(patch),
      head: () => this.history.head,
    });
    this.bridge = new AgentBridge(this.history, this.sandbox, this.verifier);
    this.bridge.verifyListener = this.liveVerify;
    this.editor = new Editor(this, { storage: this.storage });

    this.cleanups.push(
      this.history.subscribe((world) => {
        this.schedulePersist();
        this.store.getState().pruneEntities(new Set(Object.keys(world.entities)));
        const v = this.store.getState().verify;
        if (v.status !== 'idle' && v.status !== 'running' && v.head !== this.history.head) this.sim?.setDiagnostics([]);
      }),
    );
    let lastChat = this.store.getState().chat;
    let lastSettings = this.store.getState().settings;
    let lastPrefs = this.store.getState().aiPrefs;
    this.cleanups.push(
      this.store.subscribe((s) => {
        if (s.aiPrefs === lastPrefs) return;
        lastPrefs = s.aiPrefs;
        saveAiPrefs(this.storage, s.aiPrefs, this.projectId);
        this.updateProviderState();
      }),
      this.ai.store.subscribe(() => this.updateProviderState()),
    );
    this.cleanups.push(
      this.store.subscribe((s) => {
        if (s.chat !== lastChat) {
          lastChat = s.chat;
          if (!s.agentBusy) {
            if (this.onSave) this.schedulePersist();
            else saveChat(this.storage, s.chat);
          }
        }
        if (s.settings !== lastSettings) {
          const prev = lastSettings;
          lastSettings = s.settings;
          saveSettings(this.storage, s.settings);
          opts.onSettings?.(s.settings);
          if (prev.showColliders !== s.settings.showColliders) this.sim?.setShowColliders(s.settings.showColliders);
          if (prev.pointerLock !== s.settings.pointerLock) this.sim?.setPointerLock(s.settings.pointerLock);
          if (prev.lowMemory !== s.settings.lowMemory) this.applyMemory();
          if (prev.backend !== s.settings.backend) void this.restartRenderer('Switching renderer…');
          if (prev.showPerf !== s.settings.showPerf) this.sim?.setStatsWhileEditing(s.settings.showPerf);
        }
      }),
    );
    if (typeof window !== 'undefined') {
      const flush = (): void => void this.flushPersist();
      window.addEventListener('pagehide', flush);
      this.cleanups.push(() => window.removeEventListener('pagehide', flush));
      this.memoryTimer = setInterval(() => this.sampleMemory(), MEMORY_SAMPLE_MS);
    }
    if (memory.on && memory.automatic) this.announceLowMemory(memory.reason);
    if (this.skippedWorld) {
      this.replaceWorld(createStarterWorld(), 'Safe mode: starter world');
      this.store
        .getState()
        .toast('The last session did not start cleanly, so Aether opened the starter world. Press Undo to restore your previous world.', 'info', 12);
    }
  }

  /** Start background work: AI connection probes and shared-world loading. */
  async boot(): Promise<void> {
    void this.loadSharedWorldFromUrl();
    this.updateProviderState();
    await this.ai.refresh();
    this.updateProviderState();
  }

  /** Mirror the resolved connection into the UI's provider chip. */
  private updateProviderState(): void {
    const a = this.ai.store.getState();
    const r = this.ai.resolve(this.store.getState().aiPrefs);
    const checking = a.server.state === 'checking' || (a.bridge.paired && a.bridge.state === 'checking' && r.kind !== 'offline');
    const next = checking ? { status: 'checking' as const, name: r.label } : { status: r.kind !== 'offline' && r.ready ? ('live' as const) : ('offline' as const), name: r.ready ? r.label : 'Offline planner' };
    const cur = this.store.getState().provider;
    if (cur.status !== next.status || cur.name !== next.name) this.store.getState().setProvider(next);
  }

  /** The connection the next prompt will use. */
  resolvedConnection(): ResolvedConnection {
    return this.ai.resolve(this.store.getState().aiPrefs);
  }

  /** The running simulation (null until the viewport is ready). */
  get simulation(): Simulation | null {
    return this.sim;
  }

  /** Listen for the simulation being attached/detached. */
  onSimulation(fn: (sim: Simulation | null) => void): () => void {
    this.simListeners.add(fn);
    return () => this.simListeners.delete(fn);
  }

  // ---------------------------------------------------------------------------
  // Viewport
  // ---------------------------------------------------------------------------

  /** Create the simulation on the viewport canvas. Returns a teardown function. */
  async attachCanvas(canvas: HTMLCanvasElement): Promise<() => void> {
    const st = this.store.getState();
    const gen = ++this.attachGen;
    st.setLoading('Starting renderer…');
    // React StrictMode (development) mounts, unmounts and remounts the viewport in one commit.
    // Yield once so a superseded attach never creates a GPU context at all: two renderers
    // initializing side by side would double the GPU memory peak at startup.
    await Promise.resolve();
    if (gen !== this.attachGen) return () => undefined;
    markBooting(this.storage);
    try {
      const sim = await Simulation.create(
        canvas,
        this.history,
        {
          onStats: (s) => this.store.getState().setStats(s),
          onHud: (hud, time) => {
            const out: Record<string, string> = {};
            for (const k of Object.keys(hud)) out[k] = formatStateValue(hud[k]);
            // Whole seconds: the HUD clock shows seconds, so React only re-renders on visible changes.
            this.store.getState().setGame({ hud: out, time: Math.floor(time) });
          },
          onMessage: (text, duration) => this.store.getState().toast(text, 'game', duration),
          onGameOver: (result, text) => this.store.getState().setGame({ status: result === 'win' ? 'won' : 'lost', text }),
          onPick: (id, additive) => this.pick(id, additive),
          onTransform: (commit) => this.editor.commitGizmo(commit),
          onSynced: () => this.editor.onSynced(),
          onModeChange: (mode) => {
            const s = this.store.getState();
            s.setMode(mode);
            if (mode === 'edit') s.resetGame();
            s.setCameraView(mode === 'play' ? 'follow' : 'orbit');
          },
          onError: (message) => this.store.getState().toast(message, 'error', 6),
          onFatal: (message) => this.store.getState().setFatal(message),
          onContextLost: (info) => {
            if (gen === this.attachGen) this.handleContextLost(info);
          },
          onVoxelHud: (state) => this.store.getState().setVoxelHud(state),
        },
        {
          backend: this.forceWebGL2 ? 'webgl2' : st.settings.backend,
          shadows: st.settings.shadows,
          pointerLock: st.settings.pointerLock,
          lowMemory: st.memory.lowMemory,
          statsWhileEditing: st.settings.showPerf,
          scaleGeometry: !classicEngineRequested(),
          saveBase: this.projectId ?? 'scratch',
          ...(this.sandbox ? { sandbox: this.sandbox } : {}),
          onProgress: (msg) => this.store.getState().setLoading(msg),
        },
      );
      if (gen !== this.attachGen) {
        sim.dispose();
        return () => undefined;
      }
      this.sim = sim;
      this.bridge.attach(sim);
      this.editor.attach(sim);
      // Settings may have changed while the renderer was starting: apply the current ones.
      const now = this.store.getState().settings;
      sim.setShowColliders(now.showColliders);
      sim.setStatsWhileEditing(now.showPerf);
      sim.setPointerLock(now.pointerLock);
      sim.setSelection(this.store.getState().selection);
      this.store.getState().setBackend(sim.backend);
      this.store.getState().setGpu({ tier: sim.renderer.gpu.tier, description: sim.renderer.gpu.description });
      for (const fn of this.simListeners) fn(sim);
      sim.setGizmo(this.store.getState().selection, this.store.getState().tool);
      const unsubSel = this.store.subscribe((s, prev) => {
        if (s.selection !== prev.selection) sim.setSelection(s.selection);
        if (s.selection !== prev.selection || s.tool !== prev.tool) sim.setGizmo(s.selection, s.tool);
      });
      // Only the first renderer flies in; a replacement (recovery, backend switch) just frames the world.
      await sim.frameWorld(this.attachCount++ === 0 ? { flyIn: true } : {});
      // The first world rendered (generation included): this boot is healthy.
      if (gen === this.attachGen) {
        clearBooting(this.storage);
        this.scheduleVerifyWarmup();
      }
      this.store.getState().setLoading(null);
      return () => {
        unsubSel();
        if (this.sim === sim) {
          this.sim = null;
          this.bridge.attach(null);
          this.editor.attach(null);
          for (const fn of this.simListeners) fn(null);
        }
        sim.dispose();
      };
    } catch (err) {
      if (gen !== this.attachGen) return () => undefined;
      log.error('renderer init failed', err);
      // An unsupported browser is not a crash loop; do not force safe mode next time.
      clearBooting(this.storage);
      st.setLoading(null);
      st.setFatal(`This browser could not start WebGPU or WebGL2: ${errorMessage(err)}`);
      return () => undefined;
    }
  }

  /**
   * Replace the renderer: the viewport remounts its canvas and attaches a new
   * simulation (play mode is stopped first). Used for context-loss recovery
   * and backend switches.
   */
  async restartRenderer(message = 'Restarting renderer…'): Promise<void> {
    if (this.sim?.mode === 'play') await this.sim.stop();
    const st = this.store.getState();
    st.setFatal(null);
    st.setLoading(message);
    st.bumpRendererEpoch();
  }

  private handleContextLost(info: ContextLossInfo): void {
    this.contextLosses++;
    // A lost WebGPU device tends to be lost again (driver resets on hybrid GPUs): recover on WebGL2.
    if (info.backend === 'webgpu') this.forceWebGL2 = true;
    const st = this.store.getState();
    if (!this.recoveries.tryAcquire(typeof performance !== 'undefined' ? performance.now() : Date.now())) {
      st.setFatal(`The graphics device keeps resetting (${info.message}). Close other GPU-heavy tabs, then reload the page.`);
      return;
    }
    st.toast(`The graphics context was lost (${info.message}). Restoring the viewport…`, 'info', 6);
    this.applyMemory();
    void this.restartRenderer('Restoring the renderer…');
  }

  /** Re-decide low-memory mode from the setting and the session's signals, and apply it everywhere. */
  private applyMemory(): void {
    const st = this.store.getState();
    const d = decideLowMemory(st.settings.lowMemory, { ...readMemorySignals(), contextLosses: this.contextLosses, pressure: this.pressure });
    const was = st.memory.lowMemory;
    st.setMemory({ lowMemory: d.on, reason: d.reason, automatic: d.automatic });
    this.history.setMaxEntries(d.on ? HISTORY_ENTRIES.low : HISTORY_ENTRIES.normal);
    if (was === d.on) return;
    this.sim?.setLowMemory(d.on);
    if (d.on && d.automatic) this.announceLowMemory(d.reason);
  }

  private announceLowMemory(reason: string | null): void {
    this.store.getState().toast(`Low memory mode is on${reason ? `: ${reason.charAt(0).toLowerCase()}${reason.slice(1)}` : ''}. You can change it in Settings.`, 'info', 8);
  }

  /** Periodic heap check (Chromium reports the heap; elsewhere this is a no-op). */
  private sampleMemory(): void {
    if (this.pressure || this.store.getState().settings.lowMemory !== 'auto') return;
    if (!heapUnderPressure(readMemorySignals())) return;
    this.pressure = true;
    log.warn('JS heap under pressure; switching to low memory mode');
    this.applyMemory();
  }

  /** Memory picture of the studio (debug handle / memory e2e). */
  memoryReport(): StudioMemoryReport {
    const st = this.store.getState();
    const heap = readMemorySignals().heapUsedBytes;
    return {
      renderer: this.sim ? this.sim.memoryStats() : null,
      historyEntries: this.history.size,
      historyLimit: this.history.entryLimit,
      chatEntries: st.chat.length,
      heapMB: heap === undefined ? null : Math.round(heap / (1024 * 1024)),
      memory: st.memory,
      rendererEpoch: st.rendererEpoch,
      contextLosses: this.contextLosses,
    };
  }

  // ---------------------------------------------------------------------------
  // Selection & editing
  // ---------------------------------------------------------------------------

  /** Viewport/outliner selection. */
  pick(id: EntityId | null, additive = false): void {
    const s = this.store.getState();
    // Leaving component editing by clicking another object.
    if (s.meshEdit && id !== s.meshEdit.id) this.editor.mesh.exit();
    if (!id) {
      if (!additive) s.select([]);
      return;
    }
    if (additive) s.select(s.selection.includes(id) ? s.selection.filter((x) => x !== id) : [...s.selection, id]);
    else s.select([id]);
  }

  /** Fly the camera to an entity. */
  focus(id: EntityId): void {
    this.sim?.focus(id);
  }

  /** Commit editor patches (source 'user'). Returns error text, or null on success. */
  commitUser(patches: Patch[] | unknown[], message: string): string | null {
    if (this.store.getState().mode === 'play') return 'Stop the simulation before editing.';
    const r = this.history.commit(patches, message, 'user');
    if (r.errors.length > 0) {
      const text = r.errors.map((e) => e.message).join('; ').slice(0, 300);
      this.store.getState().toast(`Edit rejected: ${text}`, 'error', 5);
      return text;
    }
    return null;
  }

  /** Delete entities (with children). Locked entities are kept. */
  deleteEntities(ids: readonly EntityId[]): void {
    if (ids.length === 0) return;
    const world = this.history.current;
    const live = ids.filter((id) => {
      const e = getEntity(world, id);
      return !!e && e.locked !== true;
    });
    if (live.length === 0) return;
    if (this.commitUser(live.map((id) => ({ op: 'remove', id, recursive: true })), live.length === 1 ? `Delete ${live[0]}` : `Delete ${live.length} entities`) === null) {
      this.store.getState().select([]);
    }
  }

  /** Rename the world. */
  renameWorld(name: string): void {
    const clean = name.replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!clean || clean === this.history.current.name) return;
    this.commitUser([{ op: 'setMeta', name: clean }], `Rename world to "${clean}"`);
  }

  undo(): void {
    if (this.store.getState().mode === 'edit') this.history.undo();
  }

  redo(): void {
    if (this.store.getState().mode === 'edit') this.history.redo();
  }

  /** Time travel to a history entry. */
  checkout(entryId: number): void {
    if (this.store.getState().mode !== 'edit') return;
    try {
      this.history.checkout(entryId);
    } catch (err) {
      this.store.getState().toast(errorMessage(err), 'error');
    }
  }

  /** Create a branch at the current position. */
  branch(name: string): string | null {
    try {
      this.history.branch(name);
      this.store.getState().toast(`Branch "${name}" created`, 'success');
      return null;
    } catch (err) {
      return errorMessage(err);
    }
  }

  /** Switch to an existing branch. */
  switchBranch(name: string): void {
    if (this.store.getState().mode !== 'edit') return;
    try {
      this.history.switchBranch(name);
    } catch (err) {
      this.store.getState().toast(errorMessage(err), 'error');
    }
  }

  /** Replace the world with a fresh starter world (undoable). */
  resetToStarter(): void {
    this.replaceWorld(createStarterWorld(), 'Load starter world');
  }

  /** Replace the whole world as one undoable commit. */
  replaceWorld(world: WorldDoc, message: string): void {
    const current = this.history.current;
    const patches = patchesBetween(current, world);
    if (patches.length === 0) return;
    const r = this.history.commit(patches, message, 'user', { atomic: true });
    if (r.errors.length > 0) {
      this.store.getState().toast(`Could not load world: ${r.errors[0]?.message ?? 'invalid'}`, 'error', 6);
      return;
    }
    if (current !== this.history.current) {
      this.store.getState().select([]);
      void this.sim?.frameWorld();
    }
  }

  // ---------------------------------------------------------------------------
  // Import / export / share
  // ---------------------------------------------------------------------------

  /** Import world JSON text (validated). Resolves to an error message or null. */
  async importText(text: string): Promise<string | null> {
    const r = parseWorldImport(text);
    if (!r.ok) return r.error;
    // Wait for play mode to end so the imported world is framed in edit mode.
    if (this.sim?.mode === 'play') await this.sim.stop();
    this.replaceWorld(r.world, `Import "${r.world.name}"`);
    this.store.getState().toast(`Imported "${r.world.name}"`, 'success');
    return null;
  }

  /** Download the current world as JSON. */
  exportToFile(): void {
    const world = this.history.current;
    downloadText(exportFileName(world), exportWorld(world));
  }

  /** Upload the world to the server and copy a share link. Returns the link or null. */
  async share(): Promise<string | null> {
    const st = this.store.getState();
    try {
      const res = await fetch(API.worlds, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(this.history.current) });
      if (!res.ok) throw new Error(res.status === 413 ? 'world too large to share' : `server responded ${res.status}`);
      const body = (await res.json()) as unknown;
      const id = typeof body === 'object' && body !== null ? (body as Record<string, unknown>)['id'] : undefined;
      if (typeof id !== 'string' || !SHARE_ID.test(id)) throw new Error('unexpected server response');
      const link = `${location.origin}${location.pathname}?world=${id}`;
      try {
        await navigator.clipboard.writeText(link);
        st.toast('Share link copied to clipboard', 'success');
      } catch {
        st.toast(`Share link: ${link}`, 'success', 10);
      }
      return link;
    } catch (err) {
      st.toast(`Sharing needs the Aether server (${errorMessage(err)}). Use Export instead.`, 'error', 6);
      return null;
    }
  }

  private async loadSharedWorldFromUrl(): Promise<void> {
    if (typeof location === 'undefined') return;
    const id = new URLSearchParams(location.search).get('world');
    if (!id) return;
    if (!SHARE_ID.test(id)) {
      this.store.getState().toast('Invalid share link', 'error');
      return;
    }
    try {
      const res = await fetch(`${API.worlds}/${id}`, { headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(res.status === 404 ? 'world not found' : `server responded ${res.status}`);
      const r = validateImportedValue((await res.json()) as unknown);
      if (!r.ok) throw new Error(r.error);
      this.replaceWorld(r.world, `Open shared "${r.world.name}"`);
      this.store.getState().toast(`Opened shared world "${r.world.name}"`, 'success');
      clearShareParam();
    } catch (err) {
      this.store.getState().toast(`Could not open shared world: ${errorMessage(err)}`, 'error', 6);
    }
  }

  // ---------------------------------------------------------------------------
  // Play mode
  // ---------------------------------------------------------------------------

  /** Toggle play/edit. */
  async togglePlay(): Promise<void> {
    const st = this.store.getState();
    if (!this.sim || st.modeBusy) return;
    st.setModeBusy(true);
    try {
      if (this.sim.mode === 'play') await this.sim.stop();
      else {
        st.resetGame();
        await this.sim.play();
      }
    } finally {
      this.store.getState().setModeBusy(false);
    }
  }

  /** Restart the running game. */
  async restart(): Promise<void> {
    this.store.getState().resetGame();
    await this.sim?.restart();
  }

  /** Camera view in play mode. */
  setCameraView(view: 'orbit' | 'follow' | 'firstPerson'): void {
    this.sim?.setCameraView(view);
    this.store.getState().setCameraView(view);
  }

  // ---------------------------------------------------------------------------
  // Verification
  // ---------------------------------------------------------------------------

  /** Run the world's tests + diagnostics headless (in workers) and publish the result live. */
  async runVerify(): Promise<void> {
    const st = this.store.getState();
    if (st.verify.status === 'running') return;
    const head = this.history.head;
    const ctrl = new AbortController();
    this.verifyAbort = ctrl;
    try {
      await this.bridge.verify(this.history.current, { signal: ctrl.signal });
    } finally {
      if (this.verifyAbort === ctrl) this.verifyAbort = null;
    }
    const v = this.store.getState().verify;
    if (this.history.head === head && v.status !== 'idle') this.sim?.setDiagnostics(v.diagnostics);
  }

  /**
   * Prefetch verification physics in a worker once the browser is idle
   * (skipped in low-memory mode; the first check then loads it on demand).
   */
  private scheduleVerifyWarmup(): void {
    if (this.warmTimer !== null || this.store.getState().memory.lowMemory) return;
    this.warmTimer = setTimeout(() => {
      const idle = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
      const warm = (): void => {
        if (!this.disposed) this.verifier.warm(Object.keys(this.history.current.scripts).length > 0);
      };
      if (typeof idle === 'function') idle(warm, { timeout: 4000 });
      else warm();
    }, VERIFY_WARMUP_DELAY_MS);
  }

  // ---------------------------------------------------------------------------
  // Agent
  // ---------------------------------------------------------------------------

  /** Refresh the state of a connection that just failed (fire and forget; probes never throw). */
  private reprobe(kind: ResolvedConnection['kind']): void {
    if (kind === 'bridge') void this.ai.refreshBridge();
    else if (kind === 'server' || kind === 'byok') void this.ai.probeServer();
  }

  /** Send a prompt to the agent and stream its events into the chat. */
  async send(prompt: string, opts: SendOptions = {}): Promise<void> {
    const text = prompt.trim().slice(0, MAX_PROMPT_CHARS);
    const st = this.store.getState();
    if (!text || st.agentBusy) return;
    if (this.sim?.mode === 'play') await this.sim.stop();
    this.sim?.touch();
    // Intent: the turn will verify the world, so load physics in a worker while the model plans.
    this.verifier.warm(Object.keys(this.history.current.scripts).length > 0);
    const prefs = st.aiPrefs;
    const resolved: ResolvedConnection = opts.offline ? { kind: 'offline', label: 'Offline planner', ready: true, vision: false } : this.ai.resolve(prefs);
    const primary = opts.offline ? null : this.ai.createProvider(prefs, resolved);
    const images = (opts.images ?? []).filter((u) => typeof u === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(u)).slice(0, 4);
    const history = buildAgentHistory(st.chat);
    const before = this.history.current;
    st.addUserMessage(text);
    const entryId = st.startAssistant();
    st.setAgentBusy(true);
    const startedAt = performance.now();
    let via = primary ? resolved.label : 'Offline planner';
    st.setAgentRun({ startedAt: Date.now(), via, step: 'Planning…' });
    const push = (view: ChatEventView): void => this.store.getState().pushEvent(entryId, view);
    if (!opts.offline && resolved.kind !== 'offline' && !resolved.ready) {
      push({ type: 'notice', tone: 'warning', text: `${resolved.label} is unavailable (${resolved.reason ?? 'not ready'}). Building with the offline planner instead.` });
    }
    let fell: FallbackNotice | null = null;
    const provider: Provider = primary
      ? createFallbackProvider({
          primary,
          fallback: createOfflinePlanner(),
          onFallback: (n) => {
            fell = n;
            via = 'Offline planner';
            const s = this.store.getState();
            s.setAgentRun(s.agentRun ? { ...s.agentRun, via } : null);
            push({ type: 'notice', tone: 'warning', text: fallbackText(resolved.label, n) });
            // Re-probe in the background so the status badge stops claiming a live connection
            // and the next prompt goes straight to the offline planner instead of retrying.
            this.reprobe(resolved.kind);
          },
        })
      : createOfflinePlanner();
    const abort = new AbortController();
    this.abort = abort;
    let status: 'done' | 'error' | 'aborted' = 'done';
    let session: string | undefined;
    const usage: RunUsage = { inputTokens: 0, outputTokens: 0, calls: 0, models: [] };
    try {
      const repairs = Math.max(0, Math.min(MAX_REPAIRS_SETTING, Math.round(st.settings.repairs)));
      // Small on-device models get the condensed prompt that fits their ~4k-token context.
      const promptProfile: PromptProfile = primary && resolved.kind === 'webllm' ? 'compact' : 'full';
      const buildAsset = primary && resolved.kind === 'local' && resolved.worker && prefs.deep ? this.deepBuilder(entryId, prefs) : undefined;
      const agent = new WorldAgent({ provider, catalogs: agentCatalogs(), resolveGenerator: resolveLibraryGenerator, maxRepairs: Number.isFinite(repairs) ? repairs : MAX_REPAIRS, promptProfile, ...(buildAsset ? { buildAsset } : {}) });
      session = primary && (resolved.kind === 'local' || resolved.kind === 'bridge') ? (projectSessionKey(this.projectId) ?? undefined) : undefined;
      status = await this.streamRun(agent.run(text, this.bridge, { signal: abort.signal, history, ...(images.length > 0 ? { images } : {}), ...(session ? { session } : {}) }), entryId, abort, usage);
      if (status === 'done' && !abort.signal.aborted && this.history.current !== before) {
        // Quality loop: review the result and spend the refinement budget on its weakest points.
        const online = primary !== null && fell === null;
        const result = await this.refine({ entryId, prompt: text, provider, online, critic: online && resolved.vision && prefs.refine > 0 ? primary : null, budget: opts.offline ? 0 : prefs.refine, abort, usage, history, promptProfile, ...(session ? { session } : {}) });
        if (result === 'aborted') status = 'aborted';
      }
      if (abort.signal.aborted) status = 'aborted';
      const after = this.history.current;
      if (isNewWorld(before, after)) void this.sim?.frameWorld();
      else if (after !== before) {
        const d = diffWorlds(before, after);
        const builtFrom = addedVoxelEdits(before, after);
        if (builtFrom !== null && d.added.length === 0) void this.sim?.revealVoxelEdits(builtFrom);
        else void this.sim?.revealEntities([...d.added, ...d.changed]);
      }
    } catch (err) {
      if (abort.signal.aborted || isAbortError(err)) status = 'aborted';
      else {
        status = 'error';
        push({ type: 'error', text: errorMessage(err).slice(0, 600) });
      }
    } finally {
      if (this.abort === abort) this.abort = null;
      push({ type: 'done', inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, calls: usage.calls, ...(usage.models.length > 0 ? { models: [...usage.models] } : {}), ms: Math.round(performance.now() - startedAt), via });
      const s = this.store.getState();
      s.finishAssistant(entryId, status);
      s.setAgentBusy(false);
      s.setAgentRun(null);
      if (this.onSave) this.schedulePersist();
      else saveChat(this.storage, this.store.getState().chat);
    }
  }

  /**
   * Deep build through local AI: the server's coding-agent worker builds the
   * generator in a throwaway workspace (iterating with its checker); progress
   * streams into the chat. The result is validated again by the agent.
   */
  private deepBuilder(entryId: number, prefs: StudioState['aiPrefs']): NonNullable<ConstructorParameters<typeof WorldAgent>[0]['buildAsset']> {
    return async (spec, signal) => {
      const ai = this.ai;
      const { backend, model, effort } = effectiveBridgeChoice(prefs, ai.store.getState().local.backends);
      const turns = prefs.deepTurns;
      const budget = { turns, minutes: Math.min(20, 3 + turns * 2) };
      const push = (text: string): void => {
        this.store.getState().pushEvent(entryId, { type: 'status', text: text.slice(0, 300) });
        this.store.getState().setAgentStep(text.slice(0, 120));
      };
      let jobId: string | null = null;
      const onAbort = (): void => {
        if (jobId) void ai.localApi.cancelJob(jobId).catch(() => undefined);
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      try {
        const job = await ai.localApi.startJob({ kind: 'asset', backend, effort, spec, budget, ...(model ? { model } : {}) });
        jobId = job.id;
        push(`Deep build of "${spec.id}" (up to ${budget.turns} rounds, ${budget.minutes} min)…`);
        const done = await ai.localApi.followJob(job.id, { ...(signal ? { signal } : {}), onEvent: (e) => {
          if (e.phase !== 'queued' || e.seq > 1) push(e.message);
        } });
        if (done.status !== 'done' || !done.result) return { ok: false, error: done.error ?? `the build was ${done.status}` };
        const r = done.result;
        const note = `${r.turns} round${r.turns === 1 ? '' : 's'}${r.checkerPassed ? ', checks passed' : ', checks not passed'}${r.model ? ` · ${r.model}` : ''}${r.usage ? ` · ${r.usage.inputTokens + r.usage.outputTokens} tokens` : ''}`;
        this.store.getState().pushEvent(entryId, { type: 'notice', tone: 'info', text: `Deep build: ${note}`.slice(0, 300) });
        return { ok: true, def: r.def, note };
      } catch (e) {
        if (signal?.aborted) throw e;
        return { ok: false, error: errorMessage(e).slice(0, 300) };
      } finally {
        signal?.removeEventListener('abort', onAbort);
      }
    };
  }

  /** Stream agent events into the chat entry; returns the turn status. The agent's own 'done' is folded into `usage`. */
  private async streamRun(run: AsyncGenerator<AgentEvent>, entryId: number, abort: AbortController, usage: RunUsage): Promise<'done' | 'error' | 'aborted'> {
    let status: 'done' | 'error' | 'aborted' = 'done';
    for await (const event of run) {
      if (event.type === 'done') {
        usage.inputTokens += event.usage.inputTokens;
        usage.outputTokens += event.usage.outputTokens;
        usage.calls += event.usage.calls;
        for (const m of event.usage.models ?? []) if (!usage.models.includes(m) && usage.models.length < 6) usage.models.push(m.slice(0, 64));
        continue;
      }
      const view = toEventView(event);
      this.store.getState().pushEvent(entryId, view);
      if (event.type === 'patches') {
        const overwritten = this.bridge.takeOverwrites();
        if (overwritten.length > 0) this.store.getState().pushEvent(entryId, { type: 'notice', tone: 'info', text: `Changed things you set by hand: ${overwritten.join('; ')}. Undo to restore them.`.slice(0, 600) });
      }
      if (view.type === 'status') this.store.getState().setAgentStep(view.text);
      if (event.type === 'error') status = 'error';
      // The Verify panel was already updated live by the bridge's verification listener.
      if (view.type === 'verify') this.sim?.setDiagnostics(view.diagnostics);
      if (abort.signal.aborted) break;
    }
    return abort.signal.aborted ? 'aborted' : status;
  }

  /**
   * The quality loop: assess (heuristics + optional vision critic), and while
   * the score is below the threshold and budget remains, improve — through
   * the connected model (targeted edits) or, offline, with deterministic
   * physical fixes — then assess again.
   */
  private async refine(ctx: {
    entryId: number;
    prompt: string;
    provider: Provider;
    online: boolean;
    critic: Provider | null;
    budget: number;
    abort: AbortController;
    usage: RunUsage;
    history: ReturnType<typeof buildAgentHistory>;
    promptProfile: PromptProfile;
    session?: string;
  }): Promise<'done' | 'aborted'> {
    let applied: string[] = [];
    for (let round = 0; round <= ctx.budget; round++) {
      if (ctx.abort.signal.aborted) return 'aborted';
      this.store.getState().setAgentStep(round === 0 ? 'Reviewing quality…' : 'Re-checking quality…');
      const v = this.store.getState().verify;
      const report = await runQualityPass({
        world: this.history.current,
        prompt: ctx.prompt,
        sim: this.sim,
        ...(v.status === 'passed' || v.status === 'failed' ? { verifyPassed: v.status === 'passed', diagnostics: v.diagnostics } : {}),
        critic: ctx.critic,
        signal: ctx.abort.signal,
      });
      if (ctx.abort.signal.aborted) return 'aborted';
      this.store.getState().pushEvent(ctx.entryId, toQualityView(report, round, applied));
      if (round >= ctx.budget || !needsRefinement(report)) return 'done';
      if (ctx.online) {
        this.store.getState().setAgentStep(`Refining (round ${round + 1} of ${ctx.budget})…`);
        const agent = new WorldAgent({ provider: ctx.provider, catalogs: agentCatalogs(), resolveGenerator: resolveLibraryGenerator, maxRepairs: 1, promptProfile: ctx.promptProfile });
        const history = [...ctx.history, { role: 'user' as const, content: ctx.prompt }, { role: 'assistant' as const, content: 'Built the first version of the world.' }];
        const status = await this.streamRun(agent.run(refineInstruction(report), this.bridge, { signal: ctx.abort.signal, history, ...(ctx.session ? { session: ctx.session } : {}) }), ctx.entryId, ctx.abort, ctx.usage);
        if (status === 'aborted') return 'aborted';
        applied = ['targeted edits by the model'];
      } else {
        const sim = this.sim;
        const imp = improvementPatches(this.history.current, report, sim ? (id) => sim.entityBounds(id) : undefined, OFFLINE_FIXES);
        if (imp.patches.length === 0) return 'done';
        const r = this.history.commit(imp.patches, `Refine: ${imp.applied.join(', ')}`.slice(0, 120), 'agent');
        if (r.applied.length === 0) return 'done';
        applied = imp.applied;
        const verify = await this.bridge.verify(this.history.current, { signal: ctx.abort.signal });
        if (ctx.abort.signal.aborted) return 'aborted';
        const view = toEventView({ type: 'verify', passed: verify.passed, summary: verify.summary, report: verify.report });
        this.store.getState().pushEvent(ctx.entryId, view);
        if (view.type === 'verify') this.sim?.setDiagnostics(view.diagnostics);
      }
    }
    return 'done';
  }

  /** Abort the running agent turn. */
  stopAgent(): void {
    this.abort?.abort();
  }

  /** Ask the agent to repair a diagnostic or failing test. */
  fixWithAI(problem: string): void {
    void this.send(`Please fix this physics/verification problem in the current world, then re-run verification: ${problem.slice(0, 600)}`);
  }

  // ---------------------------------------------------------------------------
  // Persistence & teardown
  // ---------------------------------------------------------------------------

  private schedulePersist(): void {
    if (this.disposed) return;
    if (this.persistTimer !== null) clearTimeout(this.persistTimer);
    if (this.onSave) this.store.getState().setSave('unsaved');
    this.persistTimer = setTimeout(() => this.flushPersist(), PERSIST_DEBOUNCE_MS);
  }

  /** Write pending changes now (legacy: localStorage; project: `onSave`, serialized). */
  private flushPersist(): Promise<void> {
    const pending = this.persistTimer !== null;
    if (this.persistTimer !== null) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    if (!this.onSave) {
      saveWorld(this.storage, this.history.current);
      return Promise.resolve();
    }
    if (!pending) return this.saving;
    const save = this.onSave;
    const world = this.history.current;
    const chat = this.store.getState().chat;
    this.store.getState().setSave('saving');
    this.saving = this.saving
      .then(() => save(world, chat))
      .then(
        (err) => {
          // A newer change may already be waiting: only report "saved" when nothing is pending.
          if (err) this.store.getState().setSave('error', err);
          else if (this.persistTimer === null) this.store.getState().setSave('saved');
        },
        (err: unknown) => this.store.getState().setSave('error', errorMessage(err)),
      );
    return this.saving;
  }

  /** Save pending project changes and wait for the write (before leaving the editor). */
  async flush(): Promise<void> {
    await this.flushPersist();
  }

  // ---------------------------------------------------------------------------
  // Thumbnails, placement, camera presets, touch input
  // ---------------------------------------------------------------------------

  /** A small WebP/JPEG still of the world for project cards (≤ 60 KB), or null. */
  async captureThumbnail(): Promise<Blob | null> {
    const sim = this.sim;
    if (!sim || sim.mode === 'play' || this.store.getState().loading !== null) return null;
    for (const [w, h] of [[480, 270], [384, 216], [320, 180]] as const) {
      const url = await sim.thumbnail(w, h);
      const blob = url ? dataUrlToBlob(url) : null;
      if (!blob) return null;
      if (fitThumbnail(blob)) return blob;
    }
    return null;
  }

  /** Place a palette item at the camera's focus point (one undoable edit) and select it. */
  addFromPalette(itemId: string): string | null {
    const item = paletteItem(itemId);
    if (!item) return null;
    if (this.store.getState().mode === 'play') {
      this.store.getState().toast('Stop the simulation before adding objects.', 'info');
      return null;
    }
    const at = this.sim ? this.sim.placementPoint() : ([0, 0, 0] as [number, number, number]);
    const entity = paletteEntity(item, this.history.current, at);
    if (this.commitUser([{ op: 'add', entity }], `Add ${item.label.toLowerCase()}`) !== null) return null;
    this.store.getState().select([entity.id]);
    void this.sim?.revealEntities([entity.id]);
    return entity.id;
  }

  /** Cinematic fly-through of the world (edit mode); any camera input stops it. */
  tour(): void {
    if (!this.sim || this.sim.mode === 'play') return;
    if (!this.sim.tour()) this.store.getState().toast('Add something to the world first.', 'info', 3);
  }

  /** Editor camera presets ('reset' re-frames the whole world). */
  viewPreset(preset: 'top' | 'front' | 'side' | 'iso' | 'reset'): void {
    if (!this.sim || this.sim.mode === 'play') return;
    if (preset === 'reset') void this.sim.frameWorld();
    else this.sim.viewPreset(preset);
  }

  /** Release everything (leaving the editor, tests, HMR). Pending changes are written first. */
  dispose(): void {
    if (this.memoryTimer !== null) clearInterval(this.memoryTimer);
    this.memoryTimer = null;
    void this.flushPersist();
    this.disposed = true;
    this.abort?.abort();
    this.verifyAbort?.abort();
    if (this.warmTimer !== null) clearTimeout(this.warmTimer);
    this.warmTimer = null;
    this.verifier.dispose();
    for (const c of this.cleanups.splice(0)) c();
    this.editor.dispose();
    this.sim?.dispose();
    this.sim = null;
    this.sandbox?.dispose();
  }
}

/** Drop `?world=` from the address bar once loaded, so a reload does not import it again. */
function clearShareParam(): void {
  try {
    const url = new URL(location.href);
    url.searchParams.delete('world');
    history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
  } catch {
    /* history unavailable */
  }
}

/** `?safe=1` or `?reset=1` in the URL: start from the starter world. */
function safeModeRequested(): boolean {
  if (typeof location === 'undefined') return false;
  const q = new URLSearchParams(location.search);
  return q.get('safe') === '1' || q.get('reset') === '1';
}

/** `?engine=classic`: draw every layer and sculpture at full detail (no fields, no virtual geometry). */
function classicEngineRequested(): boolean {
  if (typeof location === 'undefined') return false;
  return new URLSearchParams(location.search).get('engine') === 'classic';
}

/** Wait after the first frame before prefetching verification physics (ms). */
const VERIFY_WARMUP_DELAY_MS = 2500;

/** Verification worker pool sized for this device (null without Worker support). */
function createVerifyPool(lowMemory: boolean): VerifyPool | null {
  if (typeof Worker === 'undefined') return null;
  const nav = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { deviceMemory?: number });
  return new VerifyPool({ lanes: verifyLanes({ hardwareConcurrency: nav?.hardwareConcurrency, deviceMemory: nav?.deviceMemory, lowMemory }) });
}

function createSandbox(): SandboxRunner | null {
  try {
    return typeof Worker !== 'undefined' ? createWorkerSandbox({ poolSize: 1 }) : null;
  } catch (err) {
    log.warn('generator sandbox unavailable', err);
    return null;
  }
}
