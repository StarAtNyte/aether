/**
 * Studio — the application controller. Owns History, the UI store, the
 * agent bridge, provider selection and persistence; attaches a Simulation
 * once the viewport canvas exists. React components call into this object
 * and subscribe to History / the store; they never own engine state.
 */
import { recordScore } from '../lib/bestScore';
import type { Proof } from '@aether/playtest/proof';
import { isUserAssetId, worldAssetIds } from '@aether/assets';
import { History, diffWorlds, getEntity, patchesBetween, type EntityId, type GeneratorDef, type Patch, type WorldDoc } from '@aether/core';
import { hasBuilding } from '@aether/arch';
import { EMPTY_MEMORY, OFFLINE_EXAMPLES, WorldAgent, createFallbackProvider, improvementPatches, isAbortError, needsRefinement, refineInstruction, type AgentEvent, type FallbackNotice, type PhotoResumeState, type Provenance, type PromptProfile, type Provider, type QualityFix, type RefineMemory, HARDCORE_PASSES, HARDCORE_SHADER_BUDGET_PATCH, bibleText, heroShots, heroReferencePrompt, judgeCloser, lumaPercentiles, meanTargets, passPrompt, type HardcoreRun, type LumaTargets } from '@aether/agent';
import { createWorkerSandbox, generationLanes, type SandboxRunner } from '@aether/procgen';
import type { StoreApi } from 'zustand/vanilla';
import { API, MAX_PROMPT_CHARS, PERSIST_DEBOUNCE_MS } from '../config';
import { beyondEditCard, buildAgentHistory, toEventView, type ChatEntry, type ChatEventView } from '../lib/chat';
import { yieldToPaint } from '../lib/yieldToPaint';
import { formatStateValue } from '../lib/format';
import { createLogger, errorMessage } from '../lib/log';
import { createStarterWorld, isPristineStarter } from '../lib/starterWorld';
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
  EFFECT_SETTINGS,
  MAX_REPAIRS_SETTING,
  saveSettings,
  saveWorld,
  systemPrefersDark,
  type StorageLike,
  type StudioSettings,
} from '../lib/storage';
import { paletteEntity, paletteItem } from '../lib/palette';
import { dataUrlToBlob, fitThumbnail } from '../lib/thumbnail';
import { downloadBytes, downloadText } from '../lib/download';
import { exportFileName, exportWorld, parseWorldImport, validateImportedValue } from '../lib/worldIO';
import { initialPanels } from '../lib/layout';
import { decideLowMemory, HISTORY_ENTRIES, heapUnderPressure, MEMORY_SAMPLE_MS, readMemorySignals, RecoveryLimiter } from '../lib/memory';
import type { ContextLossInfo, RenderMemoryStats, WatchdogEvent } from '@aether/render';
import { Editor } from './editor/Editor';
import { AssetController } from './assets';
import { TextureController } from './textures';
import { ForgeController } from './forge';
import { NpcChatController, type ChatResult } from './npcChat';
import { ArchController } from './arch';
import { PublishController } from './publish';
import { createStudioStore, type MemoryState, type StudioMode, type StudioState } from '../state/store';
import { AgentBridge, agentCatalogs, createOfflinePlanner, resolveLibraryGenerator, verifyOnMainThread, type VerificationRun } from './AgentBridge';
import { levelToolsFor } from './levelTools';
import type { VerifyTrace } from '@aether/physics';
import { playUiSound } from '../lib/uiSound';
import { planMarks } from '../lib/planMarks';
import { encodeWorldToken, viewerUrl } from '../lib/shareLink';
import { PlaytestController } from './playtest/controller';
import { decodeSession, encodeSession, type ProjectSession } from '../projects/session';
import { LiveVerifyFeed } from './verify/live';
import { VerifyPool } from './verify/pool';
import { VerificationService } from './verify/service';
import { verifyLanes } from './verify/shards';
import { aiConnection, effectiveBridgeChoice, projectSessionKey, type AiConnection, type ResolvedConnection } from '../ai/connection';
import { loadAiPrefs, saveAiPrefs } from '../ai/prefs';
import { runQualityPass, toQualityView } from '../ai/quality';
import { fallbackText } from '../ai/messages';
import { createProviderChain, type ChainLink } from '../ai/chain';
import { composeTiles } from '../ai/decode';
import { prefersReducedMotion, Simulation } from './Simulation';

/** Token usage of one turn (all agent runs of a prompt). */
interface RunUsage {
  inputTokens: number;
  outputTokens: number;
  calls: number;
  /** Part of `inputTokens` read from the provider's prompt cache. */
  cachedInputTokens: number;
  /** Models that answered, in order of first use. */
  models: string[];
}
import { addedVoxelEdits, isNewWorld } from './worldQueries';

const log = createLogger('studio');

/** Share-link world ids (server-generated, 12 base62 chars). */
const SHARE_ID = /^[0-9A-Za-z]{12}$/;
const MAX_REPAIRS = 2;
/** Review rounds on a paid API key (subscription backends have no cap: they stop on approval or stall). */
const REVIEW_ROUNDS_METERED = 10;
/** Compare rounds of a room from a photo on a paid key (each is a vision call; subscriptions have no cap: they stop on agreement or stall). */
const PHOTO_ROUNDS_METERED = 10;
/** Independent judges per look and independent reads of the photo on a paid key (subscriptions use the agent's default of three). */
const PHOTO_JUDGES_METERED = 1;
const PHOTO_READS_METERED = 1;
/** A house is dozens of tool calls (rooms, pieces, fixes): the AI-first run gets room to finish it. */
const REVIEW_MAX_TURNS = 40;
const REVIEW_MAX_TOOL_CALLS = 300;
/** Offline refinement only applies physical and lighting fixes (the offline planner's art direction stays intact). */
const OFFLINE_FIXES: ReadonlySet<QualityFix> = new Set(['ground', 'separate', 'light-night']);

/** A project opened in the studio (see `projects/`). */
export interface StudioProject {
  world: WorldDoc;
  chat: readonly ChatEntry[];
  /** The stored session (undo history, last verdicts), untrusted; see `projects/session.ts`. */
  session?: unknown;
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
  onSave?: (world: WorldDoc, chat: readonly ChatEntry[], session: ProjectSession | null) => Promise<string | null>;
  /** Called whenever settings change (lets the app shell follow the theme). */
  onSettings?: (settings: StudioSettings) => void;
  /** Project id (AI preferences are remembered per project). */
  projectId?: string;
  /** AI connection manager (default: the page-wide one). */
  ai?: AiConnection;
  /** The project opens straight into play (a launched game template): see `SimulationOptions.preloadPlayer`. */
  playOnOpen?: boolean;
}

/** Options of {@link Studio.send}. */
export interface SendOptions {
  /** Use the built-in offline planner even when an AI backend is live (templates). */
  offline?: boolean;
  /** Reference images (data URLs) sent with the prompt; at most 4. */
  images?: readonly string[];
  /**
   * 'auto' (default): the message refines the current world and only a clear "start over" replaces it.
   * 'new': build a new world (templates, the home prompt). 'refine': never replace.
   */
  intent?: 'auto' | 'new' | 'refine';
  /** 'recreate': rebuild the room of the first attached photo (the composer's "Recreate this image"); 'off': never. */
  photo?: 'recreate' | 'off';
  /** Continue the repair of the last room rebuilt from a photo, with the same photo and the saved stage state. */
  continuePhoto?: boolean;
  /** Start playing again once the edit is done (the in-game tweak bar). */
  resumePlay?: boolean;
  /** What the chat shows as the user's message when it differs from the prompt (an answer to a question). */
  echo?: string;
  /** Hardcore mode: the hero shots, references (in `images`) and art bible this pass is judged against. */
  hardcore?: HardcoreRun;
}

/** What the player is told when the renderer gives something up to keep frames smooth (automatic quality only). */
const PERFORMANCE_NOTICE: Readonly<Record<string, string>> = {
  'light-volume': 'Frames were slow: turned off the baked room lighting.',
  cascades: 'Frames were slow: sun shadows are simpler now.',
  'post-medium': 'Frames were slow: lowered the graphics quality a step.',
  'post-off': 'Frames were slow: switched to the fastest graphics mode.',
  effects: 'Frames were slow: fewer particles.',
};

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
/** Delay before the asset catalog is preloaded after the renderer starts (ms). */
const CATALOG_PRELOAD_MS = 1500;
/** Longest the loading poster waits for the first presented frame after the world is framed (ms). */
const FIRST_DRAW_WAIT_MS = 15_000;
/** Longest the loading screen waits for the world to finish preparing before letting the user in anyway (ms). */
const FULL_LOAD_WAIT_MS = 150_000;
/** What the loading screen says while the world finishes preparing. */
const LOADING_STAGE_TEXT = Object.freeze({
  scene: 'Building the world…',
  materials: 'Loading models and textures…',
  render: 'Preparing shaders and geometry…',
  motion: 'Almost ready…',
  capture: 'Almost ready…',
  lighting: 'Lighting the world…',
});

export class Studio {
  readonly history: History;
  readonly store: StoreApi<StudioState>;
  readonly bridge: AgentBridge;
  /** Hand editing: selection ops, mesh editing, brushes, materials, parameters. */
  readonly editor: Editor;
  /** Architecture tools: building views, floor-plan editing, render quality, daylight study. */
  readonly arch: ArchController;
  /** Asset library, user imports, placement and world packages. */
  readonly assets: AssetController;
  /** The project's texture sets (photographed, AI-generated): stored, registered, restored with the world. */
  readonly textures: TextureController;
  /** Image / text → parametric generator (the asset forge). */
  readonly forge: ForgeController;
  /** Free conversation with characters through the connected model (off offline). */
  readonly npcChat: NpcChatController;
  /** Publishing: games, videos, renders, models, floor plans, share links, history, versions. */
  readonly publish: PublishController;
  /** The Verified-playable flow: an autonomous bot plays or walks the world, repairs it, replays its run. */
  readonly playtest: PlaytestController;
  private readonly storage: StorageLike | null;
  private readonly sandbox: SandboxRunner | null;
  /** Physics verification in workers (main-thread fallback). */
  private readonly verifier: VerificationService;
  /** Streams verification progress into the store. */
  private readonly liveVerify: LiveVerifyFeed;
  /** Outcome of the last verification run, for the seal and its motion replay. */
  private lastProof: { trace: VerifyTrace | null; passed: boolean; head: number; tests: number; passedTests: number; seconds: number } | null = null;
  private proofSeq = 0;
  /** What the next prompt can refer to ("it", "the same", "the other one"). Reset with the conversation. */
  private refineMemory: RefineMemory = EMPTY_MEMORY;
  private lastPrompt = '';
  /** The last photo room: the photo (kept in memory only) and the state to continue its repair from. */
  private photoSource: string | null = null;
  private photoResume: PhotoResumeState | null = null;
  /** What the agent last told the user in one line (shown as a toast for edits made while playing). */
  private lastReply = '';
  private proofGen = 0;
  /** The bot's proof for the world on screen (a real passed run), or null; shares and builds carry it. */
  playtestProof(): Promise<Proof | null> {
    return this.playtest.proof();
  }

  /** Cancels the running panel verification (dispose). */
  private verifyAbort: AbortController | null = null;
  private warmTimer: ReturnType<typeof setTimeout> | null = null;
  private sim: Simulation | null = null;
  /** Bumped per attach so a superseded (StrictMode / remount) attach discards its renderer. */
  private attachGen = 0;
  readonly ai: AiConnection;
  /** Id of the open project (null: the legacy single world). */
  readonly projectId: string | null;
  private readonly playOnOpen: boolean;
  private abort: AbortController | null = null;
  /** The last prompt was a small edit applied locally (no quality loop, no proof replay for cosmetic ones). */
  private localEdit: { cosmetic: boolean; head: number } | null = null;
  /** History head when the running turn started (a cosmetic edit keeps checks that described it). */
  private turnHead = -1;
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
    const historyCap = memory.on ? HISTORY_ENTRIES.low : HISTORY_ENTRIES.normal;
    // The project's undo history and verdicts come back with it (never in safe mode, which opened something else).
    const restored = opts.project && !this.skippedWorld && opts.project.session != null ? decodeSession(opts.project.session, initial) : null;
    if (restored?.history) {
      this.history = restored.history;
      this.history.setMaxEntries(historyCap);
    } else {
      this.history = new History(initial, { maxEntries: historyCap });
    }
    this.projectId = opts.projectId ?? null;
    this.playOnOpen = opts.playOnOpen === true;
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
    // The live feed fills the Checks panel; the run's outcome (and motion trace) also feeds the proof seal.
    const live = this.liveVerify;
    this.bridge.verifyListener = {
      start: (w) => live.start(w),
      plan: (p) => live.plan(p),
      result: (i, r) => live.result(i, r),
      end: (run, ms) => {
        live.end(run, ms);
        this.recordProof(run);
      },
    };
    this.bridge.traceProofs = true;
    this.editor = new Editor(this, { storage: this.storage });
    this.arch = new ArchController(this);
    this.assets = new AssetController(this, { storage: this.storage });
    this.textures = new TextureController(this);
    this.bridge.textures = this.textures;
    this.forge = new ForgeController(this);
    this.npcChat = new NpcChatController(this);
    this.publish = new PublishController(this);
    this.playtest = new PlaytestController(this);
    if (restored?.playtest) this.playtest.restore(restored.playtest);
    if (restored?.verify) this.store.getState().setVerify({ ...restored.verify, head: this.history.head, live: null });

    this.cleanups.push(
      this.history.subscribe((world) => {
        this.schedulePersist();
        this.store.getState().pruneEntities(new Set(Object.keys(world.entities)));
        const v = this.store.getState().verify;
        if (v.status !== 'idle' && v.status !== 'running' && v.head !== this.history.head) this.sim?.setDiagnostics([]);
        // An edit makes a running replay stale.
        if (this.lastProof && this.lastProof.head !== this.history.head && !this.store.getState().agentBusy) this.dismissProof();
      }),
    );
    // A new verdict (the bot's or the checks') is saved with the project, so it survives a reload.
    this.cleanups.push(
      this.store.subscribe((s, prev) => {
        if (!this.onSave) return;
        const settled = (now: string, before: string): boolean => now !== before && now !== 'running' && now !== 'idle';
        if (settled(s.playtest.status, prev.playtest.status) || settled(s.verify.status, prev.verify.status) || (s.verify.head !== prev.verify.head && s.verify.status !== 'running')) this.schedulePersist();
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
          if (prev.reduceMotion !== s.settings.reduceMotion) this.sim?.setReducedMotion(s.settings.reduceMotion || prefersReducedMotion());
          if (prev.lowMemory !== s.settings.lowMemory) this.applyMemory();
          if (prev.backend !== s.settings.backend) void this.restartRenderer('Switching renderer…');
          if (prev.showPerf !== s.settings.showPerf) this.sim?.setStatsWhileEditing(s.settings.showPerf);
          if (prev.renderTier !== s.settings.renderTier || prev.motion !== s.settings.motion || prev.effects !== s.settings.effects) this.applyGraphics();
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
    // Paint the processing indicator before GPU setup, and skip superseded StrictMode attaches.
    await yieldToPaint();
    if (gen !== this.attachGen) return () => undefined;
    markBooting(this.storage);
    try {
      const sim = await Simulation.create(
        canvas,
        this.history,
        {
          onStats: (s) => this.store.getState().setStats(s),
          onProcessing: (stage) => { if (gen === this.attachGen) this.store.getState().setProcessing(stage); },
          onQualityTransition: (tier) => { if (gen === this.attachGen) this.store.getState().setQualityApplying(tier); },
          onGraphicsChanged: () => { if (gen === this.attachGen) this.publishGraphicsState(); },
          onHud: (hud, time) => {
            const out: Record<string, string> = {};
            for (const k of Object.keys(hud)) out[k] = formatStateValue(hud[k]);
            // Whole seconds: the HUD clock shows seconds, so React only re-renders on visible changes.
            this.store.getState().setGame({ hud: out, time: Math.floor(time) });
          },
          onMessage: (text, duration) => this.store.getState().toast(text, 'game', duration),
          onNpc: (frame) => this.store.getState().setNpc(frame),
          onInteract: (prompt) => this.store.getState().setInteract(prompt),
          onGameOver: (result, text) => {
            // A game that keeps a score shows it on the end screen, with the best run on this device.
            const raw = this.sim?.logic?.readState('score');
            const score = typeof raw === 'number' && Number.isFinite(raw) ? Math.round(raw) : undefined;
            const w = this.history.current;
            const kept = score !== undefined ? recordScore(`${w.id}:${w.name}`, score) : undefined;
            this.store.getState().setGame({ status: result === 'win' ? 'won' : 'lost', text, ...(score !== undefined && kept ? { score, best: kept.best, record: kept.record } : { score: undefined, best: undefined, record: undefined }) });
          },
          onCombat: (hud) => this.store.getState().setCombat(hud),
          onPick: (id, additive) => this.pick(id, additive),
          onTransform: (commit) => this.editor.commitGizmo(commit),
          onSynced: () => this.editor.onSynced(),
          onModeChange: (mode) => {
            const s = this.store.getState();
            s.setMode(mode);
            this.npcChat.reset();
            if (mode === 'edit') {
              s.resetGame();
              this.sim?.setHeld(false);
            }
            s.setCameraView(mode === 'play' ? (this.history.current.player.mode === 'firstPerson' ? 'firstPerson' : 'follow') : 'orbit');
          },
          onError: (message) => this.store.getState().toast(message, 'error', 6),
          onPerformance: (_level, step, up) => {
            this.store.getState().toast(up ? 'Frames are smooth: gave some graphics quality back.' : (PERFORMANCE_NOTICE[step] ?? 'Lowered the graphics to keep the frame rate up.'), 'info', 6);
            this.publishGraphicsState();
          },
          onFatal: (message) => this.store.getState().setFatal(message),
          onContextLost: (info) => {
            if (gen === this.attachGen) this.handleContextLost(info);
          },
          onWatchdog: (e) => {
            if (gen === this.attachGen) this.handleWatchdog(e);
          },
          onVoxelHud: (state) => this.store.getState().setVoxelHud(state),
          onLightmap: (status) => this.store.getState().setLightmap(status),
        },
        {
          backend: this.forceWebGL2 ? 'webgl2' : st.settings.backend,
          ...(this.forceWebGL2 ? { backendReason: 'device-lost' as const } : {}),
          shadows: st.settings.shadows,
          pointerLock: st.settings.pointerLock,
          lowMemory: st.memory.lowMemory,
          safeMode: st.safeGraphics,
          statsWhileEditing: st.settings.showPerf,
          scaleGeometry: !classicEngineRequested(),
          compressedTextures: !uncompressedTexturesRequested(),
          saveBase: this.projectId ?? 'scratch',
          ...(this.playOnOpen ? { preloadPlayer: true } : {}),
          lightmapBase: `${import.meta.env.BASE_URL ?? '/'}templates/lightmaps/`,
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
      sim.setReducedMotion(now.reduceMotion || prefersReducedMotion());
      sim.setStatsWhileEditing(now.showPerf);
      sim.setPointerLock(now.pointerLock);
      sim.setSelection(this.store.getState().selection);
      this.store.getState().setBackend(sim.backend);
      this.store.getState().setGpu({ tier: sim.renderer.gpu.tier, description: sim.renderer.gpu.description, backend: sim.renderer.gpu.report });
      this.applyGraphics();
      for (const fn of this.simListeners) fn(sim);
      // The asset catalog is not needed for the first frame: load it once the editor has settled.
      setTimeout(() => {
        if (!this.disposed) void this.assets.ready().catch(() => undefined);
      }, CATALOG_PRELOAD_MS);
      sim.setGizmo(this.store.getState().selection, this.store.getState().tool);
      const unsubSel = this.store.subscribe((s, prev) => {
        if (s.selection !== prev.selection) sim.setSelection(s.selection);
        // Clicking one of the outlined candidates answers the question.
        if (s.clarify && s.selection !== prev.selection && s.selection.length === 1 && s.clarify.items.some((i) => i.id === s.selection[0])) this.answerClarify(s.selection[0] as string);
        if (s.selection !== prev.selection || s.tool !== prev.tool) sim.setGizmo(s.selection, s.tool);
      });
      // The world opens close in, on its opening view (not the far overview, the heaviest view to load): the first
      // renderer is placed there at once, a replacement (recovery, backend switch) flies there.
      performance.mark('aether:frameworld-start');
      const firstAttach = this.attachCount === 0;
      await sim.openWorld(this.attachCount++ === 0 ? { duration: 0 } : {});
      // A link with ?tour=1 (a shared world, a gallery showcase) opens straight into the cinematic fly-through.
      if (firstAttach && typeof location !== 'undefined' && new URLSearchParams(location.search).get('tour') === '1') window.setTimeout(() => this.tour(), 1500);
      performance.mark('aether:frameworld-end');
      // The poster stays up until the renderer has presented a frame (programs may still be linking): never an empty canvas.
      for (let waited = 0; sim.renderer.frameCount === 0 && waited < FIRST_DRAW_WAIT_MS && gen === this.attachGen && !this.disposed; waited += 50) await new Promise<void>((r) => setTimeout(r, 50));
      // The first world rendered (generation included): this boot is healthy.
      if (gen === this.attachGen) {
        clearBooting(this.storage);
        this.scheduleVerifyWarmup();
      }
      // No exploring until the world is complete: models, textures, programs and merged batches all in, so the first
      // steps never hitch on a shader link or show objects popping in.
      if (gen === this.attachGen && !this.disposed) {
        this.store.getState().setLoading(LOADING_STAGE_TEXT.render);
        await sim.whenFullyLoaded(FULL_LOAD_WAIT_MS, (stage) => {
          if (gen === this.attachGen && !this.disposed) this.store.getState().setLoading(LOADING_STAGE_TEXT[stage]);
        });
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
    await yieldToPaint();
    if (!this.disposed && !this.store.getState().fatal) st.bumpRendererEpoch();
  }

  /**
   * The viewport stayed blank and the renderer stepped down, or a shader failed to build: say so over the viewport
   * (with the Safe mode switch and the diagnostics), in the console, and as a toast. When even the plainest drawing on
   * WebGPU stays blank, the renderer restarts on WebGL2 once.
   */
  private handleWatchdog(e: WatchdogEvent): void {
    const st = this.store.getState();
    const prev = st.graphicsAlert;
    const steps = [...(prev?.steps ?? []), ...(e.step ? [e.step] : [])];
    log.warn(`graphics: ${e.kind}${e.reason ? ` (${e.reason})` : ''}: ${e.message}`);
    log.warn(`graphics diagnostics:\n${e.diagnostics}`);
    st.setGraphicsAlert({ kind: e.kind, message: e.message, diagnostics: e.diagnostics, steps });
    if (e.webgpu && (e.kind === 'exhausted' || e.step === 'minimal') && !this.forceWebGL2) {
      this.forceWebGL2 = true;
      st.toast('The view stayed blank on WebGPU: restarting on WebGL2.', 'info', 6);
      void this.restartRenderer('Restarting on WebGL2…');
    }
  }

  /** Turn safe graphics (lowest tier, no effects) on or off; remembered on this device. */
  setSafeGraphics(on: boolean): void {
    const st = this.store.getState();
    st.setSafeGraphics(on);
    this.sim?.renderer.setSafeMode(on);
    const a = st.graphicsAlert;
    if (a) st.setGraphicsAlert({ ...a, message: on ? 'Safe mode is on: lowest graphics tier, no effects.' : 'Safe mode is off.', diagnostics: this.sim?.renderer.diagnostics() ?? a.diagnostics });
    else st.toast(on ? 'Safe mode on: lowest graphics, no effects.' : 'Safe mode off.', 'info', 4);
  }

  /** The renderer's diagnostics report (plain text), for the copy button. */
  graphicsDiagnostics(): string {
    return this.sim?.renderer.diagnostics() ?? this.store.getState().graphicsAlert?.diagnostics ?? 'No renderer is running.';
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

  /**
   * Apply the graphics settings (render tier and effect switches) to the renderer and publish what is in
   * effect, so Settings can show it.
   */
  private applyGraphics(): void {
    const sim = this.sim;
    if (!sim) return;
    const st = this.store.getState();
    const r = sim.renderer;
    const overrides: Record<string, boolean> = {};
    for (const k of EFFECT_SETTINGS) {
      const v = st.settings.effects[k];
      if (typeof v === 'boolean') overrides[k] = v;
    }
    r.setRenderTier(st.settings.renderTier);
    r.setMotionProfile(st.settings.motion);
    r.setEffects(overrides);
    this.publishGraphicsState();
  }

  /** Put the tier in effect, the tier the GPU asks for and the performance ladder into the store (the View menu shows them). */
  private publishGraphicsState(): void {
    const r = this.sim?.renderer;
    if (!r) return;
    const st = this.store.getState();
    const gpu = st.gpu ?? { tier: r.gpu.tier, description: r.gpu.description };
    st.setGpu({ ...gpu, backend: r.gpu.report, render: { tier: r.renderTier, auto: r.autoRenderTier, effects: r.intendedEffects, ladder: r.performanceLevel, reason: r.autoTierReason } });
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

  /** Environment fields waiting for the next frame's preview ({@link previewEnvironment}). */
  private envPreview: Partial<WorldDoc['environment']> | null = null;
  private envPreviewFrame: number | null = null;

  /**
   * Show environment fields live while a slider is dragged, without an edit: at most once a frame, and only what is
   * cheap follows (the renderer's live environment). The drag ends with a commit of the value, one undo entry, or with
   * {@link endEnvironmentPreview}.
   */
  previewEnvironment(set: Partial<WorldDoc['environment']>): void {
    this.envPreview = set;
    if (this.envPreviewFrame !== null || typeof requestAnimationFrame !== 'function') return;
    this.envPreviewFrame = requestAnimationFrame(() => {
      this.envPreviewFrame = null;
      const fields = this.envPreview;
      this.envPreview = null;
      if (fields) this.sim?.renderer.setEnvironmentOverride({ ...this.history.current.environment, ...fields }, { live: true });
    });
  }

  /** Stop a preview: `restore` shows the document's environment again (the drag ended without an edit). */
  endEnvironmentPreview(restore: boolean): void {
    if (this.envPreviewFrame !== null) cancelAnimationFrame(this.envPreviewFrame);
    this.envPreviewFrame = null;
    this.envPreview = null;
    if (restore) this.sim?.renderer.restoreEnvironment();
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

  /**
   * True (with a short notice) while the agent is building: history moves would change the world under it, so the
   * agent's summary could end up describing a world that is not there. The controls are disabled too; this guards
   * the keyboard, the command palette and every other caller.
   */
  private blockedByAgent(): boolean {
    if (!this.store.getState().agentBusy) return false;
    this.store.getState().toast('Wait for the agent to finish, or press Stop, before changing the history.', 'info', 3);
    return true;
  }

  undo(): void {
    if (this.store.getState().mode === 'edit' && !this.blockedByAgent()) this.history.undo();
  }

  /** Answer "which one?": select the chosen object and run the question's prompt again. */
  answerClarify(id: string): void {
    const c = this.store.getState().clarify;
    if (!c || this.store.getState().agentBusy) return;
    const label = c.items.find((i) => i.id === id)?.label ?? id;
    this.store.getState().setClarify(null);
    this.sim?.setCandidates([]);
    this.store.getState().select([id]);
    void this.send(c.prompt, { intent: 'refine', echo: label });
  }

  /** Dismiss a pending question (the next prompt starts fresh). */
  dismissClarify(): void {
    if (this.store.getState().clarify === null) return;
    this.store.getState().setClarify(null);
    this.sim?.setCandidates([]);
  }

  redo(): void {
    if (this.store.getState().mode === 'edit' && !this.blockedByAgent()) this.history.redo();
  }

  /** Time travel to a history entry. */
  checkout(entryId: number): void {
    if (this.store.getState().mode !== 'edit' || this.blockedByAgent()) return;
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
    if (this.store.getState().mode !== 'edit' || this.blockedByAgent()) return;
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
    if (this.blockedByAgent()) return;
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
      void this.sim?.openWorld();
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

  /** A room from a photo can be continued: its saved stage state and its photo are still held. */
  canContinuePhoto(): boolean {
    return this.photoResume !== null && this.photoSource !== null;
  }

  /** Download the provenance and assumptions record of a photo room as JSON. */
  exportPhotoRecord(record: Provenance): void {
    const name = exportFileName(this.history.current).replace(/\.aether\.json$/, '.provenance.json');
    downloadText(name, `${JSON.stringify(record, null, 2)}\n`);
  }

  /** Download the current world as JSON. */
  exportToFile(): void {
    const world = this.history.current;
    downloadText(exportFileName(world), exportWorld(world));
  }

  /** Download the world's meshes (static scene) as a binary glTF (.glb). Resolves to an error message or null. */
  async exportGltf(): Promise<string | null> {
    const st = this.store.getState();
    const sim = this.sim;
    if (!sim) return 'The 3D view is not ready yet.';
    if (sim.mode === 'play') return 'Stop playing to export the scene.';
    try {
      const data = await sim.renderer.exportGlb();
      downloadBytes(exportFileName(this.history.current).replace(/\.aether\.json$/, '.glb'), data, 'model/gltf-binary');
      st.toast(`Exported a ${Math.max(1, Math.round(data.byteLength / 1024))} KB glTF model.`, 'success');
      return null;
    } catch (err) {
      const msg = `Could not export glTF: ${errorMessage(err).slice(0, 200)}`;
      st.toast(msg, 'error', 6);
      return msg;
    }
  }

  /**
   * Copy a share link. The world travels inside the link itself (a URL
   * fragment: no upload, works on any static host) and opens read-only with
   * a Remix button; a world too large for a link is uploaded to the server
   * instead when one is available. Returns the link or null.
   */
  async share(): Promise<string | null> {
    const st = this.store.getState();
    const imports = worldAssetIds(this.history.current).filter(isUserAssetId).length;
    const note = imports > 0 ? ` ${imports} imported file${imports > 1 ? 's are' : ' is'} not included (stand-ins appear) — use Export package to share them.` : '';
    const token = await encodeWorldToken(this.history.current).catch(() => null);
    if (token) {
      const link = viewerUrl(token);
      try {
        await navigator.clipboard.writeText(link);
        st.toast(`Link copied: it opens this world read-only, ready to play or remix.${note}`, 'success', note ? 7 : 4);
      } catch {
        st.toast(`Copy this link to share the world: ${link.length > 160 ? `${link.slice(0, 160)}…` : link}`, 'info', 10);
      }
      return link;
    }
    try {
      const res = await fetch(API.worlds, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(this.history.current) });
      if (!res.ok) throw new Error(res.status === 413 ? 'world too large to share' : `server responded ${res.status}`);
      const body = (await res.json()) as unknown;
      const id = typeof body === 'object' && body !== null ? (body as Record<string, unknown>)['id'] : undefined;
      if (typeof id !== 'string' || !SHARE_ID.test(id)) throw new Error('unexpected server response');
      const link = `${location.origin}${location.pathname}?world=${id}`;
      try {
        await navigator.clipboard.writeText(link);
        st.toast(imports > 0 ? `Share link copied. ${imports} imported file${imports > 1 ? 's are' : ' is'} not included (stand-ins appear) — use Export package to share them.` : 'Share link copied to clipboard', 'success', imports > 0 ? 7 : undefined);
      } catch {
        st.toast(`Share link: ${link}`, 'success', 10);
      }
      return link;
    } catch (err) {
      st.toast(`This world is too large for a link and the share server is unavailable (${errorMessage(err)}). Use Export instead.`, 'error', 7);
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
    this.dismissProof();
    if (this.sim.mode !== 'play') playUiSound(st.settings, 'play');
    st.setModeBusy(true);
    const sim = this.sim;
    try {
      await yieldToPaint();
      if (this.disposed || this.sim !== sim) return;
      if (this.sim.mode === 'play') {
        this.sim.setHeld(false);
        await this.sim.stop();
      } else {
        st.resetGame();
        // A world with a title card starts held: the card shows until the player starts.
        const intro = this.history.current.intro !== undefined;
        this.sim.setHeld(intro);
        await this.sim.play();
        // Read the mode afresh: play() may have failed and left the studio editing.
        if (this.simMode() === 'play') this.store.getState().setGame({ intro });
        else this.sim.setHeld(false);
      }
    } finally {
      this.store.getState().setModeBusy(false);
    }
  }

  /** The simulation's current mode (a method, so reads after an await are not narrowed away). */
  private simMode(): StudioMode {
    return this.sim?.mode ?? 'edit';
  }

  /** Dismiss the title card and let the game run. */
  /**
   * The player said something to the character they are talking to. With a
   * connected model the character answers in its own words (capped, plain
   * text); otherwise nothing is sent and the authored dialogue carries on.
   */
  async npcSay(line: string): Promise<ChatResult> {
    const ctx = this.sim?.npcChatContext() ?? null;
    if (!ctx) return { ok: false, reason: 'Nobody is listening.' };
    const result = await this.npcChat.ask(ctx, line);
    if (result.ok && !this.sim?.npcFreeReply(ctx.npc, result.reply)) return { ok: false, reason: 'The conversation ended.' };
    return result;
  }

  startGame(): void {
    this.sim?.setHeld(false);
    this.store.getState().setGame({ intro: false });
  }

  /** Restart the running game: a world with a title card returns to it (Play starts the new run). */
  async restart(): Promise<void> {
    this.store.getState().resetGame();
    const intro = this.history.current.intro !== undefined;
    this.sim?.setHeld(intro);
    await this.sim?.restart({ held: intro });
    if (intro && this.simMode() === 'play') this.store.getState().setGame({ intro: true });
    else this.sim?.setHeld(false);
  }

  /** Camera view in play mode. */
  setCameraView(view: 'orbit' | 'follow' | 'firstPerson'): void {
    this.sim?.setCameraView(view);
    this.store.getState().setCameraView(view);
  }

  // ---------------------------------------------------------------------------
  // Verification
  // ---------------------------------------------------------------------------

  /**
   * Run the world's tests + diagnostics headless (in workers) and publish the result live. `quiet` keeps the seal and
   * the motion replay of the result off the viewport (a background re-check after a playtest repair must not cover
   * the bot's own verdict).
   */
  async runVerify(opts: { quiet?: boolean } = {}): Promise<void> {
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
    if (this.history.head === head && opts.quiet !== true) void this.presentProof();
  }

  /** Remember a finished verification run for the seal and the replay. */
  private recordProof(run: VerificationRun): void {
    if (run.cancelled || 'error' in run.report) {
      this.lastProof = null;
      return;
    }
    const results = run.report.results;
    this.lastProof = {
      trace: run.trace ?? null,
      passed: run.passed,
      head: this.history.head,
      tests: results.length,
      passedTests: results.filter((r) => r.passed).length,
      seconds: run.report.simulatedSeconds,
    };
  }

  /**
   * Show the outcome of the last verification: the seal, then (once the
   * world finished materialising) the ghost replay of its motion.
   */
  async presentProof(): Promise<void> {
    const proof = this.lastProof;
    if (!proof || proof.head !== this.history.head || this.disposed) return;
    const gen = ++this.proofGen;
    const st = this.store.getState();
    if (st.mode === 'play') return;
    st.setProofSeal({ id: ++this.proofSeq, passed: proof.passed, tests: proof.tests, passedTests: proof.passedTests, seconds: proof.seconds, replay: proof.trace !== null });
    if (proof.passed) playUiSound(st.settings, 'proof');
    const sim = this.sim;
    if (!proof.trace || !sim) return;
    // Let grow-in and the camera flight finish first (bounded).
    const deadline = performance.now() + 5000;
    while (sim.renderer.animating && performance.now() < deadline && gen === this.proofGen && !this.disposed) await new Promise((r) => setTimeout(r, 120));
    if (gen !== this.proofGen || this.disposed || this.sim !== sim || this.store.getState().mode === 'play' || proof.head !== this.history.head) return;
    await sim.playProof(proof.trace);
  }

  /** Hide the seal and stop the replay. */
  dismissProof(): void {
    this.proofGen++;
    this.sim?.stopProof();
    if (this.store.getState().proofSeal) this.store.getState().setProofSeal(null);
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
        if (!this.disposed) {
          this.verifier.warm(Object.keys(this.history.current.scripts).length > 0);
          this.playtest.warm();
        }
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
    // "keep refining" continues the photo room from the saved list of objects (the loop stops on a plateau or a round cap, not on perfection).
    if (!opts.continuePhoto && this.photoResume && this.photoSource && /^\s*(please\s+)?(keep|continue) refining\b/i.test(text)) opts = { ...opts, continuePhoto: true, intent: 'refine' };
    if (this.sim?.mode === 'play') await this.sim.stop();
    this.sim?.touch();
    // Intent: the turn will verify the world, so load physics in a worker while the model plans.
    this.verifier.warm(Object.keys(this.history.current.scripts).length > 0);
    const prefs = st.aiPrefs;
    let resolved: ResolvedConnection = opts.offline ? { kind: 'offline', label: 'Offline planner', ready: true, vision: false } : this.ai.resolve(prefs);
    // A status read while the local server restarted (or a probe that timed out) is stale: look again before
    // settling for the offline planner, so a restarted `aether start` is used instead of silently falling back.
    if (!opts.offline && prefs.mode !== 'offline') {
      const conn = this.ai.store.getState();
      const transient = conn.local.state === 'error' || conn.local.state === 'checking' || conn.server.state !== 'live' || conn.bridge.state === 'offline';
      if (!resolved.ready || (prefs.mode === 'auto' && resolved.kind !== 'local' && transient)) {
        // The turn is under way while the connection is looked at again (no second prompt, no idle gap).
        st.setAgentBusy(true);
        await this.ai.refresh().catch(() => undefined);
        resolved = this.ai.resolve(prefs);
      }
    }
    const primary = opts.offline ? null : this.ai.createProvider(prefs, resolved);
    let images = (opts.images ?? []).filter((u) => typeof u === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(u)).slice(0, 4);
    if (opts.continuePhoto && this.photoResume && this.photoSource) images = [this.photoSource];
    else if (images[0]) {
      this.photoSource = images[0];
      this.photoResume = null;
    }
    const history = buildAgentHistory(st.chat);
    const before = this.history.current;
    this.turnHead = this.history.head;
    this.dismissProof();
    playUiSound(st.settings, 'send');
    st.addUserMessage(opts.echo ?? text);
    const entryId = st.startAssistant();
    this.lastPrompt = text;
    this.lastReply = '';
    st.setClarify(null);
    this.sim?.setCandidates([]);
    st.setAgentBusy(true);
    // The planner (online or offline) places library assets: make sure the catalog is in.
    await this.assets.ready().catch(() => undefined);
    const startedAt = performance.now();
    let via = primary ? resolved.label : 'Offline planner';
    st.setAgentRun({ startedAt: Date.now(), via, step: 'Planning…' });
    const push = (view: ChatEventView): void => this.store.getState().pushEvent(entryId, view);
    if (!opts.offline && resolved.kind !== 'offline' && !resolved.ready) {
      push({ type: 'notice', tone: 'warning', text: `${resolved.label} is unavailable (${resolved.reason ?? 'not ready'}). Building with the offline planner instead.` });
    }
    // The chosen assistant first, then the user's other signed-in assistants, then the offline planner.
    let fell: FallbackNotice | null = null;
    const links: ChainLink[] = primary ? [{ label: resolved.label, provider: primary, vision: resolved.vision }, ...this.ai.alternates(prefs, resolved).map((a) => ({ label: a.resolved.label, provider: a.provider, vision: a.resolved.vision }))] : [];
    const chain = primary
      ? createProviderChain(links, createOfflinePlanner(), ({ from, to, notice }) => {
          via = to ? to.label : 'Offline planner';
          if (!to) fell = notice;
          const s = this.store.getState();
          s.setAgentRun(s.agentRun ? { ...s.agentRun, via } : null);
          push({ type: 'notice', tone: 'warning', text: fallbackText(from.label, notice, to?.label) });
          // Re-probe in the background so the status badge stops claiming a live connection
          // and the next prompt goes straight to a working assistant instead of retrying.
          this.reprobe(resolved.kind);
        })
      : null;
    const provider: Provider = chain ?? createOfflinePlanner();
    const abort = new AbortController();
    this.abort = abort;
    let status: 'done' | 'error' | 'aborted' = 'done';
    let session: string | undefined;
    const usage: RunUsage = { inputTokens: 0, outputTokens: 0, calls: 0, cachedInputTokens: 0, models: [] };
    try {
      const repairs = Math.max(0, Math.min(MAX_REPAIRS_SETTING, Math.round(st.settings.repairs)));
      // Small on-device models get the condensed prompt that fits their ~4k-token context.
      const promptProfile: PromptProfile = primary && resolved.kind === 'webllm' ? 'compact' : 'full';
      const buildAsset = primary && resolved.kind === 'local' && resolved.worker && prefs.deep ? this.deepBuilder(entryId, prefs) : undefined;
      // Review loop: the AI looks at every building it makes or edits and fixes it until it judges it right.
      // Subscription backends are not metered, so the loop has no round cap there (it stops when the model
      // approves or progress stalls); paid keys keep a high finite cap. Small on-device models skip it.
      const subscription = resolved.kind === 'bridge' || resolved.kind === 'local';
      const review = primary && promptProfile === 'full' ? { ...(subscription ? {} : { maxRounds: REVIEW_ROUNDS_METERED }), vision: () => chain?.active()?.vision ?? resolved.vision, maxViews: 6, differences: true, crossCheck: true } : undefined;
      // A photo of a room is rebuilt from the photo through the design tools; without an assistant that can see it,
      // nothing is guessed (the offline planner would build some other room) and the user is told so.
      // Each render is scored by a panel of independent judges (median per item, compared with the accepted state):
      // three on a subscription, one on a paid key (still stateless, with the fixed rubric and the relative comparison).
      const photo = primary && promptProfile === 'full' ? { vision: () => chain?.active()?.vision ?? resolved.vision, differences: true, crossCheck: true, harness: true, objects: true, perception: (() => { try { return globalThis.localStorage?.getItem('aether.perception') !== 'off'; } catch { return true; } })(), ...(subscription ? {} : { maxRounds: PHOTO_ROUNDS_METERED, judges: PHOTO_JUDGES_METERED, reads: PHOTO_READS_METERED }) } : { vision: false };
      // Blender on this computer: offered only while the local server reports it ready (never on a hosted page).
      // Loaded on demand (blender/available.ts), so the editor's own chunk does not grow.
      const aiState = this.ai.store.getState();
      const blender = promptProfile === 'full' && primary && aiState.server.local && aiState.local.blender === 'ready' ? await import('../blender/available').then((m) => m.blenderToolsFor(aiState, this.assets)).catch(() => null) : null;
      // The level tools serve the offline planner too: an "onto" move is set down on the surface measured under it.
      const agent = new WorldAgent({ provider, catalogs: agentCatalogs(), resolveGenerator: resolveLibraryGenerator, maxRepairs: Number.isFinite(repairs) ? repairs : MAX_REPAIRS, promptProfile, photo, ...(buildAsset ? { buildAsset } : {}), ...(promptProfile === 'full' && primary ? { importAsset: this.assetImporter(entryId), hubSearch: this.hubSearcher() } : {}), ...(promptProfile === 'full' ? { levelTools: levelToolsFor(() => this.simulation, () => this.sandbox), textures: { images: primary ? this.ai.imageGenerator() : null } } : {}), ...(promptProfile === 'full' && primary ? { brief: {} } : {}), ...(blender ? { blender } : {}), ...(review ? { review, maxTurns: REVIEW_MAX_TURNS, maxToolCalls: REVIEW_MAX_TOOL_CALLS } : {}) });
      session = primary && (resolved.kind === 'local' || resolved.kind === 'bridge') ? (projectSessionKey(this.projectId) ?? undefined) : undefined;
      // The untouched default glade is a placeholder, not something the user made: the first prompt builds a new world.
      const intent = opts.intent ?? (before === this.history.current && st.chat.length === 0 && !this.history.canUndo() && isPristineStarter(before) ? 'new' : 'auto');
      const runOpts = { signal: abort.signal, history, selection: st.selection, memory: this.refineMemory, heading: this.sim?.cameraHeading() ?? 0, intent, ...(images.length > 0 ? { images } : {}), ...(opts.hardcore ? { hardcore: opts.hardcore } : {}), ...(opts.photo || opts.continuePhoto ? { photo: opts.photo ?? ('recreate' as const) } : {}), ...(images.length > 0 ? { photoPermission: 'The user attached this photo and asked for it to be rebuilt as a room in their project; no further terms were stated.' } : {}), ...(opts.continuePhoto && this.photoResume ? { photoResume: this.photoResume } : {}), ...(session ? { session } : {}), steer: () => this.store.getState().takeQueued(), ...(primary && promptProfile === 'full' && prefs.reviewPlan ? { reviewBrief: () => new Promise<{ brief?: unknown; notes?: string } | null>((resolve) => { this.briefAnswer = resolve; }) } : {}) } as const;
      this.localEdit = null;
      status = await this.streamRun(agent.run(text, this.bridge, runOpts), entryId, abort, usage);
      // A targeted edit ("move the shrine", "make the sofa green") is not followed by scene-wide polishing: the quality
      // loop would restyle forests and lights the user did not mention. The edit's own review already looked at it.
      if (status === 'done' && !abort.signal.aborted && this.history.current !== before && this.localEdit === null && agent.lastScope !== 'small') {
        // Quality loop: review the result and spend the refinement budget on its weakest points.
        const online = primary !== null && fell === null;
        const result = hasBuilding(this.history.current) && primary !== null && promptProfile === 'full' ? 'done' : await this.refine({ entryId, prompt: text, provider, online, critic: online && (chain?.active()?.vision ?? false) && prefs.refine > 0 ? (chain?.active()?.provider ?? null) : null, budget: opts.offline ? 0 : prefs.refine, abort, usage, history, promptProfile, ...(session ? { session } : {}) });
        if (result === 'aborted') status = 'aborted';
      }
      if (abort.signal.aborted) status = 'aborted';
      // The offline planner could not map the request: say so with the way out, never leave a bare "done".
      if (status === 'done' && this.history.current === before && this.localEdit === null && (primary === null || fell !== null) && this.store.getState().clarify === null) {
        push({ type: 'notice', tone: 'warning', text: 'Offline mode is limited and nothing was built or changed. Connect an AI to build anything you describe, or try one of these.', offline: { examples: [...OFFLINE_EXAMPLES] } });
      }
      // Stopped part-way: whatever was already applied stays, and the turn says so (Undo removes it).
      if (status === 'aborted' && this.history.current !== before) {
        push({ type: 'notice', tone: 'warning', text: 'Stopped before finishing. The world below is only the part built so far and was not checked. Undo removes it.' });
      }
      const after = this.history.current;
      if (isNewWorld(before, after)) void this.sim?.openWorld();
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
      // Offline answers are not model usage: no fabricated call or token counts.
      const offlineOnly = usage.models.length > 0 && usage.models.every((m) => m === 'aether-mock');
      push({ type: 'done', inputTokens: offlineOnly ? 0 : usage.inputTokens, outputTokens: offlineOnly ? 0 : usage.outputTokens, calls: offlineOnly ? 0 : usage.calls, ...(!offlineOnly && usage.cachedInputTokens > 0 ? { cachedInputTokens: usage.cachedInputTokens } : {}), ...(usage.models.length > 0 ? { models: [...usage.models] } : {}), ms: Math.round(performance.now() - startedAt), via });
      const s = this.store.getState();
      s.finishAssistant(entryId, status);
      s.setAgentBusy(false);
      s.setAgentRun(null);
      if (this.onSave) this.schedulePersist();
      else saveChat(this.storage, this.store.getState().chat);
    }
    // Messages queued while the turn ran and not picked up by it go next, as one message; a stopped turn drops them.
    const waiting = this.store.getState().takeQueued();
    if (waiting.length > 0 && status !== 'aborted' && !this.disposed) void this.send(waiting.join('\n'));
    const local = this.localEdit;
    if (status === 'done' && this.history.current !== before) {
      if (!(local && local.cosmetic)) void this.presentProof();
      // Then the bot plays or walks what was just built (quiet when there is nothing to play).
      void this.playtest.run({ auto: true });
    }
    if (opts.resumePlay && this.lastReply) this.store.getState().toast(this.lastReply.slice(0, 140), status === 'done' ? 'info' : 'error', 4);
    if (opts.resumePlay && this.store.getState().mode === 'edit' && this.sim && !this.disposed) void this.togglePlay();
  }

  /**
   * `import_asset`: the model comes from the local server's SimReady import; its progress goes to the step feed, the
   * status line and a busy toast, and the result is stored with the project (credit included).
   */
  private assetImporter(entryId: number): NonNullable<ConstructorParameters<typeof WorldAgent>[0]['importAsset']> {
    return async (request, o) => {
      const push = (text: string): void => {
        o.onProgress(text);
        this.store.getState().pushEvent(entryId, { type: 'status', text: text.slice(0, 300) });
        this.store.getState().setAgentStep(text.slice(0, 120));
      };
      const r = request.hubId ? await this.assets.importHubModel(request.hubId, { ...(o.signal ? { signal: o.signal } : {}), onProgress: push }) : await this.assets.importModelFromServer(request.query, request.maxSize, { ...(o.signal ? { signal: o.signal } : {}), onProgress: push });
      if (!r.ok) return r;
      return { ok: true, id: r.meta.id, name: r.meta.name, size: r.meta.size ?? [1, 1, 1], triangles: r.meta.triangles ?? 0, credit: r.meta.credit ?? '', licence: r.licence };
    };
  }

  /** The agent's window on the asset hub: ranked hits from the pinned dataset, or the reason it is unavailable. */
  private hubSearcher(): NonNullable<ConstructorParameters<typeof WorldAgent>[0]['hubSearch']> {
    return async (query, o) => {
      const { hubClient } = await import('../assets/hub');
      const r = await (await hubClient()).search(query, { limit: o.limit, ...(o.style ? { style: o.style } : {}), ...(o.maxBytes !== undefined ? { maxBytes: o.maxBytes } : {}) });
      if (!r.ok) return r;
      return { ok: true, total: r.total, hits: r.hits.map(({ item, score }) => ({ score, id: item.id, name: item.name, category: item.category, style: item.style, size: item.size, triangles: item.triangles, bytes: item.bytes, licence: item.licence, author: item.author })) };
    };
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

  /** Resolves the plan the user is reviewing before the build (null: carry on unchanged). */
  private briefAnswer: ((r: { brief?: unknown; notes?: string } | null) => void) | null = null;

  /** The user's answer to a plan shown for review: an edited brief and/or notes, or null to build as planned. */
  answerBrief(r: { brief?: unknown; notes?: string } | null): void {
    const f = this.briefAnswer;
    this.briefAnswer = null;
    f?.(r);
  }

  /** Stream agent events into the chat entry; returns the turn status. The agent's own 'done' is folded into `usage`. */
  private async streamRun(run: AsyncGenerator<AgentEvent>, entryId: number, abort: AbortController, usage: RunUsage): Promise<'done' | 'error' | 'aborted'> {
    let status: 'done' | 'error' | 'aborted' = 'done';
    let shown = this.history.current;
    // A small edit's card says what changed: the reply after it keeps only what the card does not say.
    let card: { summary: string; notes: readonly string[] } | null = null;
    for await (const event of run) {
      if (event.type === 'photo' && event.resume) this.photoResume = event.resume;
      if (event.type === 'done') {
        usage.inputTokens += event.usage.inputTokens;
        usage.cachedInputTokens += event.usage.cachedInputTokens ?? 0;
        usage.outputTokens += event.usage.outputTokens;
        usage.calls += event.usage.calls;
        for (const m of event.usage.models ?? []) if (!usage.models.includes(m) && usage.models.length < 6) usage.models.push(m.slice(0, 64));
        continue;
      }
      if (event.type === 'memory') {
        this.refineMemory = event.memory;
        continue;
      }
      if (event.type === 'history') {
        this.store.getState().pushEvent(entryId, { type: 'message', text: event.action === 'undo' ? 'Undone. Your world is back to how it was.' : 'Redone.' });
        // The agent's own "undo" request: the turn is deciding this, so it is not blocked by the busy guard.
        if (event.action === 'undo') this.history.undo();
        else this.history.redo();
        continue;
      }
      if (event.type === 'clarify') {
        const world = this.history.current;
        const items = event.candidates.flatMap((c) => {
          const e = getEntity(world, c.id);
          if (!e) return [];
          // Above the object as drawn (its bounds), else above its own position.
          const b = this.sim?.entityBounds(c.id) ?? null;
          const position: readonly [number, number, number] = b ? [(b.min[0] + b.max[0]) / 2, b.max[1] + 0.2, (b.min[2] + b.max[2]) / 2] : [e.transform.position[0], e.transform.position[1] + 1, e.transform.position[2]];
          return [{ id: c.id, label: c.label, position }];
        });
        this.store.getState().setClarify({ prompt: this.lastPrompt, text: event.text, items });
        this.sim?.setCandidates(items.map((i) => i.id));
      } else if (event.type === 'edit') {
        this.store.getState().setClarify(null);
        this.localEdit = { cosmetic: event.cosmetic, head: this.history.head };
        // Colours, names and lights cannot change what the physics checks measured: their verdict still holds.
        const v = this.store.getState().verify;
        if (event.cosmetic && v.head !== null && v.head === this.turnHead && v.status !== 'running' && v.status !== 'idle') this.store.getState().setVerify({ head: this.history.head });
      }
      if (event.type === 'edit') this.lastReply = event.summary;
      else if (event.type === 'message' && this.lastReply === '') this.lastReply = event.text;
      if (event.type === 'message' && card) {
        const rest = beyondEditCard(card, event.text);
        card = null;
        if (rest === '') continue;
        if (rest !== event.text) {
          this.store.getState().pushEvent(entryId, { type: 'message', text: rest });
          continue;
        }
      }
      card = event.type === 'edit' ? { summary: event.summary, notes: event.notes } : event.type === 'status' ? card : null;
      const view = toEventView(event, { head: this.history.head });
      if (event.type === 'step' && view.type === 'step') {
        // The "Step N" counter and, for a look at images, small pictures of what the model was shown (never stored).
        this.store.getState().bumpAgentStep(event.label);
        if (event.looked && event.looked.length > 0) {
          const thumbs = await Promise.all(event.looked.slice(0, 6).map(async (l) => ({ label: l.label.slice(0, 60), src: await composeTiles([{ dataUrl: l.dataUrl }], 120).catch(() => null) })));
          const ok = thumbs.filter((t): t is { label: string; src: string } => t.src !== null);
          if (ok.length > 0) view.thumbs = ok;
        }
      }
      this.store.getState().pushEvent(entryId, view);
      if (event.type === 'patches') {
        // Name what was just placed while it materialises (the plan, annotated on the world).
        const now = this.history.current;
        if (now !== shown) {
          const labels = planMarks(isNewWorld(shown, now) ? null : shown, now);
          shown = now;
          if (labels.length > 0) this.store.getState().setPlanMarks({ id: ++this.proofSeq, labels });
        }
        const overwritten = this.bridge.takeOverwrites();
        if (overwritten.length > 0) this.store.getState().pushEvent(entryId, { type: 'notice', tone: 'info', text: `Changed things you set by hand: ${overwritten.join('; ')}. Undo to restore them.`.slice(0, 600) });
      }
      if (view.type === 'status') this.store.getState().setAgentStep(view.text);
      if (view.type === 'photo' && view.phase !== 'done') this.store.getState().setAgentStep(`Photo: ${view.text}`.slice(0, 120));
      if (view.type === 'review' && (view.phase === 'checking' || view.phase === 'fixing')) this.store.getState().setAgentStep(`Review ${view.round}: ${view.text}`.slice(0, 120));
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
        // The same tools as the build (so the same system prompt): the refinement continues the build's conversation.
        const agent = new WorldAgent({ provider: ctx.provider, catalogs: agentCatalogs(), resolveGenerator: resolveLibraryGenerator, maxRepairs: 1, promptProfile: ctx.promptProfile, ...(ctx.promptProfile === 'full' ? { levelTools: levelToolsFor(() => this.simulation, () => this.sandbox) } : {}) });
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
    const session = this.sessionSnapshot();
    this.store.getState().setSave('saving');
    this.saving = this.saving
      .then(() => save(world, chat, session))
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

  /** The session saved with the project: bounded undo history and the verdicts that describe the head world. */
  private sessionSnapshot(): ProjectSession | null {
    try {
      const v = this.store.getState().verify;
      const verify = v.head === this.history.head && (v.status === 'passed' || v.status === 'failed' || v.status === 'error') ? { status: v.status, summary: v.summary, results: v.results, diagnostics: v.diagnostics, ms: v.ms } : null;
      return encodeSession({ history: this.history, playtest: this.playtest.sessionVerdict(), verify });
    } catch (err) {
      log.warn('session snapshot failed', err);
      return null;
    }
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

  /** Sandbox check of a generator (static check + dry run), for the asset forge. */
  validateGenerator(def: GeneratorDef): Promise<{ ok: boolean; error?: string }> {
    return this.bridge.validateGenerator(def);
  }

  /** The generator sandbox (custom generators run only there). */
  get generatorSandbox(): SandboxRunner | null {
    return this.sandbox;
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
    const sim = this.sim;
    if (!sim || sim.mode === 'play') return;
    if (!sim.tour()) {
      this.store.getState().toast('Add something to the world first.', 'info', 3);
      return;
    }
    // Cinema view while it plays: the viewport hides its tools until the tour ends (a pointer, the wheel or Esc stops it).
    this.store.getState().setTouring(true);
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') sim.renderer.stopTour();
    };
    window.addEventListener('keydown', onKey, true);
    const watch = window.setInterval(() => {
      if (sim.renderer.touring && !this.disposed && this.sim === sim) return;
      window.clearInterval(watch);
      window.removeEventListener('keydown', onKey, true);
      this.store.getState().setTouring(false);
    }, 250);
  }

  /**
   * Hardcore mode: refine the current world to match reference pictures. Hero shots are derived from the world, one reference
   * per shot is drawn by the connected image model, luminance targets are measured from the references, and six specialist
   * passes run in the chat one after another, each reviewed against the references side by side. Needs an image model
   * (Codex with a ChatGPT login, or an image API key) and a live AI.
   */
  async hardcoreMode(subject?: string): Promise<void> {
    const st = this.store.getState();
    const world = this.history.current;
    if (st.agentBusy) { st.toast('The assistant is busy. Wait for it, or stop it, then start hardcore mode.', 'info', 5); return; }
    const shots = heroShots(world);
    if (shots.length === 0) { st.toast('Build something first: hardcore mode refines a world to match references.', 'info', 5); return; }
    const images = this.ai.imageGenerator();
    if (!images) { st.toast('Hardcore mode draws its references with an image model: connect Codex (ChatGPT login) or an image API key in Settings, AI connection.', 'error', 8); return; }
    const what = (subject ?? (world.description || world.name)).trim().slice(0, 400);
    st.toast(`Hardcore mode: drawing ${shots.length} reference pictures…`, 'info', 6);
    const refs: string[] = [];
    for (const shot of shots) {
      try {
        const got = await images.generate({ prompt: heroReferencePrompt(what, shot), size: 1024 });
        refs.push(got.dataUrl);
      } catch (err) {
        { st.toast(`Could not draw the references: ${errorMessage(err).slice(0, 160)}`, 'error', 8); return; }
      }
    }
    const lumas: LumaTargets[] = [];
    for (const r of refs) {
      const px = await this.bridge.decodeImage(r, 256).catch(() => null);
      const l = px ? lumaPercentiles(px.data) : null;
      if (l) lumas.push(l);
    }
    const targets = meanTargets(lumas);
    const bible = bibleText(what, shots, targets);
    // Each pass is kept only when a judge finds the hero shots closer to the references than before it.
    const judgeWith = this.directorProvider();
    const refsImage = await this.bridge.composeImages(refs.map((dataUrl) => ({ dataUrl })), { maxSide: 1600 });
    const heroImage = async (): Promise<string | null> => {
      const got = await this.bridge.captureReview(shots, { size: 480 }).catch(() => []);
      return got.length > 0 ? this.bridge.composeImages(got.map((g) => ({ dataUrl: g.dataUrl })), { maxSide: 1600 }) : null;
    };
    // A refined world compiles the full shaded-material cap of the render tier.
    this.history.commit([HARDCORE_SHADER_BUDGET_PATCH], 'Hardcore: hero shader budget', 'agent');
    for (const [i, pass] of HARDCORE_PASSES.entries()) {
      if (this.disposed) return;
      const head = this.history.head;
      const before = judgeWith && refsImage ? await heroImage() : null;
      await this.send(passPrompt(pass, i, bible), { intent: 'refine', images: refs, hardcore: { bible, shots, ...(targets ? { targets } : {}) }, echo: `Hardcore pass ${i + 1} of ${HARDCORE_PASSES.length}: ${pass.title}` });
      const after = before && this.history.head !== head ? await heroImage() : null;
      if (judgeWith && refsImage && before && after) {
        const verdict = await judgeCloser(judgeWith, refsImage, before, after).catch(() => ({ better: 'B' as const, why: '' }));
        if (verdict.better === 'A') {
          while (this.history.head !== head && this.history.canUndo()) this.history.undo();
          this.store.getState().toast(`Hardcore: undid "${pass.title}", it moved the world away from the references.${verdict.why ? ` ${verdict.why.slice(0, 160)}` : ''}`, 'info', 8);
        }
      }
      const last = this.store.getState().chat.at(-1);
      if (last && 'status' in last && last.status === 'aborted') return;
    }
  }

  /** Editor camera presets ('reset' re-frames the whole world). */
  /** Stop a running baked-light bake (the building keeps the probe light). */
  cancelLightBake(): void {
    this.sim?.renderer.cancelLightmapBake();
  }

  /** Set the world's baked light (`environment.lightBake`): one undo step; null puts it back to automatic. */
  setLightBake(quality: 'off' | 'low' | 'medium' | 'high' | null): void {
    const label = quality === null ? 'Baked light: automatic' : quality === 'off' ? 'Baked light: off' : `Baked light: ${quality}`;
    this.commitUser([{ op: 'setEnvironment', set: { lightBake: quality === null ? null : { quality, samples: null } } }], label);
  }

  viewPreset(preset: 'top' | 'front' | 'side' | 'iso' | 'reset'): void {
    if (!this.sim || this.sim.mode === 'play') return;
    if (preset === 'reset') void this.sim.openWorld();
    else this.sim.viewPreset(preset);
  }

  /** Fly to the zoomed-out overview of the whole world, or back to the view it left (edit mode; key O). */
  toggleOverview(): void {
    const sim = this.sim;
    if (!sim || sim.mode === 'play') return;
    void sim.toggleOverview();
  }

  /** A language model for the camera director (null when only the offline planner is available). */
  directorProvider(): Provider | null {
    const prefs = this.store.getState().aiPrefs;
    const resolved = this.ai.resolve(prefs);
    if (resolved.kind === 'offline' || !resolved.ready) return null;
    return this.ai.createProvider(prefs, resolved);
  }

  /** The paired local bridge (a hosted studio publishes to the user's hosting through it), or null. */
  bridgeEndpoint(): { url: string; token: string } | null {
    return this.ai.bridgeEndpoint();
  }

  /** The user's imported files the current world uses (published games carry them). */
  bundledImports(): Promise<Array<{ meta: { id: string; mime: string } & Record<string, unknown>; data: Uint8Array }>> {
    return this.assets.importsFor(this.history.current);
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
    this.playtest.dispose();
    for (const c of this.cleanups.splice(0)) c();
    this.arch.dispose();
    this.publish.dispose();
    this.forge.cancel();
    this.forge.close();
    this.assets.dispose();
    this.textures.dispose();
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

/** `?textures=rgba`: load the library's original images instead of the KTX2 twins (comparisons, diagnostics). */
function uncompressedTexturesRequested(): boolean {
  if (typeof location === 'undefined') return false;
  return new URLSearchParams(location.search).get('textures') === 'rgba';
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
    return typeof Worker !== 'undefined' ? createWorkerSandbox({ poolSize: generationLanes(), maxQueue: 4096 }) : null;
  } catch (err) {
    log.warn('generator sandbox unavailable', err);
    return null;
  }
}
