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
  /** Triangles the scene holds at full detail (every scatter instance, every sculpture). */
  sceneTriangles: number;
  /** Instances in culled scatter fields, and how many the last frame drew. */
  fieldInstances: number;
  fieldDrawn: number;
  /** Virtual-geometry instances and the triangles their cluster cuts draw. */
  virtualInstances: number;
  virtualDrawn: number;
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
  /** While running: every test in world order, filled in as each one is decided (null otherwise). */
  live?: LiveVerify | null;
  /** Parallel worker lanes of the last run (1 on the main thread). */
  lanes?: number;
  /** True when the last run happened in a worker. */
  worker?: boolean;
  /** Simulated seconds of the last run. */
  simulatedSeconds?: number;
}

/** Live view of a running verification. */
export interface LiveVerify {
  tests: Array<{ id: string; kind: string }>;
  /** Index-aligned with `tests`; null until decided. */
  results: Array<TestResultView | null>;
  lanes: number;
  worker: boolean;
}

/** Backend LLM provider status. */
export interface ProviderState {
  status: 'checking' | 'live' | 'offline';
  name: string;
}

/** Transform gizmo settings (session). */
export interface GizmoSettings {
  space: 'world' | 'local';
  /** Rotate / scale around the selection centre, the active object's origin, or each object's own origin. */
  pivot: 'center' | 'origin' | 'individual';
  /** Grid / angle / scale snapping on (hold Ctrl while dragging to invert). */
  snap: boolean;
  /** Grid step in metres. */
  grid: number;
  /** Angle step in degrees. */
  angle: number;
  /** Scale step. */
  scaleStep: number;
  /** Move snaps onto the surface under the pointer. */
  surface: boolean;
  /** Move snaps the pivot onto the nearest vertex under the pointer. */
  vertex: boolean;
}

/** Mesh component selection while editing a mesh (indices into its vertex / triangle arrays). */
export interface MeshEditState {
  id: string;
  mode: 'vertex' | 'edge' | 'face';
  vertices: number[];
  /** Vertex index pairs. */
  edges: number[];
  faces: number[];
  /** Soft-selection radius in metres (0: off). */
  soft: number;
}

/** Brush settings (sculpt, paint, scatter). */
export interface BrushSettings {
  sculpt: 'raise' | 'lower' | 'smooth' | 'flatten' | 'noise';
  /** Radius in metres. */
  size: number;
  /** 0..1 */
  strength: number;
  falloff: 'smooth' | 'linear' | 'constant' | 'sharp';
  /** Paint colour (#rrggbb). */
  color: string;
  /** Erase instead of paint / place. */
  erase: boolean;
  /** Generator painted by the scatter brush. */
  scatterItem: string;
  /** Scatter instances per square metre. */
  density: number;
}

/** Default gizmo settings. */
export const DEFAULT_GIZMO: Readonly<GizmoSettings> = Object.freeze({ space: 'world', pivot: 'center', snap: false, grid: 0.5, angle: 15, scaleStep: 0.1, surface: false, vertex: false });
/** Default brush settings. */
export const DEFAULT_BRUSH: Readonly<BrushSettings> = Object.freeze({ sculpt: 'raise', size: 3, strength: 0.5, falloff: 'smooth', color: '#5e8c3a', erase: false, scatterItem: 'grass-tuft', density: 1.5 });

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
  /** Transform gizmo options. */
  gizmo: GizmoSettings;
  /** Mesh being edited at component level (null: object mode). */
  meshEdit: MeshEditState | null;
  /** A mesh operation is running (in the compute worker). */
  meshBusy: boolean;
  /** Sculpt / paint / scatter brush settings. */
  brush: BrushSettings;
  /** The material eyedropper is armed: the next viewport click copies a material. */
  materialPick: boolean;

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
  setGizmoSettings(patch: Partial<GizmoSettings>): void;
  setMeshEdit(state: MeshEditState | null): void;
  setMeshBusy(busy: boolean): void;
  setBrush(patch: Partial<BrushSettings>): void;
  setMaterialPick(on: boolean): void;
}

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

/** Merge a gizmo settings patch, keeping every value in range. */
export function mergeGizmo(cur: GizmoSettings, patch: Partial<GizmoSettings>): GizmoSettings {
  const n = { ...cur, ...patch };
  return {
    space: n.space === 'local' ? 'local' : 'world',
    pivot: n.pivot === 'origin' || n.pivot === 'individual' ? n.pivot : 'center',
    snap: n.snap === true,
    grid: clampNum(n.grid, 0.01, 100, DEFAULT_GIZMO.grid),
    angle: clampNum(n.angle, 1, 90, DEFAULT_GIZMO.angle),
    scaleStep: clampNum(n.scaleStep, 0.01, 10, DEFAULT_GIZMO.scaleStep),
    surface: n.surface === true,
    vertex: n.vertex === true,
  };
}

/** Merge a brush settings patch, keeping every value in range. */
export function mergeBrush(cur: BrushSettings, patch: Partial<BrushSettings>): BrushSettings {
  const n = { ...cur, ...patch };
  const modes: ReadonlyArray<BrushSettings['sculpt']> = ['raise', 'lower', 'smooth', 'flatten', 'noise'];
  const falloffs: ReadonlyArray<BrushSettings['falloff']> = ['smooth', 'linear', 'constant', 'sharp'];
  return {
    sculpt: modes.includes(n.sculpt) ? n.sculpt : DEFAULT_BRUSH.sculpt,
    size: clampNum(n.size, 0.1, 100, DEFAULT_BRUSH.size),
    strength: clampNum(n.strength, 0.01, 1, DEFAULT_BRUSH.strength),
    falloff: falloffs.includes(n.falloff) ? n.falloff : DEFAULT_BRUSH.falloff,
    color: typeof n.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(n.color) ? n.color.toLowerCase() : DEFAULT_BRUSH.color,
    erase: n.erase === true,
    scatterItem: typeof n.scatterItem === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(n.scatterItem) ? n.scatterItem : DEFAULT_BRUSH.scatterItem,
    density: clampNum(n.density, 0.05, 20, DEFAULT_BRUSH.density),
  };
}

/** Initial values that callers may override (persisted chat/settings). */
export interface StudioInit {
  chat?: ChatEntry[];
  settings?: StudioSettings;
  /** Initial panel visibility (defaults to both open). */
  panels?: { left: boolean; right: boolean };
  aiPrefs?: AiPrefs;
}

const EMPTY_STATS: PerfStats = { fps: 0, frameMs: 0, drawCalls: 0, triangles: 0, bodies: 0, entities: 0, stepMs: 0, gpuMB: 0, heapMB: 0, sceneTriangles: 0, fieldInstances: 0, fieldDrawn: 0, virtualInstances: 0, virtualDrawn: 0 };
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
    gizmo: { ...DEFAULT_GIZMO },
    meshEdit: null,
    meshBusy: false,
    brush: { ...DEFAULT_BRUSH },
    materialPick: false,

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
      if (s.meshEdit && !existing.has(s.meshEdit.id)) set({ meshEdit: null });
    },
    setGizmoSettings: (patch) => set((s) => ({ gizmo: mergeGizmo(s.gizmo, patch) })),
    setMeshEdit: (meshEdit) => set({ meshEdit }),
    setMeshBusy: (meshBusy) => set((s) => (s.meshBusy === meshBusy ? s : { meshBusy })),
    setBrush: (patch) => set((s) => ({ brush: mergeBrush(s.brush, patch) })),
    setMaterialPick: (materialPick) => set((s) => (s.materialPick === materialPick ? s : { materialPick })),
  }));
}
