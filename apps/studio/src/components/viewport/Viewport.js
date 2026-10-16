import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Centre viewport: the canvas (created imperatively per mount so a renderer
 * never shares a GPU context with a disposed one — StrictMode safe) and its
 * quiet overlays: camera presets and performance (top-left), checks and
 * display options (top-right), the tool dock (bottom-centre), the axis
 * gizmo (bottom-right), the first-use navigation hint, floating labels,
 * the agent progress bar, play HUD and touch controls.
 */
import { lazyBoundary } from '../ErrorBoundary';
import { memo, useEffect, useRef, useState } from 'react';
import { useSimulation, useStudio, useUI, useWorld } from '../../app/context';
import { liveAgentLine } from '../../lib/agentLine';
import { shortcut } from '../../lib/keys';
import { roomLabels, worldLabels } from '../../lib/labels';
import { MAX_LABELS } from '../../engine/viewOverlay';
import { PLAN_MARK_SECONDS } from '../../lib/planMarks';
import { sectionLevel } from '../../state/archUi';
import { ViewOverlay } from '../../engine/viewOverlay';
import { MATERIAL_DRAG_TYPE, parseMaterialDrag } from '../../lib/materials';
import { PALETTE_DRAG_TYPE } from '../../lib/palette';
import { ASSET_DRAG_TYPE, dragState } from '../../editor/library/useLibrary';
import { Icon } from '../Icon';
import { ToolDock } from './ToolDock';
import { ContextBar } from './ContextBar';
import { Menu } from '../ui/Menu';
import { Segmented } from '../ui/Segmented';
import { PerfHud } from './PerfHud';
import { GeometryBadge } from './GeometryBadge';
import { NpcSpeech } from './NpcSpeech';
import { InteractPromptView, PlayHud, TitleCard } from './PlayHud';
import { RevealOverlay } from './RevealOverlay';
import { PlayTweak } from './PlayTweak';
import { ArchBar } from './ArchBar';
import { PlanView } from './PlanView';
import { TouchControls } from './TouchControls';
import { VerifyPill } from './VerifyPill';
import { ProofSeal } from './ProofSeal';
import { PlaytestPill } from './PlaytestPill';
import { ReplayBar } from './ReplayBar';
/** Block-world game HUD (and its stylesheet): loaded only when a voxel game runs. */
const VoxelHud = lazyBoundary(() => import('./VoxelHud').then((m) => ({ default: m.VoxelHud })), { what: 'block tools', fallback: null, variant: 'inline' });
/** Camera presets (edit mode). */
const CameraPresets = memo(function CameraPresets() {
    const studio = useStudio();
    const [preset, setPreset] = useState('iso');
    return (_jsx(Segmented, { label: "Camera", size: "sm", value: preset, onChange: (v) => {
            setPreset(v);
            studio.viewPreset(v);
        }, options: [
            ['iso', '3D'],
            ['top', 'Top'],
            ['front', 'Front'],
            ['side', 'Side'],
        ], titles: { iso: '3D view (1)', top: 'Top view (2)', front: 'Front view (3)', side: 'Side view (4)' } }));
});
/** Fly-through button (edit mode). */
const TourButton = memo(function TourButton() {
    const studio = useStudio();
    return (_jsx("button", { type: "button", className: "vp-btn", "aria-label": "Fly through the world", "data-tip": "Fly through (move the camera to stop)", onClick: () => studio.tour(), children: _jsx(Icon, { name: "camera" }) }));
});
/** Play-mode camera switcher. */
const CameraToggle = memo(function CameraToggle() {
    const studio = useStudio();
    const view = useUI((s) => s.cameraView);
    return (_jsx(Segmented, { label: "Camera", size: "sm", value: view, onChange: (v) => studio.setCameraView(v), options: [
            ['follow', 'Follow'],
            ['firstPerson', 'First person'],
            ['orbit', 'Orbit'],
        ] }));
});
/** Display options menu (top-right). */
const DisplayMenu = memo(function DisplayMenu() {
    const studio = useStudio();
    const s = useUI((x) => x.settings);
    const update = studio.store.getState().updateSettings;
    return (_jsx(Menu, { label: "Display options", align: "end", width: 220, items: [
            { id: 'labels', label: 'Object labels', checked: s.showLabels, shortcut: 'L', onSelect: () => update({ showLabels: !s.showLabels }) },
            { id: 'perf', label: 'Performance', checked: s.showPerf, shortcut: shortcut('Shift+P'), onSelect: () => update({ showPerf: !s.showPerf }) },
            { id: 'colliders', label: 'Colliders', checked: s.showColliders, onSelect: () => update({ showColliders: !s.showColliders }) },
            { id: 'hint', label: 'Navigation hint', checked: s.showNavHint, onSelect: () => update({ showNavHint: !s.showNavHint }) },
        ], trigger: (t) => (_jsx("button", { ...t, type: "button", className: "vp-btn", "aria-label": "Display options", "data-tip": "Display options", "data-tip-align": "end", children: _jsx(Icon, { name: "eye" }) })) }));
});
/** First-use navigation hint (dismissed once, remembered). */
const NavHint = memo(function NavHint() {
    const studio = useStudio();
    const show = useUI((s) => s.settings.showNavHint);
    if (!show)
        return null;
    return (_jsxs("div", { className: "nav-hint", role: "note", children: [_jsxs("span", { className: "nav-hint__item", children: [_jsx(Icon, { name: "mouse" }), _jsxs("span", { children: [_jsx("b", { children: "Drag" }), " rotate"] })] }), _jsxs("span", { className: "nav-hint__item", children: [_jsx(Icon, { name: "hand" }), _jsxs("span", { children: [_jsx("b", { children: "Right-drag" }), " pan"] })] }), _jsxs("span", { className: "nav-hint__item", children: [_jsx(Icon, { name: "zoom" }), _jsxs("span", { children: [_jsx("b", { children: "Scroll" }), " zoom"] })] }), _jsx("button", { type: "button", className: "icon-btn icon-btn--sm", "aria-label": "Dismiss navigation hint", onClick: () => studio.store.getState().updateSettings({ showNavHint: false }), children: _jsx(Icon, { name: "x" }) })] }));
});
/** Agent progress: a hairline bar along the top edge and a status line. */
const BusyIndicator = memo(function BusyIndicator() {
    const busy = useUI((s) => s.agentBusy);
    const line = useUI(liveAgentLine);
    if (!busy)
        return null;
    return (_jsxs(_Fragment, { children: [_jsx("span", { className: "vp-progress", "aria-hidden": "true" }), _jsxs("div", { className: "vp-status", role: "status", "aria-live": "polite", children: [_jsx("span", { className: "vp-status__dot", "aria-hidden": "true" }), _jsx("span", { className: "vp-status__text", children: line })] })] }));
});
/** Axis gizmo + labels driven by the simulation's view listener. */
const ViewOverlays = memo(function ViewOverlays({ playing }) {
    const studio = useStudio();
    const sim = useSimulation();
    const world = useWorld();
    const showLabels = useUI((s) => s.settings.showLabels);
    // Room chips (name · area) while looking into a building: cutaway, walls down, a section or one storey.
    const roomsLevel = useUI((s) => {
        const a = s.arch;
        if (!a.building || a.plan || a.levelMode === 'exploded')
            return undefined;
        if (a.walls === 'up' && a.section === null && a.levelMode !== 'solo')
            return undefined;
        if (a.levelMode === 'solo')
            return a.level;
        return a.section === null ? null : sectionLevel(a.levels, a.section);
    });
    // What the agent just placed is named for a few seconds (then the normal labels return).
    const plan = useUI((s) => s.planMarks);
    // A question about which object an edit means: candidates are numbered where they stand.
    const clarify = useUI((s) => s.clarify);
    const [planShown, setPlanShown] = useState(null);
    useEffect(() => {
        if (!plan)
            return;
        setPlanShown(plan.id);
        const t = setTimeout(() => setPlanShown((cur) => (cur === plan.id ? null : cur)), PLAN_MARK_SECONDS * 1000);
        return () => clearTimeout(t);
    }, [plan]);
    const gizmoRef = useRef(null);
    const layerRef = useRef(null);
    const overlayRef = useRef(null);
    useEffect(() => {
        const svg = gizmoRef.current;
        if (!sim || !svg)
            return;
        const lines = [...svg.querySelectorAll('line[data-axis]')];
        const dots = [...svg.querySelectorAll('g[data-axis]')];
        const overlay = new ViewOverlay(lines.length === 3 ? lines : null, dots.length === 3 ? dots : null, layerRef.current);
        overlayRef.current = overlay;
        sim.setViewListener((cam) => overlay.update(cam));
        return () => {
            sim.setViewListener(null);
            overlay.dispose();
            overlayRef.current = null;
        };
    }, [sim]);
    useEffect(() => {
        if (playing) {
            overlayRef.current?.setLabels([]);
            return;
        }
        if (clarify) {
            overlayRef.current?.setLabels(clarify.items.slice(0, MAX_LABELS).map((c, i) => ({ id: `clarify-${c.id}`, name: String(i + 1), metric: c.label, position: c.position, tone: 'plan' })));
            return;
        }
        if (plan && planShown === plan.id) {
            overlayRef.current?.setLabels(plan.labels.slice(0, MAX_LABELS));
            return;
        }
        const rooms = roomsLevel === undefined ? [] : roomLabels(world, roomsLevel);
        overlayRef.current?.setLabels([...rooms, ...(showLabels ? worldLabels(world) : [])].slice(0, MAX_LABELS));
    }, [world, showLabels, playing, sim, roomsLevel, plan, planShown, clarify]);
    return (_jsxs(_Fragment, { children: [_jsx("div", { className: "vp-labels", ref: layerRef, "aria-hidden": "true", "data-layout-ignore": "" }), _jsx("div", { className: `vp-gizmo${playing ? ' is-hidden' : ''}`, children: _jsx("button", { type: "button", className: "vp-gizmo__btn", onClick: () => studio.viewPreset('reset'), "aria-label": "Reset camera", "data-tip": "Reset camera", "data-kbd": "0", "data-tip-pos": "left", children: _jsxs("svg", { ref: gizmoRef, width: "64", height: "64", viewBox: "0 0 64 64", "aria-hidden": "true", focusable: "false", children: [_jsx("line", { "data-axis": "x", className: "vp-gizmo__axis vp-gizmo__axis--x", x1: "32", y1: "32", x2: "54", y2: "32" }), _jsx("line", { "data-axis": "y", className: "vp-gizmo__axis vp-gizmo__axis--y", x1: "32", y1: "32", x2: "32", y2: "10" }), _jsx("line", { "data-axis": "z", className: "vp-gizmo__axis vp-gizmo__axis--z", x1: "32", y1: "32", x2: "44", y2: "44" }), _jsxs("g", { "data-axis": "x", transform: "translate(54 32)", children: [_jsx("circle", { r: "6", className: "vp-gizmo__cap vp-gizmo__cap--x" }), _jsx("text", { className: "vp-gizmo__text", dy: "2.5", children: "X" })] }), _jsxs("g", { "data-axis": "y", transform: "translate(32 10)", children: [_jsx("circle", { r: "6", className: "vp-gizmo__cap vp-gizmo__cap--y" }), _jsx("text", { className: "vp-gizmo__text", dy: "2.5", children: "Y" })] }), _jsxs("g", { "data-axis": "z", transform: "translate(44 44)", children: [_jsx("circle", { r: "6", className: "vp-gizmo__cap vp-gizmo__cap--z" }), _jsx("text", { className: "vp-gizmo__text", dy: "2.5", children: "Z" })] })] }) }) })] }));
});
/** Loading state: a quiet skeleton surface and one line of text. */
function ViewportLoading({ text }) {
    return (_jsxs("div", { className: "vp-loading", role: "status", children: [_jsx("span", { className: "vp-loading__surface skeleton", "aria-hidden": "true" }), _jsx("span", { className: "vp-loading__text", children: text })] }));
}
/** The viewport. */
export const Viewport = memo(function Viewport() {
    const studio = useStudio();
    const hostRef = useRef(null);
    const loading = useUI((s) => s.loading);
    const fatal = useUI((s) => s.fatal);
    const mode = useUI((s) => s.mode);
    const [dropping, setDropping] = useState(false);
    // A new epoch (context-loss recovery, backend switch) remounts the canvas: a lost context is never reused.
    const epoch = useUI((s) => s.rendererEpoch);
    const playing = mode === 'play';
    const voxelGame = useUI((s) => s.voxelHud !== null);
    // The title card owns the screen until Start: no touch controls underneath it.
    const introHeld = useUI((s) => s.game.intro);
    const titleHeld = introHeld;
    // The inventory screen takes the touch area: no stick or buttons over it.
    const voxelUi = useUI((s) => s.voxelHud?.inventoryOpen === true || s.voxelHud?.dead === true);
    const photo = useUI((s) => s.arch.photo && s.mode === 'play');
    const planOpen = useUI((s) => s.arch.plan && s.arch.building !== null && s.mode === 'edit');
    const viewer = useUI((s) => s.viewer);
    // Entering play: a short iris opens the viewport (CSS; skipped with reduced motion).
    const [entering, setEntering] = useState(false);
    useEffect(() => {
        if (!playing)
            return;
        setEntering(true);
        const t = setTimeout(() => setEntering(false), 700);
        return () => clearTimeout(t);
    }, [playing]);
    useEffect(() => {
        const host = hostRef.current;
        if (!host)
            return;
        const canvas = document.createElement('canvas');
        canvas.className = 'viewport__canvas';
        canvas.tabIndex = 0;
        canvas.setAttribute('aria-label', '3D viewport');
        host.appendChild(canvas);
        let teardown = null;
        let cancelled = false;
        void studio.attachCanvas(canvas).then((t) => {
            if (cancelled)
                t();
            else
                teardown = t;
        });
        return () => {
            cancelled = true;
            teardown?.();
            canvas.remove();
        };
    }, [studio, epoch]);
    const ready = !loading && !fatal;
    return (_jsxs("section", { className: `viewport${playing ? ' is-playing' : ''}${entering ? ' is-entering' : ''}${dropping ? ' is-dropping' : ''}${photo ? ' is-photo' : ''}${planOpen ? ' is-plan' : ''}`, "aria-label": "Viewport", onDragOver: (e) => {
            const types = [...e.dataTransfer.types];
            if (playing || viewer || (!types.includes(PALETTE_DRAG_TYPE) && !types.includes(MATERIAL_DRAG_TYPE) && !types.includes(ASSET_DRAG_TYPE) && !types.includes('Files')))
                return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            setDropping(true);
            if (dragState.asset) {
                const rect = e.currentTarget.getBoundingClientRect();
                studio.assets.previewDrop(dragState.asset, { x: ((e.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1, y: -((e.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1 });
            }
        }, onDragLeave: () => {
            setDropping(false);
            studio.assets.clearPreview();
        }, onDrop: (e) => {
            setDropping(false);
            studio.assets.clearPreview();
            dragState.asset = null;
            if (playing || viewer)
                return;
            const rect = e.currentTarget.getBoundingClientRect();
            const ndc = { x: ((e.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1, y: -((e.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1 };
            const assetId = e.dataTransfer.getData(ASSET_DRAG_TYPE);
            if (assetId) {
                e.preventDefault();
                void studio.assets.place(assetId, ndc);
                return;
            }
            if (e.dataTransfer.files.length > 0) {
                e.preventDefault();
                void studio.assets.importFiles([...e.dataTransfer.files], ndc);
                return;
            }
            const material = parseMaterialDrag(e.dataTransfer.getData(MATERIAL_DRAG_TYPE));
            if (material) {
                e.preventDefault();
                const rect = e.currentTarget.getBoundingClientRect();
                const x = ((e.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
                const y = -((e.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;
                if (!studio.editor.dropMaterial(x, y, material.spec, material.name))
                    studio.store.getState().toast('Drop the material onto an object.', 'info', 3);
                return;
            }
            const id = e.dataTransfer.getData(PALETTE_DRAG_TYPE);
            if (!id)
                return;
            e.preventDefault();
            void studio.addFromPalette(id);
        }, children: [_jsx("div", { className: "viewport__host", ref: hostRef, "data-layout-ignore": "" }), ready && _jsx(ViewOverlays, { playing: playing }), ready && planOpen && _jsx(PlanView, {}), ready && _jsx(ArchBar, {}), _jsxs("div", { className: "vp-overlay vp-overlay--tl", children: [ready && !playing && (_jsxs("div", { className: "vp-row", children: [_jsx(CameraPresets, {}), _jsx(TourButton, {})] })), _jsx(PerfHud, {}), ready && _jsx(GeometryBadge, {})] }), _jsxs("div", { className: "vp-overlay vp-overlay--tr", children: [playing ? !voxelGame && _jsx(CameraToggle, {}) : ready && (_jsxs(_Fragment, { children: [_jsx(PlaytestPill, {}), _jsx(VerifyPill, {})] })), ready && !playing && _jsx(DisplayMenu, {})] }), ready && !playing && !viewer && (_jsx("div", { className: "vp-context", children: _jsx(ContextBar, {}) })), _jsx(BusyIndicator, {}), ready && _jsx(ProofSeal, {}), ready && _jsx(ReplayBar, {}), voxelGame ? (_jsx(VoxelHud, {})) : (_jsx(PlayHud, {})), _jsx(NpcSpeech, {}), !voxelGame && _jsx(InteractPromptView, {}), _jsx(RevealOverlay, {}), _jsx(TitleCard, {}), ready && playing && !voxelUi && _jsx(PlayTweak, {}), ready && playing && !voxelUi && !titleHeld && _jsx(TouchControls, {}), ready && !playing && (_jsxs("div", { className: "vp-bottom", children: [_jsx(NavHint, {}), !viewer && _jsx(ToolDock, {})] })), loading && !fatal && _jsx(ViewportLoading, { text: loading }), fatal && (_jsxs("div", { className: "vp-fatal", role: "alert", children: [_jsx("span", { className: "vp-fatal__icon", children: _jsx(Icon, { name: "alert", size: 20 }) }), _jsx("h3", { children: "3D is unavailable" }), _jsx("p", { children: fatal }), _jsx("p", { className: "vp-fatal__hint", children: "Try a recent Chrome, Edge, Firefox or Safari with hardware acceleration enabled." })] }))] }));
});
