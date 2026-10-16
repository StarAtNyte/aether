/**
 * UI state (zustand, vanilla store so it is testable without React).
 *
 * The world itself is NOT here: it lives in `History` and React reads it via
 * `useWorld`. This store holds selection, panels, chat, play-mode HUD,
 * stats (pushed at 4 Hz, never per frame), verification results and toasts.
 */
import { createStore } from 'zustand/vanilla';
import { MAX_TOASTS } from '../config';
import { appendEvent, trimChat } from '../lib/chat';
import { DEFAULT_SETTINGS } from '../lib/storage';
import { constrainPanels, togglePanels } from '../lib/layout';
import { DEFAULT_ARCH_UI, mergeArchUi } from './archUi';
import { DEFAULT_AI_PREFS, parsePrefs } from '../ai/prefs';
/** Default gizmo settings. */
export const DEFAULT_GIZMO = Object.freeze({ space: 'world', pivot: 'center', snap: false, grid: 0.5, angle: 15, scaleStep: 0.1, surface: false, vertex: false });
/** Default brush settings. */
export const DEFAULT_BRUSH = Object.freeze({ sculpt: 'raise', size: 3, strength: 0.5, falloff: 'smooth', color: '#5e8c3a', erase: false, scatterItem: 'grass-tuft', density: 1.5 });
function clampNum(v, min, max, fallback) {
    return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}
/** Merge a gizmo settings patch, keeping every value in range. */
export function mergeGizmo(cur, patch) {
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
export function mergeBrush(cur, patch) {
    const n = { ...cur, ...patch };
    const modes = ['raise', 'lower', 'smooth', 'flatten', 'noise'];
    const falloffs = ['smooth', 'linear', 'constant', 'sharp'];
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
const EMPTY_STATS = { fps: 0, frameMs: 0, drawCalls: 0, triangles: 0, bodies: 0, entities: 0, stepMs: 0, gpuMB: 0, heapMB: 0, sceneTriangles: 0, fieldInstances: 0, fieldDrawn: 0, virtualInstances: 0, virtualDrawn: 0 };
const IDLE_VERIFY = { status: 'idle', summary: '', results: [], diagnostics: [], head: null, ms: 0 };
const IDLE_PLAYTEST = { status: 'idle', kind: 'game', head: null, progress: null, sentence: '', repairs: [], findings: [], objectives: [], seconds: 0, ms: 0, replay: false, proven: false, worker: false };
const INITIAL_GAME = { status: 'playing', text: '', hud: {}, time: 0, intro: false };
const MAX_TOAST_TEXT = 240;
/** Shallow equality of two flat records (numbers/strings). */
function shallowEqual(a, b) {
    if (a === b)
        return true;
    const ka = Object.keys(a);
    if (ka.length !== Object.keys(b).length)
        return false;
    for (const k of ka)
        if (!Object.is(a[k], b[k]))
            return false;
    return true;
}
/** True when merging `patch` into `game` would not change anything (HUD compared by value). */
function changesNothing(game, patch) {
    for (const k of Object.keys(patch)) {
        if (k === 'hud') {
            if (!patch.hud || !shallowEqual(game.hud, patch.hud))
                return false;
        }
        else if (!Object.is(game[k], patch[k]))
            return false;
    }
    return true;
}
/** Create an independent store instance. */
export function createStudioStore(init = {}) {
    let nextChatId = (init.chat ?? []).reduce((m, e) => Math.max(m, e.id), 0) + 1;
    let nextToastId = 1;
    return createStore()((set, get) => ({
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
        playtest: IDLE_PLAYTEST,
        replay: null,
        proofSeal: null,
        planMarks: null,
        clarify: null,
        viewer: false,
        game: INITIAL_GAME,
        npc: null,
        voxelHud: null,
        interact: null,
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
        arch: { ...DEFAULT_ARCH_UI },
        setMode: (mode) => set({ mode }),
        setModeBusy: (modeBusy) => set({ modeBusy }),
        setRightTab: (rightTab) => set({ rightTab }),
        setLeftView: (leftView) => set({ leftView }),
        setLayout: (layout) => set((s) => (s.layout === layout ? s : { layout, panels: constrainPanels(layout, s.panels) })),
        setSheetTab: (sheetTab) => set({ sheetTab }),
        showLeftView: (view) => set((s) => {
            if (s.layout === 'phone')
                return { leftView: view, sheetTab: view };
            const panels = s.panels.left ? s.panels : togglePanels(s.layout, s.panels, 'left');
            return { leftView: view, panels };
        }),
        showInspector: () => set((s) => {
            if (s.layout === 'phone')
                return { sheetTab: 'inspector' };
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
            if (next.length === cur.length && next.every((id, i) => id === cur[i]))
                return;
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
        pushEvent: (entryId, event) => set((s) => ({
            chat: s.chat.map((e) => (e.id === entryId && e.role === 'assistant' ? { ...e, events: appendEvent(e.events, event) } : e)),
        })),
        finishAssistant: (entryId, status) => set((s) => ({
            chat: s.chat.map((e) => {
                if (e.id !== entryId || e.role !== 'assistant')
                    return e;
                // Progress lines are transient: drop them once the turn is over.
                const events = e.events.filter((ev) => ev.type !== 'status');
                if (status === 'aborted')
                    events.push({ type: 'status', text: 'Stopped.' });
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
        setPlaytest: (v) => set((s) => ({ playtest: { ...s.playtest, ...v } })),
        setReplay: (replay) => set({ replay }),
        setProofSeal: (proofSeal) => set({ proofSeal }),
        setPlanMarks: (planMarks) => set({ planMarks }),
        setClarify: (clarify) => set({ clarify }),
        setViewer: (viewer) => set({ viewer }),
        setGame: (g) => set((s) => (changesNothing(s.game, g) ? s : { game: { ...s.game, ...g } })),
        resetGame: () => set({ game: INITIAL_GAME, npc: null, interact: null }),
        setNpc: (frame) => set({ npc: frame }),
        setVoxelHud: (v) => set({ voxelHud: v }),
        setInteract: (p) => set((s) => (s.interact === p ? s : { interact: p })),
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
            if (selection.length !== s.selection.length)
                set({ selection });
            if (s.meshEdit && !existing.has(s.meshEdit.id))
                set({ meshEdit: null });
        },
        setGizmoSettings: (patch) => set((s) => ({ gizmo: mergeGizmo(s.gizmo, patch) })),
        setMeshEdit: (meshEdit) => set({ meshEdit }),
        setMeshBusy: (meshBusy) => set((s) => (s.meshBusy === meshBusy ? s : { meshBusy })),
        setBrush: (patch) => set((s) => ({ brush: mergeBrush(s.brush, patch) })),
        setMaterialPick: (materialPick) => set((s) => (s.materialPick === materialPick ? s : { materialPick })),
        setArch: (patch) => set((s) => {
            const arch = mergeArchUi(s.arch, patch);
            return shallowEqual(arch, s.arch) ? s : { arch };
        }),
    }));
}
