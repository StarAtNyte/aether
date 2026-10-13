/**
 * Studio — the application controller. Owns History, the UI store, the
 * agent bridge, provider selection and persistence; attaches a Simulation
 * once the viewport canvas exists. React components call into this object
 * and subscribe to History / the store; they never own engine state.
 */
import { History, diffWorlds, getEntity, patchesBetween, type EntityId, type Patch, type WorldDoc } from '@aether/core';
import { WorldAgent, isAbortError, type Provider } from '@aether/agent';
import { createWorkerSandbox, type SandboxRunner } from '@aether/procgen';
import type { StoreApi } from 'zustand/vanilla';
import { API, MAX_PROMPT_CHARS, PERSIST_DEBOUNCE_MS } from '../config';
import { buildAgentHistory, toDiagnostics, toEventView, toTestResults } from '../lib/chat';
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
  saveSettings,
  saveWorld,
  type StorageLike,
} from '../lib/storage';
import { exportFileName, exportWorld, parseWorldImport, validateImportedValue } from '../lib/worldIO';
import { initialPanels } from '../lib/layout';
import { createStudioStore, type StudioState } from '../state/store';
import { AgentBridge, agentCatalogs, runVerification, selectProvider } from './AgentBridge';
import { Simulation } from './Simulation';
import { isNewWorld } from './worldQueries';

const log = createLogger('studio');

/** Share-link world ids (server-generated, 12 base62 chars). */
const SHARE_ID = /^[0-9A-Za-z]{12}$/;
const MAX_HISTORY_ENTRIES = 150;
const MAX_REPAIRS = 2;

/** Application controller. See module docs. */
export class Studio {
  readonly history: History;
  readonly store: StoreApi<StudioState>;
  readonly bridge: AgentBridge;
  private readonly storage: StorageLike | null;
  private readonly sandbox: SandboxRunner | null;
  private sim: Simulation | null = null;
  /** Bumped per attach so a superseded (StrictMode / remount) attach discards its renderer. */
  private attachGen = 0;
  private provider: Provider | null = null;
  private abort: AbortController | null = null;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly cleanups: Array<() => void> = [];
  private readonly simListeners = new Set<(sim: Simulation | null) => void>();

  /** World skipped at boot because the previous session crashed while starting (or `?safe=1`). */
  private readonly skippedWorld: WorldDoc | null;

  constructor(opts: { storage?: StorageLike | null; safeMode?: boolean } = {}) {
    this.storage = opts.storage === undefined ? browserStorage() : opts.storage;
    const saved = loadWorld(this.storage);
    // Crash-loop guard: never auto-load a world that may have killed the last session.
    const safe = opts.safeMode ?? (previousBootFailed(this.storage) || safeModeRequested());
    this.skippedWorld = safe && saved ? saved : null;
    if (this.skippedWorld) saveRecoveryWorld(this.storage, this.skippedWorld);
    // In safe mode the saved world stays one Undo away (first history entry).
    const initial = saved ?? createStarterWorld();
    this.history = new History(initial, { maxEntries: MAX_HISTORY_ENTRIES });
    this.store = createStudioStore({ chat: loadChat(this.storage), settings: loadSettings(this.storage), panels: initialPanels() });
    this.sandbox = createSandbox();
    this.bridge = new AgentBridge(this.history, this.sandbox);

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
    this.cleanups.push(
      this.store.subscribe((s) => {
        if (s.chat !== lastChat) {
          lastChat = s.chat;
          if (!s.agentBusy) saveChat(this.storage, s.chat);
        }
        if (s.settings !== lastSettings) {
          const prev = lastSettings;
          lastSettings = s.settings;
          saveSettings(this.storage, s.settings);
          if (prev.showColliders !== s.settings.showColliders) this.sim?.setShowColliders(s.settings.showColliders);
          if (prev.pointerLock !== s.settings.pointerLock) this.sim?.setPointerLock(s.settings.pointerLock);
          if (prev.lowPower !== s.settings.lowPower) this.sim?.setLowPower(s.settings.lowPower);
          if (prev.showPerf !== s.settings.showPerf) this.sim?.setStatsWhileEditing(s.settings.showPerf);
        }
      }),
    );
    if (typeof window !== 'undefined') {
      const flush = (): void => this.flushPersist();
      window.addEventListener('pagehide', flush);
      this.cleanups.push(() => window.removeEventListener('pagehide', flush));
    }
    if (this.skippedWorld) {
      this.replaceWorld(createStarterWorld(), 'Safe mode: starter world');
      this.store
        .getState()
        .toast('The last session did not start cleanly, so Aether opened the starter world. Press Undo to restore your previous world.', 'info', 12);
    }
  }

  /** Start background work: provider probe and shared-world loading. */
  async boot(): Promise<void> {
    void this.loadSharedWorldFromUrl();
    const choice = await selectProvider();
    this.provider = choice.provider;
    this.store.getState().setProvider({ status: choice.live ? 'live' : 'offline', name: choice.name });
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
          onModeChange: (mode) => {
            const s = this.store.getState();
            s.setMode(mode);
            if (mode === 'edit') s.resetGame();
            s.setCameraView(mode === 'play' ? 'follow' : 'orbit');
          },
          onError: (message) => this.store.getState().toast(message, 'error', 6),
          onFatal: (message) => this.store.getState().setFatal(message),
        },
        {
          preferWebGPU: st.settings.preferWebGPU,
          shadows: st.settings.shadows,
          pointerLock: st.settings.pointerLock,
          lowPower: st.settings.lowPower,
          statsWhileEditing: st.settings.showPerf,
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
      sim.setShowColliders(st.settings.showColliders);
      sim.setSelection(this.store.getState().selection);
      this.store.getState().setBackend(sim.backend);
      for (const fn of this.simListeners) fn(sim);
      const unsubSel = this.store.subscribe((s, prev) => {
        if (s.selection !== prev.selection) sim.setSelection(s.selection);
      });
      await sim.frameWorld({ flyIn: true });
      // The first world rendered (generation included): this boot is healthy.
      if (gen === this.attachGen) clearBooting(this.storage);
      this.store.getState().setLoading(null);
      return () => {
        unsubSel();
        if (this.sim === sim) {
          this.sim = null;
          this.bridge.attach(null);
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

  // ---------------------------------------------------------------------------
  // Selection & editing
  // ---------------------------------------------------------------------------

  /** Viewport/outliner selection. */
  pick(id: EntityId | null, additive = false): void {
    const s = this.store.getState();
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

  /** Delete entities (with children). */
  deleteEntities(ids: readonly EntityId[]): void {
    if (ids.length === 0) return;
    const world = this.history.current;
    const live = ids.filter((id) => getEntity(world, id));
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
    const blob = new Blob([exportWorld(world)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = exportFileName(world);
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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

  /** Run the world's tests + diagnostics headless and publish the result. */
  async runVerify(): Promise<void> {
    const st = this.store.getState();
    if (st.verify.status === 'running') return;
    const head = this.history.head;
    st.setVerify({ status: 'running', summary: '', head });
    const t0 = performance.now();
    const r = await runVerification(this.history.current, this.sim);
    const results = toTestResults(r.report);
    const diagnostics = toDiagnostics(r.report);
    const crashed = 'error' in r.report;
    this.store.getState().setVerify({
      status: crashed ? 'error' : r.passed ? 'passed' : 'failed',
      summary: r.summary,
      results,
      diagnostics,
      head,
      ms: performance.now() - t0,
    });
    if (this.history.head === head) this.sim?.setDiagnostics(diagnostics);
  }

  // ---------------------------------------------------------------------------
  // Agent
  // ---------------------------------------------------------------------------

  /** Send a prompt to the agent and stream its events into the chat. */
  async send(prompt: string): Promise<void> {
    const text = prompt.trim().slice(0, MAX_PROMPT_CHARS);
    const st = this.store.getState();
    if (!text || st.agentBusy) return;
    if (this.sim?.mode === 'play') await this.sim.stop();
    const provider = this.provider ?? (await selectProvider()).provider;
    this.provider = provider;
    const history = buildAgentHistory(st.chat);
    const before = this.history.current;
    st.addUserMessage(text);
    const entryId = st.startAssistant();
    st.setAgentBusy(true);
    const abort = new AbortController();
    this.abort = abort;
    let status: 'done' | 'error' | 'aborted' = 'done';
    try {
      const agent = new WorldAgent({ provider, catalogs: agentCatalogs(), maxRepairs: MAX_REPAIRS });
      for await (const event of agent.run(text, this.bridge, { signal: abort.signal, history })) {
        const view = toEventView(event);
        this.store.getState().pushEvent(entryId, view);
        if (event.type === 'error') status = 'error';
        if (view.type === 'verify') {
          this.store.getState().setVerify({ status: view.passed ? 'passed' : 'failed', summary: view.summary, results: view.results, diagnostics: view.diagnostics, head: this.history.head, ms: 0 });
          this.sim?.setDiagnostics(view.diagnostics);
        }
        if (abort.signal.aborted) break;
      }
      if (abort.signal.aborted) status = 'aborted';
      const after = this.history.current;
      if (isNewWorld(before, after)) void this.sim?.frameWorld();
      else if (after !== before) {
        const d = diffWorlds(before, after);
        void this.sim?.revealEntities([...d.added, ...d.changed]);
      }
    } catch (err) {
      if (abort.signal.aborted || isAbortError(err)) status = 'aborted';
      else {
        status = 'error';
        this.store.getState().pushEvent(entryId, { type: 'error', text: errorMessage(err).slice(0, 600) });
      }
    } finally {
      if (this.abort === abort) this.abort = null;
      const s = this.store.getState();
      s.finishAssistant(entryId, status);
      s.setAgentBusy(false);
      saveChat(this.storage, this.store.getState().chat);
    }
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
    if (this.persistTimer !== null) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => this.flushPersist(), PERSIST_DEBOUNCE_MS);
  }

  private flushPersist(): void {
    if (this.persistTimer !== null) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    saveWorld(this.storage, this.history.current);
  }

  /** Release everything (tests / HMR). */
  dispose(): void {
    this.flushPersist();
    this.abort?.abort();
    for (const c of this.cleanups.splice(0)) c();
    this.sim?.dispose();
    this.sim = null;
    this.sandbox?.dispose();
  }
}

/** `?safe=1` or `?reset=1` in the URL: start from the starter world. */
function safeModeRequested(): boolean {
  if (typeof location === 'undefined') return false;
  const q = new URLSearchParams(location.search);
  return q.get('safe') === '1' || q.get('reset') === '1';
}

function createSandbox(): SandboxRunner | null {
  try {
    return typeof Worker !== 'undefined' ? createWorkerSandbox({ poolSize: 1 }) : null;
  } catch (err) {
    log.warn('generator sandbox unavailable', err);
    return null;
  }
}
