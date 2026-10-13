/**
 * UI state (zustand, vanilla store so it is testable without React).
 *
 * The world itself is NOT here: it lives in `History` and React reads it via
 * `useWorld`. This store holds selection, panels, chat, play-mode HUD,
 * stats (pushed at 4 Hz, never per frame), verification results and toasts.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import { MAX_TOASTS } from '../config';
import { appendEvent, trimChat, type ChatEntry, type ChatEventView, type ChatStatus, type DiagnosticView, type TestResultView } from '../lib/chat';
import { DEFAULT_SETTINGS, type StudioSettings } from '../lib/storage';
import { constrainPanels, togglePanels, type LayoutMode } from '../lib/layout';
import type { EditorTool } from '../engine/Simulation';
import { DEFAULT_AI_PREFS, parsePrefs, type AiPrefs } from '../ai/prefs';

/** Editor vs. simulation. */
export type StudioMode = 'edit' | 'play';
/** Inspector tabs (legacy name: the right-hand panel's tabs before the left rail existed). */
export type RightTab = 'outliner' | 'inspector' | 'logic' | 'verify' | 'history';
/** Left panel views, switched from the icon rail. */
export type LeftView = 'agent' | 'objects' | 'assets' | 'logic' | 'verify' | 'history';
/** Project save status shown in the top bar. */
export type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'error';
/** Orbit camera or player view (play mode). */
export type CameraView = 'orbit' | 'follow' | 'firstPerson';

/** Live performance counters (updated at 4 Hz). */
export interface PerfStats {
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  bodies: number;
  entities: number;
  stepMs: number;
  /** Estimated GPU drawing-buffer + shadow memory (MB). */
  gpuMB: number;
  /** JS heap in use (MB; 0 when the browser does not report it). */
  heapMB: number;
}

/** Low-memory mode as currently applied. */
export interface MemoryState {
  lowMemory: boolean;
  /** Why it is on (shown in the UI), null when off. */
  reason: string | null;
  /** On because of detection (setting 'auto'), not because the user chose it. */
  automatic: boolean;
}

/** GPU the renderer runs on. */
export interface GpuState {
  tier: 'discrete' | 'integrated' | 'software' | 'unknown';
  description: string;
}

/** A transient notification. */
export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error' | 'game';
  text: string;
  /** Seconds on screen. */
  duration: number;
  /** Optional action button (e.g. "Undo"). */
  action?: { label: string; run: () => void };
}

/** Latest physics verification. */
export interface VerifyState {
  status: 'idle' | 'running' | 'passed' | 'failed' | 'error';
  summary: string;
  results: TestResultView[];
  diagnostics: DiagnosticView[];
  /** History entry id the result belongs to (stale when the head moved). */
  head: number | null;
  ms: number;
}

/** Backend LLM provider status. */
export interface ProviderState {
  status: 'checking' | 'live' | 'offline';
  name: string;
}

/** Play-mode game state shown in the HUD. */
export interface GameState {
  status: 'playing' | 'won' | 'lost';
  text: string;
  /** HUD values keyed by state key (already formatted). */
  hud: Record<string, string>;
  time: number;
}

/** Full UI state + actions. */
export interface StudioState {
  mode: StudioMode;
  modeBusy: boolean;
  rightTab: RightTab;
  /** Left panel view (icon rail). */
  leftView: LeftView;
  /** Responsive layout mode (set by the editor shell). */
  layout: LayoutMode;
  /** Phone layout: bottom sheet tab. */
  sheetTab: LeftView | 'inspector';
  panels: { left: boolean; right: boolean };
  /** Project autosave state (always 'saved' outside project mode). */
  save: { status: SaveStatus; error: string | null };
  /** Command palette open. */
  paletteOpen: boolean;
  /** Editor tool (select, or a move / rotate / scale gizmo). */
  tool: EditorTool;
  selection: string[];
  outlinerFilter: string;
  chat: ChatEntry[];
  agentBusy: boolean;
  provider: ProviderState;
  backend: 'webgpu' | 'webgl2' | null;
  loading: string | null;
  fatal: string | null;
  stats: PerfStats;
  verify: VerifyState;
  game: GameState;
  cameraView: CameraView;
  toasts: Toast[];
  settings: StudioSettings;
  settingsOpen: boolean;
  /** Section shown when Settings opens. */
  settingsTab: 'general' | 'ai' | 'shortcuts';
  memory: MemoryState;
  gpu: GpuState | null;
  /** Bumped to replace the renderer (context-loss recovery, low-memory switch); the viewport remounts its canvas. */
  rendererEpoch: number;
  /** AI connection / model / effort / refinement for this project. */
  aiPrefs: AiPrefs;
  /** The running agent turn: when it started, which connection it uses and the current step (null when idle). */
  agentRun: { startedAt: number; via: string; step: string } | null;

  setMode(mode: StudioMode): void;
  setModeBusy(busy: boolean): void;
  setRightTab(tab: RightTab): void;
  setLeftView(view: LeftView): void;
  setLayout(layout: LayoutMode): void;
  setSheetTab(tab: LeftView | 'inspector'): void;
  /** Show a left view: opens the left panel (or the phone sheet tab) on it. */
  showLeftView(view: LeftView): void;
  /** Show the inspector: opens the right panel (or the phone sheet tab). */
  showInspector(): void;
  togglePanel(side: 'left' | 'right'): void;
  setPanel(side: 'left' | 'right', open: boolean): void;
  setSave(status: SaveStatus, error?: string | null): void;
  setPaletteOpen(open: boolean): void;
  setTool(tool: EditorTool): void;
  select(ids: readonly string[]): void;
  setOutlinerFilter(filter: string): void;
  addUserMessage(text: string): number;
  startAssistant(): number;
  pushEvent(entryId: number, event: ChatEventView): void;
  finishAssistant(entryId: number, status: ChatStatus): void;
  clearChat(): void;
  setChat(chat: ChatEntry[]): void;
  setAgentBusy(busy: boolean): void;
  setProvider(p: ProviderState): void;
  setBackend(b: 'webgpu' | 'webgl2' | null): void;
  setLoading(msg: string | null): void;
  setFatal(msg: string | null): void;
  setStats(stats: PerfStats): void;
  setVerify(v: Partial<VerifyState>): void;
  setGame(g: Partial<GameState>): void;
  resetGame(): void;
  setCameraView(v: CameraView): void;
  toast(text: string, kind?: Toast['kind'], duration?: number, action?: Toast['action']): number;
  dismissToast(id: number): void;
  updateSettings(patch: Partial<StudioSettings>): void;
  setSettingsOpen(open: boolean): void;
  /** Open Settings on a section. */
  openSettings(tab: 'general' | 'ai' | 'shortcuts'): void;
  setMemory(m: MemoryState): void;
  setGpu(g: GpuState | null): void;
  bumpRendererEpoch(): void;
  setAiPrefs(patch: Partial<AiPrefs>): void;
  setAgentRun(run: { startedAt: number; via: string; step: string } | null): void;
  setAgentStep(step: string): void;
  pruneEntities(existing: ReadonlySet<string>): void;
}

/** Initial values that callers may override (persisted chat/settings). */
export interface StudioInit {
  chat?: ChatEntry[];
  settings?: StudioSettings;
  /** Initial panel visibility (defaults to both open). */
  panels?: { left: boolean; right: boolean };
  aiPrefs?: AiPrefs;
}

const EMPTY_STATS: PerfStats = { fps: 0, frameMs: 0, drawCalls: 0, triangles: 0, bodies: 0, entities: 0, stepMs: 0, gpuMB: 0, heapMB: 0 };
const IDLE_VERIFY: VerifyState = { status: 'idle', summary: '', results: [], diagnostics: [], head: null, ms: 0 };
const INITIAL_GAME: GameState = { status: 'playing', text: '', hud: {}, time: 0 };
const MAX_TOAST_TEXT = 240;

/** Shallow equality of two flat records (numbers/strings). */
function shallowEqual<T extends object>(a: T, b: T): boolean {
  if (a === b) return true;
  const ka = Object.keys(a) as Array<keyof T>;
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) if (!Object.is(a[k], b[k])) return false;
  return true;
}

/** True when merging `patch` into `game` would not change anything (HUD compared by value). */
function changesNothing(game: GameState, patch: Partial<GameState>): boolean {
  for (const k of Object.keys(patch) as Array<keyof GameState>) {
    if (k === 'hud') {
      if (!patch.hud || !shallowEqual(game.hud, patch.hud)) return false;
    } else if (!Object.is(game[k], patch[k])) return false;
  }
  return true;
}

/** Create an independent store instance. */
export function createStudioStore(init: StudioInit = {}): StoreApi<StudioState> {
  let nextChatId = (init.chat ?? []).reduce((m, e) => Math.max(m, e.id), 0) + 1;
  let nextToastId = 1;
  return createStore<StudioState>()((set, get) => ({
    mode: 'edit',
    modeBusy: false,
    rightTab: 'outliner',
    leftView: 'agent',
    layout: 'wide',
    sheetTab: 'agent',
    panels: init.panels ? { left: init.panels.left, right: init.panels.right } : { left: true, right: true },
    save: { status: 'saved', error: null },
    paletteOpen: false,
    tool: 'select',
    selection: [],
    outlinerFilter: '',
    chat: init.chat ? trimChat(init.chat) : [],
    agentBusy: false,
    provider: { status: 'checking', name: '' },
    backend: null,
    loading: 'Starting renderer…',
    fatal: null,
    stats: EMPTY_STATS,
    verify: IDLE_VERIFY,
    game: INITIAL_GAME,
    cameraView: 'orbit',
    toasts: [],
    settings: init.settings ? { ...init.settings } : { ...DEFAULT_SETTINGS },
    settingsOpen: false,
    settingsTab: 'general',
    memory: { lowMemory: false, reason: null, automatic: false },
    gpu: null,
    rendererEpoch: 0,
    aiPrefs: init.aiPrefs ? parsePrefs(init.aiPrefs) : { ...DEFAULT_AI_PREFS },
    agentRun: null,

    setMode: (mode) => set({ mode }),
    setModeBusy: (modeBusy) => set({ modeBusy }),
    setRightTab: (rightTab) => set({ rightTab }),
    setLeftView: (leftView) => set({ leftView }),
    setLayout: (layout) => set((s) => (s.layout === layout ? s : { layout, panels: constrainPanels(layout, s.panels) })),
    setSheetTab: (sheetTab) => set({ sheetTab }),
    showLeftView: (view) =>
      set((s) => {
        if (s.layout === 'phone') return { leftView: view, sheetTab: view };
        const panels = s.panels.left ? s.panels : togglePanels(s.layout, s.panels, 'left');
        return { leftView: view, panels };
      }),
    showInspector: () =>
      set((s) => {
        if (s.layout === 'phone') return { sheetTab: 'inspector' };
        return s.panels.right ? s : { panels: togglePanels(s.layout, s.panels, 'right') };
      }),
    togglePanel: (side) => set((s) => ({ panels: togglePanels(s.layout, s.panels, side) })),
    setPanel: (side, open) => set((s) => (s.panels[side] === open ? s : { panels: { ...s.panels, [side]: open } })),
    setSave: (status, error = null) => set((s) => (s.save.status === status && s.save.error === error ? s : { save: { status, error: error === null ? null : error.slice(0, 240) } })),
    setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
    setTool: (tool) => set({ tool }),
    select: (ids) => {
      const next = [...new Set(ids)];
      const cur = get().selection;
      if (next.length === cur.length && next.every((id, i) => id === cur[i])) return;
      set({ selection: next });
    },
    setOutlinerFilter: (outlinerFilter) => set({ outlinerFilter: outlinerFilter.slice(0, 120) }),
    addUserMessage: (text) => {
      const id = nextChatId++;
      set((s) => ({ chat: trimChat([...s.chat, { id, role: 'user', text }]) }));
      return id;
    },
    startAssistant: () => {
      const id = nextChatId++;
      set((s) => ({ chat: trimChat([...s.chat, { id, role: 'assistant', events: [], status: 'streaming' }]) }));
      return id;
    },
    pushEvent: (entryId, event) =>
      set((s) => ({
        chat: s.chat.map((e) => (e.id === entryId && e.role === 'assistant' ? { ...e, events: appendEvent(e.events, event) } : e)),
      })),
    finishAssistant: (entryId, status) =>
      set((s) => ({
        chat: s.chat.map((e) => {
          if (e.id !== entryId || e.role !== 'assistant') return e;
          // Progress lines are transient: drop them once the turn is over.
          const events: ChatEventView[] = e.events.filter((ev) => ev.type !== 'status');
          if (status === 'aborted') events.push({ type: 'status', text: 'Stopped.' });
          return { ...e, events, status };
        }),
      })),
    clearChat: () => set({ chat: [] }),
    setChat: (chat) => {
      nextChatId = chat.reduce((m, e) => Math.max(m, e.id), nextChatId - 1) + 1;
      set({ chat: trimChat(chat) });
    },
    setAgentBusy: (agentBusy) => set({ agentBusy }),
    setProvider: (provider) => set({ provider }),
    setBackend: (backend) => set({ backend }),
    setLoading: (loading) => set({ loading }),
    setFatal: (fatal) => set({ fatal }),
    setStats: (stats) => set((s) => (shallowEqual(s.stats, stats) ? s : { stats })),
    setVerify: (v) => set((s) => ({ verify: { ...s.verify, ...v } })),
    setGame: (g) => set((s) => (changesNothing(s.game, g) ? s : { game: { ...s.game, ...g } })),
    resetGame: () => set({ game: INITIAL_GAME }),
    setCameraView: (cameraView) => set({ cameraView }),
    toast: (text, kind = 'info', duration = 3, action) => {
      const id = nextToastId++;
      const d = Number.isFinite(duration) ? Math.min(Math.max(duration, 1), 30) : 3;
      set((s) => {
        const toasts = [...s.toasts, { id, kind, text: text.slice(0, MAX_TOAST_TEXT), duration: d, ...(action ? { action } : {}) }];
        return { toasts: toasts.length > MAX_TOASTS ? toasts.slice(toasts.length - MAX_TOASTS) : toasts };
      });
      return id;
    },
    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
    updateSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
    setSettingsOpen: (settingsOpen) => set(settingsOpen ? { settingsOpen } : { settingsOpen, settingsTab: 'general' }),
    openSettings: (settingsTab) => set({ settingsOpen: true, settingsTab }),
    setMemory: (memory) => set((s) => (s.memory.lowMemory === memory.lowMemory && s.memory.reason === memory.reason && s.memory.automatic === memory.automatic ? s : { memory })),
    setGpu: (gpu) => set({ gpu }),
    bumpRendererEpoch: () => set((s) => ({ rendererEpoch: s.rendererEpoch + 1 })),
    setAiPrefs: (patch) => set((s) => ({ aiPrefs: parsePrefs({ ...s.aiPrefs, ...patch }) })),
    setAgentRun: (agentRun) => set({ agentRun }),
    setAgentStep: (step) => set((s) => (s.agentRun && s.agentRun.step !== step ? { agentRun: { ...s.agentRun, step: step.slice(0, 120) } } : s)),
    pruneEntities: (existing) => {
      const s = get();
      const selection = s.selection.filter((id) => existing.has(id));
      if (selection.length !== s.selection.length) set({ selection });
    },
  }));
}
