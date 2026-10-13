/**
 * Side panel shells: the left panel (view chosen on the icon rail), the
 * right inspector, the collapsed right rail (medium layout) and the resize
 * handle shared by both sides.
 */
import { memo, useRef, type KeyboardEvent, type PointerEvent, type ReactElement, type ReactNode } from 'react';
import { useStudio, useUI } from '../app/context';
import type { LeftView } from '../state/store';
import { PANEL_WIDTH } from '../lib/layout';
import { Icon } from '../components/Icon';
import { Menu } from '../components/ui/Menu';
import { HistoryPanel } from '../components/panels/HistoryPanel';
import { LogicPanel } from '../components/panels/LogicPanel';
import { Outliner } from '../components/panels/Outliner';
import { VerifyPanel } from '../components/panels/VerifyPanel';
import { AgentPanel } from './AgentPanel';
import { AssetsPanel } from './AssetsPanel';
import { LEFT_VIEWS } from './IconRail';
import { InspectorPanel } from './InspectorPanel';

/** Panel header: title on the left, actions on the right. */
export function PanelHeader({ title, children, id }: { title: string; children?: ReactNode; id?: string }): ReactElement {
  return (
    <div className="panel__header">
      <h2 className="panel__title" id={id}>
        {title}
      </h2>
      {children && <div className="panel__actions">{children}</div>}
    </div>
  );
}

const ProviderChip = memo(function ProviderChip(): ReactElement | null {
  const provider = useUI((s) => s.provider);
  if (provider.status === 'checking') return <span className="chip chip--quiet">Connecting…</span>;
  return (
    <span className="chip chip--quiet" data-tip={provider.status === 'live' ? `Model: ${provider.name}` : 'Built-in planner (runs in your browser)'}>
      <span className={`status-dot${provider.status === 'live' ? ' is-live' : ''}`} aria-hidden="true" />
      {provider.status === 'live' ? 'Connected' : 'Offline planner'}
    </span>
  );
});

/** Body of a left view (also used by the phone sheet). */
export function LeftViewBody({ view }: { view: LeftView }): ReactElement {
  switch (view) {
    case 'agent':
      return <AgentPanel />;
    case 'objects':
      return <Outliner />;
    case 'assets':
      return <AssetsPanel />;
    case 'logic':
      return <LogicPanel />;
    case 'verify':
      return <VerifyPanel />;
    case 'history':
      return <HistoryPanel />;
  }
}

/** Header actions of a left view. */
export const LeftViewActions = memo(function LeftViewActions({ view }: { view: LeftView }): ReactElement | null {
  const studio = useStudio();
  const chatLength = useUI((s) => s.chat.length);
  const busy = useUI((s) => s.agentBusy);
  if (view !== 'agent') return null;
  return (
    <>
      <ProviderChip />
      <Menu
        label="Agent actions"
        align="end"
        items={[{ id: 'clear', label: 'Clear conversation', icon: 'trash', disabled: busy || chatLength === 0, onSelect: () => studio.store.getState().clearChat() }]}
        trigger={(t) => (
          <button {...t} type="button" className="icon-btn icon-btn--sm" aria-label="Agent actions" data-tip="More">
            <Icon name="more" />
          </button>
        )}
      />
    </>
  );
});

/** The left panel. */
export const LeftPanel = memo(function LeftPanel(): ReactElement {
  const view = useUI((s) => s.leftView);
  const title = LEFT_VIEWS.find((v) => v.id === view)?.label ?? '';
  return (
    <section className="panel panel--left" id="left-panel" role="tabpanel" aria-labelledby={`rail-${view}`}>
      <PanelHeader title={title}>
        <LeftViewActions view={view} />
      </PanelHeader>
      <div className="panel__body">
        <LeftViewBody view={view} />
      </div>
    </section>
  );
});

/** The right panel (inspector). */
export const RightPanel = memo(function RightPanel(): ReactElement {
  return (
    <aside className="panel panel--right" aria-label="Inspector">
      <InspectorPanel />
    </aside>
  );
});

/** Collapsed right side (medium layout): a rail button that opens the inspector. */
export const RightRail = memo(function RightRail(): ReactElement {
  const studio = useStudio();
  const selected = useUI((s) => s.selection.length > 0);
  return (
    <nav className="rail rail--right" aria-label="Inspector">
      <div className="rail__group">
        <button type="button" className="rail__btn" aria-label="Show inspector" data-tip={selected ? 'Inspect selection' : 'Scene settings'} data-tip-pos="left" onClick={() => studio.store.getState().showInspector()}>
          <Icon name="sliders" />
          {selected && <span className="rail__dot" aria-hidden="true" />}
        </button>
      </div>
    </nav>
  );
});

/**
 * Drag handle on a panel's inner edge. Updates the CSS width variable live
 * (no React render per pointer move) and commits the width on release.
 * Keyboard: arrows resize by 16 px, Home resets.
 */
export const ResizeHandle = memo(function ResizeHandle({ side, width, onCommit, hostRef }: { side: 'left' | 'right'; width: number; onCommit: (w: number) => void; hostRef: { current: HTMLElement | null } }): ReactElement {
  const drag = useRef<{ x: number; w: number; cur: number } | null>(null);
  const cssVar = side === 'left' ? '--left-w' : '--right-w';
  const clamp = (w: number): number => Math.round(Math.max(PANEL_WIDTH.min, Math.min(PANEL_WIDTH.max, w)));
  const onDown = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, w: width, cur: width };
    hostRef.current?.classList.add('is-resizing');
  };
  const onMove = (e: PointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    d.cur = clamp(d.w + (side === 'left' ? dx : -dx));
    hostRef.current?.style.setProperty(cssVar, `${d.cur}px`);
  };
  const onUp = (): void => {
    const d = drag.current;
    drag.current = null;
    hostRef.current?.classList.remove('is-resizing');
    if (d) onCommit(d.cur);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    const grow = side === 'left' ? 'ArrowRight' : 'ArrowLeft';
    const shrink = side === 'left' ? 'ArrowLeft' : 'ArrowRight';
    if (e.key === grow || e.key === shrink) {
      e.preventDefault();
      onCommit(clamp(width + (e.key === grow ? 16 : -16)));
    } else if (e.key === 'Home') {
      e.preventDefault();
      onCommit(side === 'left' ? PANEL_WIDTH.left : PANEL_WIDTH.right);
    }
  };
  return (
    <div
      className={`resize-handle resize-handle--${side}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={side === 'left' ? 'Resize left panel' : 'Resize inspector'}
      aria-valuenow={width}
      aria-valuemin={PANEL_WIDTH.min}
      aria-valuemax={PANEL_WIDTH.max}
      tabIndex={0}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onDoubleClick={() => onCommit(side === 'left' ? PANEL_WIDTH.left : PANEL_WIDTH.right)}
      onKeyDown={onKey}
    />
  );
});
