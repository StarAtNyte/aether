/**
 * Phone layout: a bottom sheet over the viewport with a drag handle (three
 * snap points), a scrollable tab bar and the selected view. The composer
 * stays visible at the smallest snap so a prompt is always one tap away.
 * Hidden in play mode (the touch controls take over).
 */
import { memo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactElement } from 'react';
import { useStudio, useUI } from '../app/context';
import type { LeftView } from '../state/store';
import { Icon, type IconName } from '../components/Icon';
import { InspectorPanel, LeftViewActions, LeftViewBody, PanelHeader } from './Panels';
import { useFailingChecks } from './IconRail';

/** Sheet snap points. */
export type SheetSnap = 'min' | 'half' | 'full';

const TABS: ReadonlyArray<{ id: LeftView | 'inspector'; label: string; icon: IconName }> = [
  { id: 'agent', label: 'Agent', icon: 'sparkles' },
  { id: 'objects', label: 'Objects', icon: 'layers' },
  { id: 'inspector', label: 'Inspect', icon: 'sliders' },
  { id: 'assets', label: 'Assets', icon: 'shapes' },
  { id: 'logic', label: 'Logic', icon: 'zap' },
  { id: 'verify', label: 'Checks', icon: 'shield' },
  { id: 'history', label: 'History', icon: 'history' },
];

/** Nearest snap for a sheet height as a fraction of the available height (pure; exported for tests). */
export function nearestSnap(fraction: number): SheetSnap {
  if (!Number.isFinite(fraction) || fraction < 0.38) return 'min';
  if (fraction < 0.78) return 'half';
  return 'full';
}

/** The phone bottom sheet. */
export const MobileSheet = memo(function MobileSheet(): ReactElement {
  const studio = useStudio();
  const tab = useUI((s) => s.sheetTab);
  const mode = useUI((s) => s.mode);
  const failing = useFailingChecks();
  const [snap, setSnap] = useState<SheetSnap>('min');
  const sheetRef = useRef<HTMLElement>(null);
  const drag = useRef<{ y: number; h: number; parent: number } | null>(null);

  const onDown = (e: PointerEvent<HTMLDivElement>): void => {
    const sheet = sheetRef.current;
    const parent = sheet?.parentElement;
    if (!sheet || !parent) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, h: sheet.getBoundingClientRect().height, parent: parent.getBoundingClientRect().height };
    sheet.classList.add('is-dragging');
  };
  const onMove = (e: PointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    const sheet = sheetRef.current;
    if (!d || !sheet) return;
    const h = Math.max(120, Math.min(d.parent, d.h - (e.clientY - d.y)));
    sheet.style.height = `${h}px`;
  };
  const onUp = (e: PointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    const sheet = sheetRef.current;
    drag.current = null;
    if (!d || !sheet) return;
    sheet.classList.remove('is-dragging');
    const moved = Math.abs(e.clientY - d.y);
    const h = sheet.getBoundingClientRect().height;
    sheet.style.height = '';
    // A tap toggles between the smallest and the middle snap.
    if (moved < 6) setSnap((s) => (s === 'min' ? 'half' : 'min'));
    else setSnap(nearestSnap(h / Math.max(1, d.parent)));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    const order: SheetSnap[] = ['min', 'half', 'full'];
    const i = order.indexOf(snap);
    if (e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setSnap(order[Math.min(2, i + 1)] ?? 'full');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSnap(order[Math.max(0, i - 1)] ?? 'min');
    }
  };

  const pick = (id: LeftView | 'inspector'): void => {
    const st = studio.store.getState();
    st.setSheetTab(id);
    if (id !== 'inspector') st.setLeftView(id);
    if (snap === 'min' && id !== 'agent') setSnap('half');
  };

  const current = TABS.find((t) => t.id === tab) ?? TABS[0];
  return (
    <section ref={sheetRef} className={`sheet is-${snap}${mode === 'play' ? ' is-hidden' : ''}`} aria-label="Panels">
      <div
        className="sheet__handle"
        role="button"
        tabIndex={0}
        aria-label={snap === 'min' ? 'Expand panel' : 'Resize panel'}
        aria-expanded={snap !== 'min'}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onKeyDown={onKey}
      >
        <span className="sheet__grip" aria-hidden="true" />
      </div>
      <div className="sheet__tabs scroll-x" role="tablist" aria-label="Panel">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`sheet__tab${tab === t.id ? ' is-active' : ''}`} onClick={() => pick(t.id)}>
            <Icon name={t.icon} />
            <span>{t.label}</span>
            {t.id === 'verify' && failing > 0 && <span className="sheet__badge">{failing}</span>}
          </button>
        ))}
      </div>
      <div className="sheet__body" role="tabpanel" aria-label={current?.label}>
        {tab === 'inspector' ? (
          <div className="sheet__inspector">
            <InspectorPanel />
          </div>
        ) : (
          <>
            {tab !== 'agent' && (
              <PanelHeader title={current?.label ?? ''}>
                <LeftViewActions view={tab} />
              </PanelHeader>
            )}
            <div className="panel__body">
              <LeftViewBody view={tab} />
            </div>
          </>
        )}
      </div>
    </section>
  );
});
