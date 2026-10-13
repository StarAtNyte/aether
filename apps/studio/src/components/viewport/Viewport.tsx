/**
 * Centre viewport: the canvas (created imperatively per mount so a renderer
 * never shares a GPU context with a disposed one — StrictMode safe) and its
 * quiet overlays: camera presets and performance (top-left), checks and
 * display options (top-right), the tool dock (bottom-centre), the axis
 * gizmo (bottom-right), the first-use navigation hint, floating labels,
 * the agent progress bar, play HUD and touch controls.
 */
import { memo, useEffect, useRef, useState, type ReactElement } from 'react';
import { useSimulation, useStudio, useUI, useWorld } from '../../app/context';
import { liveAgentLine } from '../../lib/agentLine';
import { shortcut } from '../../lib/keys';
import { worldLabels } from '../../lib/labels';
import { ViewOverlay } from '../../engine/viewOverlay';
import { PALETTE_DRAG_TYPE } from '../../editor/AssetsPanel';
import { Icon } from '../Icon';
import { Menu } from '../ui/Menu';
import { Segmented } from '../ui/Segmented';
import { PerfHud } from './PerfHud';
import { PlayHud } from './PlayHud';
import { TouchControls } from './TouchControls';
import { VerifyPill } from './VerifyPill';

type CameraPreset = 'iso' | 'top' | 'front' | 'side';

/** Camera presets (edit mode). */
const CameraPresets = memo(function CameraPresets(): ReactElement {
  const studio = useStudio();
  const [preset, setPreset] = useState<CameraPreset>('iso');
  return (
    <Segmented<CameraPreset>
      label="Camera"
      size="sm"
      value={preset}
      onChange={(v) => {
        setPreset(v);
        studio.viewPreset(v);
      }}
      options={[
        ['iso', '3D'],
        ['top', 'Top'],
        ['front', 'Front'],
        ['side', 'Side'],
      ]}
      titles={{ iso: '3D view (1)', top: 'Top view (2)', front: 'Front view (3)', side: 'Side view (4)' }}
    />
  );
});

/** Play-mode camera switcher. */
const CameraToggle = memo(function CameraToggle(): ReactElement {
  const studio = useStudio();
  const view = useUI((s) => s.cameraView);
  return (
    <Segmented<'follow' | 'firstPerson' | 'orbit'>
      label="Camera"
      size="sm"
      value={view}
      onChange={(v) => studio.setCameraView(v)}
      options={[
        ['follow', 'Follow'],
        ['firstPerson', 'First person'],
        ['orbit', 'Orbit'],
      ]}
    />
  );
});

/** Display options menu (top-right). */
const DisplayMenu = memo(function DisplayMenu(): ReactElement {
  const studio = useStudio();
  const s = useUI((x) => x.settings);
  const update = studio.store.getState().updateSettings;
  return (
    <Menu
      label="Display options"
      align="end"
      width={220}
      items={[
        { id: 'labels', label: 'Object labels', checked: s.showLabels, shortcut: 'L', onSelect: () => update({ showLabels: !s.showLabels }) },
        { id: 'perf', label: 'Performance', checked: s.showPerf, shortcut: shortcut('Shift+P'), onSelect: () => update({ showPerf: !s.showPerf }) },
        { id: 'colliders', label: 'Colliders', checked: s.showColliders, onSelect: () => update({ showColliders: !s.showColliders }) },
        { id: 'hint', label: 'Navigation hint', checked: s.showNavHint, onSelect: () => update({ showNavHint: !s.showNavHint }) },
      ]}
      trigger={(t) => (
        <button {...t} type="button" className="vp-btn" aria-label="Display options" data-tip="Display options" data-tip-align="end">
          <Icon name="eye" />
        </button>
      )}
    />
  );
});

/** Floating tool dock (bottom-centre, edit mode). */
const ToolDock = memo(function ToolDock(): ReactElement {
  const studio = useStudio();
  const selection = useUI((s) => s.selection);
  const labels = useUI((s) => s.settings.showLabels);
  const st = studio.store.getState();
  const has = selection.length > 0;
  return (
    <div className="dock" role="toolbar" aria-label="Tools">
      <button type="button" className="dock__btn" onClick={() => st.showLeftView('assets')} aria-label="Add object" data-tip="Add object" data-kbd="A" data-tip-pos="top">
        <Icon name="plus" />
      </button>
      <span className="dock__sep" aria-hidden="true" />
      <button type="button" className="dock__btn" disabled={!has} onClick={() => selection[0] && studio.focus(selection[0])} aria-label="Focus selection" data-tip="Focus selection" data-kbd="F" data-tip-pos="top">
        <Icon name="focus" />
      </button>
      <button type="button" className="dock__btn" disabled={!has} onClick={() => studio.deleteEntities(selection)} aria-label="Delete selection" data-tip="Delete" data-kbd="Del" data-tip-pos="top">
        <Icon name="trash" />
      </button>
      <span className="dock__sep" aria-hidden="true" />
      <button type="button" className="dock__btn" onClick={() => studio.viewPreset('reset')} aria-label="Frame world" data-tip="Frame world" data-kbd="0" data-tip-pos="top">
        <Icon name="maximize" />
      </button>
      <button type="button" className={`dock__btn${labels ? ' is-active' : ''}`} aria-pressed={labels} onClick={() => st.updateSettings({ showLabels: !labels })} aria-label="Object labels" data-tip="Object labels" data-kbd="L" data-tip-pos="top">
        <Icon name="tag" />
      </button>
    </div>
  );
});

/** First-use navigation hint (dismissed once, remembered). */
const NavHint = memo(function NavHint(): ReactElement | null {
  const studio = useStudio();
  const show = useUI((s) => s.settings.showNavHint);
  if (!show) return null;
  return (
    <div className="nav-hint" role="note">
      <span className="nav-hint__item">
        <Icon name="mouse" />
        <span>
          <b>Drag</b> rotate
        </span>
      </span>
      <span className="nav-hint__item">
        <Icon name="hand" />
        <span>
          <b>Right-drag</b> pan
        </span>
      </span>
      <span className="nav-hint__item">
        <Icon name="zoom" />
        <span>
          <b>Scroll</b> zoom
        </span>
      </span>
      <button type="button" className="icon-btn icon-btn--sm" aria-label="Dismiss navigation hint" onClick={() => studio.store.getState().updateSettings({ showNavHint: false })}>
        <Icon name="x" />
      </button>
    </div>
  );
});

/** Agent progress: a hairline bar along the top edge and a status line. */
const BusyIndicator = memo(function BusyIndicator(): ReactElement | null {
  const busy = useUI((s) => s.agentBusy);
  const line = useUI(liveAgentLine);
  if (!busy) return null;
  return (
    <>
      <span className="vp-progress" aria-hidden="true" />
      <div className="vp-status" role="status" aria-live="polite">
        <span className="vp-status__dot" aria-hidden="true" />
        <span className="vp-status__text">{line}</span>
      </div>
    </>
  );
});

/** Axis gizmo + labels driven by the simulation's view listener. */
const ViewOverlays = memo(function ViewOverlays({ playing }: { playing: boolean }): ReactElement {
  const studio = useStudio();
  const sim = useSimulation();
  const world = useWorld();
  const showLabels = useUI((s) => s.settings.showLabels);
  const gizmoRef = useRef<SVGSVGElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<ViewOverlay | null>(null);

  useEffect(() => {
    const svg = gizmoRef.current;
    if (!sim || !svg) return;
    const lines = [...svg.querySelectorAll<SVGLineElement>('line[data-axis]')] as [SVGLineElement, SVGLineElement, SVGLineElement];
    const dots = [...svg.querySelectorAll<SVGGElement>('g[data-axis]')] as [SVGGElement, SVGGElement, SVGGElement];
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
    overlayRef.current?.setLabels(showLabels && !playing ? worldLabels(world) : []);
  }, [world, showLabels, playing, sim]);

  return (
    <>
      <div className="vp-labels" ref={layerRef} aria-hidden="true" />
      <div className={`vp-gizmo${playing ? ' is-hidden' : ''}`}>
        <button type="button" className="vp-gizmo__btn" onClick={() => studio.viewPreset('reset')} aria-label="Reset camera" data-tip="Reset camera" data-kbd="0" data-tip-pos="left">
          <svg ref={gizmoRef} width="64" height="64" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
            <line data-axis="x" className="vp-gizmo__axis vp-gizmo__axis--x" x1="32" y1="32" x2="54" y2="32" />
            <line data-axis="y" className="vp-gizmo__axis vp-gizmo__axis--y" x1="32" y1="32" x2="32" y2="10" />
            <line data-axis="z" className="vp-gizmo__axis vp-gizmo__axis--z" x1="32" y1="32" x2="44" y2="44" />
            <g data-axis="x" transform="translate(54 32)">
              <circle r="6" className="vp-gizmo__cap vp-gizmo__cap--x" />
              <text className="vp-gizmo__text" dy="2.5">
                X
              </text>
            </g>
            <g data-axis="y" transform="translate(32 10)">
              <circle r="6" className="vp-gizmo__cap vp-gizmo__cap--y" />
              <text className="vp-gizmo__text" dy="2.5">
                Y
              </text>
            </g>
            <g data-axis="z" transform="translate(44 44)">
              <circle r="6" className="vp-gizmo__cap vp-gizmo__cap--z" />
              <text className="vp-gizmo__text" dy="2.5">
                Z
              </text>
            </g>
          </svg>
        </button>
      </div>
    </>
  );
});

/** Loading state: a quiet skeleton surface and one line of text. */
function ViewportLoading({ text }: { text: string }): ReactElement {
  return (
    <div className="vp-loading" role="status">
      <span className="vp-loading__surface skeleton" aria-hidden="true" />
      <span className="vp-loading__text">{text}</span>
    </div>
  );
}

/** The viewport. */
export const Viewport = memo(function Viewport(): ReactElement {
  const studio = useStudio();
  const hostRef = useRef<HTMLDivElement>(null);
  const loading = useUI((s) => s.loading);
  const fatal = useUI((s) => s.fatal);
  const mode = useUI((s) => s.mode);
  const [dropping, setDropping] = useState(false);
  // A new epoch (context-loss recovery, backend switch) remounts the canvas: a lost context is never reused.
  const epoch = useUI((s) => s.rendererEpoch);
  const playing = mode === 'play';

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const canvas = document.createElement('canvas');
    canvas.className = 'viewport__canvas';
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', '3D viewport');
    host.appendChild(canvas);
    let teardown: (() => void) | null = null;
    let cancelled = false;
    void studio.attachCanvas(canvas).then((t) => {
      if (cancelled) t();
      else teardown = t;
    });
    return () => {
      cancelled = true;
      teardown?.();
      canvas.remove();
    };
  }, [studio, epoch]);

  const ready = !loading && !fatal;
  return (
    <section
      className={`viewport${playing ? ' is-playing' : ''}${dropping ? ' is-dropping' : ''}`}
      aria-label="Viewport"
      onDragOver={(e) => {
        if (playing || ![...e.dataTransfer.types].includes(PALETTE_DRAG_TYPE)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setDropping(true);
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        setDropping(false);
        const id = e.dataTransfer.getData(PALETTE_DRAG_TYPE);
        if (!id) return;
        e.preventDefault();
        void studio.addFromPalette(id);
      }}
    >
      <div className="viewport__host" ref={hostRef} />
      {ready && <ViewOverlays playing={playing} />}
      <div className="vp-overlay vp-overlay--tl">
        {ready && !playing && <CameraPresets />}
        <PerfHud />
      </div>
      <div className="vp-overlay vp-overlay--tr">
        {playing ? <CameraToggle /> : ready && <VerifyPill />}
        {ready && !playing && <DisplayMenu />}
      </div>
      <BusyIndicator />
      <PlayHud />
      {ready && playing && <TouchControls />}
      {ready && !playing && (
        <div className="vp-bottom">
          <NavHint />
          <ToolDock />
        </div>
      )}
      {loading && !fatal && <ViewportLoading text={loading} />}
      {fatal && (
        <div className="vp-fatal" role="alert">
          <span className="vp-fatal__icon">
            <Icon name="alert" size={20} />
          </span>
          <h3>3D is unavailable</h3>
          <p>{fatal}</p>
          <p className="vp-fatal__hint">Try a recent Chrome, Edge, Firefox or Safari with hardware acceleration enabled.</p>
        </div>
      )}
    </section>
  );
});
